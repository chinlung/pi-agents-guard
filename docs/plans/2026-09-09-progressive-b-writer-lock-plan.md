# 漸進式 B 首批：接線測試與 writer-lock 抽離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改外部行為的前提下，建立真實 extension 接線測試，把 writer-lock 狀態與 I/O 從 index 移出，為獨立的鎖安全修正提供可測邊界。

**Architecture:** 保留 `src/index.ts` 的 Runtime／RuntimeDeps／createRuntime／default export。首批只新增一個 production 檔 `src/runtime/writer-lock.ts`；設定、guard、小型 subagent 狀態與 hooks 留在原處。抽離後先進鎖安全檢查點，不直接接著搬其他模組。

**Tech Stack:** Node >=22.19.0、strict TypeScript、Vitest 5、Biome 2、pi coding agent 0.85.1；使用現有依賴，不新增套件。

**Spec:** `docs/plans/2026-09-09-index-runtime-root-cause-and-refactor-proposal.md` §4 B、§5、§6；原始行為規格 `docs/design.md` §3、§4.4、§5.1、§5.5、§8。

**Approval:** 操作者已核准「漸進式 B」方向、此執行計畫及隔離 worktree。於 `.worktrees/progressive-b`／`refactor/progressive-b` 實作。首批驗證與 review 後，操作者以「繼續修復，定點commit」授權 checkpoint commits；未授權 push、安裝或 OpenSpec 初始化。下方完成紀錄描述 checkpoint 提交前的驗證狀態。

**Execution:** Task 1／2 已驗證；258 tests、typecheck、lint 通過。Task 3 的八個安全探針與複雜度結果見 [安全停止點](2026-09-09-writer-lock-safety-findings.md)，雙角度唯讀 review 已完成，未見抽離造成的行為退化；註解補強與非阻擋性 coverage 缺口已記錄。設定／優先順序回歸已由實際 hook 測試覆蓋，無需改既有 integration tests。

## Global Constraints

- 純重構與行為修正分開驗收。本計畫不宣稱修復 lock 競態、ownership、child 來源或 lifecycle fail-open。
- 不改公開 Runtime／RuntimeDeps 簽章、設定來源優先順序、lock/config JSON、command/flag 名稱、package entry。
- 保留 hard-deny → writer-lock → subagent-policy 的判定順序與第一個 block 短路。
- 模組設定必須透過 getter 取得，不能捕捉初始化的 config 物件；`recompute()` 會替換物件。
- 全部 state 寫入僅限 `state/agents-guard/**`；檔案 0600、目錄 0700；測試使用本測試建立的 temp root。
- 不觸碰真實 `~/.pi/agent`，不發真實 LLM／git push／commit／gh 網路請求；不得使用廣泛 temp cleanup。
- 既有 230 tests 不刪除或放寬斷言。已知錯誤不新增為「預期正確行為」的永久測試。
- 所有 writer 線性執行。實作前確認 branch／worktree 與其他 writer；未明確授權不得 commit、push、切換共用工作樹或安裝 extension。
- 本 repo 尚未初始化 OpenSpec；不自行新增 `openspec/` 或 `.pi/`。鎖安全行為修正開始前另核准規格及工作流程。

## 來源與版本注意事項

