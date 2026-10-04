# agents-guard Stage 4 實作計畫：git-evidence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `git-evidence` 模組 —— 偵測 bash 工具成功執行的 `git commit`／`git push`，自動在 `tool_result` 附加驗證證據（新 commit 的 SHA/標題、本地與遠端 SHA 是否一致、可選的 CI 狀態）。**不阻擋任何操作**（`AGENTS.md:52`／`:53`）。

**Architecture:** 延續既有純函式決策核心模式。`detectGitEvents`／`formatCommitEvidence`／`formatPushEvidence`／`formatCiEvidence`／`combineEvidence` 全部是純函式（無 I/O）。唯一的 I/O 邊界是驗證命令本身的執行（`git log`／`git rev-parse`／`gh run list`），透過與 Stage 3 `detectWorktreeRoot` 相同的 `ExecFn` 注入介面完成，在 `Runtime.augmentGitEvidence`（新增的 async 方法）內呼叫，並沿用 `guarded()` 的 fail-open 精神（新增 `guardedAsync`）。

**Tech Stack:** TypeScript（既有 strict 設定）、vitest。不需新依賴。

**Spec:** `docs/design.md` §5.3（git-evidence 完整規格）、§4.4 原則 5（fail-open）、§8 測試策略

## Deviations from design.md（實作時的具體化，需記錄以免與文件產生歧義）

1. **判定函式簽章改用 `isError: boolean` 取代 `exitCode: number`**：design.md §5.3 的 `detectGitEvent(command, exitCode)` 假設 extension 能取得純數字的 exit code。實測 pi 的 `BashToolDetails`（`@earendil-works/pi-coding-agent/dist/core/tools/bash.d.ts`）只有 `truncation`／`fullOutputPath`，**沒有 exit code 欄位**；bash tool 原始碼（`bash.js:263-264`）顯示非 0 exit code 會讓 tool **拋錯**，框架把它轉成 `ToolResultEvent.isError === true`。因此本模組只能取得 `isError: boolean`，語意等價（`isError === false` 即 `exitCode === 0`），改名為 `detectGitEvents(command, isError)`（見下一條）。
2. **回傳陣列而非單一事件**：design.md 的型別是單一 `{kind:"commit"}|{kind:"push";remote?}|null`，但複合命令如 `git commit -m x && git push` 同時觸發兩種事件是常見操作序列。改為 `detectGitEvents(...): GitEvent[]`，可能同時包含 commit 與 push 兩筆，wrapper 對每筆各自產生一段證據，以 `\n\n` 串接後一起附加（仍受同一個 `maxAppendBytes` 上限）。
3. **`gh` 可用性判定簡化**：design.md 只要求「gh 不存在時跳過並註明」，未要求區分「未安裝」「未認證」「無 CI 設定」。本實作把 `gh run list -L 3` 執行失敗的**任何**情況（exec 拋錯或回傳非 0）都視為「未檢查 CI」並用同一句訊息，不額外分類。
4. **`ExecFn`（`src/lib/git.ts`）的 `options` 新增可選 `signal`**：`detectWorktreeRoot` 原本的 `options?: { cwd?: string }` 擴充為 `{ cwd?: string; signal?: AbortSignal }`，向後相容（既有呼叫端不受影響），讓 git-evidence 的驗證命令可被 `ctx.signal` 中斷（design.md §5.3「所有子命令帶 ctx.signal，可被 Esc 中斷」）。

## Global Constraints

