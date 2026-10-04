import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root: string;

function git(args: string[]) {
	return spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		timeout: 5000,
		env: {
			PATH: process.env.PATH,
			HOME: root,
			XDG_CONFIG_HOME: root,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
		},
	});
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "ag-ignore-"));
	const init = git(["init", "--template=", "-b", "main"]);
	expect(init.error).toBeUndefined();
	expect(init.status, init.stderr).toBe(0);
	copyFileSync(
		new URL("../.gitignore", import.meta.url),
		join(root, ".gitignore"),
	);
});

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

describe("repository sensitive-file ignore policy", () => {
	it.each([
		".env",
		".env.production",
		"nested/.env.local",
		"auth.json",
		"nested/auth.json",
		"credentials.json",
		"nested/service-account-prod.json",
		"private.pem",
		"nested/private.key",
		"identity.p12",
		"identity.pfx",
		"id_rsa",
		"nested/id_ed25519",
		".netrc",
		"nested/.npmrc",
		".pi/subagents/session.jsonl",
	])("keeps %s out of ordinary staging", (path) => {
		const result = git(["check-ignore", "--no-index", "--quiet", "--", path]);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
	});

	it.each([
		".env.example",
		"nested/.env.sample",
		"nested/.env.template",
		"id_rsa.pub",
		"id_ed25519.pub",
		"src/config.ts",
		"docs/reports/example-evidence.json",
		".github/workflows/ci.yml",
		".pi/skills/example/SKILL.md",
	])("keeps the intentionally publishable %s trackable", (path) => {
		const result = git(["check-ignore", "--no-index", "--quiet", "--", path]);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(1);
	});
});
