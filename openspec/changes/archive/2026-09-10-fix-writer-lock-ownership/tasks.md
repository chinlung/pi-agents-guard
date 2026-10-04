# Writer Advisory Implementation Plan

> **For agentic workers:** 執行時載入 `executing-plans` 與 `test-driven-development`。本計畫採 inline sequential、單一 writer；不逐 checkbox 派發 implementer。

**Goal:** 將 writer-lock 改為環境確認及 session 存在提醒，真正移除其寫入阻擋。
**Architecture:** 純資料判斷、同步 presence 檔案操作、單一 session controller 與既有 Pi adapter；只有環境 refresh 新增 Promise。
**Tech Stack:** Node >=22.19.0、strict TypeScript、Vitest 5、Biome 2、Pi 0.85.1；不新增 production dependency。
**Change:** `fix-writer-lock-ownership`
**Spec:** `openspec/changes/fix-writer-lock-ownership/specs/writer-lock-safety/spec.md`
**Design:** `openspec/changes/fix-writer-lock-ownership/design.md`
**Approval:** 需求 `725bc7e`、設計 `052374e`、tasks `da38ac6` 均已由使用者分別核准；tasks 核准回覆為「核准」。目前為 Phase 4 執行紀錄；checkbox 僅依實測更新，CLI artifact done 不代表額外授權。

## Global Constraints

- 執行 cwd 固定為 `<REPO>/.worktrees/progressive-b`，分支 `refactor/progressive-b`。不動主 checkout 或真實 agent 設定／狀態。
- 開始 Phase 4 前讀 OpenSpec apply guidance、重查 status／diff，跑 `npm test`、`npm run typecheck`、`npm run lint` 建立當次 baseline。舊紀錄的 258 tests 不是本次證據；既有紅燈先辨識，不修改測試掩蓋。
- 每項依 RED → GREEN → REFACTOR；下列程式區塊是測試／實作落點，不代表已寫入 src/test。局部檢查通過才進下一項。
- Task 1–3 是 additive 的可測元件，舊 runtime 保留至 Task 4 一次切換；不為中途綠燈新增第二套 controller。Task 4 前不宣稱行為已改成提示，Task 5 前不宣稱完成驗收。
- 全部 state 在 `state/agents-guard/**`，新目錄 0700、檔案 0600。新測試使用 `mkdtempSync` 自建根並以 `finally`／`afterEach` 清理自己保留的精確路徑，不以 glob 找舊暫存目錄刪除。
- 不改其他模組的拒絕／failure policy；不改原 `detectWorktreeRoot`、config 儲存 helper 的語意。`src/config.ts` 最多加 writer 選項的 deprecated 註解，不能順便重寫設定合併器。
- 無 SQLite、timer、PID liveness、持久工具預留、host protocol 或全程序停止驗收。沒有新增型別／依賴所需的 package 版本變更，不改 manifest、lockfile 或 CI。
- Task 1–4 做局部測試及自審；正式程式 checkpoint 等 Task 5 的完整驗證與唯讀雙 review。既有定點 commit 授權不含 push、merge、安裝、發布或 archive。
- 驗證 exit code 與顯示分開；mutation 原始命令必須非零且命中指定 assertion，還原後原命令必須為零。證據記在各 task 完成項下，詳細 review findings 放 `review-notes.md`，不另建 design／plan。

## 需求 → 設計 → Tasks

| Requirement | Design 決策 | Tasks |
|---|---|---|
| Advisory behavior without write locking | §1 tool-call 零介入、§2 Runtime 相容 | 4、5 |
| Basic worktree awareness | §1 觸發、§2 快照 | 1、2、4、5 |
| Scoped session presence notices | §3 canonical root／host／instance 範圍 | 1、2、3、4 |
| Truthful and non-disruptive diagnostics | §2 unknown、§4 去重／輸出隔離 | 1、2、3、4、5 |
| Non-destructive presence lifecycle | §1 off／child、§2 revision、§3 own-only | 3、4、5 |
| Bounded compatibility and honest guarantees | §5 相容、Migration Plan | 4、5 |

依賴：`1 → 2 → 3 → 4 → 5`。2、3 理論上可獨立，但同一 writer 線性執行更省協調；不開平行寫入 lane。

## 1. 純資料契約、peer 分類及提示

**Paths / symbols:** 在 `src/types.ts` 新增並 export 下列資料型別；在 `src/modules/writer-lock.ts` 新增 `presenceDirectoryKey`、`parsePresenceRecord`、`assessPresence`、`writerNoticeSignature`、`formatWriterNotice`；新建 `test/writer-presence.test.ts`。舊函式暫留，待 Task 4 移除正式呼叫後清理。

