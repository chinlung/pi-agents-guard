# agents-guard Stage 5 實作計畫：completion-diff-recheck

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `completion-diff-recheck` 模組 —— `AGENTS.md:111` 指出「formatter／autofix／IDE watcher 可能在最後一次編輯之後才改動檔案」，本模組在 `agent_settled` 時重跑 `git status --porcelain` 比對 agent 最後觀察到的快照，有差異則顯示卡片，可選追加一輪要求 agent 修正回報。這是 `docs/design.md` §11 建議實作順序的**最後一個模組**，完成後涵蓋原始盤點的全部 5 個模組。

**Architecture:** 延續既有模式。`isWriteTool`／`isPorcelainStatusCommand`／`extractText`／`normalizePorcelain`／`decideRecheck` 為純函式。`Runtime` 內部追蹤三個 session 級狀態（`hadWrites`、`observedPorcelain`、`followUpCount`），透過既有 `handleToolResult`（擴充第四參數）更新；`agent_settled` 時，extension entry 先用 `pi.exec` 跑 `git status --porcelain` + `git diff --stat`（唯一 I/O 邊界），再呼叫 `Runtime.checkCompletionDiff`（同步）取得卡片文字與是否追加一輪。

**Tech Stack:** TypeScript（既有 strict 設定）、vitest。不需新依賴。

**Spec:** `docs/design.md` §5.4（completion-diff-recheck 完整規格）、§5.5（child session 停用）、§4.4 原則 5（fail-open）

## Deviations from design.md（實作時的具體化）

1. **`(no output)` 佔位字串正規化**：pi 內建 bash tool 對空輸出回傳字面字串 `"(no output)"`（`bash.js` 的 `formatOutput(snapshot, emptyText="(no output)")`）。agent 透過 bash 工具跑 `git status --porcelain` 觀察到的「乾淨」快照文字會是 `"(no output)"`，而本模組收尾時透過 `pi.exec` 直接執行同一命令得到的「乾淨」結果是**真正的空字串**。`normalizePorcelain` 因此把 `""` 與 `"(no output)"` 視為等價，否則兩種取得管道的「乾淨」表示法不同會造成誤判 `changed:true`。
2. **`decideRecheck` 的 `summary` 只由 porcelain 資料構成**：design.md 註明 `git diff --stat` 「僅用於卡片顯示的摘要，不參與比對判定」。因此純函式 `decideRecheck` 的 `summary` 欄位只描述 porcelain 的差異（變動檔案清單），`git diff --stat` 的輸出由 extension entry 另外附加到最終顯示的卡片文字，不進入 `decideRecheck` 的判定或其純函式輸出。
3. **顯示方式具體化為 `pi.appendEntry` + `ctx.ui.notify`，不用自訂 `registerEntryRenderer` Component**：design.md 說「顯示卡片（`pi.appendEntry`，display-only）」。`pi.appendEntry` 只負責把資料存進 session（不進 LLM context），要讓它在 TUI 「看起來像卡片」需要另外 `registerEntryRenderer` 註冊一個自訂 `Component`（`docs/tui.md`），這需要 `@earendil-works/pi-tui` 這個目前專案未設定、執行期是否能穩定 resolve 也未驗證的套件。改用本專案已在 Stage 1 驗證過、在互動與非互動模式都能正確顯示的既有 `emit` helper（`ctx.ui.notify` + 非 UI 模式 fallback `console`）做為使用者可見的顯示層，`pi.appendEntry` 則按規格持久化一筆不進 LLM context 的記錄。兩者合起來滿足「顯示但不污染 LLM context」的行為目標，且不引入新依賴風險。
4. **`guarded`／`guardedAsync` 收斂為共用的 `guardedRun`／`guardedRunAsync`**：Stage 4 的 `guardedAsync` 與既有 `guarded` 幾乎是同一段 fail-open 邏輯的兩份拷貝。Stage 5 新增第三種需要 fail-open 的同步呼叫（`checkCompletionDiff`）促成第三次重複，此時通用化：抽出 `guardedRun<T>(name, fallback, run: () => T): T` 與 `guardedRunAsync<T>(name, fallback, run: () => Promise<T>): Promise<T>`，`guarded`／`guardedAsync`／新的 completion-diff-recheck 呼叫都改呼叫這兩個通用版本，不改變任何外部可觀察行為。

