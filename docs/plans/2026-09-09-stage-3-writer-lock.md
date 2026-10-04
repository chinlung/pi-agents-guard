# agents-guard Stage 3 實作計畫：writer-lock

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `writer-lock` 模組 —— 同一 git worktree 同時只有一個 session 可寫入（`AGENTS.md:56`／`:93`），衝突時唯讀降級而非彈框；正確處理 background／foreground subagent child 情境（design.md §5.5）；讀取 lock 檔時做完整性驗證（design.md §5.6 layer 3，layer 1/2 已在 Stage 1 的 `hard-deny.protectedPaths` 完成）。

**Architecture:** 延續既有純函式決策核心模式。新增 `src/lib/git.ts`（worktree root/branch 偵測，注入 `pi.exec`，唯一需要 async I/O 的部分）；`src/modules/writer-lock.ts` 內的 `parseLockFile`／`checkLockIntegrity`／`decideLockAction`／`decideReadonlyGate` 全部同步純函式（lock 檔讀寫本身是同步 fs 呼叫，只有 git 偵測需要 async，因此把「決定 worktree root」與「讀寫 lock 檔＋做決策」拆成兩個時間點：`session_start` 的 async handler 先 await git 偵測，再呼叫 `Runtime.initWriterLock`（同步）完成剩下的一切）。

**Tech Stack:** TypeScript（既有 strict 設定）、vitest、`node:crypto`（lock 檔 hash）、`node:os`（hostname）。不需新依賴。

**Spec:** `docs/design.md` §5.1（writer-lock 完整規格）、§5.5（subagent child 情境）、§5.6 layer 3（`checkLockIntegrity`，layer 1/2 已完成，見下方 Deviation）、§6.2（`config.json` schema 的 `writerLock` 區塊）、§8 測試策略

## Deviations from design.md（實作時的具體化，需記錄以免與文件產生歧義）

1. **`checkLockIntegrity` 與 `decideLockAction` 的職責邊界**：design.md §5.6 的 `LockIntegrity.invalid.why` 列了 `"schema" | "dead-pid" | "foreign-host"`，與 §5.1 `decideLockAction` 的 dead-pid／foreign-host 判定重疊。本實作把 `checkLockIntegrity` 限縮為**純粹的資料可信度判定**（schema 是否合法、mtime 是否與 heartbeat 一致、若聲稱是自己的 lock 是否與記憶中的雜湊一致），回傳 `"valid" | "invalid"（why 只有 "schema"）| "tampered"`；pid liveness／host 比對統一交給 `decideLockAction`（本來就需要 `isPidAlive` 注入）。這避免同一段邏輯寫兩次，且不改變任何外部可觀察行為——`invalid` 與後續 `decideLockAction(null, ...)` 的組合，效果等同於文件描述的「pid 已死／不同 host → invalid」。
2. **`git worktree remove` 的比對方式**：`blockedGitSubcommands` 清單允許多字子命令（如 `"worktree remove"`），比對方式是「git 命令的 args 依序 join 後，等於或以 `"<entry> "` 開頭」，不是子字串比對（`git worktree list` 不會被 `"worktree remove"` 誤擋）。
3. **`§6.2` 範例遺漏 `worktree remove`**：文件 §6.2 的 `blockedGitSubcommands` JSON 範例只列 12 項，但 §5.1 的行為敘述明確列了第 13 項 `git worktree remove`。以 §5.1 的行為敘述為準，預設清單納入 `"worktree remove"`。

## Global Constraints

- 沿用 Stage 1／2 既有慣例：所有 `decide*`／`check*`／`parse*`／`hash*`／`build*` 函式為純函式，不做檔案 I/O、不呼叫 pi API、不直接讀 `process.env`
- 唯一的 I/O／async 邊界是 `src/lib/git.ts` 的 `detectWorktreeRoot`（注入 exec 函式）；lock 檔讀寫透過 `src/state.ts` 的既有同步原子寫入 + 本階段新增的 `statMtimeMs`／`removeFile`
- 阻擋一律 `return { kind: "block", reason }`，不彈確認框；`live-holder` 唯讀狀態需要人工 `/agents-guard takeover` 才能接管，不自動接管
- 模組例外一律經由 `src/index.ts` 既有的 `guarded()` wrapper 捕捉並 fail-open
- lock 檔與其目錄以 `0600`／`0700` 建立（`writeJsonFileAtomic` 已滿足此條件，沿用）
- 每個 commit 前必須 `npx vitest run` 全綠

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/lib/git.ts` | `detectWorktreeRoot`：注入 exec 函式，回傳 `{root, branch} \| null` |
| `src/state.ts` | 新增 `statMtimeMs`、`removeFile` |
| `src/types.ts` | 新增 `LockFile`、`WriterLockSelf`、`WriterLockOptions`、`LockDecision`、`LockIntegrity` |
| `src/config.ts` | `writer-lock` 的預設值與四層來源支援（`heartbeatTimeoutMs` 純量欄位 + `blockedGitSubcommands`／`blockedTools` 透過既有 `ARRAY_FIELDS`） |
| `src/modules/writer-lock.ts` | `lockFilePath`、`buildLockFile`、`hashLockFile`、`parseLockFile`、`checkLockIntegrity`、`decideLockAction`、`decideReadonlyGate` |
| `src/index.ts` | `Runtime` 新增 `initWriterLock`／`heartbeatWriterLock`／`releaseWriterLock`／`takeoverWriterLock`；`handleToolCall` 接線唯讀閘門；extension entry 新增 `session_start` 的 async git 偵測、`turn_end` heartbeat、`session_shutdown` 釋放、`/agents-guard takeover`／`unlock` 命令 |
| `test/git.test.ts` | `detectWorktreeRoot` 測試（注入假 exec） |
| `test/state.test.ts` | 補 `statMtimeMs`／`removeFile` 測試 |
| `test/writer-lock.test.ts` | 判定核心的完整 block/pass、valid/invalid/tampered、決策表測試 |
| `test/integration.test.ts` | `Runtime` 的 writer-lock 接線測試（含 child 情境、heartbeat、釋放、takeover） |

---

## Task 1: git worktree 偵測

**Files:**
- Create: `src/lib/git.ts`
- Test: `test/git.test.ts`

**Interfaces:**
- Consumes: 無（`ExecFn` 型別自行宣告，簽章對齊 pi 的 `pi.exec(command, args, options): Promise<ExecResult>`）
- Produces:
  - `type ExecFn = (command: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; code: number }>`
  - `function detectWorktreeRoot(exec: ExecFn, cwd: string): Promise<{ root: string; branch: string } | null>`

- [ ] **Step 1: 寫失敗測試**

`test/git.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectWorktreeRoot } from "../src/lib/git.js";

function fakeExec(
	responses: Record<string, { stdout: string; code: number }>,
) {
	return async (command: string, args: string[]) => {
		const key = `${command} ${args.join(" ")}`;
		return responses[key] ?? { stdout: "", code: 1 };
	};
}

