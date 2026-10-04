import { minimatch } from "minimatch";
import { parse } from "unbash";
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
	it("parses bash with unbash", () => {
		const ast = parse("echo hi > out.txt");
		expect(ast.type).toBe("Script");
		expect(ast.commands.length).toBeGreaterThan(0);
	});

	it("matches globs with minimatch", () => {
		expect(
			minimatch(
				"/Users/x/.pi/agent/settings.json",
				"**/.pi/agent/settings.json",
			),
		).toBe(true);
		expect(
			minimatch("/Users/x/src/index.ts", "**/.pi/agent/settings.json"),
		).toBe(false);
	});
});