## Global Constraints

- `isWriteTool`／`isPorcelainStatusCommand`／`extractText`／`normalizePorcelain`／`decideRecheck` 為純函式，不做 I/O
- 本模組**永不阻擋**任何操作；輸出只有「要不要顯示卡片」與「要不要追加一輪」
- `facts.hadWrites === false` 時完全不動作（不比對、不顯示）
- 在 `isSubagentChild === true` 的 session 完全停用（design.md §5.5：child 的卡片沒有觀看者，追加一輪浪費 child 的 turn）
- `followUp` 有 `maxFollowUpsPerSession`（預設 2）上限，防回饋循環
- 每個 commit 前必須 `npx vitest run` 全綠

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/types.ts` | 新增 `CompletionDiffRecheckOptions`、`RecheckFacts`、`RecheckResult` |
| `src/config.ts` | `completion-diff-recheck` 的預設值與四層來源支援（沿用既有 `BOOLEAN_FIELDS`／`NUMBER_FIELDS`，無需新機制） |
| `src/modules/completion-diff-recheck.ts` | `isWriteTool`、`isPorcelainStatusCommand`、`extractText`、`normalizePorcelain`、`decideRecheck` |
| `src/index.ts` | `guarded`／`guardedAsync` retrofit 為 `guardedRun`／`guardedRunAsync`；`handleToolResult` 擴充第四參數以追蹤 `hadWrites`／`observedPorcelain`；`Runtime.checkCompletionDiff`；`agent_settled` hook |
| `test/completion-diff-recheck.test.ts` | 判定核心的完整測試 |
| `test/integration.test.ts` | `Runtime.checkCompletionDiff` 與追蹤邏輯的接線測試 |
| `test/config.test.ts` | 補 `completion-diff-recheck` 的四層來源測試 |

---

## Task 1: 型別與 config.ts 支援

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface CompletionDiffRecheckOptions { followUp: boolean; maxFollowUpsPerSession: number }`
  - `interface RecheckFacts { hadWrites: boolean; followUpCount: number }`
  - `interface RecheckResult { changed: boolean; summary: string; shouldFollowUp: boolean }`
  - `AgentsGuardConfig.modules["completion-diff-recheck"]: ModuleState & CompletionDiffRecheckOptions`
  - `DEFAULT_FOLLOW_UP = false`、`DEFAULT_MAX_FOLLOW_UPS_PER_SESSION = 2`

- [ ] **Step 1: 寫失敗測試**

於 `test/config.test.ts` 追加：

```ts
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
		expect(config.modules["completion-diff-recheck"].maxFollowUpsPerSession).toBe(2);
		expect(provenance.modules["completion-diff-recheck"]).toBe("file");
	});

	it("overrides maxFollowUpsPerSession via command layer", () => {
		const { config } = resolveConfig({
			command: { modules: { "completion-diff-recheck": { maxFollowUpsPerSession: 5 } } },
		});
		expect(config.modules["completion-diff-recheck"].maxFollowUpsPerSession).toBe(5);
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL —— `DEFAULT_CONFIG.modules["completion-diff-recheck"].followUp` 為 `undefined`

- [ ] **Step 3: 實作 `src/types.ts`**

在既有 `GitEvidenceOptions`／`GitEvent` 之後新增：

```ts
export interface CompletionDiffRecheckOptions {
	followUp: boolean;
	maxFollowUpsPerSession: number;
}

export interface RecheckFacts {
	hadWrites: boolean;
	followUpCount: number;
}

export interface RecheckResult {
	changed: boolean;
	summary: string;
	shouldFollowUp: boolean;
}
```

把 `AgentsGuardConfig` 的 `completion-diff-recheck` 條目改為：

```ts
"completion-diff-recheck": ModuleState & CompletionDiffRecheckOptions;
```

- [ ] **Step 4: 實作 `src/config.ts`**

新增預設值（放在 `DEFAULT_CHECK_CI` 之後）：

```ts
export const DEFAULT_FOLLOW_UP = false;
export const DEFAULT_MAX_FOLLOW_UPS_PER_SESSION = 2;
```

擴充 `NUMBER_FIELDS`／`BOOLEAN_FIELDS`：

```ts
const NUMBER_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": [],
	"subagent-policy": [],
	"writer-lock": ["heartbeatTimeoutMs"],
	"git-evidence": ["maxAppendBytes"],
	"completion-diff-recheck": ["maxFollowUpsPerSession"],
};