describe("detectWorktreeRoot", () => {
	it("returns the trimmed root and branch on success", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": { stdout: "/Users/me/project\n", code: 0 },
			"git rev-parse --abbrev-ref HEAD": { stdout: "main\n", code: 0 },
		});
		expect(await detectWorktreeRoot(exec, "/Users/me/project/src")).toEqual({
			root: "/Users/me/project",
			branch: "main",
		});
	});

	it("returns null when not inside a git repository", async () => {
		const exec = fakeExec({});
		expect(await detectWorktreeRoot(exec, "/tmp/not-a-repo")).toBeNull();
	});

	it("returns null when rev-parse throws", async () => {
		const exec = async () => {
			throw new Error("ENOENT: git not found");
		};
		expect(await detectWorktreeRoot(exec, "/Users/me/project")).toBeNull();
	});

	it("reports a detached HEAD as an empty branch instead of failing", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": { stdout: "/Users/me/project\n", code: 0 },
			"git rev-parse --abbrev-ref HEAD": { stdout: "HEAD\n", code: 0 },
		});
		expect(await detectWorktreeRoot(exec, "/Users/me/project")).toEqual({
			root: "/Users/me/project",
			branch: "HEAD",
		});
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/git.test.ts`
Expected: FAIL —— `Cannot find module '../src/lib/git.js'`

- [ ] **Step 3: 實作**

`src/lib/git.ts`:

```ts
export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string },
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
): Promise<{ root: string; branch: string } | null> {
	try {
		const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
		if (top.code !== 0) return null;
		const root = top.stdout.trim();
		if (root === "") return null;

		const branchResult = await exec(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			{ cwd },
		);
		const branch = branchResult.code === 0 ? branchResult.stdout.trim() : "";
		return { root, branch };
	} catch {
		return null;
	}
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/git.test.ts`
Expected: PASS（4 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/lib/git.ts test/git.test.ts
git commit -m "feat(git): worktree root/branch 偵測（注入 exec，任何失敗回傳 null）"
```

---

## Task 2: state.ts 擴充（mtime、刪除）

**Files:**
- Modify: `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: `node:fs`
- Produces:
  - `function statMtimeMs(path: string): number | null`
  - `function removeFile(path: string): void`（不存在時靜默成功，不拋錯）

- [ ] **Step 1: 寫失敗測試**

於 `test/state.test.ts` 追加：

```ts
import { statMtimeMs, removeFile } from "../src/state.js";

describe("statMtimeMs", () => {
	it("returns the file's mtime in milliseconds", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "a.json");
		writeJsonFileAtomic(file, { a: 1 });
		const mtime = statMtimeMs(file);
		expect(mtime).not.toBeNull();
		expect(mtime).toBeGreaterThan(0);
	});

	it("returns null for a missing file", () => {
		expect(statMtimeMs(join(tmpdir(), "definitely-missing-ag.json"))).toBeNull();
	});
});

describe("removeFile", () => {
	it("deletes an existing file", () => {
		const dir = mkdtempSync(join(tmpdir(), "ag-state-"));
		const file = join(dir, "a.json");
		writeJsonFileAtomic(file, { a: 1 });
		removeFile(file);
		expect(readJsonFile(file).value).toBeUndefined();
	});

	it("is a no-op for a missing file", () => {
		expect(() => removeFile(join(tmpdir(), "definitely-missing-ag.json"))).not.toThrow();
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/state.test.ts`
Expected: FAIL —— `statMtimeMs`／`removeFile` 未匯出

- [ ] **Step 3: 實作**

在 `src/state.ts` 的 import 加入 `rmSync`、`statSync`，並新增：

```ts
export function statMtimeMs(path: string): number | null {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return null;
	}
}

export function removeFile(path: string): void {
	rmSync(path, { force: true });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat(state): 新增 statMtimeMs/removeFile 供 writer-lock 使用"
```

---

## Task 3: 型別擴充

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: 既有 `ModuleState`、`Decision`
- Produces:
  - `interface LockFile { version: 1; sessionId: string; pid: number; host: string; worktreeRoot: string; branch: string; startedAt: number; heartbeatAt: number }`
  - `interface WriterLockSelf { sessionId: string; pid: number; host: string; isSubagentChild: boolean }`
  - `interface WriterLockOptions { heartbeatTimeoutMs: number; blockedGitSubcommands: string[]; blockedTools: string[] }`
  - `type LockDecision = { action: "skip" } | { action: "acquire" } | { action: "reacquire" } | { action: "share"; holder: LockFile } | { action: "takeover-stale"; why: "dead-pid" | "heartbeat-timeout" } | { action: "readonly"; holder: LockFile; why: "live-holder" | "foreign-host" }`
  - `type LockIntegrity = { kind: "valid"; lock: LockFile } | { kind: "invalid"; why: "schema" } | { kind: "tampered"; why: "mtime-ahead-of-heartbeat" | "self-lock-mismatch" }`
  - `AgentsGuardConfig.modules["writer-lock"]: ModuleState & WriterLockOptions`

沒有獨立測試檔——這批型別由 Task 5／6 的測試間接驗證（型別錯誤會讓那些測試檔在 `tsc` 階段先失敗）。

- [ ] **Step 1: 實作**

在既有 `SubagentPolicyFacts` 之後新增：

```ts
export interface LockFile {
	version: 1;
	sessionId: string;
	pid: number;
	host: string;
	worktreeRoot: string;
	branch: string;
	startedAt: number;
	heartbeatAt: number;
}

export interface WriterLockSelf {
	sessionId: string;
	pid: number;
	host: string;
	isSubagentChild: boolean;
}

export interface WriterLockOptions {
	heartbeatTimeoutMs: number;
	blockedGitSubcommands: string[];
	blockedTools: string[];
}

export type LockDecision =
	| { action: "skip" }
	| { action: "acquire" }
	| { action: "reacquire" }
	| { action: "share"; holder: LockFile }
	| { action: "takeover-stale"; why: "dead-pid" | "heartbeat-timeout" }
	| { action: "readonly"; holder: LockFile; why: "live-holder" | "foreign-host" };

export type LockIntegrity =
	| { kind: "valid"; lock: LockFile }
	| { kind: "invalid"; why: "schema" }
	| { kind: "tampered"; why: "mtime-ahead-of-heartbeat" | "self-lock-mismatch" };
```

把 `AgentsGuardConfig` 的 `writer-lock` 條目改為：

```ts
"writer-lock": ModuleState & WriterLockOptions;
```

- [ ] **Step 2: Commit（與 Task 4 合併一次 commit，因為 config.ts 需要這批型別才能編譯）**

---

## Task 4: config.ts 支援 writer-lock 選項

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: Task 3 的型別；既有 `ARRAY_FIELDS`
- Produces:
  - `const DEFAULT_HEARTBEAT_TIMEOUT_MS: number`（14400000，4h）
  - `const DEFAULT_BLOCKED_GIT_SUBCOMMANDS: string[]`
  - `const DEFAULT_BLOCKED_TOOLS: string[]`
  - `DEFAULT_CONFIG.modules["writer-lock"]` 含上述三個選項
  - `resolveConfig`／`serializeExplicit` 對 `heartbeatTimeoutMs`（純量）與另兩個陣列欄位（透過 `ARRAY_FIELDS`）的四層來源支援

- [ ] **Step 1: 寫失敗測試**

於 `test/config.test.ts` 追加：

```ts
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
			command: { modules: { "writer-lock": { blockedGitSubcommands: ["reset"] } } },
		});
		expect(config.modules["writer-lock"].blockedGitSubcommands).toEqual(["reset"]);
	});
});