**Interfaces（供 Tasks 2–4 共用）：**

```ts
type WriterNotice = { level: "info" | "warning" | "error"; message: string };
type WriterRefreshReason = "startup" | "status" | "enabled";
type WriterIssueCode =
  | "not-checked" | "git-failed" | "git-timeout" | "git-aborted"
  | "git-invalid-output" | "root-unresolved" | "record-invalid"
  | "record-io" | "record-stale" | "record-clock" | "record-collision"
  | "record-unowned" | "record-missing" | "scan-limit" | "record-size"
  | "record-symlink" | "legacy-present" | "legacy-unknown"
  | "options-invalid" | "temp-cleanup" | "own-cleanup";
type WriterBranch = { kind: "branch"; name: string } | { kind: "detached" | "unknown" };
type WriterSnapshot =
  | { kind: "git"; cwd: string; root: string; branch: WriterBranch;
      dirty: boolean | null; checkedAt: number; issues: WriterIssueCode[] }
  | { kind: "not-applicable" | "unknown"; cwd: string;
      checkedAt: number; issues: WriterIssueCode[] };
interface PresenceRecord {
  version: 1; instanceId: string; sessionId: string; pid: number; host: string;
  worktreeRoot: string; startedAt: number; lastSeenAt: number;
}
type PresencePeer = { record: PresenceRecord; freshness: "recent" | "uncertain" };
type PresenceScan = { records: PresenceRecord[]; issues: WriterIssueCode[] };
type WriterReport = { snapshot: WriterSnapshot; peers: PresencePeer[]; issues: WriterIssueCode[] };
```

函式簽章：`presenceDirectoryKey(root: string): string` 回 full SHA-256 hex；`parsePresenceRecord(raw: unknown): PresenceRecord | null`；`assessPresence(records: readonly PresenceRecord[], self: { instanceId: string | null; host: string; worktreeRoot: string }, now: number, timeoutMs: number): { peers: PresencePeer[]; issues: WriterIssueCode[] }`；`writerNoticeSignature(sessionId: string, report: WriterReport): string`；`formatWriterNotice(report: WriterReport): WriterNotice`。self 的 instanceId 只有成功登記且仍可辨識為自身時才非 null。

- [x] **1.1 RED：** 寫去重時間排除案例，再加入合法 schema／invalid 數字與 UUID、同 root 別 instance、同 instance 自身、不同 host／root、同 sessionId 別 instance、stale／future／無效 timeout 分類案例。先跑 `npm test -- test/writer-presence.test.ts`，應因新 export 尚不存在而失敗；export 接上後觀察行為 assertion，而非停留在 import error。

```ts
const report: WriterReport = {
  snapshot: { kind: "unknown", cwd: "/repo", checkedAt: 1, issues: ["git-failed"] },
  peers: [], issues: [],
};
expect(writerNoticeSignature("s", report)).toBe(writerNoticeSignature("s", {
  ...report, snapshot: { ...report.snapshot, checkedAt: 2 },
}));
expect(formatWriterNotice(report).message).toContain("資訊不完整");
```

- [x] **1.2 GREEN：** 驗證非空身分、UUID instanceId、絕對 root、正整數 pid、有限非負時間；未來超過 5 秒容差或時間倒置標 record-clock，逾時標 record-stale，均保留為 uncertain peer。timeout 不是有限正數時使用原 14,400,000 ms 並標 options-invalid。peer 排序穩定；不以 PID 相同排除其他 instance。訊息轉義控制字元、單個動態欄位上限 256 個 code points，最多列 5 peers 並列省略數量；僅顯示固定原因文案，不列檔案內容或 stderr。

signature 的核心實作不含時間或顯示文案（`createHash` 沿用既有 Node import）：

```ts
const s = report.snapshot;
return createHash("sha256").update(JSON.stringify([
  sessionId, s.kind, s.kind === "git" ? s.root : s.cwd,
  s.kind === "git" ? s.branch : null, s.kind === "git" ? s.dirty : null,
  report.peers.map(p => [p.record.instanceId, p.freshness]).sort(),
  [...new Set([...s.issues, ...report.issues])].sort(),
])).digest("hex");
```

