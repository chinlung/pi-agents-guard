# agents-guard Stage 2 實作計畫：subagent-policy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `subagent-policy` 模組 —— 對 `subagent` 工具呼叫做三條純參數判定（`AGENTS.md:88`／`:91`／`:92`），並接線進現有 `tool_call`／`tool_result` hook，沿用 Stage 1 已驗證的開關機制、fail-open wrapper 與 provenance 追蹤。

**Architecture:** 延續 Stage 1 的純函式決策核心模式：`decideSubagentCall(input, facts, opts)` 是純函式（無 I/O），facts（`capabilitiesListed`、`isSubagentChild`）由 `src/index.ts` 的 `createRuntime` 在 `tool_call`／`tool_result` 收集後傳入。`config.ts` 的四層來源解析與 `serializeExplicit` 需擴充成通用機制（`ARRAY_FIELDS` 表），讓 `subagent-policy` 的四個 pattern 清單與 `hard-deny` 的兩個清單共用同一套合併／序列化邏輯，而不是重複特判 `"hard-deny"`。

**Tech Stack:** TypeScript（既有 strict 設定）、vitest。不需新依賴。

**Spec:** `docs/design.md`（§5.2 subagent-policy 完整規格、§5.5 subagent child 情境、§4.4 五個設計原則、§8 測試策略）

## Global Constraints

- 沿用 Stage 1 既有慣例：所有 `decide*` 函式為純函式，不做檔案 I/O、不呼叫 pi API、不直接讀 `process.env`（事實由參數傳入）
- 阻擋一律 `return { kind: "block", reason }`，不彈確認框
- 模組例外一律經由 `src/index.ts` 既有的 `guarded()` wrapper 捕捉並 fail-open（`subagent-policy` 直接沿用同一個 `failureCounts` 機制，不需新程式碼）
- 三個 pattern 清單／清單型選項皆可由 config 覆寫，且 `config.ts` 的合併與序列化邏輯不得為 `subagent-policy` 重複硬編一份（用 Task 1 的 `ARRAY_FIELDS` 通用化取代）
- 每個 commit 前必須 `npx vitest run` 全綠
- 規則 1（`:88`）在 `facts.isSubagentChild === true` 時停用；規則 2、3 在 child 中仍啟用（§5.5）

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/types.ts` | 新增 `SubagentPolicyOptions`、`SubagentPolicyFacts`；`AgentsGuardConfig.modules["subagent-policy"]` 擴充為 `ModuleState & SubagentPolicyOptions` |
| `src/config.ts` | 新增四個 pattern 清單的預設值；把 `hard-deny` 專用的合併／序列化邏輯改為通用的 `ARRAY_FIELDS` 表，同時覆蓋 `hard-deny` 與 `subagent-policy` |
| `src/modules/subagent-policy.ts` | `decideSubagentCall` 判定核心（純函式） |
| `src/index.ts` | `Runtime` 新增 `handleToolResult`（追蹤 `capabilitiesListed`）；`handleToolCall` 接線 `subagent-policy`；extension entry 新增 `tool_result` hook 訂閱 |
| `test/config.test.ts` | 補 `subagent-policy` 的四層來源／深度合併／序列化測試 |
| `test/subagent-policy.test.ts` | `decideSubagentCall` 三條規則的 block/pass 雙向測試 + child 情境測試 |
| `test/integration.test.ts` | `Runtime.handleToolCall`／`handleToolResult` 對 `subagent-policy` 的接線測試 |

---

## Task 1: 型別擴充 + config.ts 通用化（`ARRAY_FIELDS`）

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: 既有 `ModuleName`、`MODULE_NAMES`、`ConfigSource`、`Provenance`
- Produces:
  - `interface SubagentPolicyOptions { weakModelPatterns: string[]; externalCliAgents: string[]; nativeOnlyOptions: string[]; reviewIntentPatterns: string[] }`
  - `AgentsGuardConfig.modules["subagent-policy"]: ModuleState & SubagentPolicyOptions`
  - `const DEFAULT_WEAK_MODEL_PATTERNS`／`DEFAULT_EXTERNAL_CLI_AGENTS`／`DEFAULT_NATIVE_ONLY_OPTIONS`／`DEFAULT_REVIEW_INTENT_PATTERNS: string[]`（於 `config.ts`）
  - `resolveConfig` 與 `serializeExplicit` 對 `subagent-policy` 的四個欄位行為與 `hard-deny` 的 `commands`／`protectedPaths` 對稱（file→env→flag→command 覆寫；只序列化非預設值）

- [ ] **Step 1: 寫失敗測試**

於 `test/config.test.ts` 追加：

```ts
describe("DEFAULT_CONFIG: subagent-policy", () => {
	it("ships non-empty pattern lists", () => {
		expect(DEFAULT_CONFIG.modules["subagent-policy"].weakModelPatterns).toContain("haiku");
		expect(DEFAULT_CONFIG.modules["subagent-policy"].externalCliAgents).toContain("codex-exec");
		expect(DEFAULT_CONFIG.modules["subagent-policy"].nativeOnlyOptions).toContain("model");
		expect(DEFAULT_CONFIG.modules["subagent-policy"].reviewIntentPatterns).toContain("review");
	});
});