const BOOLEAN_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": [],
	"subagent-policy": [],
	"writer-lock": [],
	"git-evidence": ["checkCi"],
	"completion-diff-recheck": ["followUp"],
};
```

`DEFAULT_CONFIG.modules["completion-diff-recheck"]` 改為：

```ts
"completion-diff-recheck": {
	enabled: true,
	followUp: DEFAULT_FOLLOW_UP,
	maxFollowUpsPerSession: DEFAULT_MAX_FOLLOW_UPS_PER_SESSION,
},
```

`ConfigPatch` 的 module 條目型別新增 `followUp?: boolean; maxFollowUpsPerSession?: number;`（`validateLayer` 內的 `target` 型別同步新增，通用迴圈已存在不需改動）。

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/config.test.ts && npx tsc --noEmit`
Expected: PASS，無型別錯誤

- [ ] **Step 6: 全量迴歸**

Run: `npx vitest run`
Expected: 全綠

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat(config): completion-diff-recheck 型別與四層來源支援（沿用既有 NUMBER_FIELDS/BOOLEAN_FIELDS）"
```

---

## Task 2: `completion-diff-recheck` 判定核心

**Files:**
- Create: `src/modules/completion-diff-recheck.ts`
- Test: `test/completion-diff-recheck.test.ts`

**Interfaces:**
- Consumes: `src/lib/bash.ts` 的 `enumerateCommands`；`src/types.ts` 的 `CompletionDiffRecheckOptions`／`RecheckFacts`／`RecheckResult`
- Produces:
  - `function isWriteTool(toolName: string): boolean`
  - `function isPorcelainStatusCommand(command: string): boolean`
  - `function extractText(content: readonly { type: string; text?: unknown }[]): string | undefined`
  - `function normalizePorcelain(text: string): string`
  - `function decideRecheck(observed: string | null, actual: string, facts: RecheckFacts, opts: CompletionDiffRecheckOptions): RecheckResult`

- [ ] **Step 1: 寫失敗測試**

`test/completion-diff-recheck.test.ts`:

```ts
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
		expect(isPorcelainStatusCommand('echo "git status --porcelain"')).toBe(false);
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
		expect(extractText([{ type: "image" }, { type: "text", text: "hi" }])).toBe("hi");
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
		expect(normalizePorcelain(" M a.txt \n")).toBe(normalizePorcelain(" M a.txt"));
	});

	it("preserves distinct porcelain lines", () => {
		expect(normalizePorcelain(" M a.txt\n?? b.txt")).toBe(" M a.txt\n?? b.txt");
	});
});