- [x] **1.3 REFACTOR／驗證：** 補 heartbeat 更新但 freshness 未變的 signature 相同、peer／原因／root 改變不同、純 dirty 提醒保留修改及無 peer 不宣稱安全。跑 `npm test -- test/writer-presence.test.ts test/writer-lock.test.ts`、`npm run typecheck`、`npm run lint`；自審純函式沒有 fs／Pi I/O。
- [x] **1.4 證據：** 記錄 RED 原因、GREEN 命令／exit code、修改檔名；checkbox 只代表純元件完成，不代表寫入阻擋已移除。

## 2. 有界 Git 環境快照

**Paths / symbols:** `src/lib/git.ts` 的 `ExecFn` options additive 增加 `timeout?: number`、結果 additive 增加 `killed?: boolean`（舊注入仍相容）；新增 `WorktreeInspectorDeps`、`inspectWorktree`。擴充 `test/git.test.ts`，保留原 `detectWorktreeRoot` 全部 characterization tests。

**Interfaces:** `WorktreeInspectorDeps = { exec: ExecFn; realpathSync: (path: string) => string; now: () => number }`；`inspectWorktree(deps: WorktreeInspectorDeps, cwd: string, signal?: AbortSignal): Promise<WriterSnapshot>`。消費 Task 1 型別，snapshot.checkedAt 在產生結果時取 clock，不把檢查開始時間冒充完成時間。

- [x] **2.1 RED：** 加以下失敗不等於非 git 的案例；再加確定 false→not-applicable、true＋root、detached／unborn branch、dirty／clean／部分欄位失敗、realpath 失敗、signal 及剩餘 timeout 傳遞；特別驗證 code 0 但 killed true 仍為失敗，不能採信 stdout。`npm test -- test/git.test.ts` 應先因新增 helper 尚不存在失敗。

```ts
const snapshot = await inspectWorktree({
  exec: async () => ({ stdout: "", code: 128 }),
  realpathSync: p => p, now: () => 1000,
}, "/repo");
expect(snapshot.kind).toBe("unknown");
expect(snapshot.issues).toContain("git-failed");
```

- [x] **2.2 GREEN：** 用 design §2 的四個參數陣列查詢，全部有 `--no-optional-locks`；每次 exec 前驗剩餘預算及 signal。耗盡／中止不再啟動下一命令，回覆後先判 signal／killed 再解析 code／stdout。只在 inside-work-tree 成功且為 false 時標不適用；未被中止的 branch code 1 表示 detached，其他失敗標 unknown。空／無法解析 root 不登記；去除 Git 輸出的結尾換行，不用全字串 trim 吞掉合法路徑空白。status 非空只代表 dirty，不解析檔名。2 秒預算限制查詢啟動及傳入 SDK 的 timeout，不宣稱 SDK 保證程序兩秒內退出；不為此修改 Pi 停止機制。

```ts
const deadline = deps.now() + 2000;
const remaining = deadline - deps.now();
// 每個命令前重算 remaining；<= 0 或 signal.aborted 時返回已知欄位＋診斷。
const inside = await deps.exec("git", ["--no-optional-locks", "rev-parse", "--is-inside-work-tree"],
  { cwd, signal, timeout: remaining });
```

- [x] **2.3 REFACTOR／實際 Git：** 在測試自建 repo 用只作用於 fixture 的 `git init`、local user 設定、關閉簽名／hooks、具名 add／commit 建立 clean、dirty、detached、unborn 案例；以兩個獨立 repo 的同名分支及同 repo linked worktree 證明 root 不同。對子目錄、symlink alias 驗證 canonical root 相同。測試 adapter 用受 timeout／signal 控制的 Node child_process，所有程序等待退出；無 Git／symlink 能力時明確失敗或報告覆蓋阻擋，不靜默 skip。不得修改專案 HEAD 或使用真實使用者 hooks／Git config。跑 `npm test -- test/git.test.ts`、typecheck、lint。
- [x] **2.4 證據：** 分開記錄 injected exec 與真實 Git 的結果；確認原 helper 的 null 與 signal 行為完全不變。若本機沒有最低 Node／Linux，明示未驗證，不能用 macOS 的結果代替。

## 3. 只操作自身的 presence 檔案 helper

**Paths / symbols:** `src/state.ts` additive 新增 `PresenceMutation`、`PresenceFiles`、`PresenceFsOps`、`createPresenceFiles`；擴充 `test/state.test.ts`。不修改 `readJsonFile`、`writeJsonFileAtomic`、`resolveStateDir` 或 config 使用的其他舊 helper。

**Interfaces:** `createPresenceFiles(stateDir: string, overrides?: Partial<PresenceFsOps>): PresenceFiles` 建構時零 I/O。PresenceFsOps 是本 task 使用之 `node:fs` 同步函式型別集合，僅供精準故障注入，不引入通用 storage framework。

