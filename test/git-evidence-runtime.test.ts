import { describe, expect, it, vi } from "vitest";
import type { ExecFn } from "../src/lib/git.js";
import { createGitEvidenceCoordinator } from "../src/runtime/git-evidence.js";
import type { GitEvidenceOptions } from "../src/types.js";
import { deferred } from "./helpers/deferred.js";

const COMMIT =
	"--- [agents-guard] commit 驗證 ---\nHEAD: abc (HEAD -> main) fix: x";
const PUSH =
	"--- [agents-guard] push 驗證（remote=origin） ---\n本地與遠端 SHA 一致：abc";
const CI = "--- [agents-guard] CI 狀態 ---\ncompleted success";
const COMMAND = "git commit -m x && git push origin";

function fixture(
	options: GitEvidenceOptions = { checkCi: true, maxAppendBytes: 4096 },
) {
	const getOptions = vi.fn(() => options);
	const exec = vi.fn<ExecFn>(async (command, args) => ({
		stdout:
			args[0] === "log"
				? "abc (HEAD -> main) fix: x"
				: command === "gh"
					? "completed success\n"
					: "abc\n",
		code: 0,
	}));
	const coordinator = createGitEvidenceCoordinator({
		exec,
		cwd: "/initial-cwd",
		getOptions,
	});
	return { coordinator, exec, getOptions };
}

