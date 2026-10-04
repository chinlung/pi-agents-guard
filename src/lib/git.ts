import { isAbsolute } from "node:path";
import type { WriterIssueCode, WriterSnapshot } from "../types.js";

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; signal?: AbortSignal; timeout?: number },
) => Promise<{ stdout: string; code: number; killed?: boolean }>;

export interface WorktreeInspectorDeps {
	exec: ExecFn;
	realpathSync: (path: string) => string;
	now: () => number;
}
export async function inspectWorktree(
	deps: WorktreeInspectorDeps,
	cwd: string,
	signal?: AbortSignal,
): Promise<WriterSnapshot> {
	const deadline = deps.now() + 2000;
	const issues = new Set<WriterIssueCode>();
	let snapshot: WriterSnapshot = {
		kind: "unknown",
		cwd,
		checkedAt: deps.now(),
		issues: [],
	};
	const finish = (): WriterSnapshot => ({
		...snapshot,
		checkedAt: deps.now(),
		issues: [...issues],
	});
	async function query(args: string[], detachedAllowed = false) {
		const timeout = deadline - deps.now();
		if (signal?.aborted) {
			issues.add("git-aborted");
			return undefined;
		}
		if (timeout <= 0) {
			issues.add("git-timeout");
			return undefined;
		}
		try {
			const result = await deps.exec("git", ["--no-optional-locks", ...args], {
				cwd,
				signal,
				timeout,
			});
			if (signal?.aborted) {
				issues.add("git-aborted");
				return undefined;
			}
			if (result.killed || deps.now() >= deadline) {
				issues.add("git-timeout");
				return undefined;
			}
			if (result.code !== 0 && !(detachedAllowed && result.code === 1)) {
				issues.add("git-failed");
				return undefined;
			}
			return result;
		} catch {
			issues.add(signal?.aborted ? "git-aborted" : "git-failed");
			return undefined;
		}
	}
	const inside = await query(["rev-parse", "--is-inside-work-tree"]);
	if (inside === undefined) return finish();
	const flag = inside.stdout.trim();
	if (flag === "false") {
		snapshot = { ...snapshot, kind: "not-applicable" };
		return finish();
	}
	if (flag !== "true") {
		issues.add("git-invalid-output");
		return finish();
	}
	const top = await query(["rev-parse", "--show-toplevel"]);
	if (top === undefined) return finish();
	const rootOutput = top.stdout.replace(/\r?\n$/, "");
	if (
		!isAbsolute(rootOutput) ||
		/[\r\n]/.test(rootOutput) ||
		rootOutput.includes("\0")
	) {
		issues.add("git-invalid-output");
		return finish();
	}
	let root: string;
	try {
		root = deps.realpathSync(rootOutput);
		if (!isAbsolute(root)) throw new Error("non-absolute root");
	} catch {
		issues.add("root-unresolved");
		return finish();
	}
	snapshot = {
		kind: "git",
		cwd,
		root,
		branch: { kind: "unknown" },
		dirty: null,
		checkedAt: deps.now(),
		issues: [],
	};
	const branch = await query(
		["symbolic-ref", "--quiet", "--short", "HEAD"],
		true,
	);
	if (branch?.code === 1) snapshot.branch = { kind: "detached" };
	else if (branch !== undefined) {
		const name = branch.stdout.replace(/\r?\n$/, "");
		if (name !== "" && !/[\r\n]/.test(name) && !name.includes("\0"))
			snapshot.branch = { kind: "branch", name };
		else issues.add("git-invalid-output");
	}
	const status = await query([
		"status",
		"--porcelain=v1",
		"--untracked-files=normal",
	]);
	if (status !== undefined) snapshot.dirty = status.stdout !== "";
	return finish();
}

/**
 * Resolves the git worktree root and current branch for `cwd`. Returns null
 * for failures such as missing Git or an unresolved root. Retained as a legacy
 * compatibility helper: null does not prove this is a non-Git directory.
 * Advisory callers use inspectWorktree to preserve incomplete diagnostics.
 */
export async function detectWorktreeRoot(
	exec: ExecFn,
	cwd: string,
	signal?: AbortSignal,
): Promise<{ root: string; branch: string } | null> {
	try {
		const top = await exec("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			signal,
		});
		if (top.code !== 0) return null;
		const root = top.stdout.trim();
		if (root === "") return null;

		const branchResult = await exec(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ cwd, signal },
		);
		const branch = branchResult.code === 0 ? branchResult.stdout.trim() : "";
		return { root, branch };
	} catch {
		return null;
	}
}
