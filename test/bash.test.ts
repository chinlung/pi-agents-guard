import { describe, expect, it } from "vitest";
import { enumerateCommands, extractWriteTargets } from "../src/lib/bash.js";

const names = (source: string) =>
	enumerateCommands(source).commands.map((c) =>
		`${c.name} ${c.args.join(" ")}`.trim(),
	);

describe("enumerateCommands: 複合命令分解", () => {
	it("splits &&", () => {
		expect(names("git status && git add -A")).toEqual([
			"git status",
			"git add -A",
		]);
	});

	it("splits ;", () => {
		expect(names("ls; sudo rm -rf /")).toContain("rm -rf /");
		expect(names("ls; sudo rm -rf /")).toContain("ls");
	});

	it("splits pipelines", () => {
		expect(names("echo ok | tee /etc/hosts")).toEqual([
			"echo ok",
			"tee /etc/hosts",
		]);
	});

	it("descends into command substitution", () => {
		expect(names("echo $(git add -A)")).toContain("git add -A");
	});

	it("expands bash -c string payloads", () => {
		expect(names("bash -c 'git add -A'")).toContain("git add -A");
	});

	it("expands prefix wrappers", () => {
		expect(names("sudo git add -A")).toContain("git add -A");
		expect(names("env FOO=1 git add -A")).toContain("git add -A");
		expect(names("xargs git add -A")).toContain("git add -A");
		expect(names("timeout 5 git add -A")).toContain("git add -A");
	});

	it("reports a parse failure while still returning what did parse", () => {
		const result = enumerateCommands("echo 'unterminated");
		expect(result.parseFailed).toBe(true);
		// Partial results are deliberate: discarding everything on a syntax error
		// would make a deliberate syntax error a bypass (see the next test).
		expect(result.commands.map((c) => c.name)).toContain("echo");
	});

	it("a deliberate syntax error does not hide an earlier command", () => {
		const result = enumerateCommands("git add -A ; echo 'unterminated");
		expect(result.parseFailed).toBe(true);
		expect(
			result.commands.map((c) => `${c.name} ${c.args.join(" ")}`.trim()),
		).toContain("git add -A");
	});
});

describe("extractWriteTargets", () => {
	it("collects > and >> and >| and &> targets", () => {
		expect(extractWriteTargets("echo x > a.json").targets).toEqual(["a.json"]);
		expect(extractWriteTargets("echo x >> b.log").targets).toEqual(["b.log"]);
		expect(extractWriteTargets("echo x >| c.txt").targets).toEqual(["c.txt"]);
		expect(extractWriteTargets("cmd &> d.log").targets).toEqual(["d.log"]);
	});

	it("treats <> as a write because the shell may truncate", () => {
		expect(extractWriteTargets("cat <> rw.txt").targets).toEqual(["rw.txt"]);
	});

	it("ignores read redirects", () => {
		expect(extractWriteTargets("cat < in.txt").targets).toEqual([]);
	});

	it("ignores file-descriptor duplication", () => {
		expect(extractWriteTargets("cat f 2>&1").targets).toEqual([]);
	});

	it("finds redirects inside compound commands", () => {
		expect(extractWriteTargets("git status && echo y > b.txt").targets).toEqual(
			["b.txt"],
		);
	});

	it("collects tee/cp/mv/ln destinations and sed -i targets", () => {
		expect(extractWriteTargets("echo x | tee out.txt").targets).toContain(
			"out.txt",
		);
		expect(extractWriteTargets("cp src.txt dest.txt").targets).toContain(
			"dest.txt",
		);
		expect(extractWriteTargets("mv a.txt b.txt").targets).toContain("b.txt");
		expect(extractWriteTargets("ln -s target link").targets).toContain("link");
		expect(extractWriteTargets("sed -i '' 's/a/b/' f.txt").targets).toContain(
			"f.txt",
		);
	});

	it("collects tee targets through a wrapper", () => {
		expect(extractWriteTargets("sudo tee /etc/hosts").targets).toContain(
			"/etc/hosts",
		);
	});
});