```ts
type PresenceFsOps = Pick<typeof import("node:fs"),
  "mkdirSync" | "lstatSync" | "opendirSync" | "openSync" | "fstatSync" |
  "readSync" | "writeFileSync" | "closeSync" | "linkSync" | "renameSync" | "unlinkSync">;
type PresenceMutation = {
  outcome: "done" | "missing" | "unowned" | "failed";
  issues: WriterIssueCode[];
};
interface PresenceFiles {
  create(record: PresenceRecord): PresenceMutation;
  update(expected: PresenceRecord, lastSeenAt: number): PresenceMutation;
  remove(expected: PresenceRecord): PresenceMutation;
  scan(root: string): PresenceScan;
  legacy(root: string): "absent" | "present" | "unknown";
}
```

只有 final path 的建立／更新／移除完成才回 done；已發布但 tmp 清理失敗仍回 done＋temp-cleanup，使 controller 不遺失已建立記錄的身分。其餘錯誤轉固定 issue code，不能 throw raw fs exception 給 adapter。函式只接受 controller 提供的已知 root／expected；永遠不依 record 中的任意路徑欄位刪檔。

- [x] **3.1 RED：** 在新 describe 的 beforeEach 建精確 root/stateDir，afterEach 清理該 root。建立完整 PresenceRecord，驗證正常建立、第二次相同路徑不覆寫、兩筆 instance 可共存；逐一替換 instanceId、sessionId、host、pid、root 後，update/remove 都不動他人內容。補 ENOENT／EACCES、invalid JSON／schema、oversize／scan cap、symlink／目錄、legacy byte-for-byte 不變。跑 `npm test -- test/state.test.ts`，先因新 helper 不存在失敗。

核心碰撞測試（record 在同一測試完整建立，不借用真實狀態）：

```ts
const record: PresenceRecord = {
  version: 1, instanceId: "00000000-0000-4000-8000-000000000001",
  sessionId: "s", pid: 123, host: "fixture", worktreeRoot: "/repo",
  startedAt: 1000, lastSeenAt: 1000,
};
const files = createPresenceFiles(stateDir);
expect(files.create(record).outcome).toBe("done");
expect(files.create({ ...record, sessionId: "other" }).outcome).toBe("unowned");
expect(files.scan("/repo").records).toEqual([record]);
```

- [x] **3.2 GREEN：** 路徑由 stateDir、full root hash、合法 UUID 組合；禁止跟隨 presence 子目錄／leaf symlink。讀取區分 ENOENT，regular file 使用 fd 有界讀取，最多讀 16 KiB＋1 byte 判斷超限並 finally close；不能先 stat size 再無界 readFile。scan 用有界目錄迭代，讀第 257 個項目即可標 scan-limit；自身協定 `.tmp-<UUID>` 不當作 peer，但仍計入掃描上限，未知項目標不完整。檔名與 record.instanceId 不合也標 invalid。

新記錄採「完整 tmp＋不覆寫的發布」，更新採「驗 immutable identity＋tmp＋rename」；tmp 以隨機檔名、wx／0600 建立並追蹤是否由本呼叫成功建立。可用 Node `linkSync(tmp, finalPath)` 初次發布，EEXIST 不覆寫，unlink 自身 tmp；這是單筆記錄的安全發布，不是 writer 互斥，也不新增宿主能力。link 不支援時只回失敗診斷，不改用會覆寫 finalPath 的 fallback。更新／移除核對 instanceId、sessionId、host、pid、root，不要求 lastSeenAt 相等。移除只 unlink 自身 leaf，不遞迴刪目錄。

```ts
// fs 是合併預設 Node fs 函式與 overrides 的注入物件，不繞過測試 seam。
// temp 已成功以 wx 建立且寫完；只有本次 createdTemp 才能在 finally 清理。
fs.linkSync(temp, finalPath); // 初次發布：若 finalPath 已存在會失敗，不覆寫。
// 更新分支在驗證 expected 身分後才 fs.renameSync(temp, finalPath)。
```

- [x] **3.3 REFACTOR／故障：** 明列 PresenceFsOps 為上述實際使用的 mkdir/lstat/opendir/open/fstat/read/write/close/link/rename/unlink 同步函式型別；以 overrides 單點注入錯誤，不以 mock 整個 state 模組掩蓋真實 I/O。rename 失敗且 cleanup 可用時無自身 tmp 殘留；cleanup 也失敗時保留固定診斷、不刪別人的檔案。驗證新目錄／檔案權限、fd 關閉、constructor 零 I/O、legacy 只 lstat 不解析／跟隨／修改。跑 `npm test -- test/state.test.ts test/config.test.ts`、typecheck、lint。
- [x] **3.4 證據：** 記錄 file tree／內容／mode 的逐項比對及注入故障結果；不以兩筆可共存宣稱原子雙 writer 排除。原 config helper 的測試仍須全綠。

