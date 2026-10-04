import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONFIG,
	parseShorthand,
	resolveConfig,
	serializeExplicit,
} from "../src/config.js";

describe("DEFAULT_CONFIG", () => {
	it("enables everything by default", () => {
		expect(DEFAULT_CONFIG.enabled).toBe(true);
		expect(DEFAULT_CONFIG.modules["hard-deny"].enabled).toBe(true);
		expect(DEFAULT_CONFIG.modules["writer-lock"].enabled).toBe(true);
	});

	it("ships non-empty hard-deny defaults", () => {
		expect(DEFAULT_CONFIG.modules["hard-deny"].commands).toContain(
			"git add -A",
		);
		expect(
			DEFAULT_CONFIG.modules["hard-deny"].protectedPaths.length,
		).toBeGreaterThan(5);
	});
});

describe("parseShorthand", () => {
	it("treats 'off' as a global disable", () => {
		expect(parseShorthand("off")).toEqual({ enabled: false });
	});

	it("treats a module list as an allowlist", () => {
		const result = parseShorthand("hard-deny,git-evidence");
		expect(result?.modules?.["hard-deny"]?.enabled).toBe(true);
		expect(result?.modules?.["git-evidence"]?.enabled).toBe(true);
		expect(result?.modules?.["writer-lock"]?.enabled).toBe(false);
	});

	it("returns null for an unrecognized value", () => {
		expect(parseShorthand("garbage")).toBeNull();
	});
});

describe("resolveConfig precedence", () => {
	it("file overrides default", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "hard-deny": { enabled: false } } },
		});
		expect(config.modules["hard-deny"].enabled).toBe(false);
		expect(provenance.modules["hard-deny"]).toBe("file");
		expect(provenance.modules["writer-lock"]).toBe("default");
	});

	it("env overrides file", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "hard-deny": { enabled: false } } },
			env: "hard-deny",
		});
		expect(config.modules["hard-deny"].enabled).toBe(true);
		expect(provenance.modules["hard-deny"]).toBe("env");
	});

	it("flag overrides env", () => {
		const { config, provenance } = resolveConfig({
			env: "hard-deny",
			flag: "off",
		});
		expect(config.enabled).toBe(false);
		expect(provenance.enabled).toBe("flag");
	});

	it("command overrides everything", () => {
		const { config, provenance } = resolveConfig({
			flag: "off",
			command: { enabled: true },
		});
		expect(config.enabled).toBe(true);
		expect(provenance.enabled).toBe("command");
	});

	it("deep-merges per key instead of replacing whole objects", () => {
		const { config } = resolveConfig({
			file: { modules: { "hard-deny": { commands: ["only-this"] } } },
		});
		expect(config.modules["hard-deny"].commands).toEqual(["only-this"]);
		expect(config.modules["hard-deny"].enabled).toBe(true);
		expect(config.modules["hard-deny"].protectedPaths.length).toBeGreaterThan(
			5,
		);
	});

	it("warns and ignores a malformed file layer", () => {
		const { config, warnings } = resolveConfig({ file: "not an object" });
		expect(config.enabled).toBe(true);
		expect(warnings.some((w) => w.includes("config"))).toBe(true);
	});
});

describe("DEFAULT_CONFIG: subagent-policy", () => {
	it("ships non-empty pattern lists", () => {
		expect(
			DEFAULT_CONFIG.modules["subagent-policy"].weakModelPatterns,
		).toContain("haiku");
		expect(
			DEFAULT_CONFIG.modules["subagent-policy"].externalCliAgents,
		).toContain("codex-exec");
		expect(
			DEFAULT_CONFIG.modules["subagent-policy"].nativeOnlyOptions,
		).toContain("model");
		expect(
			DEFAULT_CONFIG.modules["subagent-policy"].reviewIntentPatterns,
		).toContain("review");
	});
});

