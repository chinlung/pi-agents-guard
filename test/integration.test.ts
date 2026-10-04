import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime, type RuntimeDeps } from "../src/index.js";
import { createPresenceFiles } from "../src/state.js";
import { deferred } from "./helpers/deferred.js";

const fixtureRoots: string[] = [];
function ownedStateDir() {
	const root = mkdtempSync(join(tmpdir(), "ag-runtime-fixture-"));
	fixtureRoots.push(root);
	return join(root, "state", "agents-guard");
}
afterEach(() => {
	for (const root of fixtureRoots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

const deps = (over: Partial<RuntimeDeps> = {}): RuntimeDeps => ({
	fileConfig: undefined,
	env: {},
	flag: undefined,
	resolver: {
		cwd: "/Users/me/project",
		home: "/Users/me",
		realpathSync: (p: string) => p,
	},
	log: vi.fn(),
	writerLock: {
		self: {
			sessionId: "session-default",
			pid: 1,
			host: "host-default",
			isSubagentChild: false,
		},
		stateDir: ownedStateDir(),
		isPidAlive: () => true,
	},
	gitEvidence: {
		exec: async () => ({ stdout: "", code: 0 }),
	},
	...over,
});

describe("runtime: hard-deny 接線", () => {
	it("blocks a denied command", () => {
		const runtime = createRuntime(deps());
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"block",
		);
	});

	it("passes an allowed command", () => {
		const runtime = createRuntime(deps());
		expect(runtime.handleToolCall("bash", { command: "git status" }).kind).toBe(
			"pass",
		);
	});

	it("blocks a redirect onto a protected path", () => {
		const runtime = createRuntime(deps());
		expect(
			runtime.handleToolCall("bash", {
				command: "echo x > /Users/me/.pi/agent/settings.json",
			}).kind,
		).toBe("block");
	});
});

describe("runtime: 開關", () => {
	it("global disable stops all gating", () => {
		const runtime = createRuntime(deps({ flag: "off" }));
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"pass",
		);
	});

	it("module disable stops only that module", () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "hard-deny": { enabled: false } } } }),
		);
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"pass",
		);
	});

	it("command layer takes effect immediately and overrides the file", () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "hard-deny": { enabled: false } } } }),
		);
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"pass",
		);
		runtime.setEnabled("hard-deny", true);
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"block",
		);
	});
});

describe("runtime: status 顯示 provenance", () => {
	it("reports the effective source per module", () => {
		const runtime = createRuntime(deps({ env: { AGENTS_GUARD: "hard-deny" } }));
		const status = runtime.status();
		expect(status).toContain("hard-deny");
		expect(status).toContain("env");
		expect(status).toContain("writer-lock");
	});
});

describe("runtime: save 只寫明確設定過的值", () => {
	it("omits defaults", () => {
		const runtime = createRuntime(deps());
		expect(runtime.save()).toEqual({ version: 1 });
	});

	it("includes a command-layer change", () => {
		const runtime = createRuntime(deps());
		runtime.setEnabled("git-evidence", false);
		expect(runtime.save()).toEqual({
			version: 1,
			modules: { "git-evidence": { enabled: false } },
		});
	});
});

describe("runtime: fail-open", () => {
	it("passes and logs when reading the input throws", () => {
		const log = vi.fn();
		const runtime = createRuntime(deps({ log }));
		const hostile = Object.defineProperty({}, "command", {
			get() {
				throw new Error("hostile input");
			},
			enumerable: true,
		}) as Record<string, unknown>;
		expect(runtime.handleToolCall("bash", hostile).kind).toBe("pass");
		expect(log).toHaveBeenCalledOnce();
	});

	it("auto-disables a module after three failures", () => {
		const log = vi.fn();
		const runtime = createRuntime(deps({ log }));
		const hostile = () =>
			Object.defineProperty({}, "command", {
				get() {
					throw new Error("hostile input");
				},
				enumerable: true,
			}) as Record<string, unknown>;

		for (let i = 0; i < 3; i += 1) runtime.handleToolCall("bash", hostile());
		expect(log).toHaveBeenCalledTimes(3);
		expect(runtime.status()).toContain("auto-disabled");

		// A fourth call must not add another log line: the module is now inert.
		runtime.handleToolCall("bash", hostile());
		expect(log).toHaveBeenCalledTimes(3);
	});
});