## 4. 單一 controller 與 Pi 接線切換

**Paths / symbols:** 替換 `src/runtime/writer-lock.ts` 的 `createWriterLockController` 內部；修改 `src/index.ts` 的 Runtime／createRuntime、session_start／turn_end／session_shutdown、status／on／off／takeover／unlock；必要時擴充 `test/helpers/extension-harness.ts` 的 notify fault 與可變 session/cwd 測試入口。測試落在 `test/writer-lock-runtime.test.ts`、`test/integration.test.ts`、`test/extension.test.ts`、`test/config.test.ts`。清理 `src/modules/writer-lock.ts`、`src/types.ts` 與 `test/writer-lock.test.ts` 中已無正式 consumer 的舊鎖判斷。

**Interfaces:** controller 保留既有同步方法，新增 `refresh(snapshot: WriterSnapshot, now: number, reason: WriterRefreshReason): WriterNotice | undefined`、`summary(): string`、`takeNotice(): WriterNotice | undefined`；files 改用 Task 3 的 PresenceFiles、建構仍零 I/O。deps 可 additive 注入 `newInstanceId?: () => string`，預設 randomUUID；既有 isPidAlive 只保留相容欄位而永不呼叫。

Runtime 新增 `refreshWriterNotice(cwd: string, now: number, reason: WriterRefreshReason, signal?: AbortSignal): Promise<WriterNotice | undefined>` 與 `takeWriterNotice(): WriterNotice | undefined`；舊 handleToolCall、init、heartbeat、release、takeover、status 的同步簽章不變。refresh 的 now 供啟動／失敗 fallback；正常環境結果使用 Task 2 的 checkedAt。controller 診斷、最近自動 signature、單筆 pending notice 與自身成功登記 handle 各自獨立，不把 drain notice 當清除 status 診斷。

- [x] **4.1 RED：** 先加具名測試「peer notice never blocks writes」及「background child skips before worktree and presence I/O」。controller 使用真實 temp state／可注入 files；Runtime 在既有 `deps`／`writerLockDeps` fixture 上建立兩個不同 instance。extension harness 必須沿用實際 default export 的 hook 註冊。先跑 `npm test -- test/writer-lock-runtime.test.ts test/integration.test.ts test/extension.test.ts`，記錄舊 readonly／child 先 I/O 的預期失敗。

extension 的最小 child assertion（沿用該檔既有 reload/h/exec fixture）：

```ts
reload({ child: true });
await h.fire({ type: "session_start", reason: "startup" });
expect(exec).not.toHaveBeenCalled();
expect(await h.fire(dispatch)).toBeUndefined(); // 不改既有 child prerequisite skip。
```

- [x] **4.2 GREEN—controller／Runtime：** 使用動態 getSettings；child／disabled 在 init/refresh/heartbeat 的 I/O 前跳過。成功 create 後才保留自身 handle；create 碰撞不覆寫、不進無限 UUID 重試。update 遺失／歸屬不符後放棄 handle，下次完整 refresh 才換 UUID 重登；release 先停止後續 heartbeat，再嘗試 own-only cleanup。sessionId 同值不重建，不同值清理／換 UUID；root 變化或 unknown 清理既知自身舊位置。不把同 PID／sessionId 別 instance 當 share。isReadonly 固定 false、checkReadonlyCall 固定 pass，handleToolCall 移除 writer 分支，hard-deny→subagent-policy 保留。

本機 revision 放 createRuntime：每個 refresh、實際身分變更、停用、release 使舊 await 結果失效；回來後再驗 revision／開關／child，才呼叫同步 controller.refresh。相容 initWriterLock 也先使舊 await 失效。setEnabled 停用時 cleanup，並記錄有效 false→true 的本機待檢查旗標；reason=enabled 只有消耗此旗標才啟動 refresh，避免 adapter 解析 status 字串或新增公開 getter。takeoverWriterLock 僅固定相容訊息，零檔案操作。

