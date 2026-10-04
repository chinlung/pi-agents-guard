# agents-guard Stage 1 實作計畫：專案骨架 + 開關機制 + hard-deny

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一個可載入 pi 的 extension，具備四層來源的模組開關機制與 `hard-deny` 模組 —— 對 MUST 級操作不彈框硬擋，並解析 shell 重導向目標與 symlink。

**Architecture:** 單一 extension entry (`src/index.ts`) 註冊 `tool_call` handler 與 `/agents-guard` 命令。所有判定邏輯為純函式（無 I/O、無 pi API 依賴），hook wrapper 只負責收集事實、呼叫 `decide*`、執行決策。bash 解析使用 `unbash` AST（與 pi-guard 同一 parser，已驗證能分解複合命令），並額外把 redirect target 視為寫入路徑 —— 這正是 pi-guard 沒做的那一步。

**Tech Stack:** TypeScript (strict, ES2022, `moduleResolution: bundler`)、vitest、biome、`unbash@4.0.0`、`minimatch`。extension 由 pi 以 jiti 直接載入 TS，無 build 步驟。

**Spec:** `docs/design.md`（§4 開關機制、§5.1b hard-deny、§5.6 state 完整性、§8 測試策略與驗收條件）

## Global Constraints

- Node `>=22.19.0`（對齊 `~/.pi/agent/npm/package.json` 的 engines）
- `package.json` 必須有 `"type": "module"` 與 `"pi": { "extensions": ["./src/index.ts"] }`
- 所有 `decide*` 函式為純函式：不做檔案 I/O、不呼叫 pi API、不讀 `process.env`（需要的事實由參數傳入）
- 阻擋一律 `return { block: true, reason }`，**永不呼叫 `ctx.ui.confirm`／`select`**（design.md §4.4 原則 4）
- 模組內部異常一律 catch 後 fail-open + 記錄，不得讓單一 bug 癱瘓 session（§4.4 原則 5）
- state 檔案以 `mode: 0o600` 建立
- 對 `~/.pi/agent` 的寫入僅限 `state/agents-guard/**`
- 不使用依賴 object key 插入順序的規則結構（§4.4 原則 3）
- 每個 commit 前必須 `npx vitest run` 全綠

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `package.json` | 套件宣告、pi extension 入口、依賴 |
| `tsconfig.json` | TS 編譯設定（僅供 vitest 與 IDE，無 build） |
| `vitest.config.ts` | 測試設定 |
| `biome.json` | formatter/linter |
| `.gitignore` | 排除 `node_modules`、`coverage` |
| `src/types.ts` | 共用型別：`Decision`、`AgentsGuardConfig`、`ModuleName` |
| `src/config.ts` | 四層來源解析與深度合併、provenance 追蹤（純函式） |
| `src/state.ts` | state 目錄路徑解析、原子讀寫、0600 權限 |
| `src/lib/bash.ts` | `unbash` 封裝：命令列舉、wrapper 展開、寫入路徑抽取（純函式） |
| `src/lib/paths.ts` | 路徑正規化與 protectedPaths glob 比對（realpath 注入） |
| `src/modules/hard-deny.ts` | `decideHardDeny` 判定核心（純函式） |
| `src/index.ts` | extension entry：註冊 hook、命令、flag；wrapper 與 fail-open |
| `test/*.test.ts` | 對應各模組的測試 |

---

## Task 1: 專案骨架與 tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, `.gitignore`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: 可執行的 `npx vitest run`；`unbash` 與 `minimatch` 可 import

- [ ] **Step 1: 寫失敗測試**

`test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parse } from "unbash";
import { minimatch } from "minimatch";

describe("toolchain", () => {
	it("parses bash with unbash", () => {
		const ast = parse("echo hi > out.txt");
		expect(ast.type).toBe("Script");
		expect(ast.commands.length).toBeGreaterThan(0);
	});

	it("matches globs with minimatch", () => {
		expect(minimatch("/Users/x/.pi/agent/settings.json", "**/.pi/agent/settings.json")).toBe(true);
		expect(minimatch("/Users/x/src/index.ts", "**/.pi/agent/settings.json")).toBe(false);
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run`
Expected: FAIL —— 尚無 `package.json`／依賴未安裝

- [ ] **Step 3: 建立骨架**

`package.json`:

```json
{
  "name": "agents-guard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Mechanical enforcement for AGENTS.md MUST rules that permission systems cannot cover",
  "engines": { "node": ">=22.19.0" },
  "pi": { "extensions": ["./src/index.ts"] },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "minimatch": "^10.0.1",
    "unbash": "^4.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@earendil-works/pi-coding-agent": "*",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
	},
});
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "formatter": { "enabled": true, "indentStyle": "tab" },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "files": { "includes": ["src/**", "test/**"] }
}
```

`.gitignore`:

```
node_modules/
coverage/
*.log
.DS_Store
```

- [ ] **Step 4: 安裝依賴並確認測試通過**

Run: `npm install && npx vitest run`
Expected: PASS（2 個測試）

若 `@earendil-works/pi-coding-agent` 無法從 npm 取得，改為指向本機安裝：`"@earendil-works/pi-coding-agent": "file:<USER_HOME>/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent"`。它只用於型別（`import type`），runtime 由 pi 提供。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts biome.json .gitignore test/smoke.test.ts
git commit -m "chore: 專案骨架與 tooling（vitest + biome + unbash + minimatch）"
```

---

## Task 2: 共用型別

**Files:**
- Create: `src/types.ts`
- Test: `test/types.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `type Decision = { kind: "pass" } | { kind: "block"; reason: string } | { kind: "augment"; append: string } | { kind: "notify"; level: "info" | "warning" | "error"; message: string }`
  - `type ModuleName = "hard-deny" | "subagent-policy" | "writer-lock" | "git-evidence" | "completion-diff-recheck"`
  - `const MODULE_NAMES: readonly ModuleName[]`
  - `interface HardDenyOptions { commands: string[]; protectedPaths: string[] }`
  - `interface AgentsGuardConfig { enabled: boolean; modules: Record<ModuleName, { enabled: boolean }> & { "hard-deny": { enabled: boolean } & HardDenyOptions } }`
  - `type ConfigSource = "default" | "file" | "env" | "flag" | "command"`
  - `interface Provenance { enabled: ConfigSource; modules: Record<ModuleName, ConfigSource> }`

- [ ] **Step 1: 寫失敗測試**

`test/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MODULE_NAMES, isModuleName } from "../src/types.js";

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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL —— `Cannot find module '../src/types.js'`

- [ ] **Step 3: 實作**

`src/types.ts`:

```ts
export type Decision =
	| { kind: "pass" }
	| { kind: "block"; reason: string }
	| { kind: "augment"; append: string }
	| { kind: "notify"; level: "info" | "warning" | "error"; message: string };