describe("runtime: warnings", () => {
	it("surfaces a malformed file layer", () => {
		const runtime = createRuntime(deps({ fileConfig: "not an object" }));
		expect(runtime.warnings().length).toBeGreaterThan(0);
	});
});

describe("runtime: subagent-policy 接線", () => {
	it("blocks a dispatch before capabilities were listed", () => {
		const runtime = createRuntime(deps());
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" })
				.kind,
		).toBe("block");
	});

	it("passes after tool_result observes a capabilities list", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult(
			"subagent",
			{ action: "list", capabilities: true },
			false,
		);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" })
				.kind,
		).toBe("pass");
	});

	it("does not count a failed list call as satisfying the prerequisite", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult(
			"subagent",
			{ action: "list", capabilities: true },
			true,
		);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" })
				.kind,
		).toBe("block");
	});

	it("does not treat an unrelated tool_result as satisfying the prerequisite", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("bash", { command: "ls" }, false);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" })
				.kind,
		).toBe("block");
	});

	it("skips rule 1 inside a subagent child session", () => {
		const runtime = createRuntime(deps({ env: { PI_SUBAGENT_CHILD: "1" } }));
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" })
				.kind,
		).toBe("pass");
	});

	it("still blocks rule 3 inside a subagent child session", () => {
		const runtime = createRuntime(deps({ env: { PI_SUBAGENT_CHILD: "1" } }));
		expect(
			runtime.handleToolCall("subagent", {
				agent: "codex-exec",
				task: "review",
				model: "opus",
			}).kind,
		).toBe("block");
	});

	it("module disable stops subagent-policy without affecting hard-deny", () => {
		const runtime = createRuntime(
			deps({
				fileConfig: { modules: { "subagent-policy": { enabled: false } } },
			}),
		);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" })
				.kind,
		).toBe("pass");
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"block",
		);
	});
});

function writerLockDeps(
	over: Partial<{
		self: {
			sessionId: string;
			pid: number;
			host: string;
			isSubagentChild: boolean;
		};
		isPidAlive: (pid: number) => boolean;
	}> = {},
) {
	return {
		self: {
			sessionId: "session-a",
			pid: 111,
			host: "host-a",
			isSubagentChild: false,
		},
		stateDir: ownedStateDir(),
		isPidAlive: () => true,
		...over,
	};
}

