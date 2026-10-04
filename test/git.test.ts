import { execFile } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	detectWorktreeRoot,
	type ExecFn,
	inspectWorktree,
} from "../src/lib/git.js";

function fakeExec(responses: Record<string, { stdout: string; code: number }>) {
	return async (command: string, args: string[]) => {
		const key = `${command} ${args.join(" ")}`;
		return responses[key] ?? { stdout: "", code: 1 };
	};
}

describe("detectWorktreeRoot", () => {
	it("returns the trimmed root and branch on success", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": {
				stdout: "/Users/me/project\n",
				code: 0,
			},
			"git rev-parse --abbrev-ref HEAD": { stdout: "main\n", code: 0 },
		});
		expect(await detectWorktreeRoot(exec, "/Users/me/project/src")).toEqual({
			root: "/Users/me/project",
			branch: "main",
		});
	});

	it("returns null when not inside a git repository", async () => {
		const exec = fakeExec({});
		expect(await detectWorktreeRoot(exec, "/tmp/not-a-repo")).toBeNull();
	});

	it("returns null when rev-parse throws", async () => {
		const exec = async () => {
			throw new Error("ENOENT: git not found");
		};
		expect(await detectWorktreeRoot(exec, "/Users/me/project")).toBeNull();
	});

	it("reports a detached HEAD as an empty branch instead of failing", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": {
				stdout: "/Users/me/project\n",
				code: 0,
			},
			"git rev-parse --abbrev-ref HEAD": { stdout: "HEAD\n", code: 0 },
		});
		expect(await detectWorktreeRoot(exec, "/Users/me/project")).toEqual({
			root: "/Users/me/project",
			branch: "HEAD",
		});
	});
});

describe("detectWorktreeRoot: signal 轉發", () => {
	it("forwards the abort signal to every exec call", async () => {
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const exec = async (
			_command: string,
			args: string[],
			options?: { cwd?: string; signal?: AbortSignal },
		) => {
			seen.push(options?.signal);
			if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
				return { stdout: "/repo\n", code: 0 };
			}
			return { stdout: "main\n", code: 0 };
		};
		await detectWorktreeRoot(exec, "/repo", controller.signal);
		expect(seen).toEqual([controller.signal, controller.signal]);
	});
});

const inspectionResponses: Record<
	string,
	{ stdout: string; code: number; killed?: boolean }
> = {
	"rev-parse --is-inside-work-tree": { stdout: "true\n", code: 0 },
	"rev-parse --show-toplevel": { stdout: "/repo \n", code: 0 },
	"symbolic-ref --quiet --short HEAD": { stdout: "main\n", code: 0 },
	"status --porcelain=v1 --untracked-files=normal": { stdout: "", code: 0 },
};
function inspector(overrides: typeof inspectionResponses = {}) {
	const calls: Parameters<ExecFn>[] = [];
	const exec: ExecFn = async (command, args, options) => {
		calls.push([command, args, options]);
		expect(command).toBe("git");
		expect(args[0]).toBe("--no-optional-locks");
		const key = args.slice(1).join(" ");
		const value = { ...inspectionResponses, ...overrides }[key];
		if (value === undefined) throw new Error("Unexpected query");
		return value;
	};
	return { calls, exec, now: () => 1000, realpathSync: (path: string) => path };
}

