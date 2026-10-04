import { describe, expect, it } from "vitest";
import { matchesProtected, normalizeCandidate } from "../src/lib/paths.js";

const resolver = (links: Record<string, string> = {}) => ({
	cwd: "/Users/me/project",
	home: "/Users/me",
	realpathSync: (path: string) => links[path] ?? path,
});

describe("normalizeCandidate", () => {
	it("absolutizes a relative path against cwd", () => {
		expect(normalizeCandidate("src/a.ts", resolver())).toContain(
			"/Users/me/project/src/a.ts",
		);
	});

	it("expands a leading ~ to home", () => {
		expect(normalizeCandidate("~/.zshrc", resolver())).toContain(
			"/Users/me/.zshrc",
		);
	});

	it("includes the symlink-resolved form alongside the literal one", () => {
		const links = { "/tmp/alias": "/Users/me/.pi/agent/settings.json" };
		const variants = normalizeCandidate("/tmp/alias", resolver(links));
		expect(variants).toContain("/tmp/alias");
		expect(variants).toContain("/Users/me/.pi/agent/settings.json");
	});

	it("falls back to the literal path when realpath throws", () => {
		const throwing = {
			cwd: "/Users/me/project",
			home: "/Users/me",
			realpathSync: () => {
				throw new Error("ENOENT");
			},
		};
		expect(normalizeCandidate("/does/not/exist", throwing)).toEqual([
			"/does/not/exist",
		]);
	});

	it("strips a leading @ that some models add to path arguments", () => {
		expect(normalizeCandidate("@/Users/me/.zshrc", resolver())).toContain(
			"/Users/me/.zshrc",
		);
	});
});

describe("matchesProtected", () => {
	const patterns = [
		"**/.pi/agent/settings.json",
		"**/.pi/agent/npm/**",
		"**/.env*",
	];

	it("matches a protected file directly", () => {
		expect(
			matchesProtected(
				"/Users/me/.pi/agent/settings.json",
				patterns,
				resolver(),
			),
		).toBe("**/.pi/agent/settings.json");
	});

	it("matches through a directory pattern", () => {
		expect(
			matchesProtected(
				"/Users/me/.pi/agent/npm/node_modules/pi-guard/src/index.ts",
				patterns,
				resolver(),
			),
		).toBe("**/.pi/agent/npm/**");
	});

	it("matches a dotfile pattern", () => {
		expect(
			matchesProtected("/Users/me/project/.env.local", patterns, resolver()),
		).toBe("**/.env*");
	});

	it("matches through a symlink alias", () => {
		const links = { "/tmp/s": "/Users/me/.pi/agent/settings.json" };
		expect(matchesProtected("/tmp/s", patterns, resolver(links))).toBe(
			"**/.pi/agent/settings.json",
		);
	});

	it("returns null for an unprotected path", () => {
		expect(
			matchesProtected("/Users/me/project/src/index.ts", patterns, resolver()),
		).toBeNull();
	});
});