describe("git-evidence coordinator", () => {
	it("coordinator preserves commit-push query order and signal", async () => {
		const { coordinator, exec, getOptions } = fixture();
		const { signal } = new AbortController();
		expect(await coordinator.augment(COMMAND, false, signal)).toBe(
			[COMMIT, PUSH, CI].join("\n\n"),
		);
		expect(exec.mock.calls).toEqual([
			[
				"git",
				["log", "-1", "--format=%H %d %s"],
				{ cwd: "/initial-cwd", signal },
			],
			["git", ["rev-parse", "HEAD"], { cwd: "/initial-cwd", signal }],
			["git", ["rev-parse", "@{u}"], { cwd: "/initial-cwd", signal }],
			["gh", ["run", "list", "-L", "3"], { cwd: "/initial-cwd", signal }],
		]);
		for (const call of exec.mock.calls) expect(call[2]?.signal).toBe(signal);
		expect(getOptions).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ command: COMMAND, isError: true },
		{ command: 'echo "git push"', isError: false },
	])(
		"does not read options or execute when $command has no successful event ($isError)",
		async ({ command, isError }) => {
			const { coordinator, exec, getOptions } = fixture();
			expect(
				await coordinator.augment(command, isError, undefined),
			).toBeUndefined();
			expect(exec).not.toHaveBeenCalled();
			expect(getOptions).not.toHaveBeenCalled();
		},
	);

	it("omits CI queries when checkCi is false", async () => {
		const { coordinator, exec } = fixture({
			checkCi: false,
			maxAppendBytes: 4096,
		});
		expect(await coordinator.augment("git push origin", false, undefined)).toBe(
			PUSH,
		);
		expect(exec.mock.calls.map(([command, args]) => [command, args])).toEqual([
			["git", ["rev-parse", "HEAD"]],
			["git", ["rev-parse", "@{u}"]],
		]);
	});

	it("treats unsuccessful upstream as unavailable, not as a SHA", async () => {
		const { coordinator, exec } = fixture({
			checkCi: false,
			maxAppendBytes: 4096,
		});
		exec
			.mockResolvedValueOnce({ stdout: "abc\n", code: 0 })
			.mockResolvedValueOnce({ stdout: "misleading-upstream", code: 128 });
		const text = await coordinator.augment("git push origin", false, undefined);
		expect(text).toContain("local=abc");
		expect(text).toContain("無法取得上游追蹤分支");
		expect(text).not.toContain("misleading-upstream");
		expect(exec).toHaveBeenCalledTimes(2);
	});

	it.each(["throw", "nonzero"])(
		"degrades only the CI section for gh %s",
		async (outcome) => {
			const { coordinator, exec } = fixture();
			exec
				.mockResolvedValueOnce({ stdout: "abc", code: 0 })
				.mockResolvedValueOnce({ stdout: "abc", code: 0 });
			if (outcome === "throw")
				exec.mockRejectedValueOnce(new Error("gh unavailable"));
			else
				exec.mockResolvedValueOnce({ stdout: "private-ci-fixture", code: 1 });
			expect(
				await coordinator.augment("git push origin", false, undefined),
			).toBe(
				`${PUSH}\n\n--- [agents-guard] CI 狀態 ---\n未檢查 CI（gh 不可用）`,
			);
			expect(exec).toHaveBeenCalledTimes(3);
		},
	);

	it.each([
		{ stage: "log", preceding: 0, code: 1, killed: false },
		{ stage: "log", preceding: 0, code: 0, killed: true },
		{ stage: "HEAD", preceding: 1, code: 1, killed: false },
		{ stage: "HEAD", preceding: 1, code: 0, killed: true },
	])(
		"preserves existing stdout use for $stage code=$code killed=$killed",
		async ({ stage, preceding, code, killed }) => {
			const { coordinator, exec } = fixture();
			if (preceding > 0)
				exec.mockResolvedValueOnce({
					stdout: "abc (HEAD -> main) fix: x",
					code: 0,
				});
			exec.mockResolvedValueOnce({
				stdout: stage === "log" ? "abc (HEAD -> main) fix: x" : "abc\n",
				code,
				killed,
			});
			expect(await coordinator.augment(COMMAND, false, undefined)).toBe(
				[COMMIT, PUSH, CI].join("\n\n"),
			);
			expect(exec).toHaveBeenCalledTimes(4);
		},
	);

	it.each(["upstream", "gh"])(
		"does not invent a killed gate for successful-code %s",
		async (stage) => {
			const { coordinator, exec } = fixture();
			exec.mockResolvedValueOnce({ stdout: "abc", code: 0 });
			if (stage === "gh")
				exec.mockResolvedValueOnce({ stdout: "abc", code: 0 });
			exec.mockResolvedValueOnce({
				stdout: stage === "gh" ? "completed success" : "abc",
				code: 0,
				killed: true,
			});
			expect(
				await coordinator.augment("git push origin", false, undefined),
			).toBe([PUSH, CI].join("\n\n"));
			expect(exec).toHaveBeenCalledTimes(3);
		},
	);

	it.each([
		{ stage: "log", preceding: 0 },
		{ stage: "HEAD", preceding: 1 },
		{ stage: "upstream", preceding: 2 },
	])(
		"propagates $stage rejection unchanged for Runtime to own",
		async ({ preceding }) => {
			const { coordinator, exec } = fixture();
			const failure = new Error("injected git failure");
			for (let i = 0; i < preceding; i += 1)
				exec.mockResolvedValueOnce({ stdout: "abc", code: 0 });
			exec.mockRejectedValueOnce(failure);
			await expect(coordinator.augment(COMMAND, false, undefined)).rejects.toBe(
				failure,
			);
			expect(exec).toHaveBeenCalledTimes(preceding + 1);
		},
	);

	it("forwards an already-aborted signal without adding completion eligibility", async () => {
		const { coordinator, exec } = fixture();
		const abort = new AbortController();
		abort.abort();
		// The fake executor deliberately ignores cancellation; this pins coordinator policy only.
		expect(await coordinator.augment(COMMAND, false, abort.signal)).toBe(
			[COMMIT, PUSH, CI].join("\n\n"),
		);
		expect(exec).toHaveBeenCalledTimes(4);
		for (const call of exec.mock.calls)
			expect(call[2]?.signal).toBe(abort.signal);
	});

	it("coordinator captures options before the first await and uses new options only next time", async () => {
		const { coordinator, exec, getOptions } = fixture();
		const pending = deferred<{ stdout: string; code: number }>();
		const optionsA = { checkCi: true, maxAppendBytes: 4096 };
		let currentOptions = optionsA;
		getOptions.mockImplementation(() => currentOptions);
		exec.mockImplementationOnce(() => pending.promise);
		const inFlight = coordinator.augment(COMMAND, false, undefined);
		try {
			expect(exec).toHaveBeenCalledTimes(1);
			expect(getOptions).toHaveBeenCalledTimes(1);
			currentOptions = { checkCi: false, maxAppendBytes: 20 };
			pending.resolve({ stdout: "abc (HEAD -> main) fix: x", code: 0 });
			expect(await inFlight).toBe([COMMIT, PUSH, CI].join("\n\n"));
			expect(exec).toHaveBeenCalledTimes(4);
			expect(getOptions).toHaveBeenCalledTimes(1);
			expect(optionsA).toEqual({ checkCi: true, maxAppendBytes: 4096 });
			exec.mockClear();
			getOptions.mockClear();
			const full = [COMMIT, PUSH].join("\n\n");
			expect(await coordinator.augment(COMMAND, false, undefined)).toBe(
				`${full.slice(0, 20)}\n...[截斷，原長度 ${full.length} bytes，上限 20]`,
			);
			expect(exec).toHaveBeenCalledTimes(3);
			expect(exec.mock.calls.every(([command]) => command !== "gh")).toBe(true);
			expect(getOptions).toHaveBeenCalledTimes(1);
		} finally {
			pending.resolve({ stdout: "abc", code: 0 });
			await inFlight;
		}
	});
});