```ts
if (reason === "enabled" && !enableRefreshPending) return undefined;
if (reason === "enabled") enableRefreshPending = false;
const revision = ++writerRevision;
if (!writerEnabled() || isSubagentChild) return undefined;
const snapshot = await inspectWorktree(inspectorDeps, cwd, signal);
if (revision !== writerRevision || !writerEnabled() || isSubagentChild) return undefined;
return writerLock.refresh(snapshot, snapshot.checkedAt, reason);
```

此片段的 `enableRefreshPending` 是前述待檢查旗標，`writerRevision` 是 createRuntime 的本機計數，`writerEnabled()` 讀目前 config 全域及 module enabled；`inspectorDeps` 由既有 exec／resolver 加 clock 組成，`writerLock` 是唯一 controller。不得把這個 revision 寫到 presence 或變成跨程序 ownership。

- [x] **4.3 GREEN—adapter／相容：** 啟動及主動查詢前更新 ctx 的 sessionId；status await refresh 後只印一次合併 status。on 對 all／writer-lock 呼叫 reason=enabled，Runtime 僅讓有效 false→true 進入檢查；other-module on/off、tool_call 不啟動檢查。turn_end 只 heartbeat＋drain notice；shutdown／off 只自身 cleanup。takeover、unlock 兩個命令均只印相容提示，unlock 不得再呼叫 release。移除 production isPidAlive 的 process.kill 檢查；若保留 RuntimeDeps 欄位，default 注入 inert callback 供簽章相容即可。

writer 專用 emitter 捕捉 UI 與 fallback console 錯誤；不共用會向外拋錯的其他模組 failure logger。相同自動 signature 不重複，主動 status 不消耗自動去重狀態；只有整體新的原因／位置／peer 狀態才再次提示。command 舊名稱與 completion 保留，訊息明示 deprecated／無接管；blockedTools／blockedGitSubcommands 仍可載入及 save round-trip，但不改任何工具決策。

- [x] **4.4 回歸矩陣：** 覆蓋下面各組，再跑 `npm test`、typecheck、lint。每個 assertion 必須驗到資料與副作用，不只 assert 不 throw。

| 組別 | 必驗案例 |
|---|---|
| 非阻擋及其他政策 | peers／dirty／invalid records 下 write、edit、ast_grep_replace、普通 Git 皆不因 writer 被擋；hard-deny 明確拒絕仍有效，subagent prerequisite/native-only/review policy 不變。 |
| child／disabled | 以會 throw 的 files、exec、realpath spies 證明 writer 零 I/O；Runtime env 與 injected self 旗標相反時依 env 唯一來源；config 載入與 completion 原本 I/O 不混入此斷言。 |
| lifecycle／late result | 同身分不重建、不同身分／root 清理自身、unknown 停用舊登記；用 deferred exec 讓 A 晚於 B、off、shutdown、sessionId 變更回來，assert 無新檔／舊摘要污染。 |
| 去重及輸出 | 重複 startup 不刷屏、peer heartbeat 不刷屏、原因改變可提示、status 每次 fresh 且只印一次；heartbeat failure drain 一次但 status 仍有診斷；hasUI false 與 notify/console 同時 throw 不影響工具。 |
| 開關／命令 | startup 前開關、全域與單一開關、有效 false→true 才重查；takeover/unlock 在有／無 worktree、停用時都不改 presence/v1；save 的 config round-trip 不受影響。 |
| 舊回歸保護 | completion 與 git-evidence 的事件、內容保留、signal、follow-up budget 原 assertion 不刪；registered events 仍各一次，不新增未知宿主能力。 |

**舊測試轉換規則：** readonly／takeover／dead-PID 的舊成功條件明確改為提醒＋零接管；own heartbeat／cleanup、別人資料不變、dynamic settings、child skip 的保護保留並擴強。移除 `buildLockFile`、`hashLockFile`、`parseLockFile`、`checkLockIntegrity`、`decideLockAction`、`decideReadonlyGate` 及 LockDecision／LockIntegrity／LockFile 前確認全 repo callers；v1 的 `lockFilePath` 仍作唯讀路徑計算並保留測試。不以刪掉 failing suite 換綠燈，測試數改變須說明原因。

- [x] **4.5 REFACTOR／證據：** 全讀 diff，核對上述矩陣與測試名稱；確認只有一個 controller、無新 production 依賴、無 writer tool gate，並記錄尚待 Task 5 的 mutations／review。不要用 grep 零命中代替實際 default-export 接線測試。

## 5. 文件、負向控制與最後驗收