- 沿用既有慣例：`detectGitEvents`／`format*Evidence`／`combineEvidence` 為純函式，不做 I/O、不呼叫 pi API
- 本模組**永不回傳 `block`**；唯一的輸出是要附加到 `tool_result.content` 的文字，或 `undefined`（不附加）
- 模組例外一律 fail-open（不附加證據，記錄一次性 log），不得讓驗證命令失敗癱瘓 bash 工具的正常回應
- 每次觸發最多 3 個 git 驗證命令（commit: 1 個；push: 2 個）+ 選擇性 1 個 `gh` 命令，全部帶 `ctx.signal`
- 附加內容經 `maxAppendBytes`（預設 2048）截斷
- 每個 commit 前必須 `npx vitest run` 全綠

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/lib/git.ts` | `ExecFn` 的 `options` 新增 `signal` |
| `src/types.ts` | 新增 `GitEvidenceOptions`、`GitEvent` |
| `src/config.ts` | `git-evidence` 的預設值與四層來源支援；把純量欄位的合併/序列化邏輯通用化為 `SCALAR_FIELDS`（`NUMBER_FIELDS`／`BOOLEAN_FIELDS`），並retrofit `writer-lock` 的 `heartbeatTimeoutMs` 改走同一套機制 |
| `src/modules/git-evidence.ts` | `detectGitEvents`、`formatCommitEvidence`、`formatPushEvidence`、`formatCiEvidence`、`combineEvidence` |
| `src/index.ts` | `RuntimeDeps` 新增 `gitEvidence: { exec: ExecFn }`；`Runtime` 新增 `augmentGitEvidence`；extension entry 的 `tool_result` hook 用 `isBashToolResult` narrowing 呼叫它並附加 content |
| `test/git.test.ts` | 補 `signal` 轉發測試 |
| `test/git-evidence.test.ts` | 判定核心與格式化函式的完整測試 |
| `test/integration.test.ts` | `Runtime.augmentGitEvidence` 的接線測試 |
| `test/config.test.ts` | 補 `git-evidence` 的四層來源測試 |

---

## Task 1: `ExecFn` 支援 `signal`

**Files:**
- Modify: `src/lib/git.ts`
- Test: `test/git.test.ts`

**Interfaces:**
- Produces: `type ExecFn = (command: string, args: string[], options?: { cwd?: string; signal?: AbortSignal }) => Promise<{ stdout: string; code: number }>`

- [ ] **Step 1: 寫失敗測試**

於 `test/git.test.ts` 追加：

```ts
describe("detectWorktreeRoot: signal 轉發", () => {
	it("forwards the abort signal to every exec call", async () => {
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const exec = async (
			_command: string,
			args: string[],
			options?: { cwd?: string; signal?: AbortSignal },
		) => {
			seen.push(options?.signal);
			if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
				return { stdout: "/repo\n", code: 0 };
			}
			return { stdout: "main\n", code: 0 };
		};
		await detectWorktreeRoot(exec, "/repo", controller.signal);
		expect(seen).toEqual([controller.signal, controller.signal]);
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/git.test.ts`
Expected: FAIL —— `detectWorktreeRoot` 目前只接受 2 個參數，`controller.signal` 不會被轉發（TS 也會報第 3 個參數不存在）

- [ ] **Step 3: 實作**

`src/lib/git.ts` 改為：

```ts
export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; signal?: AbortSignal },
) => Promise<{ stdout: string; code: number }>;

/**
 * Resolves the git worktree root and current branch for `cwd`. Returns null
 * for any failure — not a git repo, git missing, detached process error —
 * so the caller can treat "not in a git worktree" as "writer-lock does not
 * apply here" (design.md §5.1) without distinguishing the reason.
 */
export async function detectWorktreeRoot(
	exec: ExecFn,
	cwd: string,
	signal?: AbortSignal,
): Promise<{ root: string; branch: string } | null> {
	try {
		const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, signal });
		if (top.code !== 0) return null;
		const root = top.stdout.trim();
		if (root === "") return null;

		const branchResult = await exec(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ cwd, signal },
		);
		const branch = branchResult.code === 0 ? branchResult.stdout.trim() : "";
		return { root, branch };
	} catch {
		return null;
	}
}
```

（既有呼叫端 `detectWorktreeRoot(exec, ctx.cwd)` 省略第三參數仍相容，不需改動 `src/index.ts` 對它的呼叫。）

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/git.test.ts`
Expected: PASS（5 個測試）

- [ ] **Step 5: 全量迴歸**

Run: `npx vitest run`
Expected: 全綠

- [ ] **Step 6: Commit**

```bash
git add src/lib/git.ts test/git.test.ts
git commit -m "feat(git): ExecFn 支援可選 signal 轉發（供 git-evidence 中斷用）"
```

---

## Task 2: 型別與 config.ts 支援（含純量欄位通用化）

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: 既有 `ModuleName`、`ARRAY_FIELDS` 機制
- Produces:
  - `interface GitEvidenceOptions { maxAppendBytes: number; checkCi: boolean }`
  - `type GitEvent = { kind: "commit" } | { kind: "push"; remote?: string }`
  - `AgentsGuardConfig.modules["git-evidence"]: ModuleState & GitEvidenceOptions`
  - `const DEFAULT_MAX_APPEND_BYTES = 2048`
  - `const DEFAULT_CHECK_CI = true`
  - 新的通用機制：`NUMBER_FIELDS`、`BOOLEAN_FIELDS`（與既有 `ARRAY_FIELDS` 同構），`readNumberField`／`writeNumberField`／`readBooleanField`／`writeBooleanField`
  - `writer-lock` 的 `heartbeatTimeoutMs` 改由 `NUMBER_FIELDS` 機制處理（移除原本手寫的 `if (name === "writer-lock")` 特判）