describe("runtime: writer advisory", () => {
	const NOW = Date.now();
	it("peers never block writes and other policies remain authoritative", () => {
		const wl = writerLockDeps();
		try {
			const a = createRuntime(deps({ writerLock: wl }));
			a.initWriterLock({ root: "/repo", branch: "main" }, NOW);
			const b = createRuntime(
				deps({
					writerLock: { ...wl, self: { ...wl.self, sessionId: "b", pid: 222 } },
				}),
			);
			expect(
				b.initWriterLock({ root: "/repo", branch: "main" }, NOW)?.message,
			).toContain("其他視窗");
			for (const tool of ["write", "edit", "ast_grep_replace", "read"])
				expect(b.handleToolCall(tool, { path: "a.ts" }).kind).toBe("pass");
			expect(
				b.handleToolCall("bash", { command: "git checkout main" }).kind,
			).toBe("pass");
			expect(
				b.handleToolCall("bash", { command: "git commit -am x" }),
			).toMatchObject({
				kind: "block",
				reason: expect.stringContaining("hard-deny"),
			});
			expect(
				b.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
			).toBe("block");
			const before = createPresenceFiles(wl.stateDir).scan("/repo").records;
			b.takeoverWriterLock({ root: "/repo", branch: "main" }, NOW + 1);
			expect(createPresenceFiles(wl.stateDir).scan("/repo").records).toEqual(
				before,
			);
			b.releaseWriterLock();
			expect(
				createPresenceFiles(wl.stateDir).scan("/repo").records,
			).toHaveLength(1);
		} finally {
			rmSync(wl.stateDir, { recursive: true, force: true });
		}
	});
	it("uses env as the sole child fact before Git or presence I/O", async () => {
		const wl = writerLockDeps();
		const exec = vi.fn(async () => {
			throw new Error("must not execute");
		});
		try {
			const c = createRuntime(
				deps({
					env: { PI_SUBAGENT_CHILD: "1" },
					writerLock: wl,
					gitEvidence: { exec },
				}),
			);
			c.initWriterLock({ root: "/repo", branch: "main" }, NOW);
			await c.refreshWriterNotice("/repo", NOW, "startup");
			c.heartbeatWriterLock(NOW);
			c.releaseWriterLock();
			expect(exec).not.toHaveBeenCalled();
			expect(createPresenceFiles(wl.stateDir).scan("/repo").records).toEqual(
				[],
			);
			expect(
				c.handleToolCall("subagent", { agent: "worker", task: "x" }).kind,
			).toBe("pass");
		} finally {
			rmSync(wl.stateDir, { recursive: true, force: true });
		}
	});
	it("does not classify a parent as child from a conflicting injected flag", () => {
		const wl = writerLockDeps();
		wl.self.isSubagentChild = true;
		try {
			const c = createRuntime(deps({ writerLock: wl }));
			c.initWriterLock({ root: "/repo", branch: "main" }, NOW);
			expect(
				createPresenceFiles(wl.stateDir).scan("/repo").records,
			).toHaveLength(1);
		} finally {
			rmSync(wl.stateDir, { recursive: true, force: true });
		}
	});
	it.each(["off", "release", "identity", "compat-init"])(
		"discards late results after %s",
		async (action) => {
			const wl = writerLockDeps();
			let resolve: (value: { stdout: string; code: number }) => void = () => {};
			const pending = new Promise<{ stdout: string; code: number }>((done) => {
				resolve = done;
			});
			const exec = vi.fn(async (_cmd: string, args: string[]) =>
				args.includes("--is-inside-work-tree")
					? pending
					: {
							stdout: args.includes("--show-toplevel") ? "/repo\n" : "main\n",
							code: 0,
						},
			);
			try {
				const c = createRuntime(
					deps({ writerLock: wl, gitEvidence: { exec } }),
				);
				const refresh = c.refreshWriterNotice("/repo", NOW, "startup");
				if (action === "off") c.setEnabled("writer-lock", false);
				else if (action === "release") c.releaseWriterLock();
				else if (action === "identity") c.setSessionId("new");
				else c.initWriterLock(null, NOW);
				const before = c.status();
				resolve({ stdout: "true\n", code: 0 });
				expect(await refresh).toBeUndefined();
				expect(c.status()).toBe(before);
				expect(createPresenceFiles(wl.stateDir).scan("/repo").records).toEqual(
					[],
				);
				expect(c.status()).not.toContain("worktree: /repo");
				expect(exec).toHaveBeenCalledTimes(1);
			} finally {
				rmSync(wl.stateDir, { recursive: true, force: true });
			}
		},
	);
	it("discards A after newer B but does not invalidate for the same sessionId", async () => {
		const wl = writerLockDeps();
		let resolve: (value: { stdout: string; code: number }) => void = () => {};
		let pending = new Promise<{ stdout: string; code: number }>((done) => {
			resolve = done;
		});
		const exec = vi.fn(
			async (_cmd: string, _args: string[], options?: { cwd?: string }) =>
				options?.cwd === "/old" ? pending : { stdout: "false", code: 0 },
		);
		const c = createRuntime(deps({ writerLock: wl, gitEvidence: { exec } }));
		const a = c.refreshWriterNotice("/old", NOW, "startup");
		await c.refreshWriterNotice("/newer", NOW, "status");
		const before = c.status();
		resolve({ stdout: "true", code: 0 });
		expect(await a).toBeUndefined();
		expect(c.status()).toBe(before);
		pending = new Promise((done) => {
			resolve = done;
		});
		const same = c.refreshWriterNotice("/old", NOW, "startup");
		c.setSessionId(wl.self.sessionId);
		resolve({ stdout: "false", code: 0 });
		expect(await same).toBeDefined();
		expect(c.status()).toContain("/old");
	});

	it("stops disabled refresh and only rechecks an effective enable transition", async () => {
		const wl = writerLockDeps();
		const exec = vi.fn(async () => ({ stdout: "false\n", code: 0 }));
		try {
			const c = createRuntime(deps({ writerLock: wl, gitEvidence: { exec } }));
			await c.refreshWriterNotice("/repo", NOW, "enabled");
			expect(exec).not.toHaveBeenCalled();
			c.setEnabled("writer-lock", false);
			await c.refreshWriterNotice("/repo", NOW, "status");
			expect(exec).not.toHaveBeenCalled();
			c.setEnabled("writer-lock", true);
			await c.refreshWriterNotice("/repo", NOW, "enabled");
			expect(exec).toHaveBeenCalledTimes(1);
			await c.refreshWriterNotice("/repo", NOW, "enabled");
			expect(exec).toHaveBeenCalledTimes(1);
			expect(c.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
				"block",
			);
		} finally {
			rmSync(wl.stateDir, { recursive: true, force: true });
		}
	});
});