export const MODULE_NAMES = [
	"hard-deny",
	"subagent-policy",
	"writer-lock",
	"git-evidence",
	"completion-diff-recheck",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export function isModuleName(value: string): value is ModuleName {
	return (MODULE_NAMES as readonly string[]).includes(value);
}

export interface HardDenyOptions {
	commands: string[];
	protectedPaths: string[];
}

export interface ModuleState {
	enabled: boolean;
}

export interface AgentsGuardConfig {
	enabled: boolean;
	modules: {
		"hard-deny": ModuleState & HardDenyOptions;
		"subagent-policy": ModuleState;
		"writer-lock": ModuleState;
		"git-evidence": ModuleState;
		"completion-diff-recheck": ModuleState;
	};
}

export type ConfigSource = "default" | "file" | "env" | "flag" | "command";

export interface Provenance {
	enabled: ConfigSource;
	modules: Record<ModuleName, ConfigSource>;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/types.test.ts`
Expected: PASS（2 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/types.ts test/types.test.ts
git commit -m "feat(types): 共用型別 Decision/ModuleName/AgentsGuardConfig"
```

---

## Task 3: 設定解析（四層來源 + provenance）

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `AgentsGuardConfig`、`ModuleName`、`ConfigSource`、`Provenance`、`MODULE_NAMES`、`isModuleName`
- Produces:
  - `const DEFAULT_CONFIG: AgentsGuardConfig`
  - `const DEFAULT_HARD_DENY_COMMANDS: string[]`
  - `const DEFAULT_PROTECTED_PATHS: string[]`
  - `function parseShorthand(raw: string): Partial<AgentsGuardConfig> | null`
  - `function resolveConfig(layers: { file?: unknown; env?: string; flag?: string; command?: Partial<AgentsGuardConfig> }): { config: AgentsGuardConfig; provenance: Provenance; warnings: string[] }`
  - `function serializeExplicit(config: AgentsGuardConfig, provenance: Provenance): Record<string, unknown>`

- [ ] **Step 1: 寫失敗測試**

`test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseShorthand, resolveConfig, serializeExplicit } from "../src/config.js";

describe("DEFAULT_CONFIG", () => {
	it("enables everything by default", () => {
		expect(DEFAULT_CONFIG.enabled).toBe(true);
		expect(DEFAULT_CONFIG.modules["hard-deny"].enabled).toBe(true);
		expect(DEFAULT_CONFIG.modules["writer-lock"].enabled).toBe(true);
	});

	it("ships non-empty hard-deny defaults", () => {
		expect(DEFAULT_CONFIG.modules["hard-deny"].commands).toContain("git add -A");
		expect(DEFAULT_CONFIG.modules["hard-deny"].protectedPaths.length).toBeGreaterThan(5);
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
		const { config, provenance } = resolveConfig({ env: "hard-deny", flag: "off" });
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
		expect(config.modules["hard-deny"].protectedPaths.length).toBeGreaterThan(5);
	});

	it("warns and ignores a malformed file layer", () => {
		const { config, warnings } = resolveConfig({ file: "not an object" });
		expect(config.enabled).toBe(true);
		expect(warnings.some((w) => w.includes("config"))).toBe(true);
	});
});

describe("serializeExplicit", () => {
	it("writes only values whose provenance is not default", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "git-evidence": { enabled: false } } },
		});
		const out = serializeExplicit(config, provenance);
		expect(out).toEqual({ version: 1, modules: { "git-evidence": { enabled: false } } });
	});

	it("writes an empty shell when nothing was explicitly set", () => {
		const { config, provenance } = resolveConfig({});
		expect(serializeExplicit(config, provenance)).toEqual({ version: 1 });
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL —— `Cannot find module '../src/config.js'`

- [ ] **Step 3: 實作**

`src/config.ts`:

```ts
import {
	type AgentsGuardConfig,
	type ConfigSource,
	type ModuleName,
	MODULE_NAMES,
	type Provenance,
	isModuleName,
} from "./types.js";

export const DEFAULT_HARD_DENY_COMMANDS: string[] = [
	"git add -A",
	"git add --all",
	"git add .",
	"git commit -a*",
	"git push --force*",
	"git push -f",
	"git push --delete",
	"sudo",
	"npm publish",
	"gh release delete",
	"crontab",
	"at",
	"chown",
];

export const DEFAULT_PROTECTED_PATHS: string[] = [
	"**/.pi/agent/settings.json",
	"**/.pi/agent/AGENTS.md",
	"**/.pi/agent/SYSTEM.md",
	"**/.pi/agent/APPEND_SYSTEM.md",
	"**/.pi/agent/keybindings.json",
	"**/.pi/agent/auth.json",
	"**/.pi/agent/trust.json",
	"**/.pi/agent/npm/**",
	"**/.pi/agent/extensions/**",
	"**/.pi/agent/state/agents-guard/**",
	"**/.pi/settings.json",
	"**/.pi/extensions/**",
	"**/.zshrc",
	"**/.bashrc",
	"**/.bash_profile",
	"**/.profile",
	"**/.zshenv",
	"**/.git/hooks/**",
	"**/.env*",
	"**/*.pem",
	"**/id_rsa*",
	"**/.netrc",
	"**/.npmrc",
];

export const DEFAULT_CONFIG: AgentsGuardConfig = {
	enabled: true,
	modules: {
		"hard-deny": {
			enabled: true,
			commands: DEFAULT_HARD_DENY_COMMANDS,
			protectedPaths: DEFAULT_PROTECTED_PATHS,
		},
		"subagent-policy": { enabled: true },
		"writer-lock": { enabled: true },
		"git-evidence": { enabled: true },
		"completion-diff-recheck": { enabled: true },
	},
};

export function parseShorthand(raw: string): Partial<AgentsGuardConfig> | null {
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	if (trimmed === "off") return { enabled: false };
	if (trimmed === "on") return { enabled: true };

	const names = trimmed.split(",").map((part) => part.trim()).filter((part) => part !== "");
	if (names.length === 0 || !names.every(isModuleName)) return null;

	const allowed = new Set(names as ModuleName[]);
	const modules: Record<string, { enabled: boolean }> = {};
	for (const name of MODULE_NAMES) modules[name] = { enabled: allowed.has(name) };
	return { enabled: true, modules } as Partial<AgentsGuardConfig>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asStringArray(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? (value as string[])
		: null;
}

/** One layer's contribution, already validated into the shape we merge. */
interface LayerPatch {
	enabled?: boolean;
	modules?: Partial<Record<ModuleName, { enabled?: boolean; commands?: string[]; protectedPaths?: string[] }>>;
}

function validateLayer(value: unknown, label: string, warnings: string[]): LayerPatch {
	const root = asRecord(value);
	if (root === null) {
		warnings.push(`agents-guard: ignoring ${label} config — expected an object`);
		return {};
	}
	const patch: LayerPatch = {};
	if (typeof root.enabled === "boolean") patch.enabled = root.enabled;

	const modules = asRecord(root.modules);
	if (modules !== null) {
		patch.modules = {};
		for (const [key, raw] of Object.entries(modules)) {
			if (!isModuleName(key)) {
				warnings.push(`agents-guard: ignoring unknown module "${key}" in ${label} config`);
				continue;
			}
			const entry = asRecord(raw);
			if (entry === null) {
				warnings.push(`agents-guard: ignoring module "${key}" in ${label} config — expected an object`);
				continue;
			}
			const target: { enabled?: boolean; commands?: string[]; protectedPaths?: string[] } = {};
			if (typeof entry.enabled === "boolean") target.enabled = entry.enabled;
			if (key === "hard-deny") {
				const commands = asStringArray(entry.commands);
				if (commands !== null) target.commands = commands;
				const protectedPaths = asStringArray(entry.protectedPaths);
				if (protectedPaths !== null) target.protectedPaths = protectedPaths;
			}
			patch.modules[key] = target;
		}
	}
	return patch;
}

export function resolveConfig(layers: {
	file?: unknown;
	env?: string;
	flag?: string;
	command?: Partial<AgentsGuardConfig>;
}): { config: AgentsGuardConfig; provenance: Provenance; warnings: string[] } {
	const warnings: string[] = [];

	const config: AgentsGuardConfig = {
		enabled: DEFAULT_CONFIG.enabled,
		modules: {
			"hard-deny": { ...DEFAULT_CONFIG.modules["hard-deny"] },
			"subagent-policy": { ...DEFAULT_CONFIG.modules["subagent-policy"] },
			"writer-lock": { ...DEFAULT_CONFIG.modules["writer-lock"] },
			"git-evidence": { ...DEFAULT_CONFIG.modules["git-evidence"] },
			"completion-diff-recheck": { ...DEFAULT_CONFIG.modules["completion-diff-recheck"] },
		},
	};
	const provenance: Provenance = {
		enabled: "default",
		modules: {
			"hard-deny": "default",
			"subagent-policy": "default",
			"writer-lock": "default",
			"git-evidence": "default",
			"completion-diff-recheck": "default",
		},
	};

	const ordered: Array<{ source: ConfigSource; patch: LayerPatch }> = [];
	if (layers.file !== undefined) {
		ordered.push({ source: "file", patch: validateLayer(layers.file, "file", warnings) });
	}
	if (layers.env !== undefined && layers.env.trim() !== "") {
		const shorthand = parseShorthand(layers.env);
		if (shorthand !== null) {
			ordered.push({ source: "env", patch: validateLayer(shorthand, "env", warnings) });
		} else {
			try {
				ordered.push({ source: "env", patch: validateLayer(JSON.parse(layers.env), "env", warnings) });
			} catch {
				warnings.push("agents-guard: ignoring AGENTS_GUARD — not a shorthand or valid JSON");
			}
		}
	}
	if (layers.flag !== undefined && layers.flag.trim() !== "") {
		const shorthand = parseShorthand(layers.flag);
		if (shorthand !== null) {
			ordered.push({ source: "flag", patch: validateLayer(shorthand, "flag", warnings) });
		} else {
			warnings.push(`agents-guard: ignoring --agents-guard=${layers.flag} — unrecognized value`);
		}
	}
	if (layers.command !== undefined) {
		ordered.push({ source: "command", patch: validateLayer(layers.command, "command", warnings) });
	}

	for (const { source, patch } of ordered) {
		if (patch.enabled !== undefined) {
			config.enabled = patch.enabled;
			provenance.enabled = source;
		}
		for (const [key, entry] of Object.entries(patch.modules ?? {})) {
			const name = key as ModuleName;
			if (entry.enabled !== undefined) {
				config.modules[name].enabled = entry.enabled;
				provenance.modules[name] = source;
			}
			if (name === "hard-deny") {
				if (entry.commands !== undefined) {
					config.modules["hard-deny"].commands = entry.commands;
					provenance.modules["hard-deny"] = source;
				}
				if (entry.protectedPaths !== undefined) {
					config.modules["hard-deny"].protectedPaths = entry.protectedPaths;
					provenance.modules["hard-deny"] = source;
				}
			}
		}
	}

	return { config, provenance, warnings };
}

/**
 * Only values whose provenance is not "default" are written, so the file never
 * freezes a default and a future default change reaches an existing install.
 * This is the direct lesson from pi-guard's saveConfig, which serialized its
 * in-memory DEFAULT_CONFIG.matchers into the file and froze the matcher set.
 */
export function serializeExplicit(
	config: AgentsGuardConfig,
	provenance: Provenance,
): Record<string, unknown> {
	const out: Record<string, unknown> = { version: 1 };
	if (provenance.enabled !== "default") out.enabled = config.enabled;

	const modules: Record<string, unknown> = {};
	for (const name of MODULE_NAMES) {
		if (provenance.modules[name] === "default") continue;
		const entry: Record<string, unknown> = { enabled: config.modules[name].enabled };
		if (name === "hard-deny") {
			const hardDeny = config.modules["hard-deny"];
			if (hardDeny.commands !== DEFAULT_CONFIG.modules["hard-deny"].commands) {
				entry.commands = hardDeny.commands;
			}
			if (hardDeny.protectedPaths !== DEFAULT_CONFIG.modules["hard-deny"].protectedPaths) {
				entry.protectedPaths = hardDeny.protectedPaths;
			}
		}
		modules[name] = entry;
	}
	if (Object.keys(modules).length > 0) out.modules = modules;
	return out;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/config.test.ts`
Expected: PASS（12 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): 四層來源解析、深度合併與 provenance 追蹤"
```

---

## Task 4: bash 解析（命令列舉 + wrapper 展開 + 寫入路徑抽取）

**Files:**
- Create: `src/lib/bash.ts`
- Test: `test/bash.test.ts`

**Interfaces:**
- Consumes: `unbash` 的 `parse`、`Command`、`Redirect`、`Word`
- Produces:
  - `interface ParsedCommand { name: string; args: string[] }`
  - `function enumerateCommands(source: string): { commands: ParsedCommand[]; parseFailed: boolean }` —— 已展開 wrapper
  - `function extractWriteTargets(source: string): { targets: string[]; parseFailed: boolean }`
  - `const WRITE_REDIRECT_OPERATORS: ReadonlySet<string>`

**設計依據（實測，2026-09-09）**：`unbash@4.0.0` 的 `Redirect` 提供 `operator`、`target: Word | undefined`、`fileDescriptor: number | undefined`。實測 `cat f 2>&1` 得到 `{op:">&", target:"1", fd:2}` —— 因此 `>&`／`<&` 必須靠「target 是否純數字」排除 fd 複製。

- [ ] **Step 1: 寫失敗測試**

`test/bash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enumerateCommands, extractWriteTargets } from "../src/lib/bash.js";

const names = (source: string) => enumerateCommands(source).commands.map((c) => `${c.name} ${c.args.join(" ")}`.trim());

describe("enumerateCommands: 複合命令分解", () => {
	it("splits &&", () => {
		expect(names("git status && git add -A")).toEqual(["git status", "git add -A"]);
	});

	it("splits ;", () => {
		expect(names("ls; sudo rm -rf /")).toEqual(["ls", "sudo rm -rf /", "rm -rf /"]);
	});

	it("splits pipelines", () => {
		expect(names("echo ok | tee /etc/hosts")).toEqual(["echo ok", "tee /etc/hosts"]);
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

	it("reports a parse failure instead of throwing", () => {
		const result = enumerateCommands("echo 'unterminated");
		expect(result.parseFailed).toBe(true);
		expect(result.commands).toEqual([]);
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
		expect(extractWriteTargets("git status && echo y > b.txt").targets).toEqual(["b.txt"]);
	});

	it("collects tee/cp/mv/ln destinations and sed -i targets", () => {
		expect(extractWriteTargets("echo x | tee out.txt").targets).toContain("out.txt");
		expect(extractWriteTargets("cp src.txt dest.txt").targets).toContain("dest.txt");
		expect(extractWriteTargets("mv a.txt b.txt").targets).toContain("b.txt");
		expect(extractWriteTargets("ln -s target link").targets).toContain("link");
		expect(extractWriteTargets("sed -i '' 's/a/b/' f.txt").targets).toContain("f.txt");
	});

	it("collects tee targets through a wrapper", () => {
		expect(extractWriteTargets("sudo tee /etc/hosts").targets).toContain("/etc/hosts");
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/bash.test.ts`
Expected: FAIL —— `Cannot find module '../src/lib/bash.js'`

- [ ] **Step 3: 實作**

`src/lib/bash.ts`:

```ts
import { parse } from "unbash";
import type { Command, Redirect, Word } from "unbash";

export interface ParsedCommand {
	name: string;
	args: string[];
}

/** Redirect operators that may truncate or write to the destination file. */
export const WRITE_REDIRECT_OPERATORS: ReadonlySet<string> = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

/** Operators whose destination may be a file OR a descriptor number. */
const AMBIGUOUS_REDIRECT_OPERATORS: ReadonlySet<string> = new Set([">&", "<&"]);

/** Wrappers whose trailing tokens are themselves a command to inspect. */
const PREFIX_WRAPPERS: ReadonlySet<string> = new Set([
	"sudo", "doas", "env", "nohup", "time", "nice", "ionice", "stdbuf", "xargs", "command", "exec",
]);

/** Wrappers that take the command as a single string argument after a flag. */
const STRING_PAYLOAD_WRAPPERS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash", "ash", "ksh"]);

const MAX_EXPANSION_DEPTH = 4;

function wordValue(word: Word | undefined): string | undefined {
	if (word === undefined) return undefined;
	const value = word.value ?? word.text;
	return typeof value === "string" && value !== "" ? value : undefined;
}

function collectCommandNodes(node: unknown, out: Command[]): void {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) collectCommandNodes(item, out);
		return;
	}
	const record = node as Record<string, unknown>;
	if (record.type === "Command") out.push(node as Command);
	for (const [key, value] of Object.entries(record)) {
		if (key === "type" || key === "pos" || key === "end") continue;
		collectCommandNodes(value, out);
	}
}

function toParsed(command: Command): ParsedCommand | null {
	const name = wordValue(command.name);
	if (name === undefined) return null;
	const args: string[] = [];
	for (const suffix of command.suffix) {
		const value = wordValue(suffix);
		if (value !== undefined) args.push(value);
	}
	return { name, args };
}

/**
 * Strip the leading numeric-looking token consumed by wrappers that take one
 * (`timeout 5 cmd`, `nice -n 5 cmd`). Returns the index of the inner command's
 * first token within `args`.
 */
function innerCommandStart(name: string, args: string[]): number {
	if (name === "timeout") return args.findIndex((arg) => !arg.startsWith("-") && !/^\d+(\.\d+)?[smhd]?$/.test(arg));
	if (name === "nice" || name === "ionice" || name === "stdbuf") {
		let index = 0;
		while (index < args.length && args[index]?.startsWith("-")) index += 2;
		return index;
	}
	if (name === "env") return args.findIndex((arg) => !arg.includes("=") && !arg.startsWith("-"));
	return args.findIndex((arg) => !arg.startsWith("-"));
}

function expand(command: ParsedCommand, depth: number, out: ParsedCommand[]): void {
	out.push(command);
	if (depth >= MAX_EXPANSION_DEPTH) return;

	if (STRING_PAYLOAD_WRAPPERS.has(command.name)) {
		const flagIndex = command.args.findIndex((arg) => arg === "-c" || arg === "-lc" || arg === "-ic");
		const payload = flagIndex >= 0 ? command.args[flagIndex + 1] : undefined;
		if (payload !== undefined) {
			for (const inner of enumerateCommands(payload, depth + 1).commands) out.push(inner);
		}
		return;
	}

	if (PREFIX_WRAPPERS.has(command.name)) {
		const start = innerCommandStart(command.name, command.args);
		if (start >= 0 && start < command.args.length) {
			const innerName = command.args[start];
			if (innerName !== undefined) {
				expand({ name: innerName, args: command.args.slice(start + 1) }, depth + 1, out);
			}
		}
	}
}

export function enumerateCommands(
	source: string,
	depth = 0,
): { commands: ParsedCommand[]; parseFailed: boolean } {
	let nodes: Command[] = [];
	try {
		const ast = parse(source);
		collectCommandNodes(ast, nodes);
	} catch {
		return { commands: [], parseFailed: true };
	}

	const out: ParsedCommand[] = [];
	for (const node of nodes) {
		const parsed = toParsed(node);
		if (parsed !== null) expand(parsed, depth, out);
	}
	return { commands: out, parseFailed: false };
}

function redirectTarget(redirect: Redirect): string | undefined {
	const target = wordValue(redirect.target);
	if (target === undefined) return undefined;
	if (WRITE_REDIRECT_OPERATORS.has(redirect.operator)) return target;
	if (AMBIGUOUS_REDIRECT_OPERATORS.has(redirect.operator)) {
		// `2>&1` duplicates a descriptor and names no file; `cmd >& out` names one.
		return /^\d+$/.test(target) ? undefined : target;
	}
	return undefined;
}

/** Destination-argument positions for commands that write without a redirect. */
function commandWriteTargets(command: ParsedCommand): string[] {
	const positional = command.args.filter((arg) => !arg.startsWith("-"));
	switch (command.name) {
		case "tee":
			return positional;
		case "cp":
		case "mv":
		case "install":
		case "rsync":
			return positional.length >= 2 ? [positional[positional.length - 1] as string] : [];
		case "ln":
			return positional.length >= 2 ? [positional[positional.length - 1] as string] : [];
		case "sed":
		case "perl":
		case "ruby": {
			const inPlace = command.args.some((arg) => arg === "-i" || arg.startsWith("-i.") || arg.startsWith("-pi"));
			return inPlace ? positional : [];
		}
		case "truncate":
		case "touch":
			return positional;
		default:
			return [];
	}
}

export function extractWriteTargets(source: string): { targets: string[]; parseFailed: boolean } {
	let nodes: Command[] = [];
	try {
		const ast = parse(source);
		collectCommandNodes(ast, nodes);
	} catch {
		return { targets: [], parseFailed: true };
	}

	const targets = new Set<string>();
	for (const node of nodes) {
		for (const redirect of node.redirects) {
			const target = redirectTarget(redirect);
			if (target !== undefined) targets.add(target);
		}
	}
	for (const command of enumerateCommands(source).commands) {
		for (const target of commandWriteTargets(command)) targets.add(target);
	}
	return { targets: [...targets], parseFailed: false };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/bash.test.ts`
Expected: PASS（17 個測試）

如果 `sed -i '' 's/a/b/' f.txt` 的 positional 包含 `''` 與 `s/a/b/`，測試用 `toContain("f.txt")` 仍會通過 —— 這是刻意的：多收集幾個候選路徑只會讓 protectedPaths 比對多做幾次，不會產生誤擋（候選必須同時命中受保護 glob 才會擋）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/bash.ts test/bash.test.ts
git commit -m "feat(bash): unbash 命令列舉、wrapper 展開與寫入目標抽取（含重導向）"
```

---

## Task 5: 路徑正規化與受保護路徑比對

**Files:**
- Create: `src/lib/paths.ts`
- Test: `test/paths.test.ts`

**Interfaces:**
- Consumes: `minimatch`
- Produces:
  - `interface PathResolver { realpathSync: (path: string) => string; cwd: string; home: string }`
  - `function normalizeCandidate(candidate: string, resolver: PathResolver): string[]` —— 回傳待比對的路徑變體（as-given 絕對化 + realpath 後）
  - `function matchesProtected(candidate: string, patterns: string[], resolver: PathResolver): string | null` —— 回傳命中的 pattern 或 `null`

- [ ] **Step 1: 寫失敗測試**

`test/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchesProtected, normalizeCandidate } from "../src/lib/paths.js";

const resolver = (links: Record<string, string> = {}) => ({
	cwd: "/Users/me/project",
	home: "/Users/me",
	realpathSync: (path: string) => links[path] ?? path,
});

describe("normalizeCandidate", () => {
	it("absolutizes a relative path against cwd", () => {
		expect(normalizeCandidate("src/a.ts", resolver())).toContain("/Users/me/project/src/a.ts");
	});

	it("expands a leading ~ to home", () => {
		expect(normalizeCandidate("~/.zshrc", resolver())).toContain("/Users/me/.zshrc");
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
		expect(normalizeCandidate("/does/not/exist", throwing)).toEqual(["/does/not/exist"]);
	});
});

describe("matchesProtected", () => {
	const patterns = ["**/.pi/agent/settings.json", "**/.pi/agent/npm/**", "**/.env*"];

	it("matches a protected file directly", () => {
		expect(matchesProtected("/Users/me/.pi/agent/settings.json", patterns, resolver())).toBe(
			"**/.pi/agent/settings.json",
		);
	});

	it("matches through a directory pattern", () => {
		expect(
			matchesProtected("/Users/me/.pi/agent/npm/node_modules/pi-guard/src/index.ts", patterns, resolver()),
		).toBe("**/.pi/agent/npm/**");
	});

	it("matches a dotfile pattern", () => {
		expect(matchesProtected("/Users/me/project/.env.local", patterns, resolver())).toBe("**/.env*");
	});

	it("matches through a symlink alias", () => {
		const links = { "/tmp/s": "/Users/me/.pi/agent/settings.json" };
		expect(matchesProtected("/tmp/s", patterns, resolver(links))).toBe("**/.pi/agent/settings.json");
	});

	it("returns null for an unprotected path", () => {
		expect(matchesProtected("/Users/me/project/src/index.ts", patterns, resolver())).toBeNull();
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/paths.test.ts`
Expected: FAIL —— `Cannot find module '../src/lib/paths.js'`

- [ ] **Step 3: 實作**

`src/lib/paths.ts`:

```ts
import { isAbsolute, resolve } from "node:path";
import { minimatch } from "minimatch";

export interface PathResolver {
	realpathSync: (path: string) => string;
	cwd: string;
	home: string;
}

/**
 * Every form of `candidate` a protected-path rule must be checked against: the
 * path as referenced (absolutized) and its symlink-resolved target. pi-guard
 * compares only the literal token, so `ln -s settings.json /tmp/s` evades it.
 */
export function normalizeCandidate(candidate: string, resolver: PathResolver): string[] {
	const trimmed = candidate.replace(/^@/, "");
	const expanded = trimmed.startsWith("~/") ? resolve(resolver.home, trimmed.slice(2)) : trimmed;
	const absolute = isAbsolute(expanded) ? expanded : resolve(resolver.cwd, expanded);

	const variants = [absolute];
	try {
		const real = resolver.realpathSync(absolute);
		if (real !== absolute) variants.push(real);
	} catch {
		// A path that does not exist yet cannot be realpath'd; the literal form
		// is still a valid thing to gate on (a write creates it).
	}
	return variants;
}

export function matchesProtected(
	candidate: string,
	patterns: string[],
	resolver: PathResolver,
): string | null {
	const variants = normalizeCandidate(candidate, resolver);
	for (const pattern of patterns) {
		for (const variant of variants) {
			if (minimatch(variant, pattern, { dot: true })) return pattern;
		}
	}
	return null;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/paths.test.ts`
Expected: PASS（9 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts test/paths.test.ts
git commit -m "feat(paths): 路徑正規化（含 symlink 解析）與受保護路徑比對"
```

---

## Task 6: hard-deny 判定核心

**Files:**
- Create: `src/modules/hard-deny.ts`
- Test: `test/hard-deny.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `Decision`／`HardDenyOptions`；`src/lib/bash.ts` 的 `enumerateCommands`／`extractWriteTargets`；`src/lib/paths.ts` 的 `matchesProtected`／`PathResolver`
- Produces: `function decideHardDeny(toolName: string, input: Record<string, unknown>, opts: HardDenyOptions, resolver: PathResolver): Decision`

- [ ] **Step 1: 寫失敗測試**

`test/hard-deny.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_HARD_DENY_COMMANDS, DEFAULT_PROTECTED_PATHS } from "../src/config.js";
import { decideHardDeny } from "../src/modules/hard-deny.js";

const opts = { commands: DEFAULT_HARD_DENY_COMMANDS, protectedPaths: DEFAULT_PROTECTED_PATHS };
const resolver = (links: Record<string, string> = {}) => ({
	cwd: "/Users/me/project",
	home: "/Users/me",
	realpathSync: (path: string) => links[path] ?? path,
});
const bash = (command: string, links?: Record<string, string>) =>
	decideHardDeny("bash", { command }, opts, resolver(links));
const tool = (name: string, path: string) => decideHardDeny(name, { path }, opts, resolver());

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

	it("matches a glob token rule", () => {
		expect(bash("git commit -am wip").kind).toBe("block");
		expect(bash("git push --force-with-lease").kind).toBe("block");
	});

	it("passes a legitimate variant", () => {
		expect(bash("git add src/index.ts").kind).toBe("pass");
		expect(bash("git status --porcelain").kind).toBe("pass");
		expect(bash("npm test").kind).toBe("pass");
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
		expect(bash("echo '{}' > /Users/me/.pi/agent/settings.json").kind).toBe("block");
		expect(bash("echo x >> /Users/me/.zshrc").kind).toBe("block");
		expect(bash("cmd &> /Users/me/.pi/agent/AGENTS.md").kind).toBe("block");
	});

	it("blocks tee/cp/mv/sed -i onto a protected path", () => {
		expect(bash("echo x | tee /Users/me/.pi/agent/settings.json").kind).toBe("block");
		expect(bash("cp evil.json /Users/me/.pi/agent/settings.json").kind).toBe("block");
		expect(bash("sed -i '' s/a/b/ /Users/me/.pi/agent/AGENTS.md").kind).toBe("block");
	});

	it("blocks a symlink alias to a protected path", () => {
		const links = { "/tmp/alias": "/Users/me/.pi/agent/settings.json" };
		expect(bash("echo x > /tmp/alias", links).kind).toBe("block");
	});

	it("blocks a write into the agents-guard state directory", () => {
		expect(bash("echo x > /Users/me/.pi/agent/state/agents-guard/locks/a.json").kind).toBe("block");
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
		expect(tool("write", "/Users/me/.pi/agent/settings.json").kind).toBe("block");
		expect(tool("edit", "/Users/me/.pi/agent/npm/node_modules/pi-guard/src/handlers.ts").kind).toBe("block");
		expect(tool("ast_grep_replace", "/Users/me/.pi/agent/AGENTS.md").kind).toBe("block");
	});

	it("passes an ordinary source file", () => {
		expect(tool("write", "/Users/me/project/src/index.ts").kind).toBe("pass");
	});

	it("ignores tools it does not gate", () => {
		expect(tool("read", "/Users/me/.pi/agent/settings.json").kind).toBe("pass");
		expect(decideHardDeny("web_search", { query: "x" }, opts, resolver()).kind).toBe("pass");
	});

	it("normalizes a leading @ in a path argument", () => {
		expect(tool("write", "@/Users/me/.pi/agent/settings.json").kind).toBe("block");
	});
});

describe("hard-deny fail-open", () => {
	it("passes when the bash command cannot be parsed", () => {
		expect(bash("echo 'unterminated").kind).toBe("pass");
	});

	it("passes when the command argument is missing or not a string", () => {
		expect(decideHardDeny("bash", {}, opts, resolver()).kind).toBe("pass");
		expect(decideHardDeny("bash", { command: 42 }, opts, resolver()).kind).toBe("pass");
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/hard-deny.test.ts`
Expected: FAIL —— `Cannot find module '../src/modules/hard-deny.js'`

- [ ] **Step 3: 實作**

`src/modules/hard-deny.ts`:

```ts
import { enumerateCommands, extractWriteTargets, type ParsedCommand } from "../lib/bash.js";
import { matchesProtected, type PathResolver } from "../lib/paths.js";
import type { Decision, HardDenyOptions } from "../types.js";

/** Tools whose `path` argument is a write and must be gated. */
const GATED_PATH_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "ast_grep_replace"]);

function tokenMatches(pattern: string, token: string): boolean {
	if (!pattern.includes("*") && !pattern.includes("?")) return pattern === token;
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`).test(token);
}

/**
 * Rule tokens must appear in order within the command's tokens; extra
 * arguments anywhere are allowed. Same subsequence semantics pi-guard uses, so
 * a rule like "git add -A" also covers "git add -A --verbose" without
 * enumerating flags — but never covers "git add -Apatch" (token equality).
 */
function isSubsequence(needle: string[], haystack: string[]): boolean {
	let index = 0;
	for (const token of haystack) {
		const pattern = needle[index];
		if (pattern !== undefined && tokenMatches(pattern, token)) index += 1;
		if (index >= needle.length) break;
	}
	return index === needle.length;
}

function commandMatchesRule(command: ParsedCommand, rule: string): boolean {
	const [ruleName, ...ruleArgs] = rule.split(/\s+/).filter((part) => part !== "");
	if (ruleName === undefined) return false;
	if (!tokenMatches(ruleName, command.name)) return false;
	return ruleArgs.length === 0 || isSubsequence(ruleArgs, command.args);
}

function blockReason(what: string, detail: string): string {
	return [
		`[agents-guard/hard-deny] 已阻擋：${what}`,
		`  ${detail}`,
		"  這是 AGENTS.md 的 MUST 級防線，不提供單次放行選項。",
		"  若確實需要此操作，請由操作者手動執行，或調整 agents-guard 的 hardDeny 設定。",
	].join("\n");
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function decideHardDeny(
	toolName: string,
	input: Record<string, unknown>,
	opts: HardDenyOptions,
	resolver: PathResolver,
): Decision {
	if (GATED_PATH_TOOLS.has(toolName)) {
		const path = asString(input.path);
		if (path === undefined) return { kind: "pass" };
		const pattern = matchesProtected(path, opts.protectedPaths, resolver);
		if (pattern !== null) {
			return {
				kind: "block",
				reason: blockReason(`${toolName} 寫入受保護路徑`, `path=${path}  命中規則=${pattern}`),
			};
		}
		return { kind: "pass" };
	}

	if (toolName !== "bash") return { kind: "pass" };

	const command = asString(input.command);
	if (command === undefined) return { kind: "pass" };

	const { commands, parseFailed } = enumerateCommands(command);
	if (parseFailed) return { kind: "pass" };

	for (const parsed of commands) {
		for (const rule of opts.commands) {
			if (commandMatchesRule(parsed, rule)) {
				const rendered = `${parsed.name} ${parsed.args.join(" ")}`.trim();
				return {
					kind: "block",
					reason: blockReason("命令命中 hard-deny 清單", `命令=${rendered}  命中規則=${rule}`),
				};
			}
		}
	}

	const { targets } = extractWriteTargets(command);
	for (const target of targets) {
		const pattern = matchesProtected(target, opts.protectedPaths, resolver);
		if (pattern !== null) {
			return {
				kind: "block",
				reason: blockReason("命令寫入受保護路徑", `目標=${target}  命中規則=${pattern}`),
			};
		}
	}

	return { kind: "pass" };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/hard-deny.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 刻意破壞測試以確認防護力（`AGENTS.md:65`）**

暫時把 `decideHardDeny` 中 bash 分支的 `for (const parsed of commands)` 迴圈改成只檢查 `commands[0]`，執行測試。

Run: `npx vitest run test/hard-deny.test.ts`
Expected: FAIL —— 「blocks through &&」「blocks through ;」等案例失敗。確認測試真的在守護複合命令分解後，還原程式碼並再次確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/modules/hard-deny.ts test/hard-deny.test.ts
git commit -m "feat(hard-deny): 命令/寫入目標/工具三層判定，含複合命令與 symlink"
```

---

## Task 7: state 讀寫

**Files:**
- Create: `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: `node:fs`、`node:os`、`node:path`
- Produces:
  - `function resolveStateDir(env: Record<string, string | undefined>, home: string): string`
  - `function readJsonFile(path: string): { value: unknown; error?: string }`
  - `function writeJsonFileAtomic(path: string, value: unknown): void` —— tmp + rename，`mode: 0o600`

- [ ] **Step 1: 寫失敗測試**

`test/state.test.ts`:

```ts
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonFile, resolveStateDir, writeJsonFileAtomic } from "../src/state.js";

describe("resolveStateDir", () => {
	it("defaults to ~/.pi/agent/state/agents-guard", () => {
		expect(resolveStateDir({}, "/Users/me")).toBe("/Users/me/.pi/agent/state/agents-guard");
	});

	it("honours PI_CODING_AGENT_DIR", () => {
		expect(resolveStateDir({ PI_CODING_AGENT_DIR: "/custom/agent" }, "/Users/me")).toBe(
			"/custom/agent/state/agents-guard",
		);
	});
});

describe("writeJsonFileAtomic / readJsonFile", () => {
	it("round-trips a value and creates the file 0600", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "nested", "config.json");
		writeJsonFileAtomic(file, { hello: "world" });

		expect(readJsonFile(file).value).toEqual({ hello: "world" });
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
	});

	it("reports a parse error instead of throwing", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "broken.json");
		writeJsonFileAtomic(file, { ok: true });
		writeFileSync(file, "{ not json");
		const result = readJsonFile(file);
		expect(result.value).toBeUndefined();
		expect(result.error).toBeDefined();
	});

	it("reports a missing file as undefined without an error", () => {
		const result = readJsonFile(join(tmpdir(), "definitely-missing-ag.json"));
		expect(result.value).toBeUndefined();
		expect(result.error).toBeUndefined();
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/state.test.ts`
Expected: FAIL —— `Cannot find module '../src/state.js'`

- [ ] **Step 3: 實作**

`src/state.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const STATE_SUBDIR = join("state", "agents-guard");

export function resolveStateDir(env: Record<string, string | undefined>, home: string): string {
	const agentDir = env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
	return join(agentDir, STATE_SUBDIR);
}

export function readJsonFile(path: string): { value: unknown; error?: string } {
	if (!existsSync(path)) return { value: undefined };
	try {
		return { value: JSON.parse(readFileSync(path, "utf8")) };
	} catch (error) {
		return { value: undefined, error: error instanceof Error ? error.message : String(error) };
	}
}

/** Write via tmp + rename so a reader never observes a partial file. */
export function writeJsonFileAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(tmp, path);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/state.test.ts`
Expected: PASS（5 個測試）

測試已在檔案頂部匯入 `writeFileSync`（ESM 測試中沒有 `require`）。

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat(state): state 目錄解析與 0600 原子讀寫"
```

---

## Task 8: extension entry、`/agents-guard` 命令與 hook 接線

**Files:**
- Create: `src/index.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: 全部前述模組；`@earendil-works/pi-coding-agent` 的 `ExtensionAPI`／`ExtensionContext` 型別
- Produces:
  - `export default function (pi: ExtensionAPI): void`
  - `export function createRuntime(deps: RuntimeDeps): Runtime` —— 可測的執行核心，不依賴 pi 實例
  - `interface Runtime { handleToolCall(toolName: string, input: Record<string, unknown>): Decision; status(): string; setEnabled(target: "all" | ModuleName, enabled: boolean): void; save(): Record<string, unknown> }`

- [ ] **Step 1: 寫失敗測試**

`test/integration.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/index.js";

const deps = (over: Partial<Parameters<typeof createRuntime>[0]> = {}) => ({
	fileConfig: undefined as unknown,
	env: {} as Record<string, string | undefined>,
	flag: undefined as string | undefined,
	resolver: { cwd: "/Users/me/project", home: "/Users/me", realpathSync: (p: string) => p },
	log: vi.fn(),
	...over,
});

describe("runtime: hard-deny 接線", () => {
	it("blocks a denied command", () => {
		const runtime = createRuntime(deps());
		const decision = runtime.handleToolCall("bash", { command: "git add -A" });
		expect(decision.kind).toBe("block");
	});

	it("passes an allowed command", () => {
		const runtime = createRuntime(deps());
		expect(runtime.handleToolCall("bash", { command: "git status" }).kind).toBe("pass");
	});
});

describe("runtime: 開關", () => {
	it("global disable stops all gating", () => {
		const runtime = createRuntime(deps({ flag: "off" }));
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("pass");
	});

	it("module disable stops only that module", () => {
		const runtime = createRuntime(deps({ fileConfig: { modules: { "hard-deny": { enabled: false } } } }));
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("pass");
	});

	it("command layer takes effect immediately and overrides the file", () => {
		const runtime = createRuntime(deps({ fileConfig: { modules: { "hard-deny": { enabled: false } } } }));
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("pass");
		runtime.setEnabled("hard-deny", true);
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("block");
	});
});

describe("runtime: status 顯示 provenance", () => {
	it("reports the effective source per module", () => {
		const runtime = createRuntime(deps({ env: { AGENTS_GUARD: "hard-deny" } }));
		const status = runtime.status();
		expect(status).toContain("hard-deny");
		expect(status).toContain("env");
		expect(status).toContain("writer-lock");
	});
});

describe("runtime: save 只寫明確設定過的值", () => {
	it("omits defaults", () => {
		const runtime = createRuntime(deps());
		expect(runtime.save()).toEqual({ version: 1 });
	});

	it("includes a command-layer change", () => {
		const runtime = createRuntime(deps());
		runtime.setEnabled("git-evidence", false);
		expect(runtime.save()).toEqual({ version: 1, modules: { "git-evidence": { enabled: false } } });
	});
});

describe("runtime: fail-open", () => {
	it("passes and logs when the decision core throws", () => {
		const log = vi.fn();
		const runtime = createRuntime(
			deps({
				log,
				resolver: {
					cwd: "/Users/me/project",
					home: "/Users/me",
					realpathSync: () => {
						throw new Error("boom");
					},
				},
			}),
		);
		// realpathSync throwing is already handled inside paths.ts, so force a
		// harder failure: a getter that throws when the input is read.
		const hostile = Object.defineProperty({}, "command", {
			get() {
				throw new Error("hostile input");
			},
		}) as Record<string, unknown>;
		expect(runtime.handleToolCall("bash", hostile).kind).toBe("pass");
		expect(log).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL —— `createRuntime` 不存在

- [ ] **Step 3: 實作**

`src/index.ts`:

```ts
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveConfig, serializeExplicit } from "./config.js";
import type { PathResolver } from "./lib/paths.js";
import { decideHardDeny } from "./modules/hard-deny.js";
import { readJsonFile, resolveStateDir, writeJsonFileAtomic } from "./state.js";
import {
	type AgentsGuardConfig,
	type Decision,
	type ModuleName,
	MODULE_NAMES,
	type Provenance,
	isModuleName,
} from "./types.js";

export interface RuntimeDeps {
	fileConfig: unknown;
	env: Record<string, string | undefined>;
	flag: string | undefined;
	resolver: PathResolver;
	log: (message: string) => void;
}

export interface Runtime {
	handleToolCall(toolName: string, input: Record<string, unknown>): Decision;
	status(): string;
	setEnabled(target: "all" | ModuleName, enabled: boolean): void;
	save(): Record<string, unknown>;
	warnings(): string[];
}

export function createRuntime(deps: RuntimeDeps): Runtime {
	let commandLayer: Partial<AgentsGuardConfig> = {};
	let config: AgentsGuardConfig;
	let provenance: Provenance;
	let warnings: string[];

	const recompute = () => {
		const resolved = resolveConfig({
			file: deps.fileConfig,
			env: deps.env.AGENTS_GUARD,
			flag: deps.flag,
			command: Object.keys(commandLayer).length > 0 ? commandLayer : undefined,
		});
		config = resolved.config;
		provenance = resolved.provenance;
		warnings = resolved.warnings;
	};
	recompute();

	/** Each module failing independently: one bug must not disable the rest. */
	const failureCounts = new Map<ModuleName, number>();
	const guarded = (name: ModuleName, run: () => Decision): Decision => {
		if (!config.enabled || !config.modules[name].enabled) return { kind: "pass" };
		if ((failureCounts.get(name) ?? 0) >= 3) return { kind: "pass" };
		try {
			return run();
		} catch (error) {
			const count = (failureCounts.get(name) ?? 0) + 1;
			failureCounts.set(name, count);
			const detail = error instanceof Error ? error.message : String(error);
			deps.log(
				count >= 3
					? `agents-guard: module ${name} failed 3 times and is now disabled for this session (${detail})`
					: `agents-guard: module ${name} failed open (${detail})`,
			);
			return { kind: "pass" };
		}
	};

	return {
		handleToolCall(toolName, input) {
			return guarded("hard-deny", () =>
				decideHardDeny(toolName, input, config.modules["hard-deny"], deps.resolver),
			);
		},
		status() {
			const lines = [`agents-guard: ${config.enabled ? "enabled" : "disabled"} (source: ${provenance.enabled})`];
			for (const name of MODULE_NAMES) {
				const state = config.modules[name].enabled ? "enabled" : "disabled";
				const failed = (failureCounts.get(name) ?? 0) >= 3 ? "  [auto-disabled after 3 failures]" : "";
				lines.push(`  ${name}: ${state} (source: ${provenance.modules[name]})${failed}`);
			}
			for (const warning of warnings) lines.push(`  ⚠️ ${warning}`);
			return lines.join("\n");
		},
		setEnabled(target, enabled) {
			if (target === "all") {
				commandLayer = { ...commandLayer, enabled };
			} else {
				const modules = { ...(commandLayer.modules ?? {}) } as Record<string, { enabled: boolean }>;
				modules[target] = { enabled };
				commandLayer = { ...commandLayer, modules } as Partial<AgentsGuardConfig>;
			}
			recompute();
		},
		save() {
			return serializeExplicit(config, provenance);
		},
		warnings() {
			return [...warnings];
		},
	};
}

export default function (pi: ExtensionAPI): void {
	pi.registerFlag("agents-guard", {
		description: "agents-guard modules: off | on | comma-separated module names",
		type: "string",
	});

	const home = homedir();
	const stateDir = resolveStateDir(process.env, home);
	const configPath = join(stateDir, "config.json");
	const fileRead = readJsonFile(configPath);

	let runtime: Runtime | undefined;

	const ensureRuntime = (cwd: string): Runtime => {
		if (runtime === undefined) {
			const resolver: PathResolver = { realpathSync, cwd, home };
			runtime = createRuntime({
				fileConfig: fileRead.value,
				env: process.env,
				flag: typeof pi.getFlag === "function" ? (pi.getFlag("agents-guard") as string | undefined) : undefined,
				resolver,
				log: (message) => console.warn(message),
			});
			if (fileRead.error !== undefined) {
				console.warn(`agents-guard: ignoring unreadable config at ${configPath} (${fileRead.error})`);
			}
		}
		return runtime;
	};

	pi.on("session_start", async (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		for (const warning of current.warnings()) {
			if (ctx.hasUI) ctx.ui.notify(warning, "warning");
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		const decision = ensureRuntime(ctx.cwd).handleToolCall(
			event.toolName,
			event.input as Record<string, unknown>,
		);
		if (decision.kind === "block") return { block: true, reason: decision.reason };
		return undefined;
	});

	pi.registerCommand("agents-guard", {
		description: "Inspect or toggle agents-guard modules",
		handler: async (args, ctx) => {
			const current = ensureRuntime(ctx.cwd);
			const [verb, target] = args.trim().split(/\s+/).filter((part) => part !== "");

			if (verb === undefined || verb === "status") {
				ctx.ui.notify(current.status(), "info");
				return;
			}
			if (verb === "save") {
				writeJsonFileAtomic(configPath, current.save());
				ctx.ui.notify(`agents-guard: saved to ${configPath}`, "info");
				return;
			}
			if (verb === "on" || verb === "off") {
				const enabled = verb === "on";
				if (target === undefined) {
					current.setEnabled("all", enabled);
				} else if (isModuleName(target)) {
					current.setEnabled(target, enabled);
				} else {
					ctx.ui.notify(
						`agents-guard: unknown module "${target}". Known: ${MODULE_NAMES.join(", ")}`,
						"error",
					);
					return;
				}
				ctx.ui.notify(current.status(), "info");
				return;
			}
			ctx.ui.notify(
				"agents-guard usage: /agents-guard [status] | on [module] | off [module] | save",
				"warning",
			);
		},
		getArgumentCompletions: (prefix: string) => {
			const items = ["status", "on", "off", "save", ...MODULE_NAMES].map((value) => ({ value, label: value }));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
	});
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run`
Expected: PASS（全部檔案）

- [ ] **Step 5: 型別與 lint 檢查**

Run: `npx tsc --noEmit && npx biome check .`
Expected: 無錯誤。若 `pi.getFlag` 的型別與此處不符，依實際 `ExtensionAPI` 定義調整（不要用 `any` 繞過）。

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/integration.test.ts
git commit -m "feat(index): extension entry、/agents-guard 命令與 hard-deny 接線"
```

---

## Task 9: 實機驗證與 README

**Files:**
- Create: `README.md`
- Modify: 無（純驗證任務）

**Interfaces:**
- Consumes: Task 1–8 的全部產出
- Produces: 驗收證據

- [ ] **Step 1: 以 pi 實機載入**

```bash
cd ~/web/pi-agents-guard
pi -e ./src/index.ts -p "/agents-guard"
```

Expected: 輸出 5 個模組的狀態與 provenance，`hard-deny: enabled (source: default)`。

- [ ] **Step 2: 實測硬擋（`AGENTS.md:65` 刻意觸發）**

在互動 session 中依序執行，記錄結果：

| 命令 | 預期 |
|---|---|
| `git status` | 直接執行 |
| `git add -A` | 被 agents-guard 擋，reason 含 `hard-deny`，**且不彈確認框** |
| `echo x > ~/.pi/agent/settings.json` | 被擋（這是 pi-guard 擋不住的那個向量） |
| `echo x > /tmp/ok.txt` | 通過 |

- [ ] **Step 3: 實測載入順序（驗收條件 14）**

在 `src/index.ts` 的 `tool_call` handler 首行暫時加入 `console.warn("[agents-guard] tool_call")`，執行 `git add -A`，觀察它是否早於 pi-guard 的確認框出現。

若 agents-guard 較晚，調整載入方式（把它加入 `settings.json` 的 `extensions` 陣列，並確認相對於 `packages` 的順序），重測直到 agents-guard 先執行。記錄結論後移除 `console.warn`。

- [ ] **Step 4: 實測 subagent 不被誤擋（驗收條件 10、12）**

```bash
pi -e ./src/index.ts -p "用 subagent 派發一個寫入型任務，在 /tmp/ag-probe 建立一個檔案"
```

Expected: child 正常完成。hard-deny 不涉及跨 session 狀態，因此本階段應無 child 相關問題；若被擋，記錄 reason 並修正受保護路徑清單。

- [ ] **Step 5: 撰寫 README**

`README.md` 必須包含：安裝方式（`extensions` 陣列路徑）、`/agents-guard` 全部子命令、四層設定來源與優先序表、`hard-deny` 的預設清單、與 pi-guard／pi-permission-system 的分工說明（連結 `docs/permission-systems-comparison.md`）、已知限制（連結 `docs/design.md` §9）。

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README 與 Stage 1 實機驗證結論"
```

---

## Self-Review

**1. Spec 覆蓋檢查**

| spec 章節 | 對應 task |
|---|---|
| §3.1 專案結構 | Task 1（骨架）、各 task 建立對應檔案 |
| §3.2 模組契約（`Decision` 純函式） | Task 2（型別）、Task 6（`decideHardDeny`） |
| §4.1 兩級粒度 | Task 3（`resolveConfig`）、Task 8（`setEnabled`） |
| §4.2 四層來源 | Task 3（含 5 個優先序測試） |
| §4.3 命令介面 | Task 8（`status`／`on`／`off`／`save`）。`takeover`／`unlock` 屬 writer-lock，留待 Stage 3 |
| §4.4 原則 1（只寫明確值） | Task 3（`serializeExplicit` + 2 個測試） |
| §4.4 原則 2（立即生效） | Task 8（「command layer takes effect immediately」測試） |
| §4.4 原則 3（不依賴 key 順序） | 全程以陣列規則 + 明確優先序，無 `"*"` 結構 |
| §4.4 原則 4（不彈框） | Task 6 只回 `block`；Task 9 Step 2 實測確認 |
| §4.4 原則 5（fail-open + 3 次停用） | Task 8（`guarded` 包裝 + fail-open 測試） |
| §5.1b hard-deny 三類判定 | Task 4（bash 解析）、Task 5（路徑）、Task 6（判定） |
| §5.6 第 2 層（自身 state 保護） | Task 3 的 `DEFAULT_PROTECTED_PATHS` 含 `state/agents-guard/**`；Task 6 有對應測試 |
| §6.1 state 目錄 | Task 7 |
| §6.3 原子寫入 | Task 7 |
| §7 錯誤處理 | Task 3（config 損壞警告）、Task 7（讀取錯誤不拋）、Task 8（模組異常計數） |
| §8.2 驗收條件 1–4、13–14 | Task 8、Task 9 |

**未覆蓋（刻意，屬後續 Stage）**：§5.1 writer-lock、§5.2 subagent-policy、§5.3 git-evidence、§5.4 completion-diff-recheck、§5.5 child 情境、§5.6 第 3 層完整性檢查、驗收條件 5–9、15–16。這些各自會有獨立 plan。

**2. Placeholder 掃描**：本計畫無 TBD／TODO／「similar to Task N」；每個 code step 都有完整可貼上的程式碼；每個 test step 都有實際斷言。

**3. 型別一致性檢查**
- `Decision` 在 Task 2 定義，Task 6／8 使用 —— 一致
- `HardDenyOptions { commands, protectedPaths }` 在 Task 2 定義，Task 3 提供預設、Task 6 消費 —— 一致
- `PathResolver { realpathSync, cwd, home }` 在 Task 5 定義，Task 6／8 注入 —— 一致
- `enumerateCommands` 回傳 `{ commands, parseFailed }`、`extractWriteTargets` 回傳 `{ targets, parseFailed }` —— Task 4 定義，Task 6 消費 —— 一致
- `ModuleName` 與 `MODULE_NAMES` 在 Task 2 定義，Task 3／8 使用 —— 一致
- `resolveStateDir`／`readJsonFile`／`writeJsonFileAtomic` 在 Task 7 定義，Task 8 使用 —— 一致

**一個已知的實作風險**（留給執行者注意）：`unbash` 的 `Word.value` 對含引號或變數展開的 token 可能與 `text` 不同。Task 4 的 `wordValue` 優先取 `value`，這是刻意的（要的是展開後的字面值）。若實測發現某些形式取不到路徑，處理方式是**加測試案例**再修 `wordValue`，不要改成寬鬆比對。