**Paths:** 更新 `README.md` 的定位／模組狀態／命令／writer 章節／失敗語意，以及 `docs/design.md` 的 writer 相關 §2–6、§7–10 描述；更新 `openspec/config.yaml` 的 runtime 已改為提示之專案事實。測試補強仍在 Tasks 1–4 已列檔案。歷史 `docs/plans/*` 不冒充本版計畫；本 change 的 proposal/spec/design 不在 review 階段順手改規格。

**Interfaces:** 不新增 production 介面。消費 Tasks 1–4 的完整行為及真實測試結果；產出可自洽的文件、mutation 證據與 review findings。README 其他章節既有錯字／無關功能缺陷不藉本 task 擴大修復。

- [x] **5.1 文件對齊：** 依實際程式逐項說明啟動／on／status 的完整檢查、turn_end 自身更新、去重、不完整資訊、scope／掃描限制、四小時只為新鮮度。替換 takeover/unlock 會取得／釋放寫入權、唯讀 gate、同 PID share、tampered 強制 readonly 等目前式敘述；v1 保留、deprecated 欄位 round-trip、混版限制與回退會恢復舊缺陷都要保留。其他模組 hard-deny state 路徑保護不移除，不宣稱已安裝、所有缺陷修復或排他安全。

文件範例以真實 status formatter／command 測試輸出核對，例如應包含：

```text
writer-lock: enabled — advisory（不鎖定寫入）
本次未觀察到其他參與記錄；僅供提醒，不是互斥鎖。
```

- [x] **5.2 負向控制：** 在單一 writer 的可恢復局部變更中逐一做下表 mutation；每次記錄原始失敗 exit code／指定 assertion，再精準還原，重跑同一條命令轉綠。若測試仍綠，先增加會失敗的行為斷言再繼續，不能只修改測試預期配合 mutation。

| 暫時破壞的行為 | 指定測試／命令 |
|---|---|
| 自動提示不再比對 signature | 重複 startup 提示數；`npm test -- test/writer-lock-runtime.test.ts test/extension.test.ts` |
| update/remove 略過 expected 身分比對 | 替換 sessionId 後 bytes 不變；`npm test -- test/state.test.ts` |
| peer 使 writer 回 block | peer 下寫入 pass 且其他拒絕仍有效；`npm test -- test/integration.test.ts test/extension.test.ts` |
| child check 移到 inspect 後或省略 revision check | child 零 exec／off 後 late result 無新檔；`npm test -- test/integration.test.ts test/extension.test.ts` |
| 恢復 unlock→release 或 takeWriterNotice 不清空 | 命令零檔案副作用／pending notice 只取一次；`npm test -- test/writer-lock-runtime.test.ts test/extension.test.ts` |

- [ ] **5.3 最終驗證與唯讀 review：** 先跑改動檔 LSP，再依序 `npm test`、`npm run typecheck`、`npm run lint`、workflow pre-check、`openspec validate fix-writer-lock-ownership --strict --no-interactive`、`git diff --check`、`lens_diagnostics mode=all`。讀完整 diff 後列可用 reviewer capabilities，以單一 async workflowScript 的 runs.all 平行唯讀 reviewer 與 codex-exec：前者查規格、相容及其他模組回歸，後者查自身記錄、安全 I/O、child／late result、測試盲點。禁止 child 再派 agent；主 writer 親自驗證 finding，修後重跑相關檢查。若任一 lane 有 infrastructure failure，依 subagent 協定停止並回報精確 run/cwd/ref 與 partial diff；不默默改用 foreground CLI。
- [ ] **5.4 驗收收斂：** 核對六個 requirement 都有實際通過案例；分開列 mock exec、真實 Git/fs、default-export harness 與實際 Pi CLI／平台覆蓋。現有 CI 是 ubuntu-latest／Node 22，無本輪 CI 結果時明示未跑；不把它視為最低 Node 或完整 CLI 驗證。實際 Pi CLI 若未執行亦明示，不為補此項安裝或修改真實設定。唯讀 review 通過、已知阻擋處理完成後才作具名 checkpoint，commit 後讀回 SHA/status/diff；不得 push。之後進 Phase 5／6 的既有核准流程，不自動 sync/archive。

## 驗收邊界

本計畫已取得 tasks 核准並依下列證據執行；尚未勾選者仍待完成。歷史 SQLite／host 協定不構成本次實作授權。未安裝、未推送、未發布、未 sync/archive。

## Phase 4 執行證據（2026-09-10）