describe("runtime: git-evidence 接線", () => {
	function evidenceFixture(env: RuntimeDeps["env"] = {}) {
		const exec = vi.fn<RuntimeDeps["gitEvidence"]["exec"]>(
			async (command, args) => ({
				stdout:
					args[0] === "log"
						? "abc (HEAD -> main) fix: x"
						: command === "gh"
							? "completed success\n"
							: "abc\n",
				code: 0,
			}),
		);
		const log = vi.fn();
		const runtime = createRuntime(deps({ env, log, gitEvidence: { exec } }));
		return { runtime, exec, log };
	}

	it("evidence preserves commit-push query order and signal", async () => {
		const { runtime, exec } = evidenceFixture();
		const { signal } = new AbortController();
		const text = await runtime.augmentGitEvidence(
			"git commit -m x && git push origin",
			false,
			signal,
		);
		expect(exec.mock.calls).toEqual([
			[
				"git",
				["log", "-1", "--format=%H %d %s"],
				{ cwd: "/Users/me/project", signal },
			],
			["git", ["rev-parse", "HEAD"], { cwd: "/Users/me/project", signal }],
			["git", ["rev-parse", "@{u}"], { cwd: "/Users/me/project", signal }],
			["gh", ["run", "list", "-L", "3"], { cwd: "/Users/me/project", signal }],
		]);
		for (const call of exec.mock.calls) expect(call[2]?.signal).toBe(signal);
		expect(text).toBe(
			[
				"--- [agents-guard] commit 驗證 ---\nHEAD: abc (HEAD -> main) fix: x",
				"--- [agents-guard] push 驗證（remote=origin） ---\n本地與遠端 SHA 一致：abc",
				"--- [agents-guard] CI 狀態 ---\ncompleted success",
			].join("\n\n"),
		);
	});

	it.each(["all", "git-evidence"] as const)(
		"evidence performs zero queries while %s is disabled",
		async (target) => {
			const { runtime, exec } = evidenceFixture();
			runtime.setEnabled(target, false);
			expect(
				await runtime.augmentGitEvidence(
					"git commit -m x && git push",
					false,
					undefined,
				),
			).toBeUndefined();
			expect(exec).not.toHaveBeenCalled();
		},
	);

	it.each(["all", "git-evidence"] as const)(
		"evidence already in flight survives disabling %s",
		async (target) => {
			const { runtime, exec } = evidenceFixture();
			const pending = deferred<{ stdout: string; code: number }>();
			exec.mockImplementationOnce(() => pending.promise);
			const inFlight = runtime.augmentGitEvidence(
				"git commit -m x && git push origin",
				false,
				undefined,
			);
			try {
				expect(exec).toHaveBeenCalledTimes(1);
				runtime.setEnabled(target, false);
				pending.resolve({ stdout: "abc (HEAD -> main) fix: x", code: 0 });
				expect(await inFlight).toContain("CI 狀態");
				expect(
					exec.mock.calls.map(([command, args]) => [command, args]),
				).toEqual([
					["git", ["log", "-1", "--format=%H %d %s"]],
					["git", ["rev-parse", "HEAD"]],
					["git", ["rev-parse", "@{u}"]],
					["gh", ["run", "list", "-L", "3"]],
				]);
				expect(
					await runtime.augmentGitEvidence("git push", false, undefined),
				).toBeUndefined();
				expect(exec).toHaveBeenCalledTimes(4);
			} finally {
				pending.resolve({ stdout: "abc", code: 0 });
				await inFlight;
			}
		},
	);

	it("evidence does not acquire completion child or shutdown gates", async () => {
		const { runtime, exec } = evidenceFixture({ PI_SUBAGENT_CHILD: "1" });
		runtime.shutdownCompletion();
		expect(
			await runtime.augmentGitEvidence("git commit -m x", false, undefined),
		).toContain("commit 驗證");
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("evidence records each failure once and only Runtime owns inert policy", async () => {
		const { runtime, exec, log } = evidenceFixture();
		exec.mockRejectedValue(new Error("injected evidence failure"));
		for (let count = 1; count <= 3; count += 1) {
			expect(
				await runtime.augmentGitEvidence("git commit -m x", false, undefined),
			).toBeUndefined();
			expect(log).toHaveBeenCalledTimes(count);
		}
		runtime.setEnabled("git-evidence", true);
		expect(
			await runtime.augmentGitEvidence("git commit -m x", false, undefined),
		).toBeUndefined();
		expect(exec).toHaveBeenCalledTimes(3);
		expect(log).toHaveBeenCalledTimes(3);
		expect(runtime.status()).toMatch(
			/git-evidence: enabled .*auto-disabled after repeated failures/,
		);
	});

	it("appends commit evidence after a successful git commit", async () => {
		const exec = async (command: string, args: string[]) => {
			expect(command).toBe("git");
			expect(args).toEqual(["log", "-1", "--format=%H %d %s"]);
			return { stdout: "abc123 (HEAD -> main) fix: x", code: 0 };
		};
		const runtime = createRuntime(deps({ gitEvidence: { exec } }));
		const evidence = await runtime.augmentGitEvidence(
			"git commit -m x",
			false,
			undefined,
		);
		expect(evidence).toContain("commit 驗證");
		expect(evidence).toContain("abc123");
	});

	it("does not append anything for a failed commit", async () => {
		const runtime = createRuntime(deps());
		expect(
			await runtime.augmentGitEvidence("git commit -m x", true, undefined),
		).toBeUndefined();
	});

	it("does not append anything for a command that only mentions git push in a string", async () => {
		const runtime = createRuntime(deps());
		expect(
			await runtime.augmentGitEvidence('echo "git push"', false, undefined),
		).toBeUndefined();
	});

	it("reports a consistent push and skips CI when checkCi is off", async () => {
		let call = 0;
		const exec = async (command: string, args: string[]) => {
			call += 1;
			if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
				return { stdout: "abc123\n", code: 0 };
			}
			if (command === "git" && args[0] === "rev-parse" && args[1] === "@{u}") {
				return { stdout: "abc123\n", code: 0 };
			}
			throw new Error(
				`unexpected exec call ${call}: ${command} ${args.join(" ")}`,
			);
		};
		const runtime = createRuntime(
			deps({
				fileConfig: { modules: { "git-evidence": { checkCi: false } } },
				gitEvidence: { exec },
			}),
		);
		const evidence = await runtime.augmentGitEvidence(
			"git push",
			false,
			undefined,
		);
		expect(evidence).toContain("push 驗證");
		expect(evidence).toContain("一致");
		expect(evidence).not.toContain("CI");
	});

	it("warns on a SHA mismatch after push", async () => {
		const exec = async (_command: string, args: string[]) => {
			if (args[1] === "HEAD") return { stdout: "abc123\n", code: 0 };
			return { stdout: "def456\n", code: 0 };
		};
		const runtime = createRuntime(
			deps({
				fileConfig: { modules: { "git-evidence": { checkCi: false } } },
				gitEvidence: { exec },
			}),
		);
		const evidence = await runtime.augmentGitEvidence(
			"git push",
			false,
			undefined,
		);
		expect(evidence).toContain("不一致");
	});

	it("degrades gracefully when gh is unavailable", async () => {
		const exec = async (command: string, args: string[]) => {
			if (command === "git" && args[1] === "HEAD")
				return { stdout: "abc123\n", code: 0 };
			if (command === "git" && args[1] === "@{u}")
				return { stdout: "abc123\n", code: 0 };
			if (command === "gh") throw new Error("ENOENT: gh not found");
			throw new Error("unexpected exec call");
		};
		const runtime = createRuntime(deps({ gitEvidence: { exec } }));
		const evidence = await runtime.augmentGitEvidence(
			"git push",
			false,
			undefined,
		);
		expect(evidence).toContain("未檢查 CI");
	});

	it("module disable stops git-evidence without affecting hard-deny", async () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "git-evidence": { enabled: false } } } }),
		);
		expect(
			await runtime.augmentGitEvidence("git commit -m x", false, undefined),
		).toBeUndefined();
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"block",
		);
	});

	it("fails open and logs when the verification exec throws unexpectedly", async () => {
		const log = vi.fn();
		const exec = async () => {
			throw new Error("boom");
		};
		const runtime = createRuntime(deps({ log, gitEvidence: { exec } }));
		expect(
			await runtime.augmentGitEvidence("git commit -m x", false, undefined),
		).toBeUndefined();
		expect(log).toHaveBeenCalledOnce();
	});
});

