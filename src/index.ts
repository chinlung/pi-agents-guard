import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type ConfigPatch,
	resolveConfig,
	serializeExplicit,
} from "./config.js";
import { registerAgentsGuard } from "./extension.js";
import { inspectWorktree } from "./lib/git.js";
import { decideHardDeny } from "./modules/hard-deny.js";
import { decideSubagentCall } from "./modules/subagent-policy.js";
import { createCompletionController } from "./runtime/completion-diff-recheck.js";
import type { Runtime, RuntimeDeps } from "./runtime/contracts.js";
import { createGitEvidenceCoordinator } from "./runtime/git-evidence.js";
import { createWriterLockController } from "./runtime/writer-lock.js";
import {
	type AgentsGuardConfig,
	type Decision,
	MODULE_NAMES,
	type ModuleName,
	type Provenance,
} from "./types.js";

/** Failures of one module before it is taken out of the loop for the session. */
const MAX_MODULE_FAILURES = 3;
const COMPLETION = "completion-diff-recheck";

export type {
	CompletionCheck,
	CompletionNotice,
	Runtime,
	RuntimeDeps,
} from "./runtime/contracts.js";

/**
 * The execution core, deliberately free of any pi instance so the whole
 * decision path is testable without starting an agent session.
 */
export function createRuntime(deps: RuntimeDeps): Runtime {
	let commandLayer: ConfigPatch = {};
	let config: AgentsGuardConfig;
	let provenance: Provenance;
	let warnings: string[];

	const recompute = (): void => {
		const resolved = resolveConfig({
			file: deps.fileConfig,
			env: deps.env.AGENTS_GUARD,
			flag: deps.flag,
			command: Object.keys(commandLayer).length > 0 ? commandLayer : undefined,
		});
		config = resolved.config;
		provenance = resolved.provenance;
		warnings = resolved.warnings;
	};
	recompute();

	const failureCounts = new Map<ModuleName, number>();

	// PI_SUBAGENT_CHILD marks a background subagent child process (see
	// design.md §5.5); fixed for the lifetime of this runtime, unlike
	// capabilitiesListed below which is observed over the session.
	const isSubagentChild = deps.env.PI_SUBAGENT_CHILD === "1";
	let capabilitiesListed = false;
	const completionEnabled = () =>
		config.enabled && config.modules[COMPLETION].enabled;

	let writerRevision = 0;
	let enableRefreshPending = false;
	let writerSessionId = deps.writerLock.self.sessionId;
	const writerEnabled = () =>
		config.enabled && config.modules["writer-lock"].enabled;
	const writerLock = createWriterLockController({
		...deps.writerLock,
		self: { ...deps.writerLock.self, isSubagentChild },
		getSettings: () => ({
			enabled: config.enabled && config.modules["writer-lock"].enabled,
			options: config.modules["writer-lock"],
		}),
	});

	/**
	 * Fail-open by construction: pi treats a throwing tool_call handler as a
	 * reason to block the tool, so one bug here would break every command. A
	 * module that fails repeatedly is taken out of the loop rather than left to
	 * flood the log. Shared by the sync and async guard wrappers below.
	 */
	function isModuleActive(name: ModuleName): boolean {
		if (!config.enabled || !config.modules[name].enabled) return false;
		return (failureCounts.get(name) ?? 0) < MAX_MODULE_FAILURES;
	}

	function recordModuleFailure(name: ModuleName, error: unknown): void {
		const count = (failureCounts.get(name) ?? 0) + 1;
		failureCounts.set(name, count);
		const detail = error instanceof Error ? error.message : String(error);
		deps.log(
			count >= MAX_MODULE_FAILURES
				? `agents-guard: module ${name} failed ${count} times and is now inert for this session (${detail})`
				: `agents-guard: module ${name} failed open (${detail})`,
		);
	}

	function guardedRun<T>(name: ModuleName, fallback: T, run: () => T): T {
		if (!isModuleActive(name)) return fallback;
		try {
			return run();
		} catch (error) {
			recordModuleFailure(name, error);
			return fallback;
		}
	}

	/** Async counterpart to `guardedRun`, sharing the same failure counter. */
	async function guardedRunAsync<T>(
		name: ModuleName,
		fallback: T,
		run: () => Promise<T>,
	): Promise<T> {
		if (!isModuleActive(name)) return fallback;
		try {
			return await run();
		} catch (error) {
			recordModuleFailure(name, error);
			return fallback;
		}
	}

	const guarded = (name: ModuleName, run: () => Decision): Decision =>
		guardedRun(name, { kind: "pass" } as Decision, run);

	const guardedAsync = (
		name: ModuleName,
		run: () => Promise<string | undefined>,
	): Promise<string | undefined> => guardedRunAsync(name, undefined, run);

	function recordCompletionFailure(): void {
		try {
			recordModuleFailure(COMPLETION, new Error("completion recheck failed"));
		} catch {
			// The counter advances before logging. Never inspect the original error.
		}
	}

	const completion = createCompletionController({
		exec: deps.gitEvidence.exec,
		isSubagentChild,
		getSettings: () => ({
			active: isModuleActive(COMPLETION),
			options: config.modules[COMPLETION],
		}),
		recordFailure: recordCompletionFailure,
	});
	const gitEvidence = createGitEvidenceCoordinator({
		exec: deps.gitEvidence.exec,
		cwd: deps.resolver.cwd,
		getOptions: () => config.modules["git-evidence"],
	});
	const augmentGitEvidence = (
		command: string,
		isError: boolean,
		signal: AbortSignal | undefined,
	) =>
		guardedAsync("git-evidence", () =>
			gitEvidence.augment(command, isError, signal),
		);

	return {
		handleToolCall(toolName, input) {
			const hardDenyDecision = guarded("hard-deny", () =>
				decideHardDeny(
					toolName,
					input,
					config.modules["hard-deny"],
					deps.resolver,
				),
			);
			if (hardDenyDecision.kind === "block") return hardDenyDecision;

			if (toolName === "subagent") {
				return guarded("subagent-policy", () =>
					decideSubagentCall(
						input,
						{ capabilitiesListed, isSubagentChild },
						config.modules["subagent-policy"],
					),
				);
			}
			return { kind: "pass" };
		},
		handleToolResult(toolName, input, isError, content) {
			if (
				toolName === "subagent" &&
				!isError &&
				input.action === "list" &&
				input.capabilities === true
			) {
				capabilitiesListed = true;
			}
			completion.observeToolResult(toolName, input, isError, content);
		},
		async refreshWriterNotice(cwd, now, reason, signal) {
			if (reason === "enabled" && !enableRefreshPending) return undefined;
			if (reason === "enabled") enableRefreshPending = false;
			const revision = ++writerRevision;
			const current = () =>
				revision === writerRevision && writerEnabled() && !isSubagentChild;
			if (!current()) return undefined;
			try {
				const snapshot = await inspectWorktree(
					{
						exec: (command, args, options) =>
							current()
								? deps.gitEvidence.exec(command, args, options)
								: Promise.resolve({ stdout: "", code: 1, killed: true }),
						realpathSync: (path) =>
							current() ? deps.resolver.realpathSync(path) : path,
						now: Date.now,
					},
					cwd,
					signal,
				);
				if (!current()) return undefined;
				return writerLock.refresh(snapshot, snapshot.checkedAt, reason);
			} catch {
				if (!current()) return undefined;
				return writerLock.refresh(
					{ kind: "unknown", cwd, checkedAt: now, issues: ["git-failed"] },
					now,
					reason,
				);
			}
		},
		takeWriterNotice: writerLock.takeNotice,
		setSessionId(value) {
			if (value !== writerSessionId) {
				++writerRevision;
				writerSessionId = value;
			}
			writerLock.setSessionId(value);
		},
		initWriterLock(worktree, now) {
			++writerRevision;
			return writerLock.init(worktree, now);
		},
		heartbeatWriterLock: writerLock.heartbeat,
		releaseWriterLock() {
			++writerRevision;
			enableRefreshPending = false;
			writerLock.release();
		},
		takeoverWriterLock: writerLock.takeover,
		augmentGitEvidence,
		checkCompletionDiff: completion.check,
		collectCompletionDiff: completion.collect,
		shutdownCompletion: completion.shutdown,
		status() {
			const lines = [
				`agents-guard: ${config.enabled ? "enabled" : "disabled"} (source: ${provenance.enabled})`,
			];
			for (const name of MODULE_NAMES) {
				const state = config.modules[name].enabled ? "enabled" : "disabled";
				const inert =
					(failureCounts.get(name) ?? 0) >= MAX_MODULE_FAILURES
						? "  [auto-disabled after repeated failures]"
						: "";
				lines.push(
					`  ${name}: ${state} (source: ${provenance.modules[name]})${inert}`,
				);
			}
			for (const warning of warnings) lines.push(`  ⚠️ ${warning}`);
			lines.push(writerLock.summary());
			lines.push(
				"writer-lock 的 blockedTools／blockedGitSubcommands 已 deprecated，僅保留設定相容，不作阻擋。",
			);
			return lines.join("\n");
		},
		setEnabled(target, enabled) {
			const wasCompletionEnabled = completionEnabled();
			const wasWriterEnabled = writerEnabled();
			if (target === "all") {
				commandLayer = { ...commandLayer, enabled };
			} else {
				commandLayer = {
					...commandLayer,
					modules: { ...commandLayer.modules, [target]: { enabled } },
				};
			}
			recompute();
			if (wasCompletionEnabled !== completionEnabled()) completion.invalidate();
			if (wasWriterEnabled !== writerEnabled()) {
				++writerRevision;
				enableRefreshPending = writerEnabled();
				if (!writerEnabled()) writerLock.release();
			}
		},
		save() {
			return serializeExplicit(config, provenance);
		},
		warnings() {
			return [...warnings];
		},
	};
}

export default function (pi: ExtensionAPI): void {
	registerAgentsGuard(pi, createRuntime);
}
