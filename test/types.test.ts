import { describe, expect, it } from "vitest";
import { isModuleName, MODULE_NAMES } from "../src/types.js";

describe("MODULE_NAMES", () => {
	it("contains all five modules", () => {
		expect(MODULE_NAMES).toEqual([
			"hard-deny",
			"subagent-policy",
			"writer-lock",
			"git-evidence",
			"completion-diff-recheck",
		]);
	});

	it("isModuleName accepts known names and rejects others", () => {
		expect(isModuleName("hard-deny")).toBe(true);
		expect(isModuleName("writer-lock")).toBe(true);
		expect(isModuleName("nope")).toBe(false);
		expect(isModuleName("")).toBe(false);
	});
});