describe("runtime: completion collection", () => {
	function fixture() {
		const exec = vi.fn<RuntimeDeps["gitEvidence"]["exec"]>(
			async (_command, args) => ({
				stdout: args[0] === "status" ? " M a.txt\n?? b.txt" : "",
				code: 0,
			}),
		);
		const log = vi.fn();
		const fileConfig = {
			modules: {
				"completion-diff-recheck": {
					followUp: true,
					maxFollowUpsPerSession: 1,
				},
			},
		};
		const runtime = createRuntime(
			deps({ fileConfig, log, gitEvidence: { exec } }),
		);
		runtime.handleToolResult("write", { path: "a.txt" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		return { runtime, exec, log, fileConfig };
	}

	it.each(["off-on", "global-off-on", "abort", "shutdown"])(
		"completion discards a finished collection after %s",
		async (action) => {
			const { runtime, exec, log } = fixture();
			const abort = new AbortController();
			const old = await runtime.collectCompletionDiff(
				"/event-cwd",
				abort.signal,
			);
			expect(old).toBeDefined();
			if (action === "abort") abort.abort();
			else if (action === "shutdown") runtime.shutdownCompletion();
			else {
				const target = action === "off-on" ? "completion-diff-recheck" : "all";
				runtime.setEnabled(target, false);
				runtime.setEnabled(target, true);
			}
			expect(old?.finish()).toBeUndefined();
			expect(old?.finish()).toBeUndefined();
			expect(log).not.toHaveBeenCalled();
			exec.mockClear();
			if (action === "shutdown") {
				runtime.setEnabled("all", true);
				runtime.shutdownCompletion(); // Repeated shutdown is harmless.
				expect(
					await runtime.collectCompletionDiff("/event-cwd"),
				).toBeUndefined();
				expect(runtime.checkCompletionDiff("?? b.txt", "")).toBeUndefined();
				expect(exec).not.toHaveBeenCalled();
			} else {
				const fresh = await runtime.collectCompletionDiff(
					"/event-cwd",
					new AbortController().signal,
				);
				expect(fresh?.finish()?.shouldFollowUp).toBe(true);
				expect(fresh?.finish()).toBeUndefined();
			}
		},
	);

	it("completion captures writes and baseline while globally disabled", async () => {
		const { exec, fileConfig } = fixture();
		const runtime = createRuntime(
			deps({ flag: "off", fileConfig, gitEvidence: { exec } }),
		);
		runtime.handleToolResult("write", {}, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		expect(await runtime.collectCompletionDiff("/event-cwd")).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
		runtime.setEnabled("all", true);
		const check = await runtime.collectCompletionDiff("/event-cwd");
		expect(check?.finish()?.shouldFollowUp).toBe(true);
	});

	it("completion does not reserve quota during collection and shares the synchronous budget", async () => {
		const { runtime } = fixture();
		const [first, second] = await Promise.all([
			runtime.collectCompletionDiff("/first"),
			runtime.collectCompletionDiff("/second"),
		]);
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(runtime.checkCompletionDiff("?? sync.txt", "")?.shouldFollowUp).toBe(
			true,
		);
		expect(second?.finish()?.shouldFollowUp).toBe(false);
		expect(first?.finish()?.shouldFollowUp).toBe(false);
		expect(first?.finish()).toBeUndefined();
	});

	it("completion consumes concurrent collections in finish order without reusing a result", async () => {
		const { runtime } = fixture();
		const [first, second] = await Promise.all([
			runtime.collectCompletionDiff("/first"),
			runtime.collectCompletionDiff("/second"),
		]);
		expect(second?.finish()?.shouldFollowUp).toBe(true);
		expect(second?.finish()).toBeUndefined();
		expect(first?.finish()?.shouldFollowUp).toBe(false);
	});

	it("completion re-reads the latest baseline when finishing a collection", async () => {
		const { runtime } = fixture();
		const check = await runtime.collectCompletionDiff("/event-cwd");
		expect(check).toBeDefined();
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt\n?? b.txt" }],
		);
		expect(check?.finish()).toBeUndefined();
		expect(runtime.checkCompletionDiff("?? next.txt", "")?.shouldFollowUp).toBe(
			true,
		);
	});

	it("completion ignores repeated enable and writer-only lifecycle changes", async () => {
		const { runtime } = fixture();
		const check = await runtime.collectCompletionDiff("/event-cwd");
		runtime.setEnabled("completion-diff-recheck", true);
		runtime.setEnabled("git-evidence", false);
		runtime.setSessionId("writer-only-id");
		runtime.initWriterLock(null, 10);
		runtime.releaseWriterLock();
		expect(check?.finish()?.shouldFollowUp).toBe(true);
	});

	it("completion invalidates an unconsumed result once failures make it inert", async () => {
		const { runtime, exec, log } = fixture();
		const old = await runtime.collectCompletionDiff("/event-cwd");
		expect(old).toBeDefined();
		exec.mockRejectedValue(new Error("private exec"));
		for (let i = 0; i < 3; i += 1)
			expect(await runtime.collectCompletionDiff("/event-cwd")).toBeUndefined();
		expect(log).toHaveBeenCalledTimes(3);
		expect(old?.finish()).toBeUndefined();
		exec.mockClear();
		expect(await runtime.collectCompletionDiff("/event-cwd")).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"block",
		);
	});

	it("completion isolates a card-building fault before consuming quota", () => {
		const { runtime, log } = fixture();
		const invalidStat = {
			trim() {
				throw new Error("private stat");
			},
		} as unknown as string;
		expect(
			runtime.checkCompletionDiff("?? b.txt", invalidStat),
		).toBeUndefined();
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls.flat().join(" ")).not.toContain("private stat");
		expect(runtime.checkCompletionDiff("?? b.txt", "")?.shouldFollowUp).toBe(
			true,
		);
	});

	it("completion contains a finish failure once without spending quota", async () => {
		const { runtime, exec, log } = fixture();
		const invalidStat = {
			trim() {
				throw new Error("private stat");
			},
		} as unknown as string;
		exec
			.mockResolvedValueOnce({ stdout: "?? b.txt", code: 0 })
			.mockResolvedValueOnce({ stdout: invalidStat, code: 0 });
		const check = await runtime.collectCompletionDiff("/event-cwd");
		expect(check).toBeDefined();
		expect(check?.finish()).toBeUndefined();
		expect(check?.finish()).toBeUndefined();
		expect(log).toHaveBeenCalledTimes(1);
		expect(runtime.checkCompletionDiff("?? b.txt", "")?.shouldFollowUp).toBe(
			true,
		);
	});

	it("completion does not inherit facts or quota from another Runtime", async () => {
		const { runtime, exec, fileConfig } = fixture();
		expect(runtime.checkCompletionDiff("?? b.txt", "")?.shouldFollowUp).toBe(
			true,
		);
		const other = createRuntime(deps({ fileConfig, gitEvidence: { exec } }));
		expect(await other.collectCompletionDiff("/other")).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
		other.handleToolResult("write", {}, false);
		const noBaseline = await other.collectCompletionDiff("/other");
		expect(noBaseline?.finish()?.shouldFollowUp).toBe(false);
		other.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: "" }],
		);
		const observed = await other.collectCompletionDiff("/other");
		expect(observed?.finish()?.shouldFollowUp).toBe(true);
	});
});

