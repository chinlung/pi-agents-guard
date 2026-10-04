import { describe, expect, it } from "vitest";
import {
	DEFAULT_HARD_DENY_COMMANDS,
	DEFAULT_PROTECTED_PATHS,
} from "../src/config.js";
import { decideHardDeny } from "../src/modules/hard-deny.js";

const opts = {
	commands: DEFAULT_HARD_DENY_COMMANDS,
	protectedPaths: DEFAULT_PROTECTED_PATHS,
};
const resolver = (links: Record<string, string> = {}) => ({
	cwd: "/Users/me/project",
	home: "/Users/me",
	realpathSync: (path: string) => links[path] ?? path,
});
const bash = (command: string, links?: Record<string, string>) =>
	decideHardDeny("bash", { command }, opts, resolver(links));
const tool = (name: string, path: string) =>
	decideHardDeny(name, { path }, opts, resolver());

describe("hard-deny 命令層（六種複合形式，MasuRii 版全部漏掉的那組）", () => {
	it("blocks a bare denied command", () => {
		expect(bash("git add -A").kind).toBe("block");
	});

	it("blocks through &&", () => {
		expect(bash("git status && git add -A").kind).toBe("block");
	});

	it("blocks through ;", () => {
		expect(bash("ls; sudo rm -rf /").kind).toBe("block");
	});

	it("blocks through a pipeline", () => {
		expect(bash("echo ok | sudo tee /etc/hosts").kind).toBe("block");
	});

	it("blocks inside command substitution", () => {
		expect(bash("echo $(git add -A)").kind).toBe("block");
	});

	it("blocks inside bash -c", () => {
		expect(bash("bash -c 'git add -A'").kind).toBe("block");
	});

	it("blocks through a prefix wrapper", () => {
		expect(bash("xargs git add -A").kind).toBe("block");
	});

	it("blocks despite a deliberate syntax error later in the line", () => {
		expect(bash("git add -A ; echo 'unterminated").kind).toBe("block");
	});

	it("matches a glob token rule", () => {
		expect(bash("git commit -am wip").kind).toBe("block");
		expect(bash("git push --force-with-lease").kind).toBe("block");
	});

	it("passes a legitimate variant", () => {
		expect(bash("git add src/index.ts").kind).toBe("pass");
		expect(bash("git status --porcelain").kind).toBe("pass");
		expect(bash("npm test").kind).toBe("pass");
		expect(bash("git commit -m wip").kind).toBe("pass");
	});

	it("names the offending command in the reason", () => {
		const decision = bash("git status && git add -A");
		expect(decision.kind).toBe("block");
		if (decision.kind === "block") {
			expect(decision.reason).toContain("git add -A");
			expect(decision.reason).toContain("AGENTS.md");
		}
	});
});

describe("hard-deny 寫入目標層", () => {
	it("blocks a redirect onto a protected path", () => {
		expect(bash("echo '{}' > /Users/me/.pi/agent/settings.json").kind).toBe(
			"block",
		);
		expect(bash("echo x >> /Users/me/.zshrc").kind).toBe("block");
		expect(bash("cmd &> /Users/me/.pi/agent/AGENTS.md").kind).toBe("block");
	});

	it("blocks tee/cp/sed -i onto a protected path", () => {
		expect(bash("echo x | tee /Users/me/.pi/agent/settings.json").kind).toBe(
			"block",
		);
		expect(bash("cp evil.json /Users/me/.pi/agent/settings.json").kind).toBe(
			"block",
		);
		expect(bash("sed -i '' s/a/b/ /Users/me/.pi/agent/AGENTS.md").kind).toBe(
			"block",
		);
	});

	it("blocks a symlink alias to a protected path", () => {
		const links = { "/tmp/alias": "/Users/me/.pi/agent/settings.json" };
		expect(bash("echo x > /tmp/alias", links).kind).toBe("block");
	});

	it("blocks a write into the agents-guard state directory", () => {
		expect(
			bash("echo x > /Users/me/.pi/agent/state/agents-guard/locks/a.json").kind,
		).toBe("block");
	});

	it("passes a redirect onto an unprotected path", () => {
		expect(bash("echo x > /tmp/ok.txt").kind).toBe("pass");
		expect(bash("npm test > /Users/me/project/out.log").kind).toBe("pass");
	});

	it("ignores descriptor duplication", () => {
		expect(bash("npm test 2>&1").kind).toBe("pass");
	});
});

describe("hard-deny 工具層", () => {
	it("blocks write/edit/ast_grep_replace onto a protected path", () => {
		expect(tool("write", "/Users/me/.pi/agent/settings.json").kind).toBe(
			"block",
		);
		expect(
			tool(
				"edit",
				"/Users/me/.pi/agent/npm/node_modules/pi-guard/src/handlers.ts",
			).kind,
		).toBe("block");
		expect(tool("ast_grep_replace", "/Users/me/.pi/agent/AGENTS.md").kind).toBe(
			"block",
		);
	});

	it("passes an ordinary source file", () => {
		expect(tool("write", "/Users/me/project/src/index.ts").kind).toBe("pass");
	});

	it("ignores tools it does not gate", () => {
		expect(tool("read", "/Users/me/.pi/agent/settings.json").kind).toBe("pass");
		expect(
			decideHardDeny("web_search", { query: "x" }, opts, resolver()).kind,
		).toBe("pass");
		// subagent dispatch must never be gated here: hard-deny holds no
		// cross-session state, and blocking it would break every delegation.
		expect(
			decideHardDeny(
				"subagent",
				{ agent: "worker", task: "write a file" },
				opts,
				resolver(),
			).kind,
		).toBe("pass");
		expect(
			decideHardDeny(
				"subagent",
				{ action: "list", capabilities: true },
				opts,
				resolver(),
			).kind,
		).toBe("pass");
	});

	it("normalizes a leading @ in a path argument", () => {
		expect(tool("write", "@/Users/me/.pi/agent/settings.json").kind).toBe(
			"block",
		);
	});
});

describe("hard-deny fail-open", () => {
	it("passes an unparseable command that contains nothing denied", () => {
		expect(bash("echo 'unterminated").kind).toBe("pass");
	});

	it("passes when the command argument is missing or not a string", () => {
		expect(decideHardDeny("bash", {}, opts, resolver()).kind).toBe("pass");
		expect(decideHardDeny("bash", { command: 42 }, opts, resolver()).kind).toBe(
			"pass",
		);
	});
});

describe("hard-deny config override", () => {
	it("honours an empty command list", () => {
		const decision = decideHardDeny(
			"bash",
			{ command: "git add -A" },
			{ commands: [], protectedPaths: DEFAULT_PROTECTED_PATHS },
			resolver(),
		);
		expect(decision.kind).toBe("pass");
	});

	it("honours a custom protected path", () => {
		const decision = decideHardDeny(
			"write",
			{ path: "/Users/me/project/secret.txt" },
			{ commands: [], protectedPaths: ["**/secret.txt"] },
			resolver(),
		);
		expect(decision.kind).toBe("block");
	});
});