describe("resolveConfig: subagent-policy 深度合併與 provenance（對稱於 hard-deny）", () => {
	it("file overrides one pattern list without touching the others", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "subagent-policy": { weakModelPatterns: ["only-this"] } } },
		});
		expect(config.modules["subagent-policy"].weakModelPatterns).toEqual(["only-this"]);
		expect(config.modules["subagent-policy"].externalCliAgents.length).toBeGreaterThan(0);
		expect(provenance.modules["subagent-policy"]).toBe("file");
	});

	it("command layer overrides file layer for subagent-policy", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "subagent-policy": { reviewIntentPatterns: ["from-file"] } } },
			command: { modules: { "subagent-policy": { reviewIntentPatterns: ["from-command"] } } },
		});
		expect(config.modules["subagent-policy"].reviewIntentPatterns).toEqual(["from-command"]);
		expect(provenance.modules["subagent-policy"]).toBe("command");
	});
});

describe("serializeExplicit: subagent-policy", () => {
	it("omits pattern lists left at default", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "subagent-policy": { enabled: false } } },
		});
		const out = serializeExplicit(config, provenance);
		expect(out).toEqual({ version: 1, modules: { "subagent-policy": { enabled: false } } });
	});

	it("includes an explicitly overridden pattern list", () => {
		const { config, provenance } = resolveConfig({
			command: { modules: { "subagent-policy": { externalCliAgents: ["only-runner"] } } },
		});
		const out = serializeExplicit(config, provenance);
		expect(out).toEqual({
			version: 1,
			modules: { "subagent-policy": { enabled: true, externalCliAgents: ["only-runner"] } },
		});
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL —— `DEFAULT_CONFIG.modules["subagent-policy"].weakModelPatterns` 為 `undefined`（型別上該欄位尚不存在）

- [ ] **Step 3: 擴充 `src/types.ts`**

在既有 `HardDenyOptions` 之後新增：

```ts
export interface SubagentPolicyOptions {
	weakModelPatterns: string[];
	externalCliAgents: string[];
	nativeOnlyOptions: string[];
	reviewIntentPatterns: string[];
}

export interface SubagentPolicyFacts {
	capabilitiesListed: boolean;
	isSubagentChild: boolean;
}
```

把 `AgentsGuardConfig` 的 `subagent-policy` 條目改為：

```ts
export interface AgentsGuardConfig {
	enabled: boolean;
	modules: {
		"hard-deny": ModuleState & HardDenyOptions;
		"subagent-policy": ModuleState & SubagentPolicyOptions;
		"writer-lock": ModuleState;
		"git-evidence": ModuleState;
		"completion-diff-recheck": ModuleState;
	};
}
```

- [ ] **Step 4: 通用化 `src/config.ts`**

新增預設清單（放在 `DEFAULT_PROTECTED_PATHS` 之後）：

```ts
export const DEFAULT_WEAK_MODEL_PATTERNS: string[] = ["haiku", "mini", "flash", "lite", "small"];

export const DEFAULT_EXTERNAL_CLI_AGENTS: string[] = [
	"codex-exec",
	"codex-exec-writer",
	"claude-code",
	"claude-code-writer",
	"cursor-agent",
	"cursor-agent-writer",
];

export const DEFAULT_NATIVE_ONLY_OPTIONS: string[] = [
	"model",
	"context",
	"acceptance",
	"outputSchema",
	"toolBudget",
	"fast",
	"skill",
	"mission",
];

export const DEFAULT_REVIEW_INTENT_PATTERNS: string[] = ["review", "audit", "security", "threat"];
```

把 `DEFAULT_CONFIG.modules["subagent-policy"]` 改為：

```ts
"subagent-policy": {
	enabled: true,
	weakModelPatterns: DEFAULT_WEAK_MODEL_PATTERNS,
	externalCliAgents: DEFAULT_EXTERNAL_CLI_AGENTS,
	nativeOnlyOptions: DEFAULT_NATIVE_ONLY_OPTIONS,
	reviewIntentPatterns: DEFAULT_REVIEW_INTENT_PATTERNS,
},
```

`resolveConfig` 目前對每個 layer 產生的 `patch.modules[key]` 是 `{ enabled?; commands?; protectedPaths? }`，且合併迴圈用 `if (name === "hard-deny") { ... }` 特判兩個欄位。改為通用機制：

```ts
/** Per-module array-valued option keys that a layer may override wholesale. */
const ARRAY_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": ["commands", "protectedPaths"],
	"subagent-policy": [
		"weakModelPatterns",
		"externalCliAgents",
		"nativeOnlyOptions",
		"reviewIntentPatterns",
	],
	"writer-lock": [],
	"git-evidence": [],
	"completion-diff-recheck": [],
};
```

`ConfigPatch` 的 module 條目型別放寬為所有已知陣列欄位的聯集：

```ts
export interface ConfigPatch {
	enabled?: boolean;
	modules?: Partial<
		Record<
			ModuleName,
			{
				enabled?: boolean;
				commands?: string[];
				protectedPaths?: string[];
				weakModelPatterns?: string[];
				externalCliAgents?: string[];
				nativeOnlyOptions?: string[];
				reviewIntentPatterns?: string[];
			}
		>
	>;
}
```

`validateLayer` 內把：

```ts
if (key === "hard-deny") {
	const commands = asStringArray(entry.commands);
	if (commands !== null) target.commands = commands;
	const protectedPaths = asStringArray(entry.protectedPaths);
	if (protectedPaths !== null) target.protectedPaths = protectedPaths;
}
```

改為：

```ts
for (const field of ARRAY_FIELDS[key]) {
	const value = asStringArray(entry[field as keyof typeof entry]);
	if (value !== null) (target as Record<string, string[]>)[field] = value;
}
```

`resolveConfig` 的合併迴圈內把：

```ts
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
```

改為：

```ts
for (const field of ARRAY_FIELDS[name]) {
	const value = (entry as Record<string, string[] | undefined>)[field];
	if (value !== undefined) {
		(config.modules[name] as Record<string, unknown>)[field] = value;
		provenance.modules[name] = source;
	}
}
```

`serializeExplicit` 內把：

```ts
if (name === "hard-deny") {
	const hardDeny = config.modules["hard-deny"];
	if (hardDeny.commands !== DEFAULT_CONFIG.modules["hard-deny"].commands) {
		entry.commands = hardDeny.commands;
	}
	if (hardDeny.protectedPaths !== DEFAULT_CONFIG.modules["hard-deny"].protectedPaths) {
		entry.protectedPaths = hardDeny.protectedPaths;
	}
}
```

改為：

```ts
for (const field of ARRAY_FIELDS[name]) {
	const current = (config.modules[name] as Record<string, unknown>)[field];
	const defaultValue = (DEFAULT_CONFIG.modules[name] as Record<string, unknown>)[field];
	if (current !== defaultValue) entry[field] = current;
}
```

這是值等同性（reference identity）比較，與 Stage 1 原本對 `hard-deny` 的做法一致：只要該欄位仍指向 `DEFAULT_CONFIG` 建立時的同一個陣列參照，就視為「未被任何 layer 覆寫」，不寫入檔案。

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/config.test.ts`
Expected: PASS（含新增的 6 個測試；既有 `hard-deny` 相關測試不得因通用化而變動行為）

- [ ] **Step 6: 全量迴歸**

Run: `npx vitest run`
Expected: PASS —— 確認 `ARRAY_FIELDS` 通用化沒有改變 `hard-deny` 既有行為

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat(config): subagent-policy 型別與四層來源支援，合併/序列化邏輯通用化為 ARRAY_FIELDS"
```

---

## Task 2: `decideSubagentCall` 判定核心

**Files:**
- Create: `src/modules/subagent-policy.ts`
- Test: `test/subagent-policy.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `Decision`、`SubagentPolicyOptions`、`SubagentPolicyFacts`
- Produces: `function decideSubagentCall(input: Record<string, unknown>, facts: SubagentPolicyFacts, opts: SubagentPolicyOptions): Decision`

**判定依據（design.md §5.2）**：

1. **規則 1（`:88`）**：`facts.isSubagentChild === false` 且 `facts.capabilitiesListed === false`，且呼叫是「執行型」——input 含 `agent`／`workflowScript`／`workflowScriptPath`／`workflow` 任一鍵，且不含 `action` 鍵（`action` 存在即視為管理／控制呼叫，一律放行，不受本規則約束）→ `block`。
2. **規則 2（`:91`）**：`input.model` 為非空字串且命中 `opts.weakModelPatterns`（大小寫不敏感子字串），且 `input.agent` 或 `input.task` 命中 `opts.reviewIntentPatterns`（大小寫不敏感子字串）→ `block`。`model` 未指定時完全不觸發（未指定表示用 agent 預設，不算「降級」）。
3. **規則 3（`:92`）**：`input.agent` 命中 `opts.externalCliAgents`（精確字串比對），且 input 含 `opts.nativeOnlyOptions` 任一鍵 → `block`，reason 列出全部違規欄位名（不只列第一個）。

三條規則依序評估，第一個命中即回傳；全部不命中回傳 `pass`。

- [ ] **Step 1: 寫失敗測試**

`test/subagent-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	DEFAULT_EXTERNAL_CLI_AGENTS,
	DEFAULT_NATIVE_ONLY_OPTIONS,
	DEFAULT_REVIEW_INTENT_PATTERNS,
	DEFAULT_WEAK_MODEL_PATTERNS,
} from "../src/config.js";
import { decideSubagentCall } from "../src/modules/subagent-policy.js";

const opts = {
	weakModelPatterns: DEFAULT_WEAK_MODEL_PATTERNS,
	externalCliAgents: DEFAULT_EXTERNAL_CLI_AGENTS,
	nativeOnlyOptions: DEFAULT_NATIVE_ONLY_OPTIONS,
	reviewIntentPatterns: DEFAULT_REVIEW_INTENT_PATTERNS,
};
const facts = (over: Partial<{ capabilitiesListed: boolean; isSubagentChild: boolean }> = {}) => ({
	capabilitiesListed: false,
	isSubagentChild: false,
	...over,
});

describe("規則 1（:88）— 派發前置檢查", () => {
	it("blocks an execution call before capabilities were listed", () => {
		const decision = decideSubagentCall({ agent: "worker", task: "do x" }, facts(), opts);
		expect(decision.kind).toBe("block");
	});

	it("blocks a workflowScript call before capabilities were listed", () => {
		expect(
			decideSubagentCall({ workflowScript: "return 1", async: true }, facts(), opts).kind,
		).toBe("block");
	});

	it("names the missing prerequisite in the reason", () => {
		const decision = decideSubagentCall({ agent: "worker" }, facts(), opts);
		expect(decision.kind).toBe("block");
		if (decision.kind === "block") {
			expect(decision.reason).toContain("capabilities");
			expect(decision.reason).toContain("AGENTS.md");
		}
	});

	it("passes once capabilities have been listed", () => {
		expect(
			decideSubagentCall({ agent: "worker", task: "do x" }, facts({ capabilitiesListed: true }), opts)
				.kind,
		).toBe("pass");
	});

	it("passes a management action call regardless of capabilitiesListed", () => {
		expect(decideSubagentCall({ action: "list", capabilities: true }, facts(), opts).kind).toBe(
			"pass",
		);
		expect(decideSubagentCall({ action: "status" }, facts(), opts).kind).toBe("pass");
	});

	it("is disabled inside a subagent child session", () => {
		expect(
			decideSubagentCall({ agent: "worker", task: "do x" }, facts({ isSubagentChild: true }), opts)
				.kind,
		).toBe("pass");
	});

	it("does not apply to calls that neither execute nor manage", () => {
		expect(decideSubagentCall({}, facts(), opts).kind).toBe("pass");
	});
});

describe("規則 2（:91）— 高風險不得降級", () => {
	it("blocks a review-intent agent name paired with a weak model", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review the diff", model: "anthropic/claude-haiku" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("block");
	});

	it("blocks a review-intent task paired with a weak model", () => {
		expect(
			decideSubagentCall(
				{ agent: "worker", task: "run a security audit", model: "gpt-mini" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("block");
	});

	it("passes when no model is specified", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review the diff" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a weak model for a non-review task", () => {
		expect(
			decideSubagentCall(
				{ agent: "worker", task: "summarize the README", model: "haiku" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a review task on a strong model", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review the diff", model: "opus" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});
});

describe("規則 3（:92）— external runner 不吃 native options", () => {
	it("blocks an external CLI agent given a native-only option", () => {
		const decision = decideSubagentCall(
			{ agent: "codex-exec", task: "review", model: "opus" },
			facts({ capabilitiesListed: true }),
			opts,
		);
		expect(decision.kind).toBe("block");
	});

	it("lists every violating field in the reason", () => {
		const decision = decideSubagentCall(
			{ agent: "codex-exec", task: "review", model: "opus", acceptance: { level: "checked" } },
			facts({ capabilitiesListed: true }),
			opts,
		);
		expect(decision.kind).toBe("block");
		if (decision.kind === "block") {
			expect(decision.reason).toContain("model");
			expect(decision.reason).toContain("acceptance");
		}
	});

	it("passes an external CLI agent without native-only options", () => {
		expect(
			decideSubagentCall(
				{ agent: "codex-exec", task: "review" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});

	it("passes a native agent using the same options", () => {
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review", model: "opus" },
				facts({ capabilitiesListed: true }),
				opts,
			).kind,
		).toBe("pass");
	});
});

describe("config override", () => {
	it("honours a narrowed externalCliAgents list", () => {
		const narrow = { ...opts, externalCliAgents: ["only-this-runner"] };
		expect(
			decideSubagentCall(
				{ agent: "codex-exec", task: "review", model: "opus" },
				facts({ capabilitiesListed: true }),
				narrow,
			).kind,
		).toBe("pass");
	});

	it("honours an empty weakModelPatterns list", () => {
		const noWeak = { ...opts, weakModelPatterns: [] };
		expect(
			decideSubagentCall(
				{ agent: "reviewer", task: "review", model: "haiku" },
				facts({ capabilitiesListed: true }),
				noWeak,
			).kind,
		).toBe("pass");
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/subagent-policy.test.ts`
Expected: FAIL —— `Cannot find module '../src/modules/subagent-policy.js'`

- [ ] **Step 3: 實作**

`src/modules/subagent-policy.ts`:

```ts
import type { Decision, SubagentPolicyFacts, SubagentPolicyOptions } from "../types.js";

/** Keys whose presence marks a call as execution (as opposed to management). */
const EXECUTION_KEYS: readonly string[] = ["agent", "workflowScript", "workflowScriptPath", "workflow"];

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isExecutionCall(input: Record<string, unknown>): boolean {
	if (asString(input.action) !== undefined) return false;
	return EXECUTION_KEYS.some((key) => input[key] !== undefined);
}

function matchesAny(value: string, patterns: string[]): boolean {
	const lower = value.toLowerCase();
	return patterns.some((pattern) => pattern !== "" && lower.includes(pattern.toLowerCase()));
}

function blockReason(what: string, detail: string): string {
	return [
		`[agents-guard/subagent-policy] 已阻擋：${what}`,
		`  ${detail}`,
		"  這是 AGENTS.md 的 MUST 級防線，不提供單次放行選項。",
	].join("\n");
}

export function decideSubagentCall(
	input: Record<string, unknown>,
	facts: SubagentPolicyFacts,
	opts: SubagentPolicyOptions,
): Decision {
	// Rule 1 (AGENTS.md:88): a dispatching call must first have listed
	// available agents. Management/control calls (those carrying `action`)
	// are exempt, and this rule has no downstream consumer inside a child
	// session (the parent's brief already picked the agent), so it is
	// disabled there — see design.md §5.5.
	if (!facts.isSubagentChild && !facts.capabilitiesListed && isExecutionCall(input)) {
		return {
			kind: "block",
			reason: blockReason(
				"派發前未列出可用 agent",
				"請先呼叫 { action: \"list\", capabilities: true }，確認要派發的 agent 可執行、未停用後再派發。（AGENTS.md:88）",
			),
		};
	}

	// Rule 2 (AGENTS.md:91): review/audit/security/threat work must not be
	// silently downgraded to a weak model. Only fires when `model` is given
	// explicitly — omitting it means "use the agent's own default", which is
	// not a downgrade.
	const model = asString(input.model);
	if (model !== undefined && matchesAny(model, opts.weakModelPatterns)) {
		const agent = asString(input.agent) ?? "";
		const task = asString(input.task) ?? "";
		if (matchesAny(agent, opts.reviewIntentPatterns) || matchesAny(task, opts.reviewIntentPatterns)) {
			return {
				kind: "block",
				reason: blockReason(
					"高風險任務被指定使用弱模型",
					`agent=${agent || "(未命名)"}  model=${model}  高風險 review/audit 類任務不得降級。（AGENTS.md:91）`,
				),
			};
		}
	}

	// Rule 3 (AGENTS.md:92): native-only Pi child options do not apply to
	// external CLI runners unless their contract explicitly supports them.
	const agent = asString(input.agent);
	if (agent !== undefined && opts.externalCliAgents.includes(agent)) {
		const violating = opts.nativeOnlyOptions.filter((key) => input[key] !== undefined);
		if (violating.length > 0) {
			return {
				kind: "block",
				reason: blockReason(
					"external CLI agent 收到 native-only 選項",
					`agent=${agent}  違規欄位=${violating.join(", ")}  外部 runner 不套用這些選項，除非其 contract 明示支援。（AGENTS.md:92）`,
				),
			};
		}
	}

	return { kind: "pass" };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/subagent-policy.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 刻意破壞測試以確認防護力（`AGENTS.md:65`）**

暫時把規則 1 的條件改成永遠 `false`（例如把 `isExecutionCall(input)` 改成 `false`），執行測試。

Run: `npx vitest run test/subagent-policy.test.ts`
Expected: FAIL —— 「blocks an execution call before capabilities were listed」等規則 1 案例失敗。確認測試真的在守護規則 1，還原程式碼並再次確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/modules/subagent-policy.ts test/subagent-policy.test.ts
git commit -m "feat(subagent-policy): 三條規則判定核心（派發前置檢查/高風險降級/native-only 選項）"
```

---

## Task 3: 接線進 `Runtime`（`tool_call` + `tool_result`）

**Files:**
- Modify: `src/index.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: `src/modules/subagent-policy.ts` 的 `decideSubagentCall`；`src/types.ts` 的 `SubagentPolicyFacts`
- Produces:
  - `Runtime.handleToolResult(toolName: string, input: Record<string, unknown>, isError: boolean): void` —— 觀察到 `{toolName:"subagent", input:{action:"list", capabilities:true}, isError:false}` 後，本 session 的 `capabilitiesListed` 恆為 `true`（不會被之後的呼叫重置）
  - `Runtime.handleToolCall` 對 `toolName === "subagent"` 額外套用 `subagent-policy`（`hard-deny` 若已 block 則優先回傳，不再評估 `subagent-policy`）
  - `isSubagentChild` 由 `RuntimeDeps.env.PI_SUBAGENT_CHILD === "1"` 決定（建構時定值，同一 runtime 不會變化）
  - extension entry 新增 `pi.on("tool_result", ...)` 呼叫 `handleToolResult`

- [ ] **Step 1: 寫失敗測試**

於 `test/integration.test.ts` 追加：

```ts
describe("runtime: subagent-policy 接線", () => {
	it("blocks a dispatch before capabilities were listed", () => {
		const runtime = createRuntime(deps());
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
		).toBe("block");
	});

	it("passes after tool_result observes a capabilities list", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("subagent", { action: "list", capabilities: true }, false);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
		).toBe("pass");
	});

	it("does not count a failed list call as satisfying the prerequisite", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("subagent", { action: "list", capabilities: true }, true);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
		).toBe("block");
	});

	it("does not treat an unrelated tool_result as satisfying the prerequisite", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("bash", { command: "ls" }, false);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
		).toBe("block");
	});

	it("skips rule 1 inside a subagent child session", () => {
		const runtime = createRuntime(deps({ env: { PI_SUBAGENT_CHILD: "1" } }));
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
		).toBe("pass");
	});

	it("still blocks rule 3 inside a subagent child session", () => {
		const runtime = createRuntime(deps({ env: { PI_SUBAGENT_CHILD: "1" } }));
		expect(
			runtime.handleToolCall("subagent", { agent: "codex-exec", task: "review", model: "opus" })
				.kind,
		).toBe("block");
	});

	it("module disable stops subagent-policy without affecting hard-deny", () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "subagent-policy": { enabled: false } } } }),
		);
		expect(
			runtime.handleToolCall("subagent", { agent: "worker", task: "do x" }).kind,
		).toBe("pass");
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("block");
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL —— `runtime.handleToolResult is not a function`

- [ ] **Step 3: 實作**

在 `src/index.ts` 頂部 import 新增 `decideSubagentCall`：

```ts
import { decideSubagentCall } from "./modules/subagent-policy.js";
```

`Runtime` interface 新增一個方法：

```ts
export interface Runtime {
	handleToolCall(toolName: string, input: Record<string, unknown>): Decision;
	handleToolResult(toolName: string, input: Record<string, unknown>, isError: boolean): void;
	status(): string;
	setEnabled(target: "all" | ModuleName, enabled: boolean): void;
	save(): Record<string, unknown>;
	warnings(): string[];
}
```

`createRuntime` 內，在 `failureCounts` 宣告之後新增 session 事實追蹤與 `isSubagentChild`：

```ts
const isSubagentChild = deps.env.PI_SUBAGENT_CHILD === "1";
let capabilitiesListed = false;
```

把回傳物件的 `handleToolCall` 改為同時接線兩個模組，並新增 `handleToolResult`：

```ts
	return {
		handleToolCall(toolName, input) {
			const hardDenyDecision = guarded("hard-deny", () =>
				decideHardDeny(
					toolName,
					input,
					config.modules["hard-deny"],
					deps.resolver,
				),
			);
			if (hardDenyDecision.kind === "block") return hardDenyDecision;

			if (toolName === "subagent") {
				return guarded("subagent-policy", () =>
					decideSubagentCall(
						input,
						{ capabilitiesListed, isSubagentChild },
						config.modules["subagent-policy"],
					),
				);
			}
			return { kind: "pass" };
		},
		handleToolResult(toolName, input, isError) {
			if (
				toolName === "subagent" &&
				!isError &&
				input.action === "list" &&
				input.capabilities === true
			) {
				capabilitiesListed = true;
			}
		},
		status() {
```

（其餘 `status`／`setEnabled`／`save`／`warnings` 保持不變，只是這段插入在它們之前，同一個回傳物件字面量內。）

在 extension entry（`export default function`）內，`pi.on("tool_call", ...)` 之後新增：

```ts
	pi.on("tool_result", async (event, ctx) => {
		ensureRuntime(ctx.cwd).handleToolResult(
			event.toolName,
			event.input,
			event.isError,
		);
	});
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 全量迴歸**

Run: `npx vitest run`
Expected: 全綠（Stage 1 的 85 個測試 + Stage 2 新增測試）

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/integration.test.ts
git commit -m "feat(index): 接線 subagent-policy 至 tool_call/tool_result，追蹤 capabilitiesListed"
```

---

## Task 4: 實機驗證與文件更新

**Files:**
- Modify: `README.md`（狀態表）
- Modify: `docs/design.md`（§10 決策記錄旁的模組狀態，若有需要標註完成日期）

- [ ] **Step 1: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 2: lint**

Run: `npx biome check .`
Expected: 無錯誤（若有 formatter 差異，執行 `npx biome format --write .` 後重跑測試確認仍全綠）

- [ ] **Step 3: 實機以 `pi -e` 載入，確認 `/agents-guard` 狀態顯示 `subagent-policy`**

Run（在任意暫時目錄，`-p` 印出後即結束，零副作用）：
```bash
pi -e "<REPO>/src/index.ts" -p "/agents-guard"
```
Expected: 輸出包含一行 `subagent-policy: enabled (source: default)`

- [ ] **Step 4: 實機確認規則 1 會擋下未 list 的派發、且 `/agents-guard off subagent-policy` 立即解除**

這一步驗證的是「載入到真實 pi 執行環境」這個 Stage 1 已用同樣方式驗證過的整合風險（design.md §8.2 條款 11），不是叫真實 agent 觸發違規（design.md 已記錄：子 session 的 agent 會依 AGENTS.md 主動拒絕明顯違規操作，因此這類驗證要用直接呼叫 runtime 或受控腳本，而非期待 agent 自願犯規）。用一個一次性 Node 腳本直接呼叫 `createRuntime`（與 `test/integration.test.ts` 相同的建構方式）驗證即可，不需要修改任何 pi 設定：

```bash
node --experimental-strip-types -e '
import { createRuntime } from "<REPO>/src/index.ts";
const runtime = createRuntime({
  fileConfig: undefined,
  env: process.env,
  flag: undefined,
  resolver: { cwd: process.cwd(), home: process.env.HOME, realpathSync: (p) => p },
  log: (m) => console.error(m),
});
console.log("dispatch before list:", runtime.handleToolCall("subagent", { agent: "worker", task: "x" }).kind);
runtime.setEnabled("subagent-policy", false);
console.log("dispatch after off:", runtime.handleToolCall("subagent", { agent: "worker", task: "x" }).kind);
'
```

Expected: 第一行印出 `dispatch before list: block`，第二行印出 `dispatch after off: pass`。若 Node 版本不支援 `--experimental-strip-types`，改用 `npx tsx -e '...'`（`tsx` 已透過 `vitest` 的相依鏈存在，或改寫成暫存 `.mjs` 腳本先跑 `tsc` 產出 JS 再執行）。

- [ ] **Step 5: 更新 `README.md` 狀態表**

把：

```
| `subagent-policy` | `:88` `:91` `:92` | 設計完成，待實作 |
```

改為：

```
| `subagent-policy` | `:88` `:91` `:92` | ✅ Stage 2 已實作 |
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: 更新 subagent-policy 狀態為 Stage 2 已實作"
```