規劃時已讀完整本機 pi `docs/extensions.md`，並沿相關連結讀 `docs/session-format.md`、`docs/environment-variables.md` 與 `examples/extensions/protected-paths.ts`。`chub search "pi coding agent" --json` 未找到對應文件，故以本機官方文件及 repo 安裝版 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` 為準。

- `session_start` 事件要有 `reason`，`session_shutdown` 同樣要有 `reason`。
- `ctx.signal` 可以是 undefined；測試需同時覆蓋有／無 signal。
- `tool_result` 回傳 partial patch；content 尾部附加不能誤寫 details／isError。
- session replacement 會 teardown／重新載入 extension；測試使用新 factory instance 模擬新 session，不把同一 instance 連續 start 當真實宿主契約。
- fake API 的作用是測本 extension 的接線，不證明多 extension 載入順序、真實 pi runner 行為或競態安全。

## Files 與依賴順序

| 檔案 | 用途 |
| --- | --- |
| `test/helpers/extension-harness.ts`（新） | 收集 default export 真正註冊的 handlers／commands，隔離環境與 exec |
| `test/extension.test.ts`（新） | 接線、command、signal、輸出與 lifecycle 行為 |
| `src/runtime/writer-lock.ts`（新） | writer-lock controller 與內部依賴型別 |
| `test/writer-lock-runtime.test.ts`（新） | controller 的動態設定、狀態隔離及檔案行為 |
| `src/index.ts` | 刪除搬出的 lock 狀態／helpers／lifecycle bodies，改成委派 |
| `test/integration.test.ts` | 保留 Runtime 相容性斷言，新增必要的動態設定／優先順序回歸 |
| `docs/design.md`、`README.md` | 本批完成後只同步實際架構與未解決風險，不宣稱全部修復 |

順序：Task 1 → Task 2 → Task 3。Task 3 是正式停止點；completion／git-evidence／command 拆分不屬本批。

---

## Task 1：先保護真正的 hook 接線

**Files:** 新增 `test/helpers/extension-harness.ts`、`test/extension.test.ts`；本 task 不修改 production code。

**Consumes:** `src/index.ts` default export、已安裝 pi 的 ExtensionAPI／ExtensionContext／ExtensionCommandContext／事件型別。

**Produces:** `createExtensionHarness(options)`，只作測試支援；不同測試建立不同 instance。

### Step 1 — 建立可失敗的 fake API 邊界

- [x] Harness 支援的 API 僅限目前 entry 真正使用者：on、registerFlag、getFlag、registerCommand、exec、appendEntry、sendMessage。其餘 API／context 屬性被存取時直接拋錯，不以自動 no-op 掩蓋新依賴。
- [x] 將第三方 overloaded `on` 的型別轉接集中在 harness，測試案例使用具體事件型別，不到處使用 `as any`。
- [x] 使用以下介面；options.exec 型別直接取 `ExtensionAPI["exec"]`，每個 fixture 必須注入只接受已列明命令的 dispatcher；未定義命令拋錯，不自動回傳成功。

```typescript
import type {
  AgentSettledEvent, ExtensionAPI, SessionShutdownEvent,
  SessionStartEvent, ToolCallEvent, ToolResultEvent, TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

type HarnessEvent = SessionStartEvent | SessionShutdownEvent | TurnEndEvent
  | AgentSettledEvent | ToolCallEvent | ToolResultEvent;

type HarnessOptions = {
  cwd: string;
  sessionId: string;
  agentDir: string;
  flag?: string;
  child?: boolean;
  hasUI?: boolean;
  signal?: AbortSignal;
  exec: ExtensionAPI["exec"];
};

// 實作檔的公開測試介面；其餘 mock 細節留在 helper。
interface ExtensionHarness {
  registeredEvents(): string[];
  fire(event: HarnessEvent): Promise<unknown>;
  command(args: string): Promise<void>;
  completions(prefix: string): unknown;
  notices: Array<{ message: string; level: string | undefined }>;
  entries: Array<{ customType: string; data: unknown }>;
  messages: Array<{ message: unknown; options: unknown }>;
  dispose(): void;
}
declare function createExtensionHarness(options: HarnessOptions): ExtensionHarness;
```

- [x] Helper 記錄每次 on 註冊（包括重複），fire 只派發對應 event.type。不要實作自製 Pi middleware；當同事件有多個 handler 時使本測試失敗，因本 extension 預期每種事件一個。
- [x] command 呼叫捕捉到的 `agents-guard` handler，completions 呼叫其 getArgumentCompletions；不能另寫一套命令解析器。
- [x] 在呼叫 default factory **之前**隔離 `PI_CODING_AGENT_DIR`、`AGENTS_GUARD`、`PI_SUBAGENT_CHILD`，AGENTS_GUARD 預設清除。beforeEach／afterEach 不使用 concurrent tests，原環境必須以 finally 還原。
- [x] UI notify、appendEntry、sendMessage 都只記錄參數；console 使用 spy，afterEach 還原；signal 原樣傳遞。
- [x] 每個測試由 fixture 以 mkdtempSync 建立 temp root，agentDir 與 fake cwd 均放其內。harness.dispose 只還原該 instance 的環境／spies，重複呼叫安全，不刪除呼叫者提供的路徑。fixture 的 finally 再精確刪除自己建立的 temp root；setup 失敗也必須經過同一清理路徑。

### Step 2 — 寫 characterization cases

- [x] 以下案例放在 `test/extension.test.ts`。每個案例的 `h` 由 beforeEach 建立、afterEach dispose；完整測試檔 import describe／it／expect／beforeEach／afterEach 與 helper。

```typescript
it("registers each expected event once", () => {
  expect(h.registeredEvents().sort()).toEqual([
    "agent_settled", "session_shutdown", "session_start",
    "tool_call", "tool_result", "turn_end",
  ]);
});

it("blocks through the actual hook and toggles immediately", async () => {
  const event = {
    type: "tool_call" as const, toolCallId: "call-1",
    toolName: "bash" as const, input: { command: "git add -A" },
  };
  expect(await h.fire(event)).toMatchObject({ block: true });
  await h.command("off hard-deny");
  expect(await h.fire(event)).toBeUndefined();
  await h.command("on hard-deny");
  expect(await h.fire(event)).toMatchObject({ block: true });
});
```

- [x] 補齊下列明確案例。不能只斷言「被呼叫」，必須比對參數／檔案／訊息：

| Case | Fixture 與斷言 |
| --- | --- |
| 成功 commit result | exec 僅允許 git log，回傳 `abc123 (HEAD -> main) fix: x`；fire 回傳 patch 的第一個 content block 與原 block 相同、尾端含 abc123，沒有 details／isError patch；不執行真實 commit |
| signal | 相同 result，exec options.signal 與傳入 AbortSignal 物件同一個；另測 undefined |
| subagent prerequisite | list 成功 tool_result 後 dispatch 由 block 變 pass；失敗 list 不變 |
| completion | 成功 write result、baseline ` M a.txt`、exec status 回 ` M a.txt\n?? b.txt`；appendEntry 含 b.txt，預設 messages 為空 |
| follow-up limit | 先在 temp config 設 followUp=true、maxFollowUpsPerSession=1，再載入 factory；兩次 settled 只有一個 sendMessage，options 為 followUp／triggerTurn=true |
| lifecycle | mock rev-parse 回 fake cwd／main；start reason=startup；讀真實 temp lock 驗證 sessionId/root/branch；turn_end 後 heartbeat 更新；shutdown reason=quit 後該 lock 不存在 |
| share shutdown | 預置與 process 同 pid／host、不同 sessionId 的新鮮 lock；start/shutdown 後逐項比對 lock 未修改／刪除 |
| commands | status 不寫 config；off/on 立即變；save JSON 僅明確值；未知 module 顯示 error；未知 verb 顯示 usage；takeover 使用已觀察 worktree；unlock 釋放 |
| UI／非 UI | hasUI=true 呼叫 notify；hasUI=false 對應 console 輸出，不能靜默消失；不得彈 confirm |
| session instance 隔離 | 銷毀第一個 harness 後建立第二個；第二個沒有第一個的 capabilities／baseline／follow-up 計數 |

turn_end 測試訊息可使用合法 user message，因目前 handler 不讀 message：

```typescript
await h.fire({
  type: "turn_end", turnIndex: 0,
  message: { role: "user", content: "fixture", timestamp: Date.now() },
  toolResults: [],
});
```

### Step 3 — GREEN → 刻意破壞 → RED → 還原

- [x] `npm test -- test/extension.test.ts`：既有行為的 characterization cases 應先綠。若紅，先判斷 fixture/API 問題或真實既有 bug；真 bug 進安全檢查點，不改斷言使其看似正確。
- [x] 暫時移除一個 `pi.on` 註冊，確認 registration case 紅，再還原。
- [x] 暫時將 tool_call block 回傳改為 undefined，確認 block case 紅，再還原。
- [x] 暫時漏傳 git-evidence 的 signal，確認 signal case 紅，再還原。每次只做一種 mutation。
- [x] `npm test -- test/extension.test.ts test/integration.test.ts`：全綠，diff 不含 mutation 殘留。

**Acceptance:** 新測試真的穿過 default export 註冊的 handler；不是另造 runtime wrapper 自測。沒有 production diff 或全域環境殘留。

---

## Task 2：只抽 writer-lock controller

**Files:** 新增 `src/runtime/writer-lock.ts`、`test/writer-lock-runtime.test.ts`；修改 `src/index.ts`，必要時在 `test/integration.test.ts` 增加回歸。

**Consumes:** 既有 `modules/writer-lock.ts` 決策函式、`state.ts` helpers、WriterLockSelf／WriterLockOptions。

**Produces:** 以下完整內部介面；controller 不 import index、不依賴 ExtensionAPI。

```typescript
import type { Decision, WriterLockOptions, WriterLockSelf } from "../types.js";
import type * as State from "../state.js";

type Worktree = { root: string; branch: string };
type Notice = { level: "info" | "warning" | "error"; message: string };

type WriterLockFiles = Pick<typeof State,
  "readJsonFile" | "statMtimeMs" | "writeJsonFileAtomic" | "removeFile">;

export interface WriterLockControllerDeps {
  self: WriterLockSelf;
  stateDir: string;
  isPidAlive: (pid: number) => boolean;
  getSettings: () => { enabled: boolean; options: WriterLockOptions };
  files?: WriterLockFiles;
}

export interface WriterLockController {
  setSessionId(sessionId: string): void;
  init(worktree: Worktree | null, now: number): Notice | undefined;
  heartbeat(now: number): void;
  release(): void;
  takeover(worktree: Worktree, now: number): Notice;
  isReadonly(): boolean;
  checkReadonlyCall(toolName: string, input: Record<string, unknown>): Decision;
}

declare function createWriterLockController(
  deps: WriterLockControllerDeps,
): WriterLockController;
```

實作 export factory；上方 declare 是計畫簽章，不能把 declare stub 當正式實作交付。files 省略時使用原 `state.ts` helpers；只為 controller tests 提供故障注入，不擴張公開 RuntimeDeps。

### Step 1 — RED：控制器存在且設定不是快照

- [x] 新測試 import 尚不存在的 createWriterLockController，先確認失敗是目標 export 缺失。
- [x] 使用下列代表案例。檔案頂部 import `mkdtempSync/rmSync`、`tmpdir`、`join`、Vitest、原 resolveConfig、state 的 readJsonFile、純模組的 lockFilePath 與新 controller；opts 從 `resolveConfig({}).config.modules["writer-lock"]` 取得，不複製預設清單。每個測試以 finally 清除自己建立的 root。

```typescript
it("uses current settings after configuration replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "ag-writer-controller-"));
  try {
    const opts = resolveConfig({}).config.modules["writer-lock"];
    let settings = { enabled: false, options: opts };
    const lock = createWriterLockController({
      self: { sessionId: "a", pid: 111, host: "fixture", isSubagentChild: false },
      stateDir: join(root, "state", "agents-guard"),
      isPidAlive: () => true,
      getSettings: () => settings,
    });
    const worktree = { root: join(root, "repo"), branch: "main" };
    const now = Date.now();
    expect(lock.init(worktree, now)).toBeUndefined();
    settings = { enabled: true, options: opts };
    expect(lock.init(worktree, now)).toBeUndefined();
    // readJsonFile + lockFilePath 取回該確切 lock，不能只測沒有 throw。
    const path = join(root, "state", "agents-guard", "locks", lockFilePath(worktree.root));
    expect(readJsonFile(path).value).toMatchObject({ sessionId: "a" });
    lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [x] 同檔補：兩個 controllers 使用不同 state root 不互相污染；同 root 不同 pid 的新鮮 holder 使第二個 readonly；readonly tool block／read pass；正確 self.isSubagentChild=true 在乾淨環境不建 lock；share shutdown 逐項保留原檔。
- [x] malformed lock、tampered lock 各維持原處理與訊息；不得將「child 搭 tampered lock」現有錯誤鎖定成期望值。

### Step 2 — GREEN：機械搬移，不修正協定

- [x] 搬 `src/index.ts:144-165` 的 mode、identity、cached lock、hash/mtime、resolveLockPath、writeSelfLock；mtime tolerance 常數跟隨移入 controller。
- [x] 搬 `:272-395` 的 setSessionId/init/heartbeat/release/takeover bodies，依上表改方法名。fs 呼叫改經 deps.files 或預設 helpers；保留現有錯誤傳播，不新增 catch。
- [x] init 開頭讀取一次 `deps.getSettings()`：enabled 等價於原 global && module enabled；options 替代原 config.modules writer-lock 讀取。readonly decision 每次取得最新 options。
- [x] controller 提供 `isReadonly()` 與 `checkReadonlyCall()`；後者委派原 decideReadonlyGate，僅由 facade 在 readonly 且 guard 活躍時呼叫。
- [x] index 建立 controller，設定 getter 不能回傳 config 的初始化快照：

```typescript
const writerLock = createWriterLockController({
  ...deps.writerLock,
  getSettings: () => ({
    enabled: config.enabled && config.modules["writer-lock"].enabled,
    options: config.modules["writer-lock"],
  }),
});
```

- [x] return Runtime 的 lifecycle 方法改成直接委派；不用 this 綁定，不改原介面：

```typescript
const writerMethods = {
  setSessionId: writerLock.setSessionId,
  initWriterLock: writerLock.init,
  heartbeatWriterLock: writerLock.heartbeat,
  releaseWriterLock: writerLock.release,
  takeoverWriterLock: writerLock.takeover,
};
```

將這些方法放入原 return object；其他 Runtime 方法留在原處。handleToolCall 只替換 lock 分支，不改 hard-deny／subagent 分支：

```typescript
if (writerLock.isReadonly()) {
  const decision = guarded("writer-lock", () =>
    writerLock.checkReadonlyCall(toolName, input),
  );
  if (decision.kind === "block") return decision;
}
```

- [x] 清除 index 不再使用的 lock imports／constants／局部變數；config save 用的 state helper 不可誤刪。
- [x] `npm test -- test/writer-lock-runtime.test.ts test/writer-lock.test.ts test/integration.test.ts test/extension.test.ts` 應綠。

### Step 3 — REFACTOR：降低局部 init 複雜度

- [x] 只在 controller 檔內分成 read/integrity、decide、apply 三個具名 helper，不新增檔案。tampered 必須在 decide 前短路；invalid warning 的傳遞保持；switch 保留 exhaustive never 分支。
- [x] 延續既有啟用／停用、uninitialized／share／readonly 狀態轉移；不要順手讓 disabled 後 heartbeat 停止、改 unlock 或加入 session reset。這些都屬行為變更。
- [x] 暫時把 getter 結果改成 factory 初始化快照，確認動態設定案例失敗，再還原。暫時讓 share release 刪檔，確認測試紅，再還原。
- [x] 執行 `lsp_diagnostics`（index、controller、新 tests），再 `npm run typecheck`、`npm run lint`、`npm test`；無 build 入口，不新增 build。

**Acceptance:** index 不再擁有 lock state 或 lock fs 操作；原 Runtime 介面與 230 tests 保留；configuration／guard 仍只有原本那份。只消除跨責任讀取範圍，不以整個大 closure 搬檔達標。

---

## Task 3：驗證、記錄，進入鎖安全停止點

**Files:** 更新 `docs/design.md` §3 架構與 README；新增 `docs/plans/2026-09-09-writer-lock-safety-findings.md` 記錄重現結果與待核准安全契約。此文件由後續安全規格消費，不作額外的 prose validator。

### Step 1 — 完成首批驗證與自審

- [x] 完整重讀 diff；確認只有 Task 1／2 指定內容，不含新鎖協定、設定預設或訊息變更。
- [x] `npm test && npm run typecheck && npm run lint` 保留原 exit code；記錄測試數，不預先猜測新增後總數。
- [x] 重新量測 index 與 controller，分清 nested aggregation 與函式本體分數；init helper 沒有把整段複雜度只換名稱。剩餘警告分類說明，不改門檻消音。
- [x] 使用 reviewer／codex-exec 唯讀雙角度 review：先 list capabilities；單一 async workflowScript，分別審相容性／狀態與 I/O。主 agent 驗證 findings。任一 infrastructure failure 明示並停止該 lane，不改成其他 runner fallback。
- [x] 先跑 `lens_diagnostics mode=all`，stale primary errors 用實際 LSP／typecheck 重查。不得把既有 Markdown 風格警告當功能已壞，也不得因此忽略新的 primary errors。

### Step 2 — 只重現安全缺口，不偷渡修正

- [x] 依前一份根因文件 §6，用精確事件序列重現：A acquire → B takeover → A heartbeat；另起獨立 fixture 做 A acquire → B takeover → A release。驗證磁碟最終 sessionId 或 lock 是否消失，不能只看 A/B 的 in-memory pass。
- [x] 以測試注入的 files 記錄 child 讀寫次數（包含 damaged lock）；確認 env/self 來源分歧，不能只測回傳 undefined。
- [x] 注入 write／rename／remove failure，記錄實際傳播與 mode／cached ownership 的結果，不先決定「catch 一切」是正確修法。
- [x] concurrent acquire 用 barrier 強制兩個參與者先讀到無 lock 再寫，斷言最終 ownership；若用 fake interleaving，清楚標為模擬，不能宣稱跨 process 測試已通過。
- [x] 缺陷重現可用一次性隔離探針保存命令／結果；不把目前錯誤行為變成必須永遠通過的 production regression assertion，不留下失敗中的一般 suite。

### Step 3 — 停止並呈交下一階段決策

安全文件必須列出：

1. 每個已重現問題的 event trace、actual／expected、來源規格與影響。
2. exclusive acquisition、takeover serialization、heartbeat/release ownership fencing 的整體契約；check-then-write／單獨 O_EXCL 為何不足。
3. 持鎖 process 崩潰、stale metadata、跨 host、舊版本 lock 相容性、人工 takeover 的處理選項與推薦。
4. 是否需要改 lock schema、同步／非同步 Runtime API、引入鎖依賴，以及相容性成本。
5. 真實兩 process／barrier／crash 測試的驗收條件與 CI 環境。

- [ ] **下一階段待核准：** 操作者核准安全規格／計畫之後才實作協定；如果採 OpenSpec，先取得初始化授權再 Phase 1。這不是重新詢問已批准的 B 方向，而是核准尚未設計的權限／一致性契約。
- [x] 此處停止，不繼續 completion／git-evidence／command 大拆分，不安裝 extension。

## 首批完成條件與執行交接

- [x] Task 1、2 的實作與驗證完成；Task 3 的 review／安全重現證據已落盤。
- [x] 現有 Runtime 呼叫者不用換 import；沒有 controller → index 的循環依賴。
- [x] 狀態與 I/O 有真正所有權邊界；沒有為縮短 index 建立十多個小檔。
- [x] 最終 `git diff --stat`／status 只含核准範圍；沒有 commit／push、安裝或修改真實 agent 設定／lock。subagent 的正常 session/review artifacts 另由工具保存。
- [x] 回報明確區分「writer-lock 抽離完成」與「鎖安全問題尚待修正」，不宣稱整個複雜度工作完成。

推薦執行方式：同一 session 用 executing-plans、單一 writer 逐 task 執行，review 才平行。這批是緊耦合搬移，不需多個 implementer；如操作者選擇 subagent-driven，仍須逐 task 串行、隔離 writer，不能共用 cwd 平行修改。