describe("decideRecheck", () => {
	const opts = { followUp: false, maxFollowUpsPerSession: 2 };
	const facts = (over: Partial<{ hadWrites: boolean; followUpCount: number }> = {}) => ({
		hadWrites: true,
		followUpCount: 0,
		...over,
	});

	it("does nothing when the session had no writes", () => {
		expect(decideRecheck(" M a.txt", "", facts({ hadWrites: false }), opts)).toEqual({
			changed: false,
			summary: "",
			shouldFollowUp: false,
		});
	});

	it("does nothing when there had writes but no difference", () => {
		expect(decideRecheck(" M a.txt", " M a.txt", facts(), opts).changed).toBe(false);
	});

	it("flags a difference with a summary, follow-up off", () => {
		const result = decideRecheck(" M a.txt", " M a.txt\n?? b.txt", facts(), opts);
		expect(result.changed).toBe(true);
		expect(result.summary).toContain("b.txt");
		expect(result.shouldFollowUp).toBe(false);
	});

	it("flags a difference and requests a follow-up when enabled and under the limit", () => {
		const result = decideRecheck(
			" M a.txt",
			" M a.txt\n?? b.txt",
			facts(),
			{ followUp: true, maxFollowUpsPerSession: 2 },
		);
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
		const result = decideRecheck(null, " M a.txt", facts(), { followUp: true, maxFollowUpsPerSession: 2 });
		expect(result.changed).toBe(true);
		expect(result.shouldFollowUp).toBe(false);
	});

	it("does nothing when there is no baseline and the working tree is actually clean", () => {
		expect(decideRecheck(null, "", facts(), opts).changed).toBe(false);
		expect(decideRecheck(null, "(no output)", facts(), opts).changed).toBe(false);
	});

	it("treats the bash tool's (no output) placeholder as a clean baseline", () => {
		expect(decideRecheck("(no output)", "", facts(), opts).changed).toBe(false);
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/completion-diff-recheck.test.ts`
Expected: FAIL —— `Cannot find module '../src/modules/completion-diff-recheck.js'`

- [ ] **Step 3: 實作**

`src/modules/completion-diff-recheck.ts`:

```ts
import { enumerateCommands } from "../lib/bash.js";
import type { CompletionDiffRecheckOptions, RecheckFacts, RecheckResult } from "../types.js";

const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit", "ast_grep_replace"]);

export function isWriteTool(toolName: string): boolean {
	return WRITE_TOOL_NAMES.has(toolName);
}

export function isPorcelainStatusCommand(command: string): boolean {
	const { commands, parseFailed } = enumerateCommands(command);
	if (parseFailed) return false;
	return commands.some(
		(parsed) =>
			parsed.name === "git" &&
			parsed.args[0] === "status" &&
			parsed.args.some((arg) => arg === "--porcelain" || arg.startsWith("--porcelain=")),
	);
}

export function extractText(content: readonly { type: string; text?: unknown }[]): string | undefined {
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") return block.text;
	}
	return undefined;
}

/**
 * Normalizes a porcelain snapshot for comparison. Treats an empty string and
 * the bash tool's own `"(no output)"` placeholder (see design.md deviation
 * #1) as the same "clean tree" value, and drops pure whitespace differences
 * between otherwise-identical lines.
 */
export function normalizePorcelain(text: string): string {
	const trimmed = text.trim();
	if (trimmed === "" || trimmed === "(no output)") return "";
	return trimmed
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim() !== "")
		.join("\n");
}

function buildSummary(normalizedActual: string): string {
	const lines = normalizedActual.split("\n").filter((line) => line !== "");
	return [`agent 收尾時偵測到 ${lines.length} 個檔案的狀態與最後回報不同：`, ...lines].join("\n");
}

/**
 * Pure decision core. `git diff --stat` is deliberately not an input here —
 * design.md marks it display-only, so it never participates in the verdict
 * (design.md deviation #2); the caller appends it to the displayed card.
 */
export function decideRecheck(
	observed: string | null,
	actual: string,
	facts: RecheckFacts,
	opts: CompletionDiffRecheckOptions,
): RecheckResult {
	if (!facts.hadWrites) {
		return { changed: false, summary: "", shouldFollowUp: false };
	}

	const normalizedActual = normalizePorcelain(actual);

	if (observed === null) {
		if (normalizedActual === "") {
			return { changed: false, summary: "", shouldFollowUp: false };
		}
		// No baseline to compare against — show a card, never follow up
		// (design.md §5.4: avoids false triggers on pure-analysis sessions).
		return { changed: true, summary: buildSummary(normalizedActual), shouldFollowUp: false };
	}

	const normalizedObserved = normalizePorcelain(observed);
	if (normalizedActual === normalizedObserved) {
		return { changed: false, summary: "", shouldFollowUp: false };
	}

	return {
		changed: true,
		summary: buildSummary(normalizedActual),
		shouldFollowUp: opts.followUp && facts.followUpCount < opts.maxFollowUpsPerSession,
	};
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/completion-diff-recheck.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 刻意破壞測試以確認防護力（`AGENTS.md:65`）**

暫時把 `normalizePorcelain` 內 `"(no output)"` 的特判移除，執行測試 → 確認「treats the bash tool's (no output) placeholder as a clean baseline」與「does nothing when there is no baseline and the working tree is actually clean」的第二個斷言失敗（模擬缺少此正規化會讓乾淨樹被誤判為有差異）。還原後再次確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/modules/completion-diff-recheck.ts test/completion-diff-recheck.test.ts
git commit -m "feat(completion-diff-recheck): 判定核心（porcelain 正規化/(no output) 等價/follow-up 上限）"
```

---

## Task 3: 接線進 `Runtime` 與 extension entry

**Files:**
- Modify: `src/index.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: Task 2 的全部函式
- Produces:
  - `guardedRun<T>(name: ModuleName, fallback: T, run: () => T): T`、`guardedRunAsync<T>(name: ModuleName, fallback: T, run: () => Promise<T>): Promise<T>`（`guarded`／`guardedAsync` 的 retrofit 實作，對外行為不變）
  - `Runtime.handleToolResult` 簽章擴充：`handleToolResult(toolName: string, input: Record<string, unknown>, isError: boolean, content?: readonly { type: string; text?: unknown }[]): void`
  - `Runtime.checkCompletionDiff(actualPorcelain: string, diffStat: string): { card: string; shouldFollowUp: boolean } | undefined`
  - extension entry 新增 `pi.on("agent_settled", ...)`

- [ ] **Step 1: 寫失敗測試**

於 `test/integration.test.ts` 檔案末尾追加：

```ts
describe("runtime: completion-diff-recheck 接線", () => {
	it("does nothing when the session had no writes", () => {
		const runtime = createRuntime(deps());
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
	});

	it("does nothing when there had writes but the porcelain snapshot is unchanged", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
	});

	it("returns a card without a follow-up when the snapshot changed and followUp is off", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("edit", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		const result = runtime.checkCompletionDiff(" M a.txt\n?? b.txt", " a.txt | 1 +");
		expect(result?.shouldFollowUp).toBe(false);
		expect(result?.card).toContain("b.txt");
	});

	it("requests a follow-up when the snapshot changed and followUp is on", () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "completion-diff-recheck": { followUp: true } } } }),
		);
		runtime.handleToolResult("edit", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		const result = runtime.checkCompletionDiff(" M a.txt\n?? b.txt", "");
		expect(result?.shouldFollowUp).toBe(true);
	});

	it("stops following up once the per-session limit is reached", () => {
		const runtime = createRuntime(
			deps({
				fileConfig: {
					modules: { "completion-diff-recheck": { followUp: true, maxFollowUpsPerSession: 1 } },
				},
			}),
		);
		runtime.handleToolResult("edit", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status --porcelain" },
			false,
			[{ type: "text", text: " M a.txt" }],
		);
		const first = runtime.checkCompletionDiff(" M a.txt\n?? b.txt", "");
		expect(first?.shouldFollowUp).toBe(true);
		const second = runtime.checkCompletionDiff(" M a.txt\n?? c.txt", "");
		expect(second?.shouldFollowUp).toBe(false);
	});

	it("ignores a bash command that only prints the human-readable git status", () => {
		const runtime = createRuntime(deps());
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		runtime.handleToolResult(
			"bash",
			{ command: "git status" },
			false,
			[{ type: "text", text: "nothing to commit" }],
		);
		// observed stays null — no false baseline from a human-readable call.
		expect(runtime.checkCompletionDiff("", "")).toBeUndefined();
		expect(runtime.checkCompletionDiff(" M a.txt", "")?.changed).not.toBe(false);
	});

	it("is disabled entirely inside a subagent child session", () => {
		const runtime = createRuntime(deps({ env: { PI_SUBAGENT_CHILD: "1" } }));
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
	});

	it("module disable stops completion-diff-recheck without affecting hard-deny", () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "completion-diff-recheck": { enabled: false } } } }),
		);
		runtime.handleToolResult("write", { path: "a.ts" }, false);
		expect(runtime.checkCompletionDiff(" M a.txt", "")).toBeUndefined();
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("block");
	});
});
```

> 上一個 case `runtime.checkCompletionDiff(" M a.txt", "")?.changed).not.toBe(false)` 刻意用寬鬆斷言（不要求 `true`，只要求不是 `false`）——因為前一次呼叫已經把 `observed` 設為 `null`（human-readable 呼叫不更新它），這次呼叫的期望是「有 baseline=null 且 actual 非空 → changed:true」，等同 Task 2 對 `observed===null` 分支的測試,此處只是確認接線正確轉發,不重複驗證判定細節。

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL —— `runtime.checkCompletionDiff is not a function`；`handleToolResult` 只接受 3 個參數

- [ ] **Step 3: 實作**

在 `src/index.ts` 頂部新增 import：

```ts
import {
	decideRecheck,
	extractText,
	isPorcelainStatusCommand,
	isWriteTool,
} from "./modules/completion-diff-recheck.js";
```

把既有的 `guarded`／`guardedAsync` 改為呼叫共用的通用版本（保留原名稱與原簽章給呼叫端使用，內部委派）：

```ts
	function guardedRun<T>(name: ModuleName, fallback: T, run: () => T): T {
		if (!config.enabled || !config.modules[name].enabled) return fallback;
		if ((failureCounts.get(name) ?? 0) >= MAX_MODULE_FAILURES) return fallback;
		try {
			return run();
		} catch (error) {
			const count = (failureCounts.get(name) ?? 0) + 1;
			failureCounts.set(name, count);
			const detail = error instanceof Error ? error.message : String(error);
			deps.log(
				count >= MAX_MODULE_FAILURES
					? `agents-guard: module ${name} failed ${count} times and is now inert for this session (${detail})`
					: `agents-guard: module ${name} failed open (${detail})`,
			);
			return fallback;
		}
	}

	async function guardedRunAsync<T>(
		name: ModuleName,
		fallback: T,
		run: () => Promise<T>,
	): Promise<T> {
		if (!config.enabled || !config.modules[name].enabled) return fallback;
		if ((failureCounts.get(name) ?? 0) >= MAX_MODULE_FAILURES) return fallback;
		try {
			return await run();
		} catch (error) {
			const count = (failureCounts.get(name) ?? 0) + 1;
			failureCounts.set(name, count);
			const detail = error instanceof Error ? error.message : String(error);
			deps.log(
				count >= MAX_MODULE_FAILURES
					? `agents-guard: module ${name} failed ${count} times and is now inert for this session (${detail})`
					: `agents-guard: module ${name} failed open (${detail})`,
			);
			return fallback;
		}
	}

	const guarded = (name: ModuleName, run: () => Decision): Decision =>
		guardedRun(name, { kind: "pass" } as Decision, run);

	const guardedAsync = (
		name: ModuleName,
		run: () => Promise<string | undefined>,
	): Promise<string | undefined> => guardedRunAsync(name, undefined, run);
```

（取代掉檔案內原本手寫的 `guarded`／`guardedAsync` 兩個函式定義；呼叫端 `guarded("hard-deny", ...)` 等既有寫法不需改動。）

在 `capabilitiesListed` 宣告之後新增 completion-diff-recheck 的追蹤狀態：

```ts
	let hadWrites = false;
	let observedPorcelain: string | null = null;
	let followUpCount = 0;
```

把 `handleToolResult` 改為：

```ts
		handleToolResult(toolName, input, isError, content) {
			if (
				toolName === "subagent" &&
				!isError &&
				input.action === "list" &&
				input.capabilities === true
			) {
				capabilitiesListed = true;
			}
			if (isWriteTool(toolName) && !isError) {
				hadWrites = true;
			}
			if (toolName === "bash" && !isError && content !== undefined) {
				const command = input.command;
				if (typeof command === "string" && isPorcelainStatusCommand(command)) {
					const text = extractText(content);
					if (text !== undefined) observedPorcelain = text;
				}
			}
		},
```

`Runtime` 介面的 `handleToolResult` 簽章改為：

```ts
	handleToolResult(
		toolName: string,
		input: Record<string, unknown>,
		isError: boolean,
		content?: readonly { type: string; text?: unknown }[],
	): void;
```

新增 `checkCompletionDiff`（放在 `augmentGitEvidence` 之後）：

```ts
		checkCompletionDiff(actualPorcelain, diffStat) {
			if (isSubagentChild) return undefined;
			return guardedRun("completion-diff-recheck", undefined, () => {
				const result = decideRecheck(
					observedPorcelain,
					actualPorcelain,
					{ hadWrites, followUpCount },
					config.modules["completion-diff-recheck"],
				);
				if (!result.changed) return undefined;

				const trimmedDiffStat = diffStat.trim();
				const card =
					trimmedDiffStat === ""
						? result.summary
						: `${result.summary}\n\n--- git diff --stat ---\n${trimmedDiffStat}`;

				if (result.shouldFollowUp) followUpCount += 1;
				return { card, shouldFollowUp: result.shouldFollowUp };
			});
		},
```

`Runtime` 介面新增：

```ts
	checkCompletionDiff(
		actualPorcelain: string,
		diffStat: string,
	): { card: string; shouldFollowUp: boolean } | undefined;
```

extension entry 內，`pi.on("session_shutdown", ...)` 之後新增：

```ts
	pi.on("agent_settled", async (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		const status = await pi.exec("git", ["status", "--porcelain"], {
			cwd: ctx.cwd,
			signal: ctx.signal,
		});
		if (status.code !== 0) return; // not a git repo, or git unavailable
		const diffStat = await pi.exec("git", ["diff", "--stat"], {
			cwd: ctx.cwd,
			signal: ctx.signal,
		});
		const result = current.checkCompletionDiff(
			status.stdout,
			diffStat.code === 0 ? diffStat.stdout : "",
		);
		if (result === undefined) return;

		pi.appendEntry("agents-guard-diff", { card: result.card });
		emit(ctx, `agents-guard: ${result.card}`, "warning");

		if (result.shouldFollowUp) {
			pi.sendMessage(
				{
					customType: "agents-guard-diff-followup",
					content: [
						{
							type: "text",
							text: `[agents-guard] 收尾後偵測到 git 狀態與最後回報不同（AGENTS.md:111）：\n\n${result.card}\n\n請重新確認實際變更，並修正最終回報。`,
						},
					],
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		}
	});
```

在既有 `pi.on("tool_result", ...)` 內，把：

```ts
		current.handleToolResult(event.toolName, event.input, event.isError);
```

改為：

```ts
		current.handleToolResult(
			event.toolName,
			event.input,
			event.isError,
			event.content,
		);
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 全量迴歸 + 型別檢查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全綠，無型別錯誤

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/integration.test.ts
git commit -m "feat(index): 接線 completion-diff-recheck 至 agent_settled；guarded/guardedAsync retrofit 為共用 guardedRun/guardedRunAsync"
```

---

## Task 4: 實機驗證與文件更新

**Files:**
- Modify: `README.md`
- Modify: `docs/design.md`（可選：於 §11 表格後標註全部 5 模組已完成）

- [ ] **Step 1: lint**

Run: `npx biome check .`（若有格式差異，`npx biome format --write .` 後重跑測試確認仍全綠）

- [ ] **Step 2: 實機以 `pi -e` 載入，確認 `/agents-guard` 狀態顯示 `completion-diff-recheck`**

```bash
pi -e "<REPO>/src/index.ts" -p "/agents-guard"
```
Expected: 輸出包含 `completion-diff-recheck: enabled (source: default)`

- [ ] **Step 3: 用隔離暫存 git repo 直接呼叫 `Runtime.checkCompletionDiff` 驗證端到端行為**

不透過完整 agent turn（Stage 4 已確認全域 `pi-guard` 會在非互動模式擋下 mutating 操作，且 agent_settled 需要一次完整回合才會觸發，成本高且難以在腳本中可靠複現）。改用與 Stage 4 相同手法：`npx tsx` 直接 import `createRuntime`，模擬 `handleToolResult` 觀察序列，並用真實 `child_process.execFile` 對隔離暫存 repo 跑 `git status --porcelain`／`git diff --stat`，驗證 `checkCompletionDiff` 的回傳值與卡片文字。**一次性腳本內的環境變數與暫存路徑必須在同一個 bash 呼叫內建立並使用**（Stage 4 已記錄的教訓：暫存路徑變數不會跨獨立 bash 工具呼叫存活）。

驗證後刪除暫存目錄與腳本，並確認 `pi-agents-guard`／`~/.pi/agent` 皆無非預期副作用（`git status --short`）。

- [ ] **Step 4: 更新 `README.md` 狀態表與說明**

把：
```
| `completion-diff-recheck` | `:111` `:110` | 設計完成，待實作 |
```
改為：
```
| `completion-diff-recheck` | `:111` `:110` | ✅ Stage 5 已實作 |
```

新增一節「## `completion-diff-recheck` 的行為」簡述追蹤機制、`(no output)` 正規化、`followUp` 開關與上限，並註明本檔開頭 Deviations（`pi.appendEntry` + `ctx.ui.notify` 取代自訂 Component）。

在檔案開頭或「目前狀態」表格後加一行註記：全部 5 個模組（`docs/design.md` 原始盤點）已完成。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: 更新 completion-diff-recheck 狀態為 Stage 5 已實作；agents-guard 5 個模組全部完成"
```
