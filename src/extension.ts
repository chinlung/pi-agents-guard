import { realpathSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
	type ExtensionAPI,
	isBashToolResult,
} from "@earendil-works/pi-coding-agent";
import type { Runtime, RuntimeDeps } from "./runtime/contracts.js";
import { readJsonFile, resolveStateDir, writeJsonFileAtomic } from "./state.js";
import { isModuleName, MODULE_NAMES, type WriterNotice } from "./types.js";

export function registerAgentsGuard(
	pi: ExtensionAPI,
	makeRuntime: (deps: RuntimeDeps) => Runtime,
): void {
	pi.registerFlag("agents-guard", {
		description:
			"agents-guard modules: off | on | comma-separated module names",
		type: "string",
	});

	const home = homedir();
	const stateDir = resolveStateDir(process.env, home);
	const configPath = join(stateDir, "config.json");
	const fileRead = readJsonFile(configPath);

	let runtime: Runtime | undefined;

	/**
	 * Command output must survive a non-interactive session: `ctx.ui.notify` is a
	 * no-op in print and json modes, so `/agents-guard status` would print
	 * nothing there. Found by running `pi -e ... -p "/agents-guard"`.
	 */
	const emit = (
		ctx: {
			hasUI: boolean;
			ui: {
				notify: (message: string, level: "info" | "warning" | "error") => void;
			};
		},
		message: string,
		level: "info" | "warning" | "error",
	): void => {
		if (ctx.hasUI) ctx.ui.notify(message, level);
		else if (level === "error") console.error(message);
		else console.log(message);
	};

	const emitWriter = (
		ctx: Parameters<typeof emit>[0],
		message: string,
		level: WriterNotice["level"],
	): void => {
		try {
			emit(ctx, message, level);
		} catch {
			try {
				console.warn(message);
			} catch {
				/* A broken output channel never gates tools. */
			}
		}
	};
	const emitPending = (
		ctx: Parameters<typeof emit>[0],
		current: Runtime,
	): void => {
		const pending = current.takeWriterNotice();
		if (pending !== undefined) emitWriter(ctx, pending.message, pending.level);
	};
	const ensureRuntime = (cwd: string): Runtime => {
		if (runtime === undefined) {
			const rawFlag = pi.getFlag("agents-guard");
			runtime = makeRuntime({
				fileConfig: fileRead.value,
				env: process.env,
				flag: typeof rawFlag === "string" ? rawFlag : undefined,
				resolver: { realpathSync, cwd, home },
				log: (message) => console.warn(message),
				writerLock: {
					self: {
						sessionId: "pending",
						pid: process.pid,
						host: hostname(),
						isSubagentChild: process.env.PI_SUBAGENT_CHILD === "1",
					},
					stateDir,
					isPidAlive: () => false, // Deprecated compatibility field; never called.
				},
				gitEvidence: {
					exec: (command, args, options) => pi.exec(command, args, options),
				},
			});
			if (fileRead.error !== undefined) {
				console.warn(
					`agents-guard: ignoring unreadable config at ${configPath} (${fileRead.error})`,
				);
			}
		}
		return runtime;
	};

	pi.on("session_start", async (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		for (const warning of current.warnings()) emit(ctx, warning, "warning");

		current.setSessionId(ctx.sessionManager.getSessionId());
		const notice = await current.refreshWriterNotice(
			ctx.cwd,
			Date.now(),
			"startup",
			ctx.signal,
		);
		if (notice !== undefined) emitWriter(ctx, notice.message, notice.level);
	});

	pi.on("turn_end", (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		current.heartbeatWriterLock(Date.now());
		emitPending(ctx, current);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		current.shutdownCompletion();
		current.releaseWriterLock();
		emitPending(ctx, current);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		const check = await current.collectCompletionDiff(ctx.cwd, ctx.signal);
		const result = check?.finish();
		if (result === undefined) return;

		pi.appendEntry("agents-guard-diff", { card: result.card });
		emit(ctx, `agents-guard: ${result.card}`, "warning");

		if (result.shouldFollowUp) {
			pi.sendMessage(
				{
					customType: "agents-guard-diff-followup",
					display: true,
					content: [
						{
							type: "text",
							text: `[agents-guard] 收尾後偵測到 git 狀態與最後回報不同（AGENTS.md:111）：\n\n${result.card}\n\n請重新確認實際變更，並修正最終回報。`,
						},
					],
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		const decision = ensureRuntime(ctx.cwd).handleToolCall(
			event.toolName,
			event.input as Record<string, unknown>,
		);
		if (decision.kind === "block")
			return { block: true, reason: decision.reason };
		return undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		current.handleToolResult(
			event.toolName,
			event.input,
			event.isError,
			event.content,
		);

		if (isBashToolResult(event)) {
			const command = event.input.command;
			if (typeof command === "string") {
				const evidence = await current.augmentGitEvidence(
					command,
					event.isError,
					ctx.signal,
				);
				if (evidence !== undefined) {
					return {
						content: [
							...event.content,
							{ type: "text" as const, text: evidence },
						],
					};
				}
			}
		}
		return undefined;
	});

	pi.registerCommand("agents-guard", {
		description: "Inspect or toggle agents-guard modules",
		handler: async (args, ctx) => {
			const current = ensureRuntime(ctx.cwd);
			const [verb, target] = args
				.trim()
				.split(/\s+/)
				.filter((part) => part !== "");

			if (verb === undefined || verb === "status") {
				current.setSessionId(ctx.sessionManager.getSessionId());
				await current.refreshWriterNotice(
					ctx.cwd,
					Date.now(),
					"status",
					ctx.signal,
				);
				current.takeWriterNotice();
				emitWriter(ctx, current.status(), "info");
				return;
			}
			if (verb === "save") {
				writeJsonFileAtomic(configPath, current.save());
				emit(ctx, `agents-guard: saved to ${configPath}`, "info");
				return;
			}
			if (verb === "on" || verb === "off") {
				const enabled = verb === "on";
				if (target === undefined) {
					current.setEnabled("all", enabled);
				} else if (isModuleName(target)) {
					current.setEnabled(target, enabled);
				} else {
					emit(
						ctx,
						`agents-guard: unknown module "${target}". Known: ${MODULE_NAMES.join(", ")}`,
						"error",
					);
					return;
				}
				if (enabled && (target === undefined || target === "writer-lock")) {
					current.setSessionId(ctx.sessionManager.getSessionId());
					await current.refreshWriterNotice(
						ctx.cwd,
						Date.now(),
						"enabled",
						ctx.signal,
					);
				}
				current.takeWriterNotice();
				emitWriter(ctx, current.status(), "info");
				return;
			}
			if (verb === "takeover" || verb === "unlock") {
				const notice = current.takeoverWriterLock(
					{ root: ctx.cwd, branch: "" },
					Date.now(),
				);
				emitWriter(ctx, notice.message, notice.level);
				return;
			}
			emit(
				ctx,
				"agents-guard usage: /agents-guard [status] | on [module] | off [module] | save | takeover | unlock",
				"warning",
			);
		},
		getArgumentCompletions: (prefix: string) => {
			const items = [
				"status",
				"on",
				"off",
				"save",
				"takeover",
				"unlock",
				...MODULE_NAMES,
			].map((value) => ({
				value,
				label: value,
			}));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
	});
}
