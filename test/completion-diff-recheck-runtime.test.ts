import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { ExecFn } from "../src/lib/git.js";
import { createCompletionController } from "../src/runtime/completion-diff-recheck.js";

function fixture({ active = true, isSubagentChild = false } = {}) {
	const settings = {
		active,
		options: { followUp: true, maxFollowUpsPerSession: 1 },
	};
	const recordFailure = vi.fn();
	const exec = vi.fn<ExecFn>(async (_command, args) => ({
		stdout: args[0] === "status" ? " M a.txt\n?? b.txt" : " a.txt | 1 +\n",
		code: 0,
	}));
	const controller = createCompletionController({
		exec,
		recordFailure,
		isSubagentChild,
		getSettings: () => settings,
	});
	function observe() {
		controller.observeToolResult("write", {}, false);
		controller.observeToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
	}
	return { controller, settings, exec, recordFailure, observe };
}

describe("completion controller", () => {
	it("completion observes actual Git changes and dirty-to-clean", async () => {
		const root = mkdtempSync(join(tmpdir(), "ag-completion-real-"));
		try {
			const cwd = join(root, "repo");
			const wrong = join(root, "wrong-repo");
			mkdirSync(cwd);
			mkdirSync(wrong);
			const gitConfig = join(root, "empty.gitconfig");
			writeFileSync(gitConfig, "");
			const run = promisify(execFile);
			const exec: ExecFn = async (command, args, options) => {
				try {
					const { stdout } = await run(command, args, {
						cwd: options?.cwd,
						signal: options?.signal,
						encoding: "utf8",
						env: {
							PATH: process.env.PATH,
							LC_ALL: "C",
							GIT_CONFIG_NOSYSTEM: "1",
							GIT_CONFIG_GLOBAL: gitConfig,
							GIT_TERMINAL_PROMPT: "0",
						},
					});
					return { stdout, code: 0, killed: false };
				} catch (error) {
					if (
						error !== null &&
						typeof error === "object" &&
						"code" in error &&
						typeof error.code === "number" &&
						"stdout" in error &&
						typeof error.stdout === "string"
					) {
						return { stdout: error.stdout, code: error.code, killed: false };
					}
					throw error;
				}
			};
			expect((await exec("git", ["init", "-q"], { cwd })).code).toBe(0);
			expect((await exec("git", ["init", "-q"], { cwd: wrong })).code).toBe(0);
			writeFileSync(join(cwd, "a.txt"), "a\n");
			const baseline = await exec("git", ["status", "--porcelain"], { cwd });
			expect(baseline.code).toBe(0);
			expect(baseline.stdout).toContain("a.txt");
			const recordFailure = vi.fn();
			const controller = createCompletionController({
				exec,
				recordFailure,
				isSubagentChild: false,
				getSettings: () => ({
					active: true,
					options: { followUp: false, maxFollowUpsPerSession: 1 },
				}),
			});
			controller.observeToolResult("write", { path: "a.txt" }, false);
			controller.observeToolResult(
				"bash",
				{ command: "git status --porcelain" },
				false,
				[{ type: "text", text: baseline.stdout }],
			);
			writeFileSync(join(cwd, "b.txt"), "b\n");
			const dirty = await controller.collect(cwd);
			expect(dirty?.finish()?.card).toContain("b.txt");
			rmSync(join(cwd, "a.txt"));
			rmSync(join(cwd, "b.txt"));
			const clean = await controller.collect(cwd);
			expect(clean?.finish()?.card).toContain("已恢復成乾淨");
			const actual = await exec("git", ["status", "--porcelain"], { cwd });
			expect(actual.code).toBe(0);
			expect(actual.stdout).toBe("");
			expect(recordFailure).not.toHaveBeenCalled();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves facts across disable and uses finish once", async () => {
		const { controller, settings, observe, recordFailure } = fixture();
		observe();
		const old = await controller.collect("/event-cwd");
		expect(old).toBeDefined();
		settings.active = false;
		controller.invalidate();
		settings.active = true;
		controller.invalidate();
		expect(old?.finish()).toBeUndefined();
		const fresh = await controller.collect("/event-cwd");
		expect(fresh?.finish()?.shouldFollowUp).toBe(true);
		expect(fresh?.finish()).toBeUndefined();
		expect(recordFailure).not.toHaveBeenCalled();
	});

	it.each(["child", "inactive", "no-writes", "failed-write"])(
		"performs zero I/O when %s",
		async (reason) => {
			const { controller, exec, recordFailure } = fixture({
				active: reason !== "inactive",
				isSubagentChild: reason === "child",
			});
			if (reason !== "no-writes")
				controller.observeToolResult("write", {}, reason === "failed-write");
			expect(await controller.collect("/event-cwd")).toBeUndefined();
			expect(controller.check("?? b.txt", "")).toBeUndefined();
			expect(exec).not.toHaveBeenCalled();
			expect(recordFailure).not.toHaveBeenCalled();
		},
	);

	it.each(["write", "edit", "ast_grep_replace"])(
		"observes successful %s without inventing a baseline",
		(tool) => {
			const { controller, exec } = fixture();
			controller.observeToolResult(tool, {}, false);
			expect(controller.check("?? b.txt", "")).toEqual({
				card: expect.stringContaining("b.txt"),
				shouldFollowUp: false,
			});
			expect(exec).not.toHaveBeenCalled();
		},
	);

	it("records observations while inactive", async () => {
		const { controller, settings, observe, exec } = fixture({ active: false });
		observe();
		expect(await controller.collect("/event-cwd")).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
		settings.active = true;
		controller.invalidate();
		const check = await controller.collect("/event-cwd");
		expect(check?.finish()?.shouldFollowUp).toBe(true);
	});

	it("observes only the first valid text block", () => {
		const { controller } = fixture();
		controller.observeToolResult("write", {}, false);
		controller.observeToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[
				{ type: "image", text: "?? image.txt" },
				{ type: "text", text: 12 },
				{ type: "text", text: " M a.txt" },
				{ type: "text", text: "?? later.txt" },
			],
		);
		expect(controller.check(" M a.txt", "")).toBeUndefined();
		expect(controller.check("?? b.txt", "")?.shouldFollowUp).toBe(true);
	});

	it.each([
		{ command: "git status --porcelain", isError: true },
		{ command: "git status", isError: false },
		{ command: 42, isError: false },
	])(
		"does not overwrite a valid baseline with $command (isError=$isError)",
		({ command, isError }) => {
			const { controller, observe } = fixture();
			observe();
			controller.observeToolResult("bash", { command }, isError, [
				{ type: "text", text: "?? wrong.txt" },
			]);
			expect(controller.check(" M a.txt", "")).toBeUndefined();
		},
	);

	it("keeps facts and budgets local to each instance", async () => {
		const first = fixture();
		const second = fixture();
		first.observe();
		expect(first.controller.check("?? b.txt", "")?.shouldFollowUp).toBe(true);
		expect(await second.controller.collect("/other")).toBeUndefined();
		expect(second.exec).not.toHaveBeenCalled();
		second.observe();
		expect(second.controller.check("?? b.txt", "")?.shouldFollowUp).toBe(true);
		expect(first.controller.check("?? c.txt", "")?.shouldFollowUp).toBe(false);
	});

	it("shares the current budget in reverse finish order", async () => {
		const { controller, observe } = fixture();
		observe();
		const [first, second] = await Promise.all([
			controller.collect("/first"),
			controller.collect("/second"),
		]);
		expect(second?.finish()?.shouldFollowUp).toBe(true);
		expect(second?.finish()).toBeUndefined();
		expect(first?.finish()?.shouldFollowUp).toBe(false);
	});

	it("uses current policy and options at finish without reserving quota", async () => {
		const { controller, settings, observe } = fixture();
		observe();
		const abandoned = await controller.collect("/event-cwd");
		settings.active = false;
		expect(abandoned?.finish()).toBeUndefined();
		settings.active = true;
		expect(abandoned?.finish()).toBeUndefined();
		const collected = await controller.collect("/event-cwd");
		settings.options = { followUp: false, maxFollowUpsPerSession: 1 };
		expect(collected?.finish()?.shouldFollowUp).toBe(false);
		settings.options = { followUp: true, maxFollowUpsPerSession: 1 };
		expect(controller.check("?? next.txt", "")?.shouldFollowUp).toBe(true);
	});

	it("makes shutdown terminal without clearing another instance", async () => {
		const { controller, settings, observe, exec } = fixture();
		observe();
		const old = await controller.collect("/event-cwd");
		exec.mockClear();
		controller.shutdown();
		controller.shutdown();
		settings.active = false;
		controller.invalidate();
		settings.active = true;
		controller.invalidate();
		expect(old?.finish()).toBeUndefined();
		expect(await controller.collect("/event-cwd")).toBeUndefined();
		expect(controller.check("?? next.txt", "")).toBeUndefined();
		expect(exec).not.toHaveBeenCalled();
		const other = fixture();
		other.observe();
		expect(other.controller.check("?? b.txt", "")?.shouldFollowUp).toBe(true);
	});

	it("uses exact scoped argv, the same signal, and successful display statistics", async () => {
		const { controller, observe, exec } = fixture();
		const { signal } = new AbortController();
		observe();
		const check = await controller.collect("/event-cwd", signal);
		expect(exec.mock.calls).toEqual([
			["git", ["status", "--porcelain"], { cwd: "/event-cwd", signal }],
			["git", ["diff", "--stat"], { cwd: "/event-cwd", signal }],
		]);
		for (const call of exec.mock.calls) expect(call[2]?.signal).toBe(signal);
		expect(check?.finish()?.card).toContain(
			"--- git diff --stat ---\na.txt | 1 +",
		);
	});

	it("reports unexpected failures without inventing a second inert counter", async () => {
		const { controller, observe, exec, recordFailure } = fixture();
		observe();
		for (let i = 0; i < 3; i += 1) {
			exec.mockRejectedValueOnce(new Error("injected failure"));
			expect(await controller.collect("/event-cwd")).toBeUndefined();
		}
		expect(recordFailure).toHaveBeenCalledTimes(3);
		// Runtime owns inert policy; this direct fixture deliberately remains active.
		const fresh = await controller.collect("/event-cwd");
		expect(fresh?.finish()?.shouldFollowUp).toBe(true);
		expect(recordFailure).toHaveBeenCalledTimes(3);
	});
});