- [ ] **Step 1: 寫失敗測試**

於 `test/config.test.ts` 追加：

```ts
describe("DEFAULT_CONFIG: git-evidence", () => {
	it("ships sane defaults", () => {
		const ge = DEFAULT_CONFIG.modules["git-evidence"];
		expect(ge.maxAppendBytes).toBe(2048);
		expect(ge.checkCi).toBe(true);
	});
});

describe("resolveConfig: git-evidence \u7d14\u91cf\u6b04\u4f4d\uff08\u901a\u7528 NUMBER_FIELDS/BOOLEAN_FIELDS\uff09", () => {
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

describe("resolveConfig: writer-lock heartbeatTimeoutMs \u4ecd\u7136\u7d93\u901a\u7528\u6a5f\u5236\u904b\u4f5c\uff08\u56de\u6ac3\uff09", () => {
	it("still overrides via file after retrofitting to NUMBER_FIELDS", () => {
		const { config, provenance } = resolveConfig({
			file: { modules: { "writer-lock": { heartbeatTimeoutMs: 5000 } } },
		});
		expect(config.modules["writer-lock"].heartbeatTimeoutMs).toBe(5000);
		expect(provenance.modules["writer-lock"]).toBe("file");
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL —— `DEFAULT_CONFIG.modules["git-evidence"].maxAppendBytes` 為 `undefined`

- [ ] **Step 3: 實作 `src/types.ts`**

在既有 `WriterLockOptions` 之後新增：

```ts
export interface GitEvidenceOptions {
	maxAppendBytes: number;
	checkCi: boolean;
}

export type GitEvent = { kind: "commit" } | { kind: "push"; remote?: string };
```

把 `AgentsGuardConfig` 的 `git-evidence` 條目改為：

```ts
"git-evidence": ModuleState & GitEvidenceOptions;
```

- [ ] **Step 4: 實作 `src/config.ts`**

新增預設值（放在 `DEFAULT_BLOCKED_TOOLS` 之後）：

```ts
export const DEFAULT_MAX_APPEND_BYTES = 2048;
export const DEFAULT_CHECK_CI = true;
```

新增與 `ARRAY_FIELDS` 同構的兩個表：

```ts
/** Per-module number-valued option keys, same generalization as ARRAY_FIELDS. */
const NUMBER_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": [],
	"subagent-policy": [],
	"writer-lock": ["heartbeatTimeoutMs"],
	"git-evidence": ["maxAppendBytes"],
	"completion-diff-recheck": [],
};

/** Per-module boolean-valued option keys, same generalization as ARRAY_FIELDS. */
const BOOLEAN_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": [],
	"subagent-policy": [],
	"writer-lock": [],
	"git-evidence": ["checkCi"],
	"completion-diff-recheck": [],
};
```

`DEFAULT_CONFIG.modules["git-evidence"]` 改為：

```ts
"git-evidence": {
	enabled: true,
	maxAppendBytes: DEFAULT_MAX_APPEND_BYTES,
	checkCi: DEFAULT_CHECK_CI,
},
```

`ConfigPatch` 的 module 條目型別新增 `maxAppendBytes?: number; checkCi?: boolean`（`heartbeatTimeoutMs?: number` 已存在，不變）。

`validateLayer` 的 `target` 型別同步新增這兩個欄位；把原本手寫的：

```ts
if (typeof entry.heartbeatTimeoutMs === "number") {
	target.heartbeatTimeoutMs = entry.heartbeatTimeoutMs;
}
```

改為通用迴圈（與 `ARRAY_FIELDS` 迴圈並列）：

```ts
for (const field of NUMBER_FIELDS[key]) {
	const value = entry[field];
	if (typeof value === "number") {
		(target as Record<string, number>)[field] = value;
	}
}
for (const field of BOOLEAN_FIELDS[key]) {
	const value = entry[field];
	if (typeof value === "boolean") {
		(target as Record<string, boolean>)[field] = value;
	}
}
```

新增讀寫 helper（放在 `readArrayField`／`writeArrayField` 之後）：

```ts
/**
 * Reads/writes a number- or boolean-valued module option by name, under the
 * same invariant as readArrayField/writeArrayField: `field` must be one of
 * NUMBER_FIELDS[name]/BOOLEAN_FIELDS[name] — the scalar keys that module's
 * own config type declares.
 */