describe("runtime: completion-diff-recheck 接線", () => {
	it("does nothing when the session had no writes", () => {
		const runtime = createRuntime(deps());
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
	});

	it("does nothing when there had writes but the porcelain snapshot is unchanged", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
	});

	it("returns a card without a follow-up when the snapshot changed and followUp is off", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("edit", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		const result = runtime.checkCompletionDiff(
			" M a.txt\n?? b.txt",
			" a.txt | 1 +",
		);
		expect(result?.shouldFollowUp).toBe(false);
		expect(result?.card).toContain("b.txt");
		expect(result?.card).toContain("--- git diff --stat ---\na.txt | 1 +");
	});

	it("requests a follow-up when the snapshot changed and followUp is on", () => {
		const runtime = createRuntime(
			deps({
				fileConfig: {
					modules: { "completion-diff-recheck": { followUp: true } },
				},
			}),
		);
		runtime.handleToolResult("edit", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		const result = runtime.checkCompletionDiff(" M a.txt\n?? b.txt", "");
		expect(result?.shouldFollowUp).toBe(true);
	});

	it("stops following up once the per-session limit is reached", () => {
		const runtime = createRuntime(
			deps({
				fileConfig: {
					modules: {
						"completion-diff-recheck": {
							followUp: true,
							maxFollowUpsPerSession: 1,
						},
					},
				},
			}),
		);
		runtime.handleToolResult("edit", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		const first = runtime.checkCompletionDiff(" M a.txt\n?? b.txt", "");
		expect(first?.shouldFollowUp).toBe(true);
		const second = runtime.checkCompletionDiff(" M a.txt\n?? c.txt", "");
		expect(second?.shouldFollowUp).toBe(false);
	});

	it("ignores a bash command that only prints the human-readable git status", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		runtime.handleToolResult("bash", { command: "git status" }, false, [
			{ type: "text", text: "nothing to commit" },
		]);
		// observed stays null — no false baseline from a human-readable call.
		expect(runtime.checkCompletionDiff("", "")).toBeUndefined();
		expect(runtime.checkCompletionDiff(" M a.txt", "")).not.toBeUndefined();
	});

	it("is disabled entirely inside a subagent child session", () => {
		const runtime = createRuntime(deps({ env: { PI_SUBAGENT_CHILD: "1" } }));
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
	});

	it("module disable stops completion-diff-recheck without affecting hard-deny", () => {
		const runtime = createRuntime(
			deps({
				fileConfig: {
					modules: { "completion-diff-recheck": { enabled: false } },
				},
			}),
		);
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe(
			"block",
		);
	});
});
