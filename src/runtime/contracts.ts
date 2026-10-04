import type { ExecFn } from "../lib/git.js";
import type { PathResolver } from "../lib/paths.js";
import type {
	Decision,
	ModuleName,
	WriterLockSelf,
	WriterNotice,
	WriterRefreshReason,
} from "../types.js";

export type CompletionNotice = { card: string; shouldFollowUp: boolean };

/** A collected snapshot can be adopted only once, synchronously. */
export interface CompletionCheck {
	finish(): CompletionNotice | undefined;
}

export interface RuntimeDeps {
	fileConfig: unknown;
	env: Record<string, string | undefined>;
	flag: string | undefined;
	resolver: PathResolver;
	log: (message: string) => void;
	writerLock: {
		self: WriterLockSelf;
		stateDir: string;
		isPidAlive: (pid: number) => boolean;
	};
	gitEvidence: { exec: ExecFn };
}

export interface Runtime {
	refreshWriterNotice(
		cwd: string,
		now: number,
		reason: WriterRefreshReason,
		signal?: AbortSignal,
	): Promise<WriterNotice | undefined>;
	takeWriterNotice(): WriterNotice | undefined;
	handleToolCall(toolName: string, input: Record<string, unknown>): Decision;
	handleToolResult(
		toolName: string,
		input: Record<string, unknown>,
		isError: boolean,
		content?: readonly { type: string; text?: unknown }[],
	): void;
	status(): string;
	setEnabled(target: "all" | ModuleName, enabled: boolean): void;
	save(): Record<string, unknown>;
	warnings(): string[];
	initWriterLock(
		worktree: { root: string; branch: string } | null,
		now: number,
	): { level: "info" | "warning" | "error"; message: string } | undefined;
	setSessionId(sessionId: string): void;
	heartbeatWriterLock(now: number): void;
	releaseWriterLock(): void;
	takeoverWriterLock(
		worktree: { root: string; branch: string },
		now: number,
	): { level: "info" | "warning" | "error"; message: string };
	augmentGitEvidence(
		command: string,
		isError: boolean,
		signal: AbortSignal | undefined,
	): Promise<string | undefined>;
	checkCompletionDiff(
		actualPorcelain: string,
		diffStat: string,
	): { card: string; shouldFollowUp: boolean } | undefined;
	collectCompletionDiff(
		cwd: string,
		signal?: AbortSignal,
	): Promise<CompletionCheck | undefined>;
	shutdownCompletion(): void;
}
