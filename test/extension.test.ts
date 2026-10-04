import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentsGuard } from "../src/extension.js";
import { createRuntime, type RuntimeDeps } from "../src/index.js";
import {
	lockFilePath,
	presenceDirectoryKey,
} from "../src/modules/writer-lock.js";
import { createPresenceFiles, writeJsonFileAtomic } from "../src/state.js";
import { deferred } from "./helpers/deferred.js";
import { createExtensionHarness } from "./helpers/extension-harness.js";

type Harness = ReturnType<typeof createExtensionHarness>;
const result = (
	toolName: string,
	input: Record<string, unknown>,
	text = "",
	isError = false,
): ToolResultEvent => ({
	type: "tool_result",
	toolCallId: "result-1",
	toolName,
	input,
	content: [{ type: "text", text }],
	isError,
	details: undefined,
});
const deniedCall = {
	type: "tool_call" as const,
	toolCallId: "call-1",
	toolName: "bash" as const,
	input: { command: "git add -A" },
};
const dispatch = {
	type: "tool_call" as const,
	toolCallId: "dispatch-1",
	toolName: "subagent",
	input: { agent: "worker", task: "do x" },
};

describe("extension: actual registered hooks", () => {
	let root: string;
	let cwd: string;
	let agentDir: string;
	let configPath: string;
	let lockPath: string;
	let stateDir: string;
	let canonicalCwd: string;
	let h: Harness;
	let now: number;
	let status: string;
	let exec: ReturnType<typeof vi.fn<ExtensionAPI["exec"]>>;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ag-extension-"));
		cwd = join(root, "repo");
		agentDir = join(root, "agent");
		mkdirSync(cwd);
		canonicalCwd = realpathSync(cwd);
		stateDir = join(agentDir, "state", "agents-guard");
		configPath = join(stateDir, "config.json");
		lockPath = join(
			agentDir,
			"state",
			"agents-guard",
			"locks",
			lockFilePath(canonicalCwd),
		);
		now = Date.now();
		status = " M a.txt\n?? b.txt";
		vi.spyOn(Date, "now").mockImplementation(() => now);
		exec = vi.fn<ExtensionAPI["exec"]>(async (command, args, options) => {
			expect(options?.cwd).toBe(cwd);
			const key = `${command} ${args.join(" ")}`;
			const outputs: Record<string, string> = {
				"git --no-optional-locks rev-parse --is-inside-work-tree": "true\n",
				"git --no-optional-locks rev-parse --show-toplevel": `${cwd}\n`,
				"git --no-optional-locks symbolic-ref --quiet --short HEAD": "main\n",
				"git --no-optional-locks status --porcelain=v1 --untracked-files=normal":
					status,
				"git log -1 --format=%H %d %s": "abc123 (HEAD -> main) fix: x",
				"git status --porcelain": status,
				"git diff --stat": " a.txt | 1 +",
			};
			const stdout = Object.hasOwn(outputs, key) ? outputs[key] : undefined;
			if (stdout === undefined) throw new Error(`Unexpected exec: ${key}`);
			return { stdout, stderr: "", code: 0, killed: false };
		});
		try {
			h = createExtensionHarness({
				cwd,
				agentDir,
				sessionId: "session-a",
				exec,
			});
		} catch (error) {
			rmSync(root, { recursive: true, force: true });
			vi.restoreAllMocks();
			throw error;
		}
	});

	afterEach(() => {
		try {
			h?.dispose();
		} finally {
			vi.restoreAllMocks();
			rmSync(root, { recursive: true, force: true });
		}
	});

	function reload(
		options: {
			hasUI?: boolean;
			notifyFailure?: () => void;
			signal?: AbortSignal;
			child?: boolean;
			flag?: string;
			activate?: (pi: ExtensionAPI) => void;
		} = {},
	) {
		h.dispose();
		h = createExtensionHarness({
			cwd,
			agentDir,
			sessionId: "session-b",
			exec,
			...options,
		});
	}

	const records = () =>
		createPresenceFiles(stateDir).scan(canonicalCwd).records;
	const endTurn = () =>
		h.fire({
			type: "turn_end",
			turnIndex: 0,
			message: { role: "user", content: "fixture", timestamp: now },
			toolResults: [],
		});

	async function observeDirtyTree() {
		await h.fire(result("write", { path: "a.txt", content: "x" }));
		await h.fire(
			result("bash", { command: "git status --porcelain" }, " M a.txt"),
		);
	}

	describe("completion boundary", () => {
		const reply = (stdout = status, code = 0, killed = false) => ({
			stdout,
			stderr: "",
			code,
			killed,
		});
		async function ready(signal?: AbortSignal) {
			writeJsonFileAtomic(configPath, {
				modules: {
					"writer-lock": { enabled: false },
					"completion-diff-recheck": {
						followUp: true,
						maxFollowUpsPerSession: 1,
					},
				},
			});
			reload({ signal });
			await observeDirtyTree();
			exec.mockClear();
			h.notices.length = 0;
		}
		function expectSilent() {
			expect(h.entries).toEqual([]);
			expect(h.notices).toEqual([]);
			expect(h.messages).toEqual([]);
		}

		it.each([
			"no-writes",
			"failed-write",
			"child",
			"aborted",
			"global-off",
			"module-off",
		])("completion skips Git when %s", async (reason) => {
			const abort = new AbortController();
			if (reason === "aborted") abort.abort();
			reload({ child: reason === "child", signal: abort.signal });
			await h.command("off writer-lock");
			if (reason !== "no-writes")
				await h.fire(result("write", {}, "", reason === "failed-write"));
			if (reason === "global-off") await h.command("off");
			if (reason === "module-off")
				await h.command("off completion-diff-recheck");
			exec.mockClear();
			h.notices.length = 0;
			await h.fire({ type: "agent_settled" });
			expect(exec).not.toHaveBeenCalled();
			expectSilent();
			expect(h.consoleWarn).not.toHaveBeenCalled();
		});

		it.each(["write", "edit", "ast_grep_replace"])(
			"completion tracks successful %s",
			async (toolName) => {
				await h.command("off writer-lock");
				await h.fire(result(toolName, {}));
				await h.fire({ type: "agent_settled" });
				expect(exec).toHaveBeenCalledTimes(2);
				expect(h.entries).toHaveLength(1);
				expect(h.messages).toEqual([]); // No baseline, even for a tracked write.
			},
		);

		it("completion preserves observations made while disabled", async () => {
			await ready();
			await h.command("off completion-diff-recheck");
			await h.fire(
				result("bash", { command: "git status --porcelain" }, status),
			);
			await h.command("on completion-diff-recheck");
			h.notices.length = 0;
			await h.fire({ type: "agent_settled" });
			expect(exec).toHaveBeenCalledTimes(2);
			expectSilent(); // The disabled-period observation replaced the old baseline.
			status = " M a.txt\n?? c.txt";
			await h.fire({ type: "agent_settled" });
			expect(h.messages).toHaveLength(1);
		});

		it.each([undefined, new AbortController().signal])(
			"completion uses the event cwd and signal %s",
			async (signal) => {
				await ready(signal);
				const nextCwd = join(root, "second");
				mkdirSync(nextCwd);
				h.setContext({ cwd: nextCwd });
				exec.mockResolvedValue(reply());
				await h.fire({ type: "agent_settled" });
				expect(exec.mock.calls).toEqual([
					["git", ["status", "--porcelain"], { cwd: nextCwd, signal }],
					["git", ["diff", "--stat"], { cwd: nextCwd, signal }],
				]);
				for (const call of exec.mock.calls)
					expect(call[2]?.signal).toBe(signal);
			},
		);

		it.each([
			[128, false],
			[0, true],
			[1, true],
		] as const)(
			"completion rejects status code=%s killed=%s",
			async (code, killed) => {
				await ready();
				exec.mockResolvedValueOnce(reply("?? misleading.txt", code, killed));
				await h.fire({ type: "agent_settled" });
				expect(exec).toHaveBeenCalledTimes(1);
				expectSilent();
				expect(h.consoleWarn).not.toHaveBeenCalled();
				await h.fire({ type: "agent_settled" });
				expect(h.messages).toHaveLength(1); // Failed status did not consume the budget.
			},
		);

		it("completion omits unsuccessful display-only statistics", async () => {
			await ready();
			exec
				.mockResolvedValueOnce(reply())
				.mockResolvedValueOnce(reply("private stat output", 1));
			await h.fire({ type: "agent_settled" });
			expect(h.entries).toEqual([
				{
					customType: "agents-guard-diff",
					data: {
						card: expect.stringContaining("b.txt"),
					},
				},
			]);
			expect(JSON.stringify(h.entries)).not.toContain("private stat output");
			expect(h.messages).toHaveLength(1);
			expect(h.consoleWarn).not.toHaveBeenCalled();
		});

		it("completion abandons killed statistics without consuming a follow-up", async () => {
			await ready();
			exec
				.mockResolvedValueOnce(reply())
				.mockResolvedValueOnce(reply("?? misleading.txt", 0, true));
			await h.fire({ type: "agent_settled" });
			expectSilent();
			expect(h.consoleWarn).not.toHaveBeenCalled();
			await h.fire({ type: "agent_settled" });
			expect(h.messages).toHaveLength(1);
		});

		it.each(["status", "diff"])(
			"completion contains an unexpected %s rejection",
			async (stage) => {
				await ready();
				if (stage === "diff") exec.mockResolvedValueOnce(reply());
				const messageRead = vi.fn(() => {
					throw new Error("private getter");
				});
				const error = Object.defineProperty(new Error(), "message", {
					get: messageRead,
				});
				exec.mockRejectedValueOnce(error);
				await expect(
					h.fire({ type: "agent_settled" }),
				).resolves.toBeUndefined();
				expectSilent();
				expect(messageRead).not.toHaveBeenCalled();
				expect(h.consoleWarn).toHaveBeenCalledExactlyOnceWith(
					expect.stringContaining("completion-diff-recheck failed open"),
				);
				expect(h.consoleWarn.mock.calls.flat().join(" ")).not.toContain(
					"private",
				);
				expect(await h.fire(deniedCall)).toMatchObject({ block: true });
				expect(await h.fire(dispatch)).toMatchObject({ block: true });
				await h.fire({ type: "agent_settled" });
				expect(h.messages).toHaveLength(1);
			},
		);

		it.each([false, true])(
			"completion becomes inert despite interrupted logging=%s",
			async (brokenLog) => {
				await ready();
				if (brokenLog)
					h.consoleWarn.mockImplementation(() => {
						throw new Error("private logger");
					});
				for (const fail of [true, false, true, true]) {
					if (fail) exec.mockRejectedValueOnce(new Error("private exec"));
					await expect(
						h.fire({ type: "agent_settled" }),
					).resolves.toBeUndefined();
				}
				expect(h.consoleWarn).toHaveBeenCalledTimes(3);
				expect(h.consoleWarn.mock.calls.flat().join(" ")).not.toContain(
					"private",
				);
				exec.mockClear();
				const entryCount = h.entries.length;
				await h.command("on completion-diff-recheck");
				await h.command("status");
				expect(h.notices.at(-1)?.message).toContain(
					"completion-diff-recheck: enabled (source: command)  [auto-disabled after repeated failures]",
				);
				expect(h.notices.at(-1)?.message.match(/auto-disabled/g)).toHaveLength(
					1,
				);
				await h.fire({ type: "agent_settled" });
				expect(exec).not.toHaveBeenCalled();
				expect(h.entries).toHaveLength(entryCount);
				expect(h.messages).toHaveLength(1);
				expect(await h.fire(deniedCall)).toMatchObject({ block: true });
			},
		);

		const races = (["status", "diff"] as const).flatMap((stage) =>
			(["off-on", "global-off-on", "abort", "shutdown"] as const).flatMap(
				(action) =>
					([false, true] as const).map((reject) => ({ stage, action, reject })),
			),
		);
		it.each(races)(
			"completion discards late $stage result after $action (reject=$reject)",
			async ({ stage, action, reject }) => {
				const abort = new AbortController();
				await ready(abort.signal);
				const entered = deferred<void>();
				const pending = deferred<Awaited<ReturnType<ExtensionAPI["exec"]>>>();
				exec.mockImplementation(async (command, args, options) => {
					expect(command).toBe("git");
					expect(options).toEqual({ cwd, signal: abort.signal });
					if (args[0] === stage) {
						entered.resolve();
						return pending.promise;
					}
					return reply();
				});
				const settled = h.fire({ type: "agent_settled" }).then(
					() => undefined,
					(error: unknown) => error,
				);
				await entered.promise;
				try {
					if (action === "abort") abort.abort();
					else if (action === "shutdown")
						await h.fire({ type: "session_shutdown", reason: "quit" });
					else {
						const suffix =
							action === "off-on" ? " completion-diff-recheck" : "";
						await h.command(`off${suffix}`);
						await h.command(`on${suffix}`);
					}
					h.notices.length = 0;
					if (reject) pending.reject(new Error("late private rejection"));
					else pending.resolve(reply());
					expect(await settled).toBeUndefined();
					expect(exec).toHaveBeenCalledTimes(stage === "status" ? 1 : 2);
					expectSilent();
					expect(h.consoleWarn).not.toHaveBeenCalled();
					exec.mockReset().mockResolvedValue(reply());
					if (action === "shutdown")
						await h.command("on completion-diff-recheck");
					await h.fire({ type: "agent_settled" });
					if (action === "shutdown" || action === "abort")
						expect(exec).not.toHaveBeenCalled();
					else expect(h.messages).toHaveLength(1);
				} finally {
					pending.resolve(reply());
					await settled;
				}
			},
		);

		it.each(["on completion-diff-recheck", "off git-evidence"])(
			"completion remains valid during %s",
			async (command) => {
				await ready();
				const entered = deferred<void>();
				const pending = deferred<Awaited<ReturnType<ExtensionAPI["exec"]>>>();
				exec.mockImplementationOnce(() => {
					entered.resolve();
					return pending.promise;
				});
				const settled = h.fire({ type: "agent_settled" });
				await entered.promise;
				try {
					await h.command(command);
					pending.resolve(reply());
					await settled;
					expect(h.messages).toHaveLength(1);
				} finally {
					pending.resolve(reply());
					await settled;
				}
			},
		);

		it("completion reports dirty-to-clean without contradictory zero-file wording", async () => {
			await ready();
			status = "";
			await h.fire({ type: "agent_settled" });
			expect(h.entries[0]?.data).toEqual({
				card: expect.stringContaining("已恢復成乾淨"),
			});
			expect(JSON.stringify(h.entries)).not.toContain("0 個檔案");
			expect(h.messages).toHaveLength(1);
		});
	});

	it("adapter creates one lazy Runtime and shuts completion before writer cleanup", async () => {
		const trace: string[] = [];
		const makeRuntime = vi.fn((input: RuntimeDeps) => {
			const runtime = createRuntime(input);
			const shutdown = runtime.shutdownCompletion;
			const release = runtime.releaseWriterLock;
			vi.spyOn(runtime, "shutdownCompletion").mockImplementation(() => {
				trace.push("completion");
				shutdown();
			});
			vi.spyOn(runtime, "releaseWriterLock").mockImplementation(() => {
				trace.push("writer");
				release();
			});
			return runtime;
		});
		reload({
			flag: "completion-diff-recheck",
			activate: (api) => registerAgentsGuard(api, makeRuntime),
		});
		expect(makeRuntime).not.toHaveBeenCalled();
		await h.fire(result("write", { path: "a.txt" }));
		expect(makeRuntime).toHaveBeenCalledTimes(1);
		expect(makeRuntime.mock.calls[0]?.[0].resolver.cwd).toBe(cwd);
		const nextCwd = join(root, "second");
		mkdirSync(nextCwd);
		h.setContext({ cwd: nextCwd });
		exec.mockImplementation(async (_command, args) => ({
			stdout:
				args[0] === "log"
					? "abc123 (HEAD -> main) fix: x"
					: args[0] === "status"
						? status
						: " a.txt | 1 +",
			stderr: "",
			code: 0,
			killed: false,
		}));
		await h.command("status");
		await h.fire({ type: "agent_settled" });
		expect(h.entries).toHaveLength(1);
		expect(h.messages).toEqual([]);
		await h.command("on git-evidence");
		expect(
			await h.fire(result("bash", { command: "git commit -m x" })),
		).toMatchObject({
			content: [
				{ type: "text", text: "" },
				{ type: "text", text: expect.stringContaining("commit 驗證") },
			],
		});
		expect(exec.mock.calls).toEqual([
			["git", ["status", "--porcelain"], { cwd: nextCwd, signal: undefined }],
			["git", ["diff", "--stat"], { cwd: nextCwd, signal: undefined }],
			["git", ["log", "-1", "--format=%H %d %s"], { cwd, signal: undefined }],
		]);
		expect(trace).toEqual([]);
		await h.fire({ type: "session_shutdown", reason: "quit" });
		expect(trace).toEqual(["completion", "writer"]);
		await h.fire({ type: "agent_settled" });
		expect(exec).toHaveBeenCalledTimes(3);
		expect(makeRuntime).toHaveBeenCalledTimes(1);
	});

	it("registers every expected event exactly once", () => {
		expect(h.registeredEvents().sort()).toEqual([
			"agent_settled",
			"session_shutdown",
			"session_start",
			"tool_call",
			"tool_result",
			"turn_end",
		]);
	});

	it("blocks through tool_call and applies command toggles immediately", async () => {
		expect(await h.fire(deniedCall)).toMatchObject({ block: true });
		await h.command("off hard-deny");
		expect(await h.fire(deniedCall)).toBeUndefined();
		await h.command("on hard-deny");
		expect(await h.fire(deniedCall)).toMatchObject({ block: true });
	});

	it("honors the CLI flag without changing saved config", async () => {
		reload({ flag: "off" });
		expect(await h.fire(deniedCall)).toBeUndefined();
		expect(existsSync(configPath)).toBe(false);
	});

	it("keeps modules isolated when toggling policy and global gates", async () => {
		await h.command("off subagent-policy");
		expect(await h.fire(dispatch)).toBeUndefined();
		expect(await h.fire(deniedCall)).toMatchObject({ block: true });
		await h.command("off");
		expect(await h.fire(deniedCall)).toBeUndefined();
		await h.command("on");
		expect(await h.fire(deniedCall)).toMatchObject({ block: true });
	});

	it.each([false, true])(
		"only successful capabilities results unlock dispatch (isError=%s)",
		async (isError) => {
			expect(await h.fire(dispatch)).toMatchObject({ block: true });
			await h.fire(
				result(
					"subagent",
					{ action: "list", capabilities: true },
					"listed",
					isError,
				),
			);
			const outcome = await h.fire(dispatch);
			if (isError) expect(outcome).toMatchObject({ block: true });
			else expect(outcome).toBeUndefined();
		},
	);

	it.each([undefined, new AbortController().signal])(
		"preserves output and propagates signal %s for commit evidence",
		async (signal) => {
			reload({ signal });
			const event = result(
				"bash",
				{ command: "git commit -m x" },
				"original output",
			);
			event.content.push({
				type: "image",
				data: "fixture",
				mimeType: "image/png",
			});
			const original = [...event.content];
			const patch = await h.fire(event);
			expect(patch).toEqual({
				content: [
					...original,
					{ type: "text", text: expect.stringContaining("abc123") },
				],
			});
			expect(event.content).toEqual(original);
			expect(exec).toHaveBeenCalledExactlyOnceWith(
				"git",
				["log", "-1", "--format=%H %d %s"],
				{ cwd, signal },
			);
			expect(exec.mock.calls[0]?.[2]?.signal).toBe(signal);
		},
	);

	it("initializes child identity from the environment without claiming a clean worktree", async () => {
		reload({ child: true });
		await h.fire({ type: "session_start", reason: "startup" });
		expect(existsSync(lockPath)).toBe(false);
		expect(exec).not.toHaveBeenCalled();
		expect(await h.fire(dispatch)).toBeUndefined();
	});

	it("does not execute verification for a failed commit", async () => {
		expect(
			await h.fire(
				result("bash", { command: "git commit -m x" }, "failed", true),
			),
		).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
	});

	it("shows a completion entry without injecting default follow-up messages", async () => {
		await observeDirtyTree();
		await h.fire({ type: "agent_settled" });
		expect(h.entries).toEqual([
			{
				customType: "agents-guard-diff",
				data: { card: expect.stringContaining("b.txt") },
			},
		]);
		expect(h.entries[0]?.data).toEqual({
			card: expect.stringContaining("--- git diff --stat ---\na.txt | 1 +"),
		});
		expect(h.notices).toContainEqual({
			message: expect.stringContaining("b.txt"),
			level: "warning",
		});
		expect(h.messages).toEqual([]);
	});

	it("completion never treats appended evidence as its baseline", async () => {
		writeJsonFileAtomic(configPath, {
			modules: {
				"writer-lock": { enabled: false },
				"completion-diff-recheck": {
					followUp: true,
					maxFollowUpsPerSession: 1,
				},
			},
		});
		reload();
		await h.fire(result("write", { path: "a.txt" }));
		const event = result("bash", {
			command: "git status --porcelain && git commit -m x",
		});
		event.content = [{ type: "image", data: "fixture", mimeType: "image/png" }];
		const original = structuredClone(event.content);
		const patch = await h.fire(event);
		expect(patch).toMatchObject({
			content: [...original, { type: "text", text: expect.any(String) }],
		});
		expect(event.content).toEqual(original);
		await h.fire({ type: "agent_settled" });
		expect(h.entries).toHaveLength(1);
		expect(h.messages).toEqual([]);
	});

	it("does not show a completion entry for an unchanged snapshot", async () => {
		status = " M a.txt";
		await observeDirtyTree();
		await h.fire({ type: "agent_settled" });
		expect(h.entries).toEqual([]);
		expect(h.messages).toEqual([]);
	});

	it("shows no-baseline changes but never follows up", async () => {
		writeJsonFileAtomic(configPath, {
			modules: { "completion-diff-recheck": { followUp: true } },
		});
		reload();
		await h.fire(result("write", { path: "a.txt", content: "x" }));
		await h.fire({ type: "agent_settled" });
		expect(h.entries).toHaveLength(1);
		expect(h.messages).toEqual([]);
	});

	it("limits follow-ups across settled events and resets state for a new instance", async () => {
		writeJsonFileAtomic(configPath, {
			modules: {
				"completion-diff-recheck": {
					followUp: true,
					maxFollowUpsPerSession: 1,
				},
			},
		});
		reload();
		await observeDirtyTree();
		await h.fire({ type: "agent_settled" });
		await h.fire({ type: "agent_settled" });
		expect(h.messages).toEqual([
			{
				message: {
					customType: "agents-guard-diff-followup",
					display: true,
					content: [{ type: "text", text: expect.stringContaining("b.txt") }],
				},
				options: { deliverAs: "followUp", triggerTurn: true },
			},
		]);
		await h.fire(result("subagent", { action: "list", capabilities: true }));
		reload();
		expect(await h.fire(dispatch)).toMatchObject({ block: true });
		await h.fire({ type: "agent_settled" });
		expect(h.entries).toEqual([]);
		await h.fire(result("write", { path: "a.txt", content: "x" }));
		await h.fire({ type: "agent_settled" });
		expect(h.messages).toEqual([]); // No inherited baseline.
		await observeDirtyTree();
		await h.fire({ type: "agent_settled" });
		expect(h.messages).toHaveLength(1); // No inherited budget consumption.
	});

	it("persists actual session identity, heartbeats, then releases on shutdown", async () => {
		await h.fire({ type: "session_start", reason: "startup" });
		expect(records()[0]).toMatchObject({
			sessionId: "session-a",
			worktreeRoot: canonicalCwd,
			lastSeenAt: now,
		});
		expect(existsSync(lockPath)).toBe(false);
		now += 1000;
		await h.fire({
			type: "turn_end",
			turnIndex: 0,
			message: { role: "user", content: "fixture", timestamp: now },
			toolResults: [],
		});
		expect(records()[0]?.lastSeenAt).toBe(now);
		await h.fire({ type: "session_shutdown", reason: "quit" });
		expect(records()).toEqual([]);
	});

	it("shutdown leaves a legacy file completely unchanged", async () => {
		writeJsonFileAtomic(lockPath, {
			version: 1,
			sessionId: "parent",
			pid: process.pid,
			host: hostname(),
			worktreeRoot: cwd,
			branch: "parent-branch",
			startedAt: now,
			heartbeatAt: now,
		});
		const original = readFileSync(lockPath, "utf8");
		await h.fire({ type: "session_start", reason: "startup" });
		await h.fire({ type: "session_shutdown", reason: "quit" });
		expect(readFileSync(lockPath, "utf8")).toBe(original);
	});

	it("preserves hard-deny priority, removes writer blocking and deprecates takeover/unlock", async () => {
		writeJsonFileAtomic(lockPath, {
			version: 1,
			sessionId: "foreign",
			pid: 222,
			host: `${hostname()}-foreign`,
			worktreeRoot: cwd,
			branch: "other",
			startedAt: now,
			heartbeatAt: now,
		});
		await h.fire({ type: "session_start", reason: "startup" });
		const blocked = await h.fire({
			...deniedCall,
			input: { command: "git commit -am x" },
		});
		expect(blocked).toMatchObject({
			block: true,
			reason: expect.stringContaining("hard-deny"),
		});
		const write = {
			type: "tool_call" as const,
			toolCallId: "w",
			toolName: "write",
			input: { path: join(cwd, "a.txt"), content: "x" },
		};
		const legacy = readFileSync(lockPath);
		expect(await h.fire(write)).toBeUndefined();
		await h.command("off writer-lock");
		expect(records()).toEqual([]);
		expect(await h.fire(write)).toBeUndefined();
		await h.command("on writer-lock");
		expect(await h.fire(write)).toBeUndefined();
		const before = records();
		expect(before).toHaveLength(1);
		exec.mockClear();
		await h.command("takeover");
		await h.command("unlock");
		expect(records()).toEqual(before);
		expect(readFileSync(lockPath)).toEqual(legacy);
		expect(exec).not.toHaveBeenCalled();
	});

	it("only saves explicit configuration and reports invalid commands", async () => {
		await h.command("");
		expect(existsSync(configPath)).toBe(false);
		await h.command("save");
		expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
			version: 1,
		});
		await h.command("off git-evidence");
		await h.command("save");
		expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
			version: 1,
			modules: { "git-evidence": { enabled: false } },
		});
		await h.command("on missing");
		expect(h.notices.at(-1)).toMatchObject({
			level: "error",
			message: expect.stringContaining("unknown module"),
		});
		await h.command("missing");
		expect(h.notices.at(-1)?.message).toContain("usage:");
		await h.command("takeover");
		expect(h.notices.at(-1)?.level).toBe("warning");
		expect(existsSync(lockPath)).toBe(false);
		expect(h.completions("take")).toEqual([
			{ value: "takeover", label: "takeover" },
		]);
		expect(h.completions("missing")).toBeNull();
	});

	it("fresh status checks merge into exactly one response; repeated on does no work", async () => {
		await h.fire({ type: "session_start", reason: "startup" });
		expect(h.notices).toHaveLength(1);
		expect(exec).toHaveBeenCalledTimes(4);
		expect(h.notices[0]?.message).toContain("既有修改");
		exec.mockClear();
		await h.fire({
			type: "tool_call",
			toolCallId: "write",
			toolName: "edit",
			input: { path: join(cwd, "a.txt"), oldText: "a", newText: "b" },
		});
		await endTurn();
		expect(exec).not.toHaveBeenCalled();
		expect(h.notices).toHaveLength(1);
		await h.command("status");
		expect(h.notices).toHaveLength(2);
		expect(exec).toHaveBeenCalledTimes(4);
		await h.command("");
		expect(h.notices).toHaveLength(3);
		expect(exec).toHaveBeenCalledTimes(8);
		exec.mockClear();
		await h.command("on writer-lock");
		await h.command("on hard-deny");
		expect(exec).not.toHaveBeenCalled();
		await h.command("off writer-lock");
		await h.command("status");
		await endTurn();
		expect(exec).not.toHaveBeenCalled();
		expect(records()).toEqual([]);
		await h.command("on writer-lock");
		expect(exec).toHaveBeenCalledTimes(4);
		expect(records()).toHaveLength(1);
	});

	it("reports a same-sessionId participating peer but never blocks the host", async () => {
		createPresenceFiles(stateDir).create({
			version: 1,
			instanceId: "00000000-0000-4000-8000-000000000001",
			sessionId: "session-a",
			pid: process.pid,
			host: hostname(),
			worktreeRoot: canonicalCwd,
			startedAt: now,
			lastSeenAt: now,
		});
		await h.fire({ type: "session_start", reason: "startup" });
		expect(h.notices[0]?.message).toContain("其他視窗");
		expect(records()).toHaveLength(2);
		expect(
			await h.fire({
				type: "tool_call",
				toolCallId: "w",
				toolName: "write",
				input: { path: join(cwd, "a.txt"), content: "x" },
			}),
		).toBeUndefined();
		await h.fire({ type: "session_shutdown", reason: "quit" });
		expect(records()).toHaveLength(1);
	});

	it("drains pending heartbeat faults once without Git or peer scans", async () => {
		await h.fire({ type: "session_start", reason: "startup" });
		const own = records()[0];
		if (!own) throw new Error("missing own");
		const path = join(
			stateDir,
			"presence",
			presenceDirectoryKey(canonicalCwd),
			`${own.instanceId}.json`,
		);
		writeJsonFileAtomic(path, { broken: true });
		exec.mockClear();
		await endTurn();
		expect(exec).not.toHaveBeenCalled();
		expect(h.notices).toHaveLength(2);
		expect(h.notices[1]?.message).toContain("存在記錄損壞或格式不符");
		await endTurn();
		expect(h.notices).toHaveLength(2);
	});

	it("handles unavailable UI and console without dialogs or follow-ups", async () => {
		reload({
			notifyFailure: () => {
				throw new Error("private UI error");
			},
		});
		h.consoleWarn.mockImplementation(() => {
			throw new Error("private console error");
		});
		await expect(
			h.fire({ type: "session_start", reason: "startup" }),
		).resolves.toBeUndefined();
		await expect(h.command("status")).resolves.toBeUndefined();
		expect(h.messages).toEqual([]);
		expect(h.entries).toEqual([]);
		expect(await h.fire(deniedCall)).toMatchObject({ block: true });
	});

	it("refreshes changed cwd and identity rather than using startup position", async () => {
		await h.fire({ type: "session_start", reason: "startup" });
		const oldRoot = canonicalCwd;
		cwd = join(root, "second");
		mkdirSync(cwd);
		canonicalCwd = realpathSync(cwd);
		h.setContext({ cwd, sessionId: "changed" });
		await h.command("status");
		expect(createPresenceFiles(stateDir).scan(oldRoot).records).toEqual([]);
		expect(records()[0]?.sessionId).toBe("changed");
		expect(h.notices.at(-1)?.message).toContain(canonicalCwd);
	});

	it("retains print-mode output when UI notification is unavailable", async () => {
		reload({ hasUI: false });
		await h.command("status");
		expect(h.consoleLog).toHaveBeenCalledWith(
			expect.stringContaining("agents-guard: enabled"),
		);
		await h.command("on missing");
		expect(h.consoleError).toHaveBeenCalledWith(
			expect.stringContaining("unknown module"),
		);
		expect(h.notices).toEqual([]);
	});
});