function readNumberField(moduleConfig: unknown, field: string): number | undefined {
	// SAFETY: see readArrayField's doc comment — same invariant, scalar type.
	const value = (moduleConfig as Record<string, unknown>)[field];
	return typeof value === "number" ? value : undefined;
}

function writeNumberField(moduleConfig: unknown, field: string, value: number): void {
	// SAFETY: see readArrayField's doc comment.
	(moduleConfig as Record<string, unknown>)[field] = value;
}

function readBooleanField(moduleConfig: unknown, field: string): boolean | undefined {
	// SAFETY: see readArrayField's doc comment — same invariant, scalar type.
	const value = (moduleConfig as Record<string, unknown>)[field];
	return typeof value === "boolean" ? value : undefined;
}

function writeBooleanField(moduleConfig: unknown, field: string, value: boolean): void {
	// SAFETY: see readArrayField's doc comment.
	(moduleConfig as Record<string, unknown>)[field] = value;
}
```

`resolveConfig` 的合併迴圈，把：

```ts
if (entry.heartbeatTimeoutMs !== undefined && name === "writer-lock") {
	config.modules["writer-lock"].heartbeatTimeoutMs = entry.heartbeatTimeoutMs;
	provenance.modules[name] = source;
}
```

改為：

```ts
for (const field of NUMBER_FIELDS[name]) {
	const value = (entry as Record<string, number | undefined>)[field];
	if (value !== undefined) {
		writeNumberField(config.modules[name], field, value);
		provenance.modules[name] = source;
	}
}
for (const field of BOOLEAN_FIELDS[name]) {
	const value = (entry as Record<string, boolean | undefined>)[field];
	if (value !== undefined) {
		writeBooleanField(config.modules[name], field, value);
		provenance.modules[name] = source;
	}
}
```

`serializeExplicit`，在既有 `ARRAY_FIELDS` 迴圈之後、`writer-lock` 特判之前插入通用迴圈，並移除原本的 `if (name === "writer-lock") {...}` 特判：

```ts
for (const field of NUMBER_FIELDS[name]) {
	const current = readNumberField(config.modules[name], field);
	const defaultValue = readNumberField(DEFAULT_CONFIG.modules[name], field);
	if (current !== defaultValue) entry[field] = current;
}
for (const field of BOOLEAN_FIELDS[name]) {
	const current = readBooleanField(config.modules[name], field);
	const defaultValue = readBooleanField(DEFAULT_CONFIG.modules[name], field);
	if (current !== defaultValue) entry[field] = current;
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run test/config.test.ts`
Expected: PASS（含新增測試；既有 `writer-lock` 的 `heartbeatTimeoutMs` 測試不得因 retrofit 而變動行為）

- [ ] **Step 6: 全量迴歸**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全綠，無型別錯誤

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat(config): git-evidence 型別與四層來源支援；純量欄位合併邏輯通用化為 NUMBER_FIELDS/BOOLEAN_FIELDS（retrofit heartbeatTimeoutMs）"
```

---

## Task 3: `git-evidence` 判定與格式化核心

**Files:**
- Create: `src/modules/git-evidence.ts`
- Test: `test/git-evidence.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `GitEvent`；`src/lib/bash.ts` 的 `enumerateCommands`
- Produces:
  - `function detectGitEvents(command: string, isError: boolean): GitEvent[]`
  - `function formatCommitEvidence(logOutput: string): string`
  - `function formatPushEvidence(localSha: string, remoteSha: string | null, remote?: string): string`
  - `function formatCiEvidence(ciOutput: string | null): string`
  - `function combineEvidence(parts: string[], maxAppendBytes: number): string`

- [ ] **Step 1: 寫失敗測試**

`test/git-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	combineEvidence,
	detectGitEvents,
	formatCiEvidence,
	formatCommitEvidence,
	formatPushEvidence,
} from "../src/modules/git-evidence.js";