describe("resolveConfig: subagent-policy 深度合併與 provenance（對稱於 hard-deny）", () => {
	it("file overrides one pattern list without touching the others", () => {
		const { config, provenance } = resolveConfig({
			file: {
				modules: { "subagent-policy": { weakModelPatterns: ["only-this"] } },
			},
		});
		expect(config.modules["subagent-policy"].weakModelPatterns).toEqual([
			"only-this",
		]);
		expect(
			config.modules["subagent-policy"].externalCliAgents.length,
		).toBeGreaterThan(0);
		expect(provenance.modules["subagent-policy"]).toBe("file");
	});

	it("command layer overrides file layer for subagent-policy", () => {
		const { config, provenance } = resolveConfig({
			file: {
				modules: { "subagent-policy": { reviewIntentPatterns: ["from-file"] } },
			},
			command: {
				modules: {
					"subagent-policy": { reviewIntentPatterns: ["from-command"] },
				},
			},
		});
		expect(config.modules["subagent-policy"].reviewIntentPatterns).toEqual([
			"from-command",
		]);
		expect(provenance.modules["subagent-policy"]).toBe("command");
	});
});

describe("serializeExplicit", () => {
	it("writes only values whose provenance is not default", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "git-evidence": { enabled: false } } },
		});
		const out = serializeExplicit(config, provenance);
		expect(out).toEqual({
			version: 1,
			modules: { "git-evidence": { enabled: false } },
		});
	});

	it("writes an empty shell when nothing was explicitly set", () => {
		const { config, provenance } = resolveConfig({});
		expect(serializeExplicit(config, provenance)).toEqual({ version: 1 });
	});
});

describe("serializeExplicit: subagent-policy", () => {
	it("omits pattern lists left at default", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "subagent-policy": { enabled: false } } },
		});
		const out = serializeExplicit(config, provenance);
		expect(out).toEqual({
			version: 1,
			modules: { "subagent-policy": { enabled: false } },
		});
	});

	it("includes an explicitly overridden pattern list", () => {
		const { config, provenance } = resolveConfig({
			command: {
				modules: { "subagent-policy": { externalCliAgents: ["only-runner"] } },
			},
		});
		const out = serializeExplicit(config, provenance);
		expect(out).toEqual({
			version: 1,
			modules: {
				"subagent-policy": {
					enabled: true,
					externalCliAgents: ["only-runner"],
				},
			},
		});
	});
});

describe("DEFAULT_CONFIG: writer-lock", () => {
	it("ships sane defaults", () => {
		const wl = DEFAULT_CONFIG.modules["writer-lock"];
		expect(wl.heartbeatTimeoutMs).toBe(14_400_000);
		expect(wl.blockedGitSubcommands).toContain("checkout");
		expect(wl.blockedGitSubcommands).toContain("worktree remove");
		expect(wl.blockedTools).toEqual(["write", "edit", "ast_grep_replace"]);
	});
});

describe("resolveConfig: writer-lock 純量與陣列欄位", () => {
	it("overrides heartbeatTimeoutMs without touching the array fields", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "writer-lock": { heartbeatTimeoutMs: 60_000 } } },
		});
		expect(config.modules["writer-lock"].heartbeatTimeoutMs).toBe(60_000);
		expect(config.modules["writer-lock"].blockedTools).toEqual([
			"write",
			"edit",
			"ast_grep_replace",
		]);
		expect(provenance.modules["writer-lock"]).toBe("file");
	});

	it("overrides blockedGitSubcommands via the shared ARRAY_FIELDS path", () => {
		const { config } = resolveConfig({
			command: {
				modules: { "writer-lock": { blockedGitSubcommands: ["reset"] } },
			},
		});
		expect(config.modules["writer-lock"].blockedGitSubcommands).toEqual([
			"reset",
		]);
	});
});

