import { describe, expect, it } from "vitest";
import {
	combineEvidence,
	detectGitEvents,
	formatCiEvidence,
	formatCommitEvidence,
	formatPushEvidence,
} from "../src/modules/git-evidence.js";

describe("detectGitEvents", () => {
	it("detects a successful commit", () => {
		expect(detectGitEvents("git commit -m x", false)).toEqual([
			{ kind: "commit" },
		]);
	});

	it("does not detect a failed commit", () => {
		expect(detectGitEvents("git commit -m x", true)).toEqual([]);
	});

	it("does not match a string that merely mentions git push", () => {
		expect(detectGitEvents('echo "git push"', false)).toEqual([]);
	});

	it("detects a push and captures the remote when given", () => {
		expect(detectGitEvents("git push origin main", false)).toEqual([
			{ kind: "push", remote: "origin" },
		]);
	});

	it("detects a bare push with no remote argument", () => {
		expect(detectGitEvents("git push", false)).toEqual([
			{ kind: "push", remote: undefined },
		]);
	});

	it("detects a push inside a compound command", () => {
		expect(detectGitEvents("git status && git push", false)).toEqual([
			{ kind: "push", remote: undefined },
		]);
	});

	it("detects both a commit and a push in one compound command", () => {
		expect(detectGitEvents("git commit -m x && git push", false)).toEqual([
			{ kind: "commit" },
			{ kind: "push", remote: undefined },
		]);
	});

	it("ignores unrelated git subcommands", () => {
		expect(detectGitEvents("git status", false)).toEqual([]);
		expect(detectGitEvents("git add -A", false)).toEqual([]);
	});

	it("fails open when the command cannot be parsed", () => {
		expect(detectGitEvents("echo 'unterminated", false)).toEqual([]);
	});
});

describe("formatCommitEvidence", () => {
	it("wraps the log output with a labeled header", () => {
		const text = formatCommitEvidence("a1b2c3d (HEAD -> main) fix: something");
		expect(text).toContain("[agents-guard] commit 驗證");
		expect(text).toContain("a1b2c3d (HEAD -> main) fix: something");
	});
});

describe("formatPushEvidence", () => {
	it("reports a clear match when local and remote SHAs agree", () => {
		const text = formatPushEvidence("abc123", "abc123");
		expect(text).toContain("[agents-guard] push 驗證");
		expect(text).toContain("一致");
		expect(text).toContain("abc123");
	});

	it("warns when local and remote SHAs disagree", () => {
		const text = formatPushEvidence("abc123", "def456");
		expect(text).toContain("不一致");
		expect(text).toContain("abc123");
		expect(text).toContain("def456");
	});

	it("notes a missing upstream instead of comparing", () => {
		const text = formatPushEvidence("abc123", null);
		expect(text).not.toContain("一致");
		expect(text).toContain("upstream");
	});

	it("includes the remote name when given", () => {
		expect(formatPushEvidence("abc123", "abc123", "origin")).toContain(
			"origin",
		);
	});
});

describe("formatCiEvidence", () => {
	it("formats real CI output", () => {
		const text = formatCiEvidence("completed\tsuccess\tci.yml\t123");
		expect(text).toContain("[agents-guard] CI");
		expect(text).toContain("completed");
	});

	it("notes that CI was not checked when gh is unavailable", () => {
		const text = formatCiEvidence(null);
		expect(text).toContain("未檢查 CI");
		expect(text).toContain("gh");
	});
});

describe("combineEvidence", () => {
	it("joins parts with a blank line when under the byte limit", () => {
		expect(combineEvidence(["a", "b"], 100)).toBe("a\n\nb");
	});

	it("truncates and notes the original length when over the limit", () => {
		const result = combineEvidence(["x".repeat(50)], 10);
		expect(result.startsWith("x".repeat(10))).toBe(true);
		expect(result).toContain("截斷");
		expect(result).toContain("50");
	});
});
