import { describe, expect, it } from "vitest";
import {
	decideRecheck,
	extractText,
	isPorcelainStatusCommand,
	isWriteTool,
	normalizePorcelain,
} from "../src/modules/completion-diff-recheck.js";

describe("isWriteTool", () => {
	it("recognizes write/edit/ast_grep_replace", () => {
		expect(isWriteTool("write")).toBe(true);
		expect(isWriteTool("edit")).toBe(true);
		expect(isWriteTool("ast_grep_replace")).toBe(true);
	});

	it("rejects read-only tools", () => {
		expect(isWriteTool("read")).toBe(false);
		expect(isWriteTool("bash")).toBe(false);
	});
});

describe("isPorcelainStatusCommand", () => {
	it("matches a bare porcelain status call", () => {
		expect(isPorcelainStatusCommand("git status --porcelain")).toBe(true);
	});

	it("matches a versioned porcelain flag and extra flags", () => {
		expect(isPorcelainStatusCommand("git status --porcelain=v1 -b")).toBe(true);
	});

	it("does not match a human-readable git status", () => {
		expect(isPorcelainStatusCommand("git status")).toBe(false);
	});

	it("does not match a string that merely mentions the words", () => {
		expect(isPorcelainStatusCommand('echo "git status --porcelain"')).toBe(
			false,
		);
	});

	it("fails open when the command cannot be parsed", () => {
		expect(isPorcelainStatusCommand("echo 'unterminated")).toBe(false);
	});
});

describe("extractText", () => {
	it("returns the first text block", () => {
		expect(extractText([{ type: "text", text: "hello" }])).toBe("hello");
	});

	it("skips non-text blocks", () => {
		expect(extractText([{ type: "image" }, { type: "text", text: "hi" }])).toBe(
			"hi",
		);
	});

	it("returns undefined when there is no text block", () => {
		expect(extractText([{ type: "image" }])).toBeUndefined();
		expect(extractText([])).toBeUndefined();
	});
});

describe("normalizePorcelain", () => {
	it("treats empty and the bash tool's (no output) placeholder as equivalent", () => {
		expect(normalizePorcelain("")).toBe(normalizePorcelain("(no output)"));
		expect(normalizePorcelain("(no output)")).toBe("");
	});

	it("ignores pure whitespace differences", () => {
		expect(normalizePorcelain(" M a.txt \n")).toBe(
			normalizePorcelain(" M a.txt"),
		);
	});

	it("preserves distinct porcelain lines", () => {
		expect(normalizePorcelain(" M a.txt\n?? b.txt")).toBe(" M a.txt\n?? b.txt");
	});
});

describe("decideRecheck", () => {
	const opts = { followUp: false, maxFollowUpsPerSession: 2 };
	const facts = (
		over: Partial<{ hadWrites: boolean; followUpCount: number }> = {},
	) => ({
		hadWrites: true,
		followUpCount: 0,
		...over,
	});

	it("does nothing when the session had no writes", () => {
		expect(
			decideRecheck(" M a.txt", "", facts({ hadWrites: false }), opts),
		).toEqual({
			changed: false,
			summary: "",
			shouldFollowUp: false,
		});
	});

	it("does nothing when there had writes but no difference", () => {
		expect(decideRecheck(" M a.txt", " M a.txt", facts(), opts).changed).toBe(
			false,
		);
	});

	it("flags a difference with a summary, follow-up off", () => {
		const result = decideRecheck(
			" M a.txt",
			" M a.txt\n?? b.txt",
			facts(),
			opts,
		);
		expect(result.changed).toBe(true);
		expect(result.summary).toContain("b.txt");
		expect(result.shouldFollowUp).toBe(false);
	});

	it("flags a difference and requests a follow-up when enabled and under the limit", () => {
		const result = decideRecheck(" M a.txt", " M a.txt\n?? b.txt", facts(), {
			followUp: true,
			maxFollowUpsPerSession: 2,
		});
		expect(result.changed).toBe(true);
		expect(result.shouldFollowUp).toBe(true);
	});

	it("stops requesting a follow-up once the session limit is reached", () => {
		const result = decideRecheck(
			" M a.txt",
			" M a.txt\n?? b.txt",
			facts({ followUpCount: 2 }),
			{ followUp: true, maxFollowUpsPerSession: 2 },
		);
		expect(result.changed).toBe(true);
		expect(result.shouldFollowUp).toBe(false);
	});

	it("only shows a card and never follows up when there is no observed baseline", () => {
		const result = decideRecheck(null, " M a.txt", facts(), {
			followUp: true,
			maxFollowUpsPerSession: 2,
		});
		expect(result.changed).toBe(true);
		expect(result.shouldFollowUp).toBe(false);
	});

	it("does nothing when there is no baseline and the working tree is actually clean", () => {
		expect(decideRecheck(null, "", facts(), opts).changed).toBe(false);
		expect(decideRecheck(null, "(no output)", facts(), opts).changed).toBe(
			false,
		);
	});

	it("treats the bash tool's (no output) placeholder as a clean baseline", () => {
		expect(decideRecheck("(no output)", "", facts(), opts).changed).toBe(false);
	});

	it("honestly reports a resolved-since-observed difference instead of claiming zero files differ", () => {
		// The agent observed a dirty tree, but by the time agent_settled fires the
		// tree is actually clean again (e.g. reverted, or committed by another
		// process). This is still a real difference from what the agent reported.
		const result = decideRecheck(" M a.txt", "", facts(), opts);
		expect(result.changed).toBe(true);
		expect(result.summary).not.toContain("0 個檔案");
		expect(result.summary).toContain("乾淨");
	});
});