describe("serializeExplicit: writer-lock", () => {
	it("round-trips deprecated blocking arrays without dropping user configuration", () => {
		const options = {
			enabled: true,
			blockedTools: ["custom"],
			blockedGitSubcommands: ["checkout"],
		};
		const { config, provenance } = resolveConfig({
			file: { modules: { "writer-lock": options } },
		});
		const saved = serializeExplicit(config, provenance);
		expect(saved).toEqual({ version: 1, modules: { "writer-lock": options } });
		expect(
			resolveConfig({ file: saved }).config.modules["writer-lock"],
		).toMatchObject(options);
	});
	it("includes an explicitly overridden heartbeatTimeoutMs", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "writer-lock": { heartbeatTimeoutMs: 1000 } } },
		});
		expect(serializeExplicit(config, provenance)).toEqual({
			version: 1,
			modules: { "writer-lock": { enabled: true, heartbeatTimeoutMs: 1000 } },
		});
	});
});

describe("DEFAULT_CONFIG: git-evidence", () => {
	it("ships sane defaults", () => {
		const ge = DEFAULT_CONFIG.modules["git-evidence"];
		expect(ge.maxAppendBytes).toBe(2048);
		expect(ge.checkCi).toBe(true);
	});
});

describe("resolveConfig: git-evidence 純量欄位（通用 NUMBER_FIELDS/BOOLEAN_FIELDS）", () => {
	it("overrides maxAppendBytes via file", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "git-evidence": { maxAppendBytes: 100 } } },
		});
		expect(config.modules["git-evidence"].maxAppendBytes).toBe(100);
		expect(config.modules["git-evidence"].checkCi).toBe(true);
		expect(provenance.modules["git-evidence"]).toBe("file");
	});

	it("overrides checkCi via command layer", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "git-evidence": { checkCi: false } } },
		});
		expect(config.modules["git-evidence"].checkCi).toBe(false);
		expect(provenance.modules["git-evidence"]).toBe("command");
	});
});

describe("serializeExplicit: git-evidence", () => {
	it("includes an explicitly overridden checkCi", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "git-evidence": { checkCi: false } } },
		});
		expect(serializeExplicit(config, provenance)).toEqual({
			version: 1,
			modules: { "git-evidence": { enabled: true, checkCi: false } },
		});
	});
});

describe("resolveConfig: writer-lock heartbeatTimeoutMs 仍然經通用機制運作（回櫃）", () => {
	it("still overrides via file after retrofitting to NUMBER_FIELDS", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "writer-lock": { heartbeatTimeoutMs: 5000 } } },
		});
		expect(config.modules["writer-lock"].heartbeatTimeoutMs).toBe(5000);
		expect(provenance.modules["writer-lock"]).toBe("file");
	});
});

describe("DEFAULT_CONFIG: completion-diff-recheck", () => {
	it("ships sane defaults", () => {
		const cdr = DEFAULT_CONFIG.modules["completion-diff-recheck"];
		expect(cdr.followUp).toBe(false);
		expect(cdr.maxFollowUpsPerSession).toBe(2);
	});
});

describe("resolveConfig: completion-diff-recheck 純量欄位", () => {
	it("overrides followUp via file", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "completion-diff-recheck": { followUp: true } } },
		});
		expect(config.modules["completion-diff-recheck"].followUp).toBe(true);
		expect(
			config.modules["completion-diff-recheck"].maxFollowUpsPerSession,
		).toBe(2);
		expect(provenance.modules["completion-diff-recheck"]).toBe("file");
	});

	it("overrides maxFollowUpsPerSession via command layer", () => {
		const { config } = resolveConfig({
			command: {
				modules: { "completion-diff-recheck": { maxFollowUpsPerSession: 5 } },
			},
		});
		expect(
			config.modules["completion-diff-recheck"].maxFollowUpsPerSession,
		).toBe(5);
	});
});

describe("serializeExplicit: completion-diff-recheck", () => {
	it("includes an explicitly overridden followUp", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "completion-diff-recheck": { followUp: true } } },
		});
		expect(serializeExplicit(config, provenance)).toEqual({
			version: 1,
			modules: { "completion-diff-recheck": { enabled: true, followUp: true } },
		});
	});
});