describe("detectGitEvents", () => {
	it("detects a successful commit", () => {
		expect(detectGitEvents("git commit -m x", false)).toEqual([{ kind: "commit" }]);
	});

	it("does not detect a failed commit", () => {
		expect(detectGitEvents("git commit -m x", true)).toEqual([]);
	});

	it("does not match a string that merely mentions git push", () => {
		expect(detectGitEvents('echo "git push"', false)).toEqual([]);
	});

	it("detects a push and captures the remote when given", () => {
		expect(detectGitEvents("git push origin main", false)).toEqual([
			{ kind: "push", remote: "origin" },
		]);
	});

	it("detects a bare push with no remote argument", () => {
		expect(detectGitEvents("git push", false)).toEqual([{ kind: "push", remote: undefined }]);
	});

	it("detects a push inside a compound command", () => {
		expect(detectGitEvents("git status && git push", false)).toEqual([
			{ kind: "push", remote: undefined },
		]);
	});

	it("detects both a commit and a push in one compound command", () => {
		expect(detectGitEvents("git commit -m x && git push", false)).toEqual([
			{ kind: "commit" },
			{ kind: "push", remote: undefined },
		]);
	});

	it("ignores unrelated git subcommands", () => {
		expect(detectGitEvents("git status", false)).toEqual([]);
		expect(detectGitEvents("git add -A", false)).toEqual([]);
	});

	it("fails open when the command cannot be parsed", () => {
		expect(detectGitEvents("echo 'unterminated", false)).toEqual([]);
	});
});

describe("formatCommitEvidence", () => {
	it("wraps the log output with a labeled header", () => {
		const text = formatCommitEvidence("a1b2c3d (HEAD -> main) fix: something");
		expect(text).toContain("[agents-guard] commit 驗證");
		expect(text).toContain("a1b2c3d (HEAD -> main) fix: something");
	});
});

describe("formatPushEvidence", () => {
	it("reports a clear match when local and remote SHAs agree", () => {
		const text = formatPushEvidence("abc123", "abc123");
		expect(text).toContain("[agents-guard] push 驗證");
		expect(text).toContain("一致");
		expect(text).toContain("abc123");
	});

	it("warns when local and remote SHAs disagree", () => {
		const text = formatPushEvidence("abc123", "def456");
		expect(text).toContain("不一致");
		expect(text).toContain("abc123");
		expect(text).toContain("def456");
	});

	it("notes a missing upstream instead of comparing", () => {
		const text = formatPushEvidence("abc123", null);
		expect(text).not.toContain("一致");
		expect(text).toContain("upstream");
	});

	it("includes the remote name when given", () => {
		expect(formatPushEvidence("abc123", "abc123", "origin")).toContain("origin");
	});
});

describe("formatCiEvidence", () => {
	it("formats real CI output", () => {
		const text = formatCiEvidence("completed\tsuccess\tci.yml\t123");
		expect(text).toContain("[agents-guard] CI");
		expect(text).toContain("completed");
	});

	it("notes that CI was not checked when gh is unavailable", () => {
		const text = formatCiEvidence(null);
		expect(text).toContain("未檢查 CI");
		expect(text).toContain("gh");
	});
});