describe("inspectWorktree", () => {
	it("preserves root whitespace and forwards the signal and a bounded timeout", async () => {
		const deps = inspector();
		const signal = new AbortController().signal;
		expect(await inspectWorktree(deps, "/repo /sub", signal)).toEqual({
			kind: "git",
			cwd: "/repo /sub",
			root: "/repo ",
			branch: { kind: "branch", name: "main" },
			dirty: false,
			checkedAt: 1000,
			issues: [],
		});
		expect(deps.calls).toHaveLength(4);
		for (const call of deps.calls)
			expect(call[2]).toEqual({ cwd: "/repo /sub", signal, timeout: 2000 });
	});
	it.each([
		[{ stdout: "", code: 128 }, "unknown"],
		[{ stdout: "true\n", code: 0, killed: true }, "unknown"],
		[{ stdout: "false\n", code: 0 }, "not-applicable"],
		[{ stdout: "nonsense", code: 0 }, "unknown"],
	] as const)(
		"distinguishes failure from a confirmed non-worktree",
		async (reply, kind) => {
			const deps = inspector({ "rev-parse --is-inside-work-tree": reply });
			const snapshot = await inspectWorktree(deps, "/x");
			expect(snapshot.kind).toBe(kind);
			expect(deps.calls).toHaveLength(1);
			if (kind === "unknown") expect(snapshot.issues.length).toBeGreaterThan(0);
		},
	);
	it.each([
		[{ stdout: "", code: 1 }, "detached"],
		[{ stdout: "", code: 128 }, "unknown"],
		[{ stdout: "main", code: 0, killed: true }, "unknown"],
	] as const)(
		"does not mislabel interrupted branch results",
		async (reply, kind) => {
			const snapshot = await inspectWorktree(
				inspector({ "symbolic-ref --quiet --short HEAD": reply }),
				"/x",
			);
			expect(snapshot).toMatchObject({
				kind: "git",
				branch: { kind },
				root: "/repo ",
			});
		},
	);
	it("keeps partial facts when status fails and reports dirty without parsing filenames", async () => {
		expect(
			await inspectWorktree(
				inspector({
					"status --porcelain=v1 --untracked-files=normal": {
						stdout: "",
						code: 1,
					},
				}),
				"/x",
			),
		).toMatchObject({
			kind: "git",
			root: "/repo ",
			dirty: null,
			issues: ["git-failed"],
		});
		expect(
			await inspectWorktree(
				inspector({
					"status --porcelain=v1 --untracked-files=normal": {
						stdout: "?? odd\nname",
						code: 0,
					},
				}),
				"/x",
			),
		).toMatchObject({ dirty: true });
	});
	it("treats failed canonicalization and missing Git as incomplete", async () => {
		const deps = inspector();
		deps.realpathSync = () => {
			throw new Error("private path detail");
		};
		expect(await inspectWorktree(deps, "/x")).toMatchObject({
			kind: "unknown",
			issues: ["root-unresolved"],
		});
		deps.exec = async () => {
			throw new Error("private executable detail");
		};
		expect(await inspectWorktree(deps, "/x")).toMatchObject({
			kind: "unknown",
			issues: ["git-failed"],
		});
	});
	it("does no exec for pre-abort and stops scheduling when the total budget expires", async () => {
		const aborted = new AbortController();
		aborted.abort();
		const deps = inspector();
		expect(await inspectWorktree(deps, "/x", aborted.signal)).toMatchObject({
			kind: "unknown",
			issues: ["git-aborted"],
		});
		expect(deps.calls).toHaveLength(0);
		let clock = 0;
		const original = deps.exec;
		deps.now = () => clock;
		deps.exec = async (...args) => {
			const result = await original(...args);
			clock += 900;
			return result;
		};
		expect(await inspectWorktree(deps, "/x")).toMatchObject({
			kind: "git",
			dirty: null,
			issues: ["git-timeout"],
		});
		expect(deps.calls.map((call) => call[2]?.timeout)).toEqual([
			2000, 1100, 200,
		]);
	});
	it("canonicalizes an actual Git worktree without changing its contents", async () => {
		const root = mkdtempSync(join(tmpdir(), "ag-git-inspect-"));
		const run = promisify(execFile);
		const env = {
			PATH: process.env.PATH,
			HOME: root,
			XDG_CONFIG_HOME: root,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
		};
		const repo = join(root, "repo ");
		mkdirSync(repo);
		const git = (args: string[], cwd = repo) =>
			run(
				"git",
				[
					"-c",
					"commit.gpgsign=false",
					"-c",
					`core.hooksPath=${join(root, "no-hooks")}`,
					...args,
				],
				{ cwd, env, timeout: 5000 },
			);
		const exec: ExecFn = async (command, args, options) => {
			try {
				const output = await run(command, args, { ...options, env });
				return { stdout: output.stdout, code: 0, killed: false };
			} catch (error) {
				const e = error as { stdout?: string; code?: number; killed?: boolean };
				return {
					stdout: e.stdout ?? "",
					code: typeof e.code === "number" ? e.code : 1,
					killed: e.killed ?? false,
				};
			}
		};
		const deps = { exec, realpathSync, now: Date.now };
		try {
			await git(["init", "-b", "main"]);
			expect(await inspectWorktree(deps, repo)).toMatchObject({
				kind: "git",
				branch: { kind: "branch", name: "main" },
				dirty: false,
			});
			writeFileSync(join(repo, "a.txt"), "keep me\n");
			expect(await inspectWorktree(deps, repo)).toMatchObject({ dirty: true });
			await git(["config", "user.name", "Fixture"]);
			await git(["config", "user.email", "fixture@example.invalid"]);
			await git(["add", "a.txt"]);
			await git(["commit", "-m", "fixture"]);
			mkdirSync(join(repo, "sub"));
			symlinkSync(repo, join(root, "alias"));
			const actualRoot = realpathSync(repo);
			for (const cwd of [join(repo, "sub"), join(root, "alias")])
				expect(await inspectWorktree(deps, cwd)).toMatchObject({
					root: actualRoot,
					dirty: false,
				});
			await git(["checkout", "--detach"]);
			expect(await inspectWorktree(deps, repo)).toMatchObject({
				branch: { kind: "detached" },
				dirty: false,
			});
			const linked = join(root, "linked");
			await git(["worktree", "add", "--detach", linked]);
			expect(await inspectWorktree(deps, linked)).toMatchObject({
				root: realpathSync(linked),
			});
			const other = join(root, "other");
			mkdirSync(other);
			await git(["init", "-b", "main"], other);
			expect(await inspectWorktree(deps, other)).toMatchObject({
				root: realpathSync(other),
				branch: { kind: "branch", name: "main" },
			});
			expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("keep me\n");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