- 起點 `da38ac6866ab8fb0deb90f83818aed2808dbdbc3`，worktree／branch 同 Global Constraints。當次 baseline：`npm test` 258 tests／15 files、typecheck、lint 均 exit 0。
- Task 1：新增 types、純 presence 判斷與 `test/writer-presence.test.ts`。先 missing export（exit 1），接 stub 後再觀察行為 assertion 失敗；GREEN 34 個新測試，與舊 writer suite 合跑 62 tests，typecheck／lint exit 0。
- Task 2：`inspectWorktree` 先 missing helper RED（exit 1），再以 unknown／killed／timeout／signal assertions 實作；`npm test -- test/git.test.ts` 17 tests exit 0。含 injected exec 與真正暫存 Git：unborn、clean／dirty、detached、子目錄／symlink canonical root、linked worktree、獨立 repo。保留原 helper 的測試與 null 語意，僅更正文註說明。
- Task 3：missing export RED 後，stub 的 create=failed 與預期 done assertion RED（exit 1）；state＋config 當時 58 tests exit 0。實際 bytes／mode／file tree、五種 identity 置換、EACCES、rename／link／cleanup 故障均有案例；後續補 fd 與 tmp cap，state 32 tests exit 0。
- Task 4：舊 controller 的 peer `isReadonly=true` 對預期 false RED；default-export child startup 原本執行兩次 Git，零 exec assertion RED（均 exit 1）。切換後刪除無正式 consumer 的強鎖函式與 26 個退役強鎖純測試，保留兩個 v1 路徑測試並由 presence／controller／Runtime／hook 測試覆蓋新契約；不是保留舊互斥語意。其他模組測試／source 政策未刪改。
- 補強：deferred A/B、off／release／identity／compat init 丟棄舊結果且摘要不污染；相同 sessionId 不使 refresh 失效；有效 enable transition、舊命令零副作用、config deprecated arrays round-trip、UI＋console 同時失敗、pending drain、state namespace 隔離。
- 自審另以 RED 重現「新 root 登記成功抹掉舊 root cleanup 診斷」及「重新檢查後又送出舊 root pending」。修為獨立保留 cleanup 診斷、fresh report 吸收 pending；兩次 RED exit 1，還原正確行為後同案例 exit 0。

### Task 5 mutation 證據

每次只做指定局部破壞，原始測試命令 exit 1 且命中下列 assertion；精準還原後同一命令 exit 0，未留下 mutation。

| 破壞 | 測試命令（`npm test --` 後） | 失敗證據 | 還原 |
|---|---|---|---|
| 關閉 signature 比對 | `test/writer-lock-runtime.test.ts test/extension.test.ts` | 自動 refresh 應 undefined 卻重發；2 failures | 35 tests，exit 0 |
| 略過 expected identity | `test/state.test.ts` | 五種替換應 unowned 卻 done，另 invalid／symlink；9 failures | 32 tests，exit 0 |
| peer 使 write 回 block | `test/integration.test.ts test/extension.test.ts` | Runtime pass、host undefined assertions 均失敗；2 failures | 68 tests，exit 0 |
| 拿掉 await 後 revision guard | 同上 | release／identity／compat init／A 晚於 B 回傳舊 notice；4 failures | 68 tests，exit 0 |
| child check 延至 inspect 後 | 同上 | Runtime 1 次／host 4 次 exec，應為零；2 failures | 68 tests，exit 0 |
| unlock 恢復 release | `test/writer-lock-runtime.test.ts test/extension.test.ts` | presence 應原封不動卻變空；1 failure | 35 tests，exit 0 |
| takeNotice 不清 pending | 同上 | 第二次取出應 undefined，host 提示數 3≠2；3 failures | 35 tests，exit 0 |
| 省略讀取 fd close | `test/state.test.ts -t 'actual read descriptor'` | valid／invalid／oversized／read-error 的 fstat 應 EBADF 卻成功；4 failures | 4 selected tests，exit 0 |

### 目前驗證與覆蓋界線

- 2026-09-10：Node `v22.23.2`、Darwin arm64。`npm test` **308 tests／16 files**、`npm run typecheck`、`npm run lint`（34 files）、workflow pre-check、OpenSpec strict validate、`git diff --check` 均 exit 0。
- 真實 Git/fs 僅在 owned temp fixtures；fs faults 與 exec 時序有明確 injection。default-export harness 使用真正註冊的 hooks，但不是完整 SDK session.prompt／Pi CLI／登入模型呼叫。
- 本輪未跑 Pi CLI、最低 Node 22.19.0、Linux 或遠端 CI；不宣稱這些覆蓋、所有 writer 偵測、互斥或完整程序停止。
- 雙重唯讀 review、最終診斷與 checkpoint 仍待 5.3／5.4 收斂。