describe("combineEvidence", () => {
	it("joins parts with a blank line when under the byte limit", () => {
		expect(combineEvidence(["a", "b"], 100)).toBe("a\n\nb");
	});

	it("truncates and notes the original length when over the limit", () => {
		const result = combineEvidence(["x".repeat(50)], 10);
		expect(result.startsWith("x".repeat(10))).toBe(true);
		expect(result).toContain("截斷");
		expect(result).toContain("50");
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/git-evidence.test.ts`
Expected: FAIL —— `Cannot find module '../src/modules/git-evidence.js'`

- [ ] **Step 3: 實作**

`src/modules/git-evidence.ts`:

```ts
import { enumerateCommands } from "../lib/bash.js";
import type { GitEvent } from "../types.js";

/**
 * Pure detector: only fires on a successful (isError === false) bash call
 * that actually invoked `git commit`/`git push` as a real subcommand —
 * never on a string that merely contains those words (`echo "git push"`).
 * Deliberately returns an array: `git commit -m x && git push` triggers
 * both events from one bash call (design.md deviation #2).
 */
export function detectGitEvents(command: string, isError: boolean): GitEvent[] {
	if (isError) return [];
	const { commands, parseFailed } = enumerateCommands(command);
	if (parseFailed) return [];

	const events: GitEvent[] = [];
	for (const parsed of commands) {
		if (parsed.name !== "git") continue;
		const sub = parsed.args[0];
		if (sub === "commit") {
			events.push({ kind: "commit" });
		} else if (sub === "push") {
			const remote = parsed.args.slice(1).find((arg) => !arg.startsWith("-"));
			events.push({ kind: "push", remote });
		}
	}
	return events;
}

export function formatCommitEvidence(logOutput: string): string {
	const trimmed = logOutput.trim();
	return [
		"--- [agents-guard] commit 驗證 ---",
		trimmed !== "" ? `HEAD: ${trimmed}` : "(無法取得 commit 資訊)",
	].join("\n");
}

export function formatPushEvidence(
	localSha: string,
	remoteSha: string | null,
	remote?: string,
): string {
	const header = `--- [agents-guard] push 驗證${remote !== undefined ? `（remote=${remote}）` : ""} ---`;
	if (remoteSha === null) {
		return [
			header,
			`local=${localSha}`,
			"無法取得上游追蹤分支（upstream 可能尚未設定），略過一致性比對。",
		].join("\n");
	}
	if (localSha === remoteSha) {
		return [header, `本地與遠端 SHA 一致：${localSha}`].join("\n");
	}
	return [
		header,
		`⚠️ 本地與遠端 SHA 不一致！local=${localSha} remote=${remoteSha}`,
	].join("\n");
}

export function formatCiEvidence(ciOutput: string | null): string {
	const header = "--- [agents-guard] CI 狀態 ---";
	if (ciOutput === null) return [header, "未檢查 CI（gh 不可用）"].join("\n");
	return [header, ciOutput.trim()].join("\n");
}

export function combineEvidence(parts: string[], maxAppendBytes: number): string {
	const combined = parts.join("\n\n");
	if (combined.length <= maxAppendBytes) return combined;
	return `${combined.slice(0, maxAppendBytes)}\n...[截斷，原長度 ${combined.length} bytes，上限 ${maxAppendBytes}]`;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/git-evidence.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 刻意破壞測試以確認防護力（`AGENTS.md:65`）**

暫時把 `detectGitEvents` 改成對 `echo "git push"` 這類字串也用 `command.includes("git push")` 子字串比對（模擬「沒用 AST 解析、直接字串比對」的錯誤實作），執行測試 → 確認「does not match a string that merely mentions git push」失敗。還原後再次確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/modules/git-evidence.ts test/git-evidence.test.ts
git commit -m "feat(git-evidence): 判定核心與格式化函式（commit/push/CI 證據，含截斷）"
```

---

## Task 4: 接線進 `Runtime` 與 extension entry

**Files:**
- Modify: `src/index.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ExecFn`；Task 3 的全部函式
- Produces:
  - `RuntimeDeps` 新增 `gitEvidence: { exec: ExecFn }`
  - `Runtime` 新增 `augmentGitEvidence(command: string, isError: boolean, signal: AbortSignal | undefined): Promise<string | undefined>`
  - extension entry 的 `tool_result` hook 用 `isBashToolResult` narrowing，成功時回傳 `{ content: [...event.content, { type: "text", text: evidence }] }`

- [ ] **Step 1: 寫失敗測試**

於 `test/integration.test.ts` 的 `deps` helper 加入預設 `gitEvidence`，並在檔案末尾追加新的 describe 區塊。

（`deps` helper 修改）：

```ts
const deps = (over: Partial<RuntimeDeps> = {}): RuntimeDeps => ({
	fileConfig: undefined,
	env: {},
	flag: undefined,
	resolver: {
		cwd: "/Users/me/project",
		home: "/Users/me",
		realpathSync: (p: string) => p,
	},
	log: vi.fn(),
	writerLock: {
		self: { sessionId: "session-default", pid: 1, host: "host-default", isSubagentChild: false },
		stateDir: mkdtempSync(join(tmpdir(), "ag-writer-lock-default-")),
		isPidAlive: () => true,
	},
	gitEvidence: {
		exec: async () => ({ stdout: "", code: 0 }),
	},
	...over,
});
```

新增測試區塊（附加在檔案末尾）：

```ts
describe("runtime: git-evidence \u63a5\u7dda", () => {
	it("appends commit evidence after a successful git commit", async () => {
		const exec = async (command: string, args: string[]) => {
			expect(command).toBe("git");
			expect(args).toEqual(["log", "-1", "--format=%H %d %s"]);
			return { stdout: "abc123 (HEAD -> main) fix: x", code: 0 };
		};
		const runtime = createRuntime(deps({ gitEvidence: { exec } }));
		const evidence = await runtime.augmentGitEvidence("git commit -m x", false, undefined);
		expect(evidence).toContain("commit \u9a57\u8b49");
		expect(evidence).toContain("abc123");
	});

	it("does not append anything for a failed commit", async () => {
		const runtime = createRuntime(deps());
		expect(await runtime.augmentGitEvidence("git commit -m x", true, undefined)).toBeUndefined();
	});

	it("does not append anything for a command that only mentions git push in a string", async () => {
		const runtime = createRuntime(deps());
		expect(await runtime.augmentGitEvidence('echo "git push"', false, undefined)).toBeUndefined();
	});

	it("reports a consistent push and skips CI when checkCi is off", async () => {
		let call = 0;
		const exec = async (command: string, args: string[]) => {
			call += 1;
			if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
				return { stdout: "abc123\n", code: 0 };
			}
			if (command === "git" && args[0] === "rev-parse" && args[1] === "@{u}") {
				return { stdout: "abc123\n", code: 0 };
			}
			throw new Error(`unexpected exec call ${call}: ${command} ${args.join(" ")}`);
		};
		const runtime = createRuntime(
			deps({
				fileConfig: { modules: { "git-evidence": { checkCi: false } } },
				gitEvidence: { exec },
			}),
		);
		const evidence = await runtime.augmentGitEvidence("git push", false, undefined);
		expect(evidence).toContain("push \u9a57\u8b49");
		expect(evidence).toContain("\u4e00\u81f4");
		expect(evidence).not.toContain("CI");
	});

	it("warns on a SHA mismatch after push", async () => {
		const exec = async (_command: string, args: string[]) => {
			if (args[1] === "HEAD") return { stdout: "abc123\n", code: 0 };
			return { stdout: "def456\n", code: 0 };
		};
		const runtime = createRuntime(
			deps({
				fileConfig: { modules: { "git-evidence": { checkCi: false } } },
				gitEvidence: { exec },
			}),
		);
		const evidence = await runtime.augmentGitEvidence("git push", false, undefined);
		expect(evidence).toContain("\u4e0d\u4e00\u81f4");
	});

	it("degrades gracefully when gh is unavailable", async () => {
		const exec = async (command: string, args: string[]) => {
			if (command === "git" && args[1] === "HEAD") return { stdout: "abc123\n", code: 0 };
			if (command === "git" && args[1] === "@{u}") return { stdout: "abc123\n", code: 0 };
			if (command === "gh") throw new Error("ENOENT: gh not found");
			throw new Error("unexpected exec call");
		};
		const runtime = createRuntime(deps({ gitEvidence: { exec } }));
		const evidence = await runtime.augmentGitEvidence("git push", false, undefined);
		expect(evidence).toContain("\u672a\u6aa2\u67e5 CI");
	});

	it("module disable stops git-evidence without affecting hard-deny", async () => {
		const runtime = createRuntime(
			deps({ fileConfig: { modules: { "git-evidence": { enabled: false } } } }),
		);
		expect(await runtime.augmentGitEvidence("git commit -m x", false, undefined)).toBeUndefined();
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("block");
	});

	it("fails open and logs when the verification exec throws unexpectedly", async () => {
		const log = vi.fn();
		const exec = async () => {
			throw new Error("boom");
		};
		const runtime = createRuntime(deps({ log, gitEvidence: { exec } }));
		expect(await runtime.augmentGitEvidence("git commit -m x", false, undefined)).toBeUndefined();
		expect(log).toHaveBeenCalledOnce();
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL —— `runtime.augmentGitEvidence is not a function`

- [ ] **Step 3: 實作**

在 `src/index.ts` 頂部新增 import：

```ts
import type { ExecFn } from "./lib/git.js";
import {
	combineEvidence,
	detectGitEvents,
	formatCiEvidence,
	formatCommitEvidence,
	formatPushEvidence,
} from "./modules/git-evidence.js";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";
```

`RuntimeDeps` 新增：

```ts
export interface RuntimeDeps {
	// ...既有欄位
	gitEvidence: { exec: ExecFn };
}
```

`Runtime` 介面新增：

```ts
	augmentGitEvidence(
		command: string,
		isError: boolean,
		signal: AbortSignal | undefined,
	): Promise<string | undefined>;
```

在 `guarded` 之後新增一個 async 版本（共用同一份 `failureCounts`）：

```ts
	const guardedAsync = async (
		name: ModuleName,
		run: () => Promise<string | undefined>,
	): Promise<string | undefined> => {
		if (!config.enabled || !config.modules[name].enabled) return undefined;
		if ((failureCounts.get(name) ?? 0) >= MAX_MODULE_FAILURES) return undefined;
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
			return undefined;
		}
	};
```

在回傳物件內（`takeoverWriterLock` 之後）新增：

```ts
		async augmentGitEvidence(command, isError, signal) {
			return guardedAsync("git-evidence", async () => {
				const events = detectGitEvents(command, isError);
				if (events.length === 0) return undefined;

				const opts = config.modules["git-evidence"];
				const cwd = deps.resolver.cwd;
				const parts: string[] = [];

				for (const event of events) {
					if (event.kind === "commit") {
						const log = await deps.gitEvidence.exec(
							"git",
							["log", "-1", "--format=%H %d %s"],
							{ cwd, signal },
						);
						parts.push(formatCommitEvidence(log.stdout));
						continue;
					}

					const head = await deps.gitEvidence.exec("git", ["rev-parse", "HEAD"], {
						cwd,
						signal,
					});
					const upstream = await deps.gitEvidence.exec(
						"git",
						["rev-parse", "@{u}"],
						{ cwd, signal },
					);
					parts.push(
						formatPushEvidence(
							head.stdout.trim(),
							upstream.code === 0 ? upstream.stdout.trim() : null,
							event.remote,
						),
					);

					if (opts.checkCi) {
						let ciOutput: string | null = null;
						try {
							const ci = await deps.gitEvidence.exec(
								"gh",
								["run", "list", "-L", "3"],
								{ cwd, signal },
							);
							ciOutput = ci.code === 0 ? ci.stdout : null;
						} catch {
							ciOutput = null;
						}
						parts.push(formatCiEvidence(ciOutput));
					}
				}

				return combineEvidence(parts, opts.maxAppendBytes);
			});
		},
		status() {
```

（把上面程式碼插在既有 `status() {` 這行**之前**，取代原本直接接續 `status()` 的位置——即在 `takeoverWriterLock` 方法之後、`status()` 方法之前插入 `augmentGitEvidence`。）

extension entry 內，把：

```ts
	pi.on("tool_result", (event, ctx) => {
		ensureRuntime(ctx.cwd).handleToolResult(
			event.toolName,
			event.input,
			event.isError,
		);
	});
```

改為：

```ts
	pi.on("tool_result", async (event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		current.handleToolResult(event.toolName, event.input, event.isError);

		if (isBashToolResult(event)) {
			const evidence = await current.augmentGitEvidence(
				event.input.command,
				event.isError,
				ctx.signal,
			);
			if (evidence !== undefined) {
				return { content: [...event.content, { type: "text", text: evidence }] };
			}
		}
		return undefined;
	});
```

`ensureRuntime` 建構 `createRuntime` 時新增 `gitEvidence` deps：

```ts
			runtime = createRuntime({
				// ...既有欄位
				gitEvidence: {
					exec: (command, args, options) => pi.exec(command, args, options),
				},
			});
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
git commit -m "feat(index): 接線 git-evidence 至 tool_result（commit/push/CI 證據附加）"
```

---

## Task 5: 實機驗證與文件更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: lint**

Run: `npx biome check .`（若有格式差異，`npx biome format --write .` 後重跑測試確認仍全綠）

- [ ] **Step 2: 實機以 `pi -e` 載入，確認 `/agents-guard` 狀態顯示 `git-evidence`**

```bash
pi -e "<REPO>/src/index.ts" -p "/agents-guard"
```
Expected: 輸出包含 `git-evidence: enabled (source: default)`

- [ ] **Step 3: 實機以隔離的暫存 git repo 驗證 commit 證據確實附加**

**不得在 `pi-agents-guard` 這個 repo 本身建立測試 commit**——用全新的暫存目錄：

```bash
tmp=$(mktemp -d)
cd "$tmp" && git init -q && git config user.email t@t.com && git config user.name t
echo hello > a.txt
pi -e "<REPO>/src/index.ts" -p "!git add a.txt && git commit -m init"
```
Expected: 輸出的 bash 工具結果應包含 `--- [agents-guard] commit 驗證 ---` 與新 commit 的 SHA。若 `-p` 的輸出格式不便肉眼確認，改用 `pi -e ... -p "!git add a.txt && git commit -m init" --json` 或檢查 session log。驗證後清除暫存目錄：`rm -rf "$tmp"`。

- [ ] **Step 4: 更新 `README.md` 狀態表與說明**

把：
```
| `git-evidence` | `:52` `:53` | 設計完成，待實作 |
```
改為：
```
| `git-evidence` | `:52` `:53` | ✅ Stage 4 已實作 |
```

新增一節「## `git-evidence` 附加規則」簡述 commit／push／CI 三種證據、`maxAppendBytes`／`checkCi` 設定、以及 Deviations 記錄的 `isError` 語意調整。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: 更新 git-evidence 狀態為 Stage 4 已實作，補附加規則說明"
```