describe("serializeExplicit: writer-lock", () => {
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL —— `DEFAULT_CONFIG.modules["writer-lock"].heartbeatTimeoutMs` is `undefined`

- [ ] **Step 3: 實作 `src/types.ts`（Task 3）與 `src/config.ts`**

先套用 Task 3 的型別變更，然後在 `src/config.ts`：

新增預設值（放在 `DEFAULT_REVIEW_INTENT_PATTERNS` 之後）：

```ts
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 14_400_000; // 4h

export const DEFAULT_BLOCKED_GIT_SUBCOMMANDS: string[] = [
	"checkout",
	"switch",
	"rebase",
	"merge",
	"reset",
	"stash",
	"restore",
	"clean",
	"apply",
	"cherry-pick",
	"revert",
	"commit",
	"worktree remove",
];

export const DEFAULT_BLOCKED_TOOLS: string[] = ["write", "edit", "ast_grep_replace"];
```

擴充 `ARRAY_FIELDS`：

```ts
const ARRAY_FIELDS: Record<ModuleName, readonly string[]> = {
	"hard-deny": ["commands", "protectedPaths"],
	"subagent-policy": [
		"weakModelPatterns",
		"externalCliAgents",
		"nativeOnlyOptions",
		"reviewIntentPatterns",
	],
	"writer-lock": ["blockedGitSubcommands", "blockedTools"],
	"git-evidence": [],
	"completion-diff-recheck": [],
};
```

`DEFAULT_CONFIG.modules["writer-lock"]` 改為：

```ts
"writer-lock": {
	enabled: true,
	heartbeatTimeoutMs: DEFAULT_HEARTBEAT_TIMEOUT_MS,
	blockedGitSubcommands: DEFAULT_BLOCKED_GIT_SUBCOMMANDS,
	blockedTools: DEFAULT_BLOCKED_TOOLS,
},
```

`ConfigPatch` 的 module 條目型別新增 `heartbeatTimeoutMs?: number`、`blockedGitSubcommands?: string[]`、`blockedTools?: string[]`（陣列欄位會自動透過 `ARRAY_FIELDS["writer-lock"]` 被通用邏輯處理；`heartbeatTimeoutMs` 是純量，需要像 `enabled` 一樣單獨處理）。

`validateLayer` 的 `target` 型別加上 `heartbeatTimeoutMs?: number`，並在既有 `if (typeof entry.enabled === "boolean") target.enabled = entry.enabled;` 之後加：

```ts
if (typeof entry.heartbeatTimeoutMs === "number") {
	target.heartbeatTimeoutMs = entry.heartbeatTimeoutMs;
}
```

`resolveConfig` 的合併迴圈，在既有 `if (entry.enabled !== undefined) {...}` 之後加：

```ts
if (entry.heartbeatTimeoutMs !== undefined) {
	if (name === "writer-lock") {
		config.modules["writer-lock"].heartbeatTimeoutMs = entry.heartbeatTimeoutMs;
	}
	provenance.modules[name] = source;
}
```

`serializeExplicit` 的欄位收集，在既有 `ARRAY_FIELDS` 迴圈之後加：

```ts
if (name === "writer-lock") {
	const heartbeat = config.modules["writer-lock"].heartbeatTimeoutMs;
	if (heartbeat !== DEFAULT_CONFIG.modules["writer-lock"].heartbeatTimeoutMs) {
		entry.heartbeatTimeoutMs = heartbeat;
	}
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/config.test.ts && npx tsc --noEmit`
Expected: PASS，無型別錯誤

- [ ] **Step 5: 全量迴歸**

Run: `npx vitest run`
Expected: 全綠

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat(config): writer-lock 型別、預設值與四層來源支援（heartbeatTimeoutMs 純量 + 兩個陣列欄位）"
```

---

## Task 5: `writer-lock` 判定核心

**Files:**
- Create: `src/modules/writer-lock.ts`
- Test: `test/writer-lock.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `LockFile`／`WriterLockSelf`／`WriterLockOptions`／`LockDecision`／`LockIntegrity`／`Decision`；`src/lib/bash.ts` 的 `enumerateCommands`
- Produces:
  - `function lockFilePath(worktreeRoot: string): string`（回傳檔名 `<sha256(worktreeRoot).slice(0,16)>.json`，不含目錄——目錄由呼叫端的 `stateDir` 決定）
  - `function buildLockFile(self: WriterLockSelf, worktree: { root: string; branch: string }, now: number): LockFile`
  - `function hashLockFile(lock: LockFile): string`
  - `function parseLockFile(raw: unknown): LockFile | null`
  - `function checkLockIntegrity(raw: unknown, fileMtimeMs: number, self: { sessionId: string }, lastWrittenByUs: { contentHash: string; mtimeMs: number } | null, now: number, opts: { mtimeToleranceMs: number }): LockIntegrity`
  - `function decideLockAction(current: LockFile | null, self: WriterLockSelf, now: number, opts: { heartbeatTimeoutMs: number; isPidAlive: (pid: number) => boolean }): LockDecision`
  - `function decideReadonlyGate(toolName: string, input: Record<string, unknown>, opts: WriterLockOptions): Decision`

- [ ] **Step 1: 寫失敗測試**

`test/writer-lock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildLockFile,
	checkLockIntegrity,
	decideLockAction,
	decideReadonlyGate,
	hashLockFile,
	lockFilePath,
	parseLockFile,
} from "../src/modules/writer-lock.js";
import type { LockFile } from "../src/types.js";

const baseLock: LockFile = {
	version: 1,
	sessionId: "session-a",
	pid: 100,
	host: "host-a",
	worktreeRoot: "/Users/me/project",
	branch: "main",
	startedAt: 1000,
	heartbeatAt: 1000,
};

const self = {
	sessionId: "session-b",
	pid: 200,
	host: "host-a",
	isSubagentChild: false,
};

describe("lockFilePath", () => {
	it("is a deterministic 16-char hex filename for the same root", () => {
		const a = lockFilePath("/Users/me/project");
		const b = lockFilePath("/Users/me/project");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{16}\.json$/);
	});

	it("differs for different roots", () => {
		expect(lockFilePath("/Users/me/project-a")).not.toBe(lockFilePath("/Users/me/project-b"));
	});
});

describe("buildLockFile / hashLockFile", () => {
	it("builds a lock carrying the given identity and timestamps", () => {
		const lock = buildLockFile(
			{ sessionId: "s1", pid: 1, host: "h1", isSubagentChild: false },
			{ root: "/r", branch: "main" },
			5000,
		);
		expect(lock).toEqual({
			version: 1,
			sessionId: "s1",
			pid: 1,
			host: "h1",
			worktreeRoot: "/r",
			branch: "main",
			startedAt: 5000,
			heartbeatAt: 5000,
		});
	});

	it("hashes identically for identical content and differently otherwise", () => {
		const a = buildLockFile({ sessionId: "s1", pid: 1, host: "h1", isSubagentChild: false }, { root: "/r", branch: "main" }, 5000);
		const b = { ...a };
		const c = { ...a, heartbeatAt: 6000 };
		expect(hashLockFile(a)).toBe(hashLockFile(b));
		expect(hashLockFile(a)).not.toBe(hashLockFile(c));
	});
});

describe("parseLockFile", () => {
	it("accepts a well-formed lock", () => {
		expect(parseLockFile(baseLock)).toEqual(baseLock);
	});

	it("rejects missing or mistyped fields", () => {
		expect(parseLockFile(null)).toBeNull();
		expect(parseLockFile({ ...baseLock, pid: "100" })).toBeNull();
		expect(parseLockFile({ ...baseLock, version: 2 })).toBeNull();
		const { sessionId, ...withoutSessionId } = baseLock;
		expect(parseLockFile(withoutSessionId)).toBeNull();
	});
});

describe("checkLockIntegrity", () => {
	const opts = { mtimeToleranceMs: 5000 };

	it("is valid for well-formed content within the mtime tolerance", () => {
		expect(
			checkLockIntegrity(baseLock, baseLock.heartbeatAt + 1000, { sessionId: "session-x" }, null, 20_000, opts).kind,
		).toBe("valid");
	});

	it("is invalid for a schema violation", () => {
		expect(
			checkLockIntegrity({ bogus: true }, 1000, { sessionId: "session-x" }, null, 20_000, opts).kind,
		).toBe("invalid");
	});

	it("is tampered when the file mtime is well ahead of the recorded heartbeat", () => {
		const result = checkLockIntegrity(
			baseLock,
			baseLock.heartbeatAt + 60_000,
			{ sessionId: "session-x" },
			null,
			70_000,
			opts,
		);
		expect(result).toEqual({ kind: "tampered", why: "mtime-ahead-of-heartbeat" });
	});

	it("is tampered when a lock claiming to be ours does not match what we last wrote", () => {
		const ownLock = { ...baseLock, sessionId: "session-b" };
		const result = checkLockIntegrity(
			ownLock,
			ownLock.heartbeatAt,
			{ sessionId: "session-b" },
			{ contentHash: "not-the-real-hash", mtimeMs: ownLock.heartbeatAt },
			ownLock.heartbeatAt,
			opts,
		);
		expect(result).toEqual({ kind: "tampered", why: "self-lock-mismatch" });
	});

	it("does not flag self-lock-mismatch before we have ever written anything", () => {
		const ownLock = { ...baseLock, sessionId: "session-b" };
		expect(
			checkLockIntegrity(ownLock, ownLock.heartbeatAt, { sessionId: "session-b" }, null, ownLock.heartbeatAt, opts)
				.kind,
		).toBe("valid");
	});

	it("does not flag self-lock-mismatch for a lock that is not ours", () => {
		expect(
			checkLockIntegrity(
				baseLock,
				baseLock.heartbeatAt,
				{ sessionId: "session-x" },
				{ contentHash: "irrelevant", mtimeMs: 1 },
				baseLock.heartbeatAt,
				opts,
			).kind,
		).toBe("valid");
	});
});

describe("decideLockAction", () => {
	const opts = { heartbeatTimeoutMs: 4 * 60 * 60 * 1000, isPidAlive: (pid: number) => pid === 100 };

	it("skips entirely inside a subagent child session", () => {
		expect(decideLockAction(baseLock, { ...self, isSubagentChild: true }, 2000, opts)).toEqual({
			action: "skip",
		});
	});

	it("acquires when there is no current lock", () => {
		expect(decideLockAction(null, self, 2000, opts)).toEqual({ action: "acquire" });
	});

	it("reacquires its own lock", () => {
		expect(decideLockAction({ ...baseLock, sessionId: self.sessionId }, self, 2000, opts)).toEqual({
			action: "reacquire",
		});
	});

	it("shares with another session in the same process (foreground child)", () => {
		expect(decideLockAction(baseLock, { ...self, pid: baseLock.pid }, 2000, opts)).toEqual({
			action: "share",
			holder: baseLock,
		});
	});

	it("goes readonly for a foreign host regardless of pid liveness", () => {
		expect(decideLockAction({ ...baseLock, host: "host-z" }, self, 2000, opts)).toEqual({
			action: "readonly",
			holder: { ...baseLock, host: "host-z" },
			why: "foreign-host",
		});
	});

	it("takes over a lock whose pid is dead", () => {
		expect(decideLockAction({ ...baseLock, pid: 999 }, self, 2000, opts)).toEqual({
			action: "takeover-stale",
			why: "dead-pid",
		});
	});

	it("takes over a lock whose heartbeat has timed out even though the pid is alive", () => {
		const stale = { ...baseLock, heartbeatAt: 0 };
		expect(decideLockAction(stale, self, opts.heartbeatTimeoutMs + 1000, opts)).toEqual({
			action: "takeover-stale",
			why: "heartbeat-timeout",
		});
	});

	it("stays readonly for a live holder with a fresh heartbeat", () => {
		expect(decideLockAction(baseLock, self, 2000, opts)).toEqual({
			action: "readonly",
			holder: baseLock,
			why: "live-holder",
		});
	});
});

describe("decideReadonlyGate", () => {
	const opts = {
		heartbeatTimeoutMs: 0,
		blockedGitSubcommands: [
			"checkout",
			"rebase",
			"reset",
			"commit",
			"worktree remove",
		],
		blockedTools: ["write", "edit", "ast_grep_replace"],
	};

	it("blocks a gated tool", () => {
		expect(decideReadonlyGate("write", { path: "a.ts" }, opts).kind).toBe("block");
		expect(decideReadonlyGate("edit", { path: "a.ts" }, opts).kind).toBe("block");
		expect(decideReadonlyGate("ast_grep_replace", { path: "a.ts" }, opts).kind).toBe("block");
	});

	it("passes a read-only tool", () => {
		expect(decideReadonlyGate("read", { path: "a.ts" }, opts).kind).toBe("pass");
		expect(decideReadonlyGate("grep", { pattern: "x" }, opts).kind).toBe("pass");
	});

	it("blocks a dangerous git subcommand", () => {
		expect(decideReadonlyGate("bash", { command: "git checkout main" }, opts).kind).toBe("block");
		expect(decideReadonlyGate("bash", { command: "git reset --hard" }, opts).kind).toBe("block");
	});

	it("blocks a two-word git subcommand precisely (not a substring match)", () => {
		expect(decideReadonlyGate("bash", { command: "git worktree remove ../x" }, opts).kind).toBe(
			"block",
		);
		expect(decideReadonlyGate("bash", { command: "git worktree list" }, opts).kind).toBe("pass");
	});

	it("blocks a dangerous git subcommand through a compound command", () => {
		expect(decideReadonlyGate("bash", { command: "git status && git commit -m x" }, opts).kind).toBe(
			"block",
		);
	});

	it("passes a read-only git command", () => {
		expect(decideReadonlyGate("bash", { command: "git status" }, opts).kind).toBe("pass");
		expect(decideReadonlyGate("bash", { command: "git log -1" }, opts).kind).toBe("pass");
		expect(decideReadonlyGate("bash", { command: "npm test" }, opts).kind).toBe("pass");
	});

	it("fails open when the bash command cannot be parsed", () => {
		expect(decideReadonlyGate("bash", { command: "echo 'unterminated" }, opts).kind).toBe("pass");
	});

	it("honours a narrowed config", () => {
		const narrow = { ...opts, blockedGitSubcommands: [], blockedTools: [] };
		expect(decideReadonlyGate("write", { path: "a.ts" }, narrow).kind).toBe("pass");
		expect(decideReadonlyGate("bash", { command: "git checkout main" }, narrow).kind).toBe("pass");
	});
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/writer-lock.test.ts`
Expected: FAIL —— `Cannot find module '../src/modules/writer-lock.js'`

- [ ] **Step 3: 實作**

`src/modules/writer-lock.ts`:

```ts
import { createHash } from "node:crypto";
import { enumerateCommands } from "../lib/bash.js";
import type {
	Decision,
	LockDecision,
	LockFile,
	LockIntegrity,
	WriterLockOptions,
	WriterLockSelf,
} from "../types.js";

export function lockFilePath(worktreeRoot: string): string {
	const digest = createHash("sha256").update(worktreeRoot).digest("hex");
	return `${digest.slice(0, 16)}.json`;
}

export function buildLockFile(
	self: WriterLockSelf,
	worktree: { root: string; branch: string },
	now: number,
): LockFile {
	return {
		version: 1,
		sessionId: self.sessionId,
		pid: self.pid,
		host: self.host,
		worktreeRoot: worktree.root,
		branch: worktree.branch,
		startedAt: now,
		heartbeatAt: now,
	};
}

/** Stable content hash so a later read can detect an out-of-band rewrite. */
export function hashLockFile(lock: LockFile): string {
	return createHash("sha256").update(JSON.stringify(lock)).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

export function parseLockFile(raw: unknown): LockFile | null {
	if (raw === null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	if (record.version !== 1) return null;
	if (!isNonEmptyString(record.sessionId)) return null;
	if (typeof record.pid !== "number" || !Number.isInteger(record.pid)) return null;
	if (!isNonEmptyString(record.host)) return null;
	if (!isNonEmptyString(record.worktreeRoot)) return null;
	if (typeof record.branch !== "string") return null;
	if (typeof record.startedAt !== "number") return null;
	if (typeof record.heartbeatAt !== "number") return null;
	return {
		version: 1,
		sessionId: record.sessionId,
		pid: record.pid,
		host: record.host,
		worktreeRoot: record.worktreeRoot,
		branch: record.branch,
		startedAt: record.startedAt,
		heartbeatAt: record.heartbeatAt,
	};
}

/**
 * Pure data-trust check for a lock file, independent of what decideLockAction
 * later does with a trusted lock. See docs/plans/2026-09-09-stage-3-writer-lock.md
 * "Deviations" #1 for why pid-liveness/host checks live in decideLockAction
 * instead of here.
 */
export function checkLockIntegrity(
	raw: unknown,
	fileMtimeMs: number,
	self: { sessionId: string },
	lastWrittenByUs: { contentHash: string; mtimeMs: number } | null,
	_now: number,
	opts: { mtimeToleranceMs: number },
): LockIntegrity {
	const lock = parseLockFile(raw);
	if (lock === null) return { kind: "invalid", why: "schema" };

	if (fileMtimeMs - lock.heartbeatAt > opts.mtimeToleranceMs) {
		return { kind: "tampered", why: "mtime-ahead-of-heartbeat" };
	}

	if (lock.sessionId === self.sessionId && lastWrittenByUs !== null) {
		if (hashLockFile(lock) !== lastWrittenByUs.contentHash) {
			return { kind: "tampered", why: "self-lock-mismatch" };
		}
	}

	return { kind: "valid", lock };
}

/**
 * The decision table from design.md §5.1. `current` must already have
 * passed checkLockIntegrity (an "invalid" read is passed in as null; a
 * "tampered" read must not reach this function at all — the caller stays
 * readonly and asks for manual `/agents-guard takeover`/`unlock`).
 */
export function decideLockAction(
	current: LockFile | null,
	self: WriterLockSelf,
	now: number,
	opts: { heartbeatTimeoutMs: number; isPidAlive: (pid: number) => boolean },
): LockDecision {
	if (self.isSubagentChild) return { action: "skip" };
	if (current === null) return { action: "acquire" };
	if (current.sessionId === self.sessionId) return { action: "reacquire" };
	if (current.host === self.host && current.pid === self.pid) {
		return { action: "share", holder: current };
	}
	if (current.host !== self.host) {
		return { action: "readonly", holder: current, why: "foreign-host" };
	}
	if (!opts.isPidAlive(current.pid)) {
		return { action: "takeover-stale", why: "dead-pid" };
	}
	if (now - current.heartbeatAt > opts.heartbeatTimeoutMs) {
		return { action: "takeover-stale", why: "heartbeat-timeout" };
	}
	return { action: "readonly", holder: current, why: "live-holder" };
}

function gitSubcommandBlocked(args: string[], blocked: string[]): boolean {
	const joined = args.join(" ");
	return blocked.some((entry) => joined === entry || joined.startsWith(`${entry} `));
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function blockReason(what: string, detail: string): string {
	return [
		`[agents-guard/writer-lock] 已阻擋：${what}`,
		`  ${detail}`,
		"  此 worktree 目前是唯讀模式；要接管請由操作者執行 /agents-guard takeover，或改用隔離 worktree（AGENTS.md:93）。",
	].join("\n");
}

/** Only called while the session is in readonly mode (see design.md §5.1). */
export function decideReadonlyGate(
	toolName: string,
	input: Record<string, unknown>,
	opts: WriterLockOptions,
): Decision {
	if (opts.blockedTools.includes(toolName)) {
		return {
			kind: "block",
			reason: blockReason(`${toolName} 需要寫入權限`, `tool=${toolName}`),
		};
	}

	if (toolName !== "bash") return { kind: "pass" };
	const command = asString(input.command);
	if (command === undefined) return { kind: "pass" };

	const { commands, parseFailed } = enumerateCommands(command);
	if (parseFailed) return { kind: "pass" };

	for (const parsed of commands) {
		if (parsed.name === "git" && gitSubcommandBlocked(parsed.args, opts.blockedGitSubcommands)) {
			return {
				kind: "block",
				reason: blockReason(
					"危險的 git 子命令",
					`命令=git ${parsed.args.join(" ")}`,
				),
			};
		}
	}
	return { kind: "pass" };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/writer-lock.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 刻意破壞測試以確認防護力（`AGENTS.md:65`）**

暫時把 `decideLockAction` 的 `pid === self.pid` share 分支條件改成永遠 `false`，執行測試 → 確認「shares with another session in the same process」失敗（模擬缺少此規則會讓每個 foreground child 被誤判為 `live-holder` 而唯讀降級——design.md §5.1 明確指出這是必要規則）。還原後再次確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/modules/writer-lock.ts test/writer-lock.test.ts
git commit -m "feat(writer-lock): 判定核心（lock 完整性/決策表/唯讀閘門）"
```

---

## Task 6: 接線進 `Runtime` 與 extension entry

**Files:**
- Modify: `src/index.ts`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `detectWorktreeRoot`；Task 2 的 `statMtimeMs`／`removeFile`；Task 5 的全部函式
- Produces:
  - `RuntimeDeps` 新增 `writerLock: { self: WriterLockSelf; stateDir: string; isPidAlive: (pid: number) => boolean }`
  - `Runtime` 新增：
    - `initWriterLock(worktree: { root: string; branch: string } | null, now: number): { level: "info" | "warning" | "error"; message: string } | undefined`
    - `heartbeatWriterLock(now: number): void`
    - `releaseWriterLock(): void`
    - `takeoverWriterLock(worktree: { root: string; branch: string }, now: number): { level: "info" | "warning" | "error"; message: string }`
  - `handleToolCall` 在 hard-deny 之後、subagent-policy 之前插入唯讀閘門

**設計說明**：git 偵測是唯一的 async 邊界，因此拆成兩段——extension entry 的 `session_start` handler（已是 `async`）先 `await detectWorktreeRoot(...)`，再呼叫 `Runtime.initWriterLock`（同步：讀 lock 檔、`checkLockIntegrity`、`decideLockAction`、寫入或不寫入、回傳要顯示的訊息）。`Runtime` 內部用一個私有欄位記錄目前模式（`"uninitialized" | "disabled" | "skip" | "writer" | "share" | "readonly"`），`handleToolCall` 只在 `"readonly"` 時呼叫 `decideReadonlyGate`。

- [ ] **Step 1: 寫失敗測試**

於 `test/integration.test.ts` 頂部的 `deps` helper 之後、既有 describe 區塊之後追加（`deps` helper 需要擴充預設 `writerLock`；`lockDir` 用暫存目錄，兩個 runtime 共用同一個 `stateDir` 即可模擬同一 worktree）：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function writerLockDeps(over: Partial<{
	self: { sessionId: string; pid: number; host: string; isSubagentChild: boolean };
	isPidAlive: (pid: number) => boolean;
}> = {}) {
	return {
		self: { sessionId: "session-a", pid: 111, host: "host-a", isSubagentChild: false },
		stateDir: mkdtempSync(join(tmpdir(), "ag-writer-lock-")),
		isPidAlive: () => true,
		...over,
	};
}

describe("runtime: writer-lock 接線", () => {
	it("acquires the lock in a fresh worktree and allows writes", () => {
		const runtime = createRuntime(deps({ writerLock: writerLockDeps() }));
		expect(runtime.initWriterLock({ root: "/repo", branch: "main" }, 1000)).toBeUndefined();
		expect(runtime.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
	});

	it("does nothing when the cwd is not a git worktree", () => {
		const runtime = createRuntime(deps({ writerLock: writerLockDeps() }));
		expect(runtime.initWriterLock(null, 1000)).toBeUndefined();
		expect(runtime.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
		expect(runtime.handleToolCall("bash", { command: "git checkout main" }).kind).toBe("pass");
	});

	it("goes readonly for a live foreign holder and blocks writes/dangerous git", () => {
		const lockDir = mkdtempSync(join(tmpdir(), "ag-writer-lock-"));
		const holder = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-a", pid: 111, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		holder.initWriterLock({ root: "/repo", branch: "main" }, 1000);

		const second = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-b", pid: 222, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		const notice = second.initWriterLock({ root: "/repo", branch: "main" }, 1500);
		expect(notice?.level).toBe("warning");
		expect(second.handleToolCall("write", { path: "a.ts" }).kind).toBe("block");
		expect(second.handleToolCall("bash", { command: "git checkout main" }).kind).toBe("block");
		expect(second.handleToolCall("read", { path: "a.ts" }).kind).toBe("pass");
		expect(second.handleToolCall("bash", { command: "git status" }).kind).toBe("pass");
	});

	it("shares writer status with another session in the same process (same pid)", () => {
		const lockDir = mkdtempSync(join(tmpdir(), "ag-writer-lock-"));
		const holder = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-a", pid: 111, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		holder.initWriterLock({ root: "/repo", branch: "main" }, 1000);

		const child = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-child", pid: 111, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		expect(child.initWriterLock({ root: "/repo", branch: "main" }, 1500)).toBeUndefined();
		expect(child.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");

		child.releaseWriterLock();
		expect(holder.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
	});

	it("takes over a lock whose pid is dead, and can then write", () => {
		const lockDir = mkdtempSync(join(tmpdir(), "ag-writer-lock-"));
		const deadHolder = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-dead", pid: 999, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		deadHolder.initWriterLock({ root: "/repo", branch: "main" }, 1000);

		const successor = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-live", pid: 111, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: (pid) => pid !== 999,
				},
			}),
		);
		const notice = successor.initWriterLock({ root: "/repo", branch: "main" }, 2000);
		expect(notice?.level).toBe("warning");
		expect(successor.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
	});

	it("skips entirely for a background subagent child", () => {
		const runtime = createRuntime(
			deps({ env: { PI_SUBAGENT_CHILD: "1" }, writerLock: writerLockDeps() }),
		);
		expect(runtime.initWriterLock({ root: "/repo", branch: "main" }, 1000)).toBeUndefined();
		expect(runtime.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
		expect(runtime.handleToolCall("bash", { command: "git checkout main" }).kind).toBe("pass");
	});

	it("heartbeat keeps a held lock fresh, and release lets a new session acquire cleanly", () => {
		const lockDir = mkdtempSync(join(tmpdir(), "ag-writer-lock-"));
		const runtime = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-a", pid: 111, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		runtime.initWriterLock({ root: "/repo", branch: "main" }, 1000);
		runtime.heartbeatWriterLock(2000);
		runtime.releaseWriterLock();

		const again = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-b", pid: 222, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		expect(again.initWriterLock({ root: "/repo", branch: "main" }, 3000)).toBeUndefined();
		expect(again.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
	});

	it("takeover command lets an operator force writer status over a live holder", () => {
		const lockDir = mkdtempSync(join(tmpdir(), "ag-writer-lock-"));
		const holder = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-a", pid: 111, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		holder.initWriterLock({ root: "/repo", branch: "main" }, 1000);

		const operatorSession = createRuntime(
			deps({
				writerLock: {
					self: { sessionId: "session-b", pid: 222, host: "host-a", isSubagentChild: false },
					stateDir: lockDir,
					isPidAlive: () => true,
				},
			}),
		);
		operatorSession.initWriterLock({ root: "/repo", branch: "main" }, 1500);
		expect(operatorSession.handleToolCall("write", { path: "a.ts" }).kind).toBe("block");

		operatorSession.takeoverWriterLock({ root: "/repo", branch: "main" }, 1600);
		expect(operatorSession.handleToolCall("write", { path: "a.ts" }).kind).toBe("pass");
	});

	it("module disable stops writer-lock without affecting hard-deny", () => {
		const runtime = createRuntime(
			deps({
				fileConfig: { modules: { "writer-lock": { enabled: false } } },
				writerLock: writerLockDeps(),
			}),
		);
		runtime.initWriterLock({ root: "/repo", branch: "main" }, 1000);
		expect(runtime.handleToolCall("bash", { command: "git add -A" }).kind).toBe("block");
	});
});
```


- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL —— `runtime.initWriterLock is not a function`

- [ ] **Step 3: 實作**

在 `src/index.ts` 頂部新增 import：

```ts
import {
	buildLockFile,
	checkLockIntegrity,
	decideLockAction,
	decideReadonlyGate,
	hashLockFile,
	lockFilePath,
} from "./modules/writer-lock.js";
import { readJsonFile, removeFile, resolveStateDir, statMtimeMs, writeJsonFileAtomic } from "./state.js";
import type { LockFile, WriterLockSelf } from "./types.js";
import { join } from "node:path";
```

`RuntimeDeps` 新增：

```ts
export interface RuntimeDeps {
	fileConfig: unknown;
	env: Record<string, string | undefined>;
	flag: string | undefined;
	resolver: PathResolver;
	log: (message: string) => void;
	writerLock: {
		self: WriterLockSelf;
		stateDir: string;
		isPidAlive: (pid: number) => boolean;
	};
}
```

`Runtime` 介面新增四個方法（型別如 Task 6 標頭所列）。

在 `createRuntime` 內，`capabilitiesListed` 宣告之後，新增 writer-lock 的內部狀態：

```ts
type WriterLockMode = "uninitialized" | "disabled" | "skip" | "writer" | "share" | "readonly";
let writerLockMode: WriterLockMode = "uninitialized";
let selfLock: LockFile | undefined;
let selfLockWritten: { contentHash: string; mtimeMs: number } | undefined;
const lockPath = join(deps.writerLock.stateDir, "locks", "PLACEHOLDER");
```

（`lockPath` 要等 `initWriterLock` 拿到 `worktreeRoot` 才能算出真正檔名，因此改成一個 helper 函式 `resolveLockPath(root: string)` 而不是頂層常數：）

```ts
const resolveLockPath = (worktreeRoot: string): string =>
	join(deps.writerLock.stateDir, "locks", lockFilePath(worktreeRoot));

const writeSelfLock = (lock: LockFile): void => {
	const path = resolveLockPath(lock.worktreeRoot);
	writeJsonFileAtomic(path, lock);
	const mtimeMs = statMtimeMs(path) ?? lock.heartbeatAt;
	selfLock = lock;
	selfLockWritten = { contentHash: hashLockFile(lock), mtimeMs };
};
```

在回傳物件字面量內（`handleToolResult` 之後），新增四個方法，並修改 `handleToolCall`：

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

			if (writerLockMode === "readonly") {
				const writerLockDecision = guarded("writer-lock", () =>
					decideReadonlyGate(toolName, input, config.modules["writer-lock"]),
				);
				if (writerLockDecision.kind === "block") return writerLockDecision;
			}

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
		initWriterLock(worktree, now) {
			if (!config.enabled || !config.modules["writer-lock"].enabled) {
				writerLockMode = "disabled";
				return undefined;
			}
			if (worktree === null) {
				writerLockMode = "disabled";
				return undefined;
			}
			const path = resolveLockPath(worktree.root);
			const read = readJsonFile(path);
			const fileMtimeMs = statMtimeMs(path);

			let current: LockFile | null = null;
			let integrityWarning: string | undefined;
			if (read.value !== undefined && fileMtimeMs !== null) {
				const integrity = checkLockIntegrity(
					read.value,
					fileMtimeMs,
					{ sessionId: deps.writerLock.self.sessionId },
					selfLockWritten ?? null,
					now,
					{ mtimeToleranceMs: 5000 },
				);
				if (integrity.kind === "valid") {
					current = integrity.lock;
				} else if (integrity.kind === "invalid") {
					integrityWarning = `agents-guard: ignoring an unreadable writer-lock file (${integrity.why})`;
				} else {
					writerLockMode = "readonly";
					return {
						level: "error",
						message: `agents-guard: writer-lock 檔案疑似被非 agents-guard 的程式修改（${integrity.why}），已進入唯讀模式。請用 /agents-guard takeover 或 /agents-guard unlock 人工裁決。`,
					};
				}
			}

			const decision = decideLockAction(current, deps.writerLock.self, now, {
				heartbeatTimeoutMs: config.modules["writer-lock"].heartbeatTimeoutMs,
				isPidAlive: deps.writerLock.isPidAlive,
			});

			switch (decision.action) {
				case "skip":
					writerLockMode = "skip";
					return undefined;
				case "acquire":
				case "reacquire":
					writerLockMode = "writer";
					writeSelfLock(buildLockFile(deps.writerLock.self, worktree, now));
					return integrityWarning !== undefined ? { level: "warning", message: integrityWarning } : undefined;
				case "takeover-stale":
					writerLockMode = "writer";
					writeSelfLock(buildLockFile(deps.writerLock.self, worktree, now));
					return {
						level: "warning",
						message: `agents-guard: 前一個 writer 已失效（${decision.why}），已自動接管此 worktree 的 writer 身分。`,
					};
				case "share":
					writerLockMode = "share";
					return undefined;
				case "readonly":
					writerLockMode = "readonly";
					return {
						level: "warning",
						message: `agents-guard: 唯讀模式 —— 此 worktree 的 writer 是另一個 session（sessionId=${decision.holder.sessionId} pid=${decision.holder.pid} branch=${decision.holder.branch}）。要接管請執行 /agents-guard takeover，或改用隔離 worktree（AGENTS.md:93）。`,
					};
			}
		},
		heartbeatWriterLock(now) {
			if (writerLockMode !== "writer" || selfLock === undefined) return;
			writeSelfLock({ ...selfLock, heartbeatAt: now });
		},
		releaseWriterLock() {
			if (writerLockMode === "writer" && selfLock !== undefined) {
				removeFile(resolveLockPath(selfLock.worktreeRoot));
			}
			writerLockMode = "disabled";
			selfLock = undefined;
			selfLockWritten = undefined;
		},
		takeoverWriterLock(worktree, now) {
			writerLockMode = "writer";
			writeSelfLock(buildLockFile(deps.writerLock.self, worktree, now));
			return { level: "warning", message: "agents-guard: 已接管此 worktree 的 writer 身分。" };
		},
		status() {
```

（不需要特判「已是 writer」：重複呼叫 `takeoverWriterLock` 只是重新寫入自己的 lock，等同 `reacquire`，行為安全且冪等。）

extension entry（`export default function`）內，`session_start` handler 改為：

```ts
	pi.on("session_start", async (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		for (const warning of current.warnings()) emit(ctx, warning, "warning");

		const worktree = await detectWorktreeRoot(
			(command, args, options) => pi.exec(command, args, options),
			ctx.cwd,
		);
		lastWorktree = worktree;
		const notice = current.initWriterLock(worktree, Date.now());
		if (notice !== undefined) emit(ctx, notice.message, notice.level);
	});
```

（`lastWorktree` 是一個模組層級的 `let lastWorktree: { root: string; branch: string } | null = null;`，供 `/agents-guard takeover` 命令使用——`takeover` 是操作者手動觸發，此時 `ctx.cwd` 一定等於 session_start 當時的 cwd，重用同一個已偵測的 worktree 值即可，不必再次呼叫 git。）

新增 `pi.on("turn_end", ...)` 與更新 `pi.on("session_shutdown", ...)`：

```ts
	pi.on("turn_end", (_event, ctx) => {
		ensureRuntime(ctx.cwd).heartbeatWriterLock(Date.now());
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ensureRuntime(ctx.cwd).releaseWriterLock();
	});
```

`ensureRuntime` 建構 `createRuntime` 時新增 `writerLock` deps：

```ts
			runtime = createRuntime({
				fileConfig: fileRead.value,
				env: process.env,
				flag: typeof rawFlag === "string" ? rawFlag : undefined,
				resolver: { realpathSync, cwd, home },
				log: (message) => console.warn(message),
				writerLock: {
					self: {
						sessionId: "pending",
						pid: process.pid,
						host: hostname(),
						isSubagentChild: process.env.PI_SUBAGENT_CHILD === "1",
					},
					stateDir,
					isPidAlive: (pid) => {
						try {
							process.kill(pid, 0);
							return true;
						} catch (error) {
							return (error as NodeJS.ErrnoException).code === "EPERM";
						}
					},
				},
			});
```

`sessionId: "pending"` 是暫時值——`ExtensionContext.sessionManager.getSessionId()` 只在事件 handler 內才拿得到，而 `ensureRuntime` 可能在 `session_start` 之前就被別的 hook（例如尚未發生 tool_call）呼叫到。改成在 `session_start` handler 內用 `ctx.sessionManager.getSessionId()` 更新一次：新增 `Runtime.setSessionId(sessionId: string): void`（極簡：只更新 `deps.writerLock.self.sessionId` 這個閉包變數，因為 `self` 目前是直接參照 `deps.writerLock.self`，改成 runtime 內部持有可變的 `let selfSessionId = deps.writerLock.self.sessionId;` 並提供 setter，所有 `decideLockAction` 呼叫處用 `selfSessionId` 取代 `deps.writerLock.self.sessionId`）。

在 `session_start` handler 內，於呼叫 `initWriterLock` 之前先呼叫：

```ts
		current.setSessionId(ctx.sessionManager.getSessionId());
```

`import { hostname } from "node:os";` 加入頂部 import。

`/agents-guard` 命令 handler 內，在既有 `if (verb === "on" || verb === "off") {...}` 之後新增：

```ts
			if (verb === "takeover") {
				if (lastWorktree === null) {
					emit(ctx, "agents-guard: 目前不在 git worktree 內，writer-lock 不適用。", "warning");
					return;
				}
				const notice = current.takeoverWriterLock(lastWorktree, Date.now());
				emit(ctx, notice.message, notice.level);
				return;
			}
			if (verb === "unlock") {
				current.releaseWriterLock();
				emit(ctx, "agents-guard: 已釋放本 session 持有的 writer-lock。", "info");
				return;
			}
```

把 usage 訊息更新為：

```ts
				"agents-guard usage: /agents-guard [status] | on [module] | off [module] | save | takeover | unlock",
```

`getArgumentCompletions` 的 `items` 陣列加入 `"takeover"`、`"unlock"`。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 全量迴歸 + 型別檢查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全綠，無型別錯誤

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/integration.test.ts
git commit -m "feat(index): 接線 writer-lock（session_start/turn_end/session_shutdown + takeover/unlock 命令）"
```

---

## Task 7: 實機驗證與文件更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: lint**

Run: `npx biome check .`（若有格式差異，`npx biome format --write .` 後重跑測試確認仍全綠）

- [ ] **Step 2: 實機以 `pi -e` 載入，確認 `/agents-guard` 狀態顯示 `writer-lock`**

Run（本機任意 git 目錄）：
```bash
cd ~/web/pi-agents-guard
pi -e "<REPO>/src/index.ts" -p "/agents-guard"
```
Expected: 輸出包含 `writer-lock: enabled (source: default)`；由於是單次 `-p` 呼叫，`session_start` 應已完成 lock 初始化，不會拋錯或掛起。

- [ ] **Step 3: 實機確認 lock 檔確實寫入且乾淨釋放**

```bash
pi -e "<REPO>/src/index.ts" -p "/agents-guard"
ls ~/.pi/agent/state/agents-guard/locks/ 2>/dev/null
```
Expected: `-p` 模式跑完後觸發 `session_shutdown`，`locks/` 目錄下不應留下屬於這次執行的 lock 檔（或目錄為空／不存在）。若殘留，檢查 `session_shutdown` 是否確實在 `-p` 模式下觸發——若否，記錄為已知限制（`-p` 單次模式的 shutdown 語意），不強行在本階段解決。

- [ ] **Step 4: 更新 `README.md` 狀態表與命令說明**

把：
```
| `writer-lock` | `:56` `:93` | 設計完成，待實作 |
```
改為：
```
| `writer-lock` | `:56` `:93` | ✅ Stage 3 已實作 |
```

在「命令」章節的程式碼區塊新增：
```
/agents-guard takeover         # writer-lock：接管本 repo 的 writer 身分
/agents-guard unlock           # writer-lock：釋放自己持有的 lock
```

新增一節「## `writer-lock` 的決策表」簡述 skip/acquire/reacquire/share/takeover-stale/readonly 六種結果與唯讀模式下的阻擋目標，並註明 §5.6 layer 3（`checkLockIntegrity`）與本檔開頭 Deviations 的職責邊界說明。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: 更新 writer-lock 狀態為 Stage 3 已實作，補命令與決策表說明"
```
