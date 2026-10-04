# Runtime Coordination Implementation Plan

> **For agentic workers:** 執行時載入 `executing-plans`；本 change 採主 session 線性實作、單一 writer。所有程式工作都在核准本 tasks 後才開始。不要另建 sidecar plan 或讓子代理再派子代理。

**Goal:** 修正 completion 的前置 I/O／失敗與生命週期邊界，再保留行為地抽離 completion、git-evidence 與 Pi adapter。
**Architecture:** 純 modules 保留；Runtime 唯一管理設定與 failureCounts；completion 以 async collect → 同步 finish 採用結果。專用 controllers 不互相匯入，adapter 不直接執行 completion Git。
**Tech Stack:** Node >=22.19.0、strict TypeScript、Vitest 5、Biome 2、Pi 0.85.1；沒有 build script。
**Spec:** [proposal.md](proposal.md)、[completion-recheck/spec.md](specs/completion-recheck/spec.md)。
**Design:** [design.md](design.md)，D1–D7 已核准；送審版本 SHA-256 `9c984fc0f7d18c8aef4779a9c35e381df3547cd80f3c2d6a763e9a75e2dc2fe5`，其後只補流程狀態。
**Execution:** `<REPO>/.worktrees/runtime-coordination`，branch `refactor/runtime-coordination`，基準 `bc114950e9ebf8967642007cc99f04522e44fc63`。
**Approval:** 2026-09-10，使用者釐清目的與觸發條件後同意繼續至 Phase 3；**本 tasks 尚待核准**，所有 checkbox 均未執行。

## Global Constraints

- 需求／D1–D7 為真相來源。不得擴張 writer、shell cwd 解析、git-evidence 判定／字元預算、全域 logger 或權限規則；不新增 timeout、重試、強鎖、host protocol。
- package／lockfile／CI 不變；不加 dependencies，不安裝或發布 extension，不讀寫真實 agent state。新測試若需要檔案，只清理由它建立的精確暫存 root；state 僅在 state/agents-guard，既有 0700／0600 政策不變。
- 既有 `src/index.ts` 的 Runtime／RuntimeDeps／createRuntime 匯入及同步方法保留；舊 RuntimeDeps 不新增必填欄位，executor 仍用 deps.gitEvidence.exec。
- 保留 hard-deny → subagent-policy；env-only child；六種事件各一個 handler；tool_result 先觀察原 content 再附加 evidence；writer 的生命週期與提示語意不變。
- 每一 task 開始前重新確認 status／diff、source 主體、測試入口及 skill 路由；只改該 task 的檔案。不要全 repo format。
- 程式 task 遵循 RED → GREEN → REFACTOR。純搬移先跑 characterization 為綠，再用負向控制證明測試能抓破壞；不把既有綠燈說成新功能 RED。
- 新增測試必須有可驗證的負向控制。命令保留原始 exit code；故意失敗與還原成功分開記錄。每批完成後完整讀 diff，作 spec／品質 review，再進下一批；需要獨立 reviewer 時遵循既定唯讀 subagent 協定。
- 核准計畫不是安裝／發布或新增遠端操作授權。本計畫不把 commit 當必要步驟；以具名檔案、diff、命令結果交付。任何 checkpoint／push／merge 另核對當時授權。
- 本模組比較 porcelain 狀態，不比內容 hash、不分析自然語言回報；同一檔案持續標示 M 時的內容變化不新增偵測保證。

## Traceability and Order

`1 → 2 → 3 → 4 → 5`，不得平行寫此 worktree。Task 1 是行為修正；Task 2–4 是保留行為的搬移；Task 5 驗整體接線、真實 Git 與文件。

| 規格需求 | 設計 | Tasks／主要斷言 |
|---|---|---|
| Eligibility before completion I/O | D2／D4／D5 | 1 的 E1–E3；2 隔離狀態；4 原 entry 接線；5 真實 Git。 |
| Scoped and trustworthy completion queries | D3／D5 | 1 的 Q1–Q3；2 controller argv／signal；5 實際快照。 |
| Bounded completion failure isolation | D5 | 1 的 F1–F3；2 不另設 counter；4 保留 hard-deny；5 完整回歸。 |
| Stop after cancellation or lifecycle invalidation | D3／D4 | 1 的 L1–L3＋最後 finish 窗口；2 失效狀態搬移；4 shutdown 順序。 |
| Preserve completion observations and follow-up limits | D2／D3／D4／D7 | 1 的 P1–P3；2 新 instance；4 原 content／單一 handler；5 文件限制。 |
| 相容性（proposal，非新功能需求） | D1／D2／D6／D7 | 2 contracts／controller；3 evidence trace；4 factory／公開匯入／命令；5 跨模組驗證。 |

## 1. 修正 Completion 的完整行為邊界（inline，尚不搬檔）

**依賴：** 已核准 spec／design、乾淨的程式基準。
**修改：** `src/index.ts` 的 Runtime 宣告、createRuntime completion facts／checkCompletionDiff／setEnabled，以及 agent_settled／session_shutdown；`test/extension.test.ts`、`test/integration.test.ts`。若需要共用可控 Promise，新增 `test/helpers/deferred.ts`，僅供本 change 測試使用。
**不修改：** pure modules、generic guards、writer controller、git-evidence 本體、package／lockfile。
**輸入：** 舊 handleToolResult／checkCompletionDiff、isModuleActive／recordModuleFailure、ExecFn。
**產出：** `CompletionNotice`、`CompletionCheck` 暫定義及 export 於 index；新增 Runtime.collectCompletionDiff(cwd, signal?) 與 shutdownCompletion()。既有方法簽章不變，Task 2 再搬 types／state。

- [x] 1.1 執行 `npm test`、`npm run typecheck`、`npm run lint`，確認 fresh baseline；核對沒有額外 dirty source。預期現基準 311 tests／16 files，實際結果若不同先調查，不覆寫使用者變更。
- [x] 1.2 先加入下列 hook／Runtime RED cases。先跑無寫入的真正 hook 測試確認現有 exec 被呼叫，再跑整組看到預期 eligibility／rejection／新 API 缺失失敗；保留命令、測試名與原始失敗摘要。

在 `test/extension.test.ts` 原 describe 中使用現有 h／exec／result／reload／observeDirtyTree；每個案例用自己的 beforeEach root。以下測試必須先在舊程式失敗，而不是先加 gate：

```ts
it("completion skips Git without successful writes", async () => {
  await h.command("off writer-lock");
  exec.mockClear();
  h.notices.length = 0;
  await h.fire({ type: "agent_settled" });
  expect(exec).not.toHaveBeenCalled();
  expect(h.entries).toEqual([]);
  expect(h.notices).toEqual([]);
  expect(h.messages).toEqual([]);
});

it("completion contains an unexpected exec rejection", async () => {
  await h.command("off writer-lock");
  await observeDirtyTree();
  exec.mockRejectedValueOnce(new Error("private executor payload"));
  await expect(h.fire({ type: "agent_settled" })).resolves.toBeUndefined();
  expect(h.entries).toEqual([]);
  expect(h.messages).toEqual([]);
  expect(h.consoleWarn).toHaveBeenCalledTimes(1);
  expect(h.consoleWarn.mock.calls.flat().join(" ")).not.toContain("private executor payload");
  expect(await h.fire(deniedCall)).toMatchObject({ block: true });
});
```

測試矩陣（ID 對應三個 scenario 的次序；使用具名 it.each，不用大迴圈掩蓋漏項）：

| ID／情境 | Setup 與必要斷言 |
|---|---|
| E1 Disabled or inert module | global off／completion off 各有成功寫入；inert 用三次注入 rejection 建立。清開關命令的 notices 後，agent_settled 的 exec／entries／notices／messages 為零；第四次不查 Git。 |
| E2 Child or no successful writes | child 由 reload({child:true}) 建立且有寫入；無寫入／僅 failed write 各驗零 I/O；成功 write／edit／ast_grep_replace 各可使前景 session 符合條件。 |
| E3 Re-enabled eligible session | 停用期間仍觀察成功寫入及 baseline；重新啟用後新事件正常比較，不清 facts。重複 on 與 off git-evidence 不使 pending completion 失效；on 不清 inert。 |
| Q1 Current event location | 初始化 Runtime 後 h.setContext 改 cwd；override exec 記錄新的 cwd 及同一 signal identity；兩次 argv 精確相符。不可只改閉包的預期值而未改 ctx。 |
| Q2 Status query is unsuccessful | code=128／code=0+killed=true／code=1+killed=true，帶非空誤導 stdout；都只查一次、無卡、無 failure log。 |
| Q3 Display-only statistics unavailable | status 成功；stat 非零且未 killed，應有原 status card 但不含 stat stdout。stat killed 時整次放棄；無卡、無配額、無 failure。 |
| F1 Exec throws during collection | status 與 stat 兩個位置各 reject，hook resolve undefined；每次只記 completion 一次 failure，不消耗配額、不改 baseline。同步 check 用會 throw 的 diffStat.trim 注入組卡故障，驗成功組卡前不扣額度。 |
| F2 Repeated unexpected failures | 失敗 → 成功 → 失敗 → 失敗累計三次，status 僅 completion inert；第四次零 exec。在取得 CompletionCheck 後使其他三次檢查失敗，也會令原 check.finish 失效。 |
| F3 Failure reporting is unavailable | consoleWarn.mockImplementation 拋出私密錯誤；三次 hook 仍 resolve，第四次不查，/status 可見 inert；不用 log 成功作唯一斷言。另用 hostile error.message getter 證明診斷不讀原 exception。 |
| L1 Already aborted signal | reload 使用已 aborted signal，有成功寫入；任何 completion exec 前略過，無 failure。 |
| L2 Disabled then re-enabled while awaiting | status／stat pending 各做 global off→on、completion off→on；晚回 success／reject 均不續查、不輸出、不 log；之後新的事件可使用原配額。 |
| L3 Shutdown or abort during collection | status／stat pending 各做 shutdown／caller abort；shutdown 後 on 仍不可恢復；單次 abort 後，在同一 Runtime 再以未 aborted 的 signal 呼叫 collect，可繼續且保留 facts／配額。 |
| P1 Default and no-baseline behavior | 預設不 follow-up；followUp=true 但無 baseline 仍只有 card；無 baseline＋clean 無卡。 |
| P2 Dirty-to-clean and unchanged snapshots | 比較相同時無卡；dirty→clean 文案包含「已恢復成乾淨」，不出現「0 個檔案不同」；stat 不影響 verdict。 |
| P3 Independent sessions and bounded follow-ups | 兩個 createRuntime facts／配額獨立；兩個重疊 collect 的 finish 按採用順序共用上限；同一 finish 第二次 undefined。同步 check 與 async collect/finish 也共用上限。 |

最後 Promise 交接窗口在 integration 明確安排；沿用該檔現有 deps helper：

```ts
it("completion does not adopt a collected result after off-on", async () => {
  const runtime = createRuntime(deps({
    fileConfig: { modules: { "completion-diff-recheck": {
      followUp: true, maxFollowUpsPerSession: 1,
    } } },
    gitEvidence: { exec: async (_command, args) => ({
      stdout: args[0] === "status" ? " M a.txt\n?? b.txt" : "", code: 0,
    }) },
  }));
  runtime.handleToolResult("write", { path: "a.txt" }, false);
  runtime.handleToolResult("bash", { command: "git status --porcelain" }, false,
    [{ type: "text", text: " M a.txt" }]);
  const old = await runtime.collectCompletionDiff("/event-cwd");
  expect(old).toBeDefined();
  runtime.setEnabled("completion-diff-recheck", false);
  runtime.setEnabled("completion-diff-recheck", true);
  expect(old?.finish()).toBeUndefined();
  const fresh = await runtime.collectCompletionDiff("/event-cwd");
  expect(fresh?.finish()?.shouldFollowUp).toBe(true);
  expect(fresh?.finish()).toBeUndefined();
});
```

同樣窗口另參數化 abort／shutdown，不只測 off-on。deferred helper 與 pending exec 使用下列形狀；pending 測試用 started Promise 判斷 exec 已進入，不使用 sleep，並在 finally 解決 pending、觀察 hook Promise 後才清理 root：

```ts
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
```

RED 命令：`npm test -- test/extension.test.ts -t 'completion skips Git'`，然後 `npm test -- test/extension.test.ts test/integration.test.ts -t 'completion'`。舊程式預期第一個有 exec 呼叫；新增 API 測試預期 collectCompletionDiff 不存在。不要用忽略測試或弱化 assert 轉綠。

- [x] 1.3 以最小 inline 變更實作 design D2–D5，跑相同 RED 命令轉綠。將既有比較／組卡主體集中成 checkCompletion；先完成 card，最後才增加 followUpCount。原 generic guards 保持原文；completion 不再套雙層 guard。

在 createRuntime 內新增 generation／closed、有效 enabled getter、current 判定與固定診斷。以下名字均為此 task 的 private symbols；COMPLETION 指定為字面常數 `"completion-diff-recheck"`：

```ts
let completionGeneration = 0;
let completionClosed = false;
const completionEnabled = () => config.enabled && config.modules[COMPLETION].enabled;
const completionCurrent = (generation: number, signal?: AbortSignal) =>
  generation === completionGeneration && !completionClosed && !isSubagentChild &&
  hadWrites && isModuleActive(COMPLETION) && !signal?.aborted;

function recordCompletionFailure(): void {
  try {
    recordModuleFailure(COMPLETION, new Error("completion recheck failed"));
  } catch {
    // Counter is updated before the logger; no raw exception or retry.
  }
}

function checkCompletion(actualPorcelain: string, diffStat: string): CompletionNotice | undefined {
  if (!completionCurrent(completionGeneration)) return undefined;
  try {
    const result = decideRecheck(observedPorcelain, actualPorcelain,
      { hadWrites, followUpCount }, config.modules[COMPLETION]);
    if (!result.changed) return undefined;
    const trimmed = diffStat.trim();
    const card = trimmed === "" ? result.summary
      : `${result.summary}\n\n--- git diff --stat ---\n${trimmed}`;
    if (result.shouldFollowUp) followUpCount += 1;
    return { card, shouldFollowUp: result.shouldFollowUp };
  } catch {
    recordCompletionFailure();
    return undefined;
  }
}

async function collectCompletionDiff(cwd: string, signal?: AbortSignal): Promise<CompletionCheck | undefined> {
  const generation = completionGeneration;
  const current = () => completionCurrent(generation, signal);
  if (!current()) return undefined;
  try {
    const status = await deps.gitEvidence.exec("git", ["status", "--porcelain"], { cwd, signal });
    if (!current() || status.code !== 0 || status.killed) return undefined;
    const stat = await deps.gitEvidence.exec("git", ["diff", "--stat"], { cwd, signal });
    if (!current() || stat.killed) return undefined;
    const actualPorcelain = status.stdout;
    const diffStat = stat.code === 0 ? stat.stdout : "";
    let consumed = false;
    return { finish() {
      if (consumed) return undefined;
      consumed = true;
      if (!current()) return undefined;
      return checkCompletion(actualPorcelain, diffStat);
    } };
  } catch {
    if (current()) recordCompletionFailure();
    return undefined;
  }
}
```

公開 Runtime 新增 design D2 的 types／兩個方法；return object 的 checkCompletionDiff 委派 checkCompletion，collectCompletionDiff 使用上述函式。shutdownCompletion 同步設 closed=true 並增加 generation。setEnabled 在 recompute 前後比較 completionEnabled，有 transition 才增加 generation，插入位置不得改動 writer transition 邏輯。

agent_settled 刪除直接 pi.exec，改為 await current.collectCompletionDiff(ctx.cwd, ctx.signal)，接著同步 `check?.finish()`；有結果才執行原 append／emit／send 區塊，三者間不得新增 await。session_shutdown 在 releaseWriterLock 前先呼叫 shutdownCompletion。沒有引入 caller 必填依賴、timer、重試或持久化。

- [x] 1.4 執行六個負向控制：移除前置 gate、移除 exec catch、忽略 generation、忽略 finish current、collect 提前扣配額、允許重用 finish。逐項跑對應 E／F／L／P 測試得到 exit 1，精確還原後相同命令 exit 0；確認 source 無 mutation 殘留。
- [x] 1.5 跑 `npm test -- test/extension.test.ts test/integration.test.ts test/completion-diff-recheck.test.ts`、typecheck、lint、相關 LSP／diff check；完整自審 Gate→I/O→finish→budget 呼叫鏈，記錄實際測試數、RED/GREEN／控制結果與未測範圍後才進 Task 2。

## 2. 抽出 Completion Controller 與型別契約（純重構）

**依賴：** Task 1 的完整行為測試已綠。
**新增：** `src/runtime/completion-diff-recheck.ts`、`src/runtime/contracts.ts`、`test/completion-diff-recheck-runtime.test.ts`。
**修改：** `src/index.ts`；必要時使用 Task 1 的 `test/helpers/deferred.ts`，不建立第二個同功能 helper。
**輸入：** Task 1 的 check／collect／facts、design D2 的 ExecFn／policy callbacks。
**產出：** 下列 controller 介面；Runtime 舊／新方法委派，failureCounts 仍在 Runtime。

```ts
export interface CompletionControllerDeps {
  exec: ExecFn;
  isSubagentChild: boolean;
  getSettings(): { active: boolean; options: CompletionDiffRecheckOptions };
  recordFailure(): void;
}
export interface CompletionController {
  observeToolResult(toolName: string, input: Record<string, unknown>, isError: boolean,
    content?: readonly { type: string; text?: unknown }[]): void;
  check(actualPorcelain: string, diffStat: string): CompletionNotice | undefined;
  collect(cwd: string, signal?: AbortSignal): Promise<CompletionCheck | undefined>;
  invalidate(): void;
  shutdown(): void;
}
```

types import 指向 `../lib/git.js` 的 ExecFn、`../types.js` 的 options、`./contracts.js` 的 CompletionNotice／CompletionCheck。factory 為 `createCompletionController(deps: CompletionControllerDeps): CompletionController`，在新 controller 檔定義，不從 index 匯入任何值。

- [x] 2.1 先跑 Task 1 回歸作搬移基準。新增 direct-controller 測試：尚未建立檔案時跑 `npm test -- test/completion-diff-recheck-runtime.test.ts`，預期缺 module/export RED；測試還須驗行為，不只檢查 export 存在。

以下完整狀態 fixture 用於新測試檔；getSettings 每次讀目前 active，而不是初始化快照：

```ts
it("controller preserves facts across disable and uses finish once", async () => {
  let active = true;
  const recordFailure = vi.fn();
  const exec = vi.fn<ExecFn>(async (_command, args) => ({
    stdout: args[0] === "status" ? " M a.txt\n?? b.txt" : "", code: 0,
  }));
  const controller = createCompletionController({ exec, recordFailure,
    isSubagentChild: false,
    getSettings: () => ({ active, options: { followUp: true, maxFollowUpsPerSession: 1 } }),
  });
  controller.observeToolResult("write", {}, false);
  controller.observeToolResult("bash", { command: "git status --porcelain" }, false,
    [{ type: "text", text: " M a.txt" }]);
  const old = await controller.collect("/event-cwd");
  expect(old).toBeDefined();
  active = false;
  controller.invalidate();
  active = true;
  controller.invalidate();
  expect(old?.finish()).toBeUndefined();
  const fresh = await controller.collect("/event-cwd");
  expect(fresh?.finish()?.shouldFollowUp).toBe(true);
  expect(fresh?.finish()).toBeUndefined();
  expect(recordFailure).not.toHaveBeenCalled();
});
```

另測 child／active=false 零 exec；observe 成功／失敗／first-text；兩個 controller state 不共用；shutdown terminal；同時兩個 collect 的逆序 finish 僅一個 follow-up；取到 check 後 policy active=false 令 finish 放棄。直接 controller 的 recordFailure spy 與 Runtime 三次 inert 是不同層證據，不能彼此代替。

- [x] 2.2 將 Task 1 facts／觀察／check／collect／generation／closed 原邏輯搬至 controller；用 deps.getSettings 取得 active／options、deps.recordFailure 通知 Runtime，不能另建 failure map。把 Runtime／RuntimeDeps／CompletionNotice／CompletionCheck types 完整搬入 contracts；index 以 type re-export 保留舊匯入位置，該檔只含 type imports／types。

Runtime 組合端保持下列形狀（COMPLETION、config、deps、isModuleActive／recordCompletionFailure 為 Task 1 既有 bindings）：

```ts
const completion = createCompletionController({
  exec: deps.gitEvidence.exec,
  isSubagentChild,
  getSettings: () => ({ active: isModuleActive(COMPLETION), options: config.modules[COMPLETION] }),
  recordFailure: recordCompletionFailure,
});
```

Runtime.handleToolResult 留下 capabilitiesListed 更新，再委派 completion.observeToolResult；兩個公開比較入口委派 check／collect，shutdown 委派 shutdown；completion enabled transition 委派 invalidate。刪除搬走的私有 facts／方法／純模組 imports，禁止雙份 baseline／counter。writer 與其他 generic guard 內容不改。

- [x] 2.3 對搬移後版本再做 generation／finish 重用的控制與還原；跑 controller＋integration＋extension，確認 Task 1 的關鍵負向控制沒有因委派而失去效果。
- [x] 2.4 跑 `npm test -- test/completion-diff-recheck-runtime.test.ts test/integration.test.ts test/extension.test.ts test/completion-diff-recheck.test.ts`、typecheck／lint／LSP／diff check；自審 contracts 無副作用及 index 匯入相容，記錄 reviewed diff 後才進 Task 3。

## 3. 抽出 Git-evidence Coordinator（純重構）

**依賴：** Task 2 完成，避免同時改 Runtime 的兩組 owner。
**新增：** `src/runtime/git-evidence.ts`、`test/git-evidence-runtime.test.ts`。
**修改：** `src/index.ts`、`test/integration.test.ts` 的 evidence characterization。
**不修改：** `src/modules/git-evidence.ts`、ExecFn、config、generic guardedAsync 及其他模組。
**介面：** `createGitEvidenceCoordinator({exec, cwd, getOptions})` 回 `{ augment(command: string, isError: boolean, signal: AbortSignal | undefined): Promise<string | undefined> }`；deps 的型別分別是 ExecFn、string、`() => GitEvidenceOptions`。

- [x] 3.1 在搬移前補 Runtime characterization，跑綠並記錄確切 trace：commit→HEAD→upstream→gh 順序、cwd、signal identity、多事件 parts 順序、disabled 時零查詢，以及執行途中停用不改既有 in-flight 行為；options A／B 捕捉的 direct 測試在 3.2 明確執行。刻意刪掉一個查詢使 trace 測試失敗，再還原；這是 characterization 控制，不聲稱原行為本來就錯。
- [x] 3.2 新增 direct coordinator 測試並跑 `npm test -- test/git-evidence-runtime.test.ts`，尚無 module 時得到預期 RED。以下 trace 測試包含真實 detector／formatters，但 executor 為 fake：

```ts
it("coordinator preserves commit-push query order and signal", async () => {
  const signal = new AbortController().signal;
  const exec = vi.fn<ExecFn>(async (_command, args) => ({
    stdout: args[0] === "log" ? "abc (HEAD -> main) fix: x" : "abc\n", code: 0,
  }));
  const coordinator = createGitEvidenceCoordinator({ exec, cwd: "/initial-cwd",
    getOptions: () => ({ checkCi: true, maxAppendBytes: 4096 }),
  });
  const text = await coordinator.augment("git commit -m x && git push origin", false, signal);
  expect(exec.mock.calls).toEqual([
    ["git", ["log", "-1", "--format=%H %d %s"], { cwd: "/initial-cwd", signal }],
    ["git", ["rev-parse", "HEAD"], { cwd: "/initial-cwd", signal }],
    ["git", ["rev-parse", "@{u}"], { cwd: "/initial-cwd", signal }],
    ["gh", ["run", "list", "-L", "3"], { cwd: "/initial-cwd", signal }],
  ]);
  expect(text).toContain("commit 驗證");
  expect(text).toContain("push 驗證");
  expect(text?.indexOf("commit 驗證")).toBeLessThan(text?.indexOf("push 驗證") ?? -1);
  expect(text).toContain("CI 狀態");
});
```

額外斷言：failed tool／echo 假字串不呼叫 getOptions 或 exec；checkCi=false 不跑 gh；upstream 非零視 null；gh throw／非零只產生未檢查文案；log／HEAD 的既有非零與 killed 處置不變；其他 exec rejection 由 coordinator 原樣向上交給 Runtime 舊 guard。Runtime 層保護單次 failure，child 不新增 completion 式 gate。

options 時點用 deferred 第一個 exec：開始時取 options A，await 期間將 getOptions 回傳值替換成新物件 B，不 mutation A；本次仍依 A，下一次才用 B。Runtime 在 evidence 已開始後 setEnabled off 不新增 generation 中斷，之後的新呼叫才被 gate；保留這個既有不對稱，不套用 completion 修正。

- [x] 3.3 搬移原 augmentGitEvidence guard 內完整 detector／exec／parts／format 邏輯到 coordinator，第一個 await 前讀 getOptions 一次；Runtime 保留原 guardedAsync 外殼。下面的委派不增加第二層 catch：

```ts
const gitEvidence = createGitEvidenceCoordinator({
  exec: deps.gitEvidence.exec,
  cwd: deps.resolver.cwd,
  getOptions: () => config.modules["git-evidence"],
});
// 在 return object 前建立委派函式，再以 shorthand 回傳：
const augmentGitEvidence = (command: string, isError: boolean, signal: AbortSignal | undefined) =>
  guardedAsync("git-evidence", () => gitEvidence.augment(command, isError, signal));
```

上述 const 作為 return object 的 augmentGitEvidence 成員，不新增另一個有不同語意的方法。把純模組 imports 移到 coordinator，Runtime 不再直接組 evidence parts。

- [x] 3.4 在新 coordinator 再做「少查 upstream」及「await 後重讀 options」控制，trace／snapshot 測試各失敗再還原；跑 `npm test -- test/git-evidence-runtime.test.ts test/git-evidence.test.ts test/integration.test.ts test/extension.test.ts`、typecheck／lint／LSP／diff check，自審 exact args、failure chain 與無新 I/O 後記錄證據。

## 4. 薄化 Pi Adapter 並保護公開入口（純重構）

**依賴：** Tasks 1–3 均綠，controllers 與 contracts 已存在。
**新增：** `src/extension.ts`。
**修改：** `src/index.ts`、`test/extension.test.ts`、`test/helpers/extension-harness.ts`。
**輸入／產出：** `registerAgentsGuard(pi: ExtensionAPI, makeRuntime: (deps: RuntimeDeps) => Runtime): void`；index default export 只呼叫它，createRuntime 本體留在 index，公開 types 重匯出。

- [x] 4.1 在原 default-export harness 先鎖住單一 handler／command、flags／save／status／completions、原 content blocks、不跟進 no-baseline 的行為。新增以下「evidence 不能變 baseline」fixture，在搬移前為綠；再將觀察錯誤地改吃附加後 content，確認會失敗並還原。

```ts
it("completion never treats appended evidence as its baseline", async () => {
  writeJsonFileAtomic(configPath, { modules: {
    "writer-lock": { enabled: false },
    "completion-diff-recheck": { followUp: true, maxFollowUpsPerSession: 1 },
  } });
  reload();
  await h.fire(result("write", { path: "a.txt" }));
  const event = result("bash", { command: "git status --porcelain && git commit -m x" });
  event.content = [{ type: "image", data: "fixture", mimeType: "image/png" }];
  const original = [...event.content];
  const patch = await h.fire(event);
  expect(patch).toMatchObject({ content: [...original, { type: "text", text: expect.any(String) }] });
  expect(event.content).toEqual(original);
  await h.fire({ type: "agent_settled" });
  expect(h.entries).toHaveLength(1);
  expect(h.messages).toEqual([]);
});
```

- [x] 4.2 在 harness 增加唯一 optional seam `activate?: (pi: ExtensionAPI) => void`，預設仍呼叫 index 的真實 default export；test 的 reload options 同步接受它。新增直接 registerAgentsGuard＋spy factory 案例，未建立新 module 時跑 RED。驗 activation 不建立 Runtime、第一個工具事件建立一次、後續 status／settled 使用同一 Runtime；舊測試不傳 override，不能全部變成假 activation。

harness 的實際呼叫改為 `(options.activate ?? activate)(api)`；新測試以以下方式啟動，再用現有 h.fire／h.command 斷言 factory 次數：

```ts
const makeRuntime = vi.fn((input: RuntimeDeps) => createRuntime(input));
reload({ flag: "completion-diff-recheck", activate: (api) => registerAgentsGuard(api, makeRuntime) });
expect(makeRuntime).not.toHaveBeenCalled();
await h.fire(result("write", { path: "a.txt" }));
await h.command("status");
await h.fire({ type: "agent_settled" });
expect(makeRuntime).toHaveBeenCalledTimes(1);
```

factory 使用真實 createRuntime，RuntimeDeps 從 contracts 或原 index type export 引入；不使用不完整的假 Runtime 掩蓋方法遺漏。

- [x] 4.3 原 default function 的完整 registration／lazy creation／emit／commands 本體搬到 extension.ts 的具名 registerAgentsGuard；只把 ensureRuntime 裡的 createRuntime 呼叫改為 makeRuntime。引用 contracts 用 type import，extension 不 value-import index。index default 改成下列薄封裝，其餘 createRuntime 保持：

```ts
import { registerAgentsGuard } from "./extension.js";
export default function (pi: ExtensionAPI): void {
  registerAgentsGuard(pi, createRuntime);
}
```

移動所需的 fs／os／path／state／Pi imports 至 adapter；同檔具名 helper 整理 hook／command，不增設 registry 或第二份 emit policy。確認 agent_settled 仍用 Task 1 的 collect／finish，shutdown 先 close completion，再做 writer cleanup；finish 到三個輸出 API 仍無 await。

- [x] 4.4 刻意重複註冊 tool_result、讓 root default 不呼叫 registerAgentsGuard、以及讓觀察吃附加 content，各得到可辨識 RED 後還原。跑 `npm test -- test/extension.test.ts test/integration.test.ts`、typecheck／lint／LSP；完整比較六個 hooks 與 command body 的搬移前後 diff，確認 factory seam 只用於指定新測試。

## 5. 跨模組驗證、真實 Git 與文件對齊

**依賴：** Tasks 1–4 完成，不引入新產品行為。
**修改：** `test/completion-diff-recheck-runtime.test.ts`（真實 Git 案例）、`README.md`、`docs/design.md` 的現況章節；本 tasks 只更新 checkbox 與執行證據，不重寫 task 規格。其他 source 僅在發現本次回歸且能定位前述 task 時修復並重跑其驗證。
**產出：** 實作與文件一致的 Phase 4 handoff，不假稱已做 CLI／SDK／平台驗收。

- [x] 5.1 用自身 mkdtemp root 建立本地 Git repo，實際執行 controller.collect／finish，比對新增未追蹤檔案與 dirty→clean；將 status 從真實 Git 取得，不用字串 fixture 冒充 filesystem 測試。測試 root 內使用隔離 Git config／環境，不 commit、不操作 remote、不借用使用者工作樹。以把 controller 的查詢導向同一暫存 root 內空白 wrong-repo 的負向控制，證明 cwd／快照案例會失敗，再還原；不得改成去查 runner 或使用者的工作樹。

沿用 `test/git.test.ts` 已採用的 node:child_process execFile／node:util promisify；controller 的 real ExecFn 僅代理固定 Git argv，成功回 code=0，正常非零回相應 code，不把 command failure 全改成 rejection。fake 的 cancellation／killed 測試仍留在 Task 1，這個案例不冒充程序停止驗收。

新增下列測試，匯入 node:fs 的 mkdirSync／mkdtempSync／writeFileSync／rmSync、node:os 的 tmpdir、node:path 的 join、execFile／promisify，以及 Task 2 的 factory／ExecFn／Vitest：

```ts
it("completion observes actual Git changes and dirty-to-clean", async () => {
  const root = mkdtempSync(join(tmpdir(), "ag-completion-real-"));
  try {
    const cwd = join(root, "repo");
    const wrong = join(root, "wrong-repo");
    mkdirSync(cwd);
    mkdirSync(wrong);
    const gitConfig = join(root, "empty.gitconfig");
    writeFileSync(gitConfig, "");
    const run = promisify(execFile);
    const exec: ExecFn = async (command, args, options) => {
      try {
        const { stdout } = await run(command, args, {
          cwd: options?.cwd, signal: options?.signal, encoding: "utf8",
          env: { PATH: process.env.PATH, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: gitConfig, GIT_TERMINAL_PROMPT: "0" },
        });
        return { stdout, code: 0, killed: false };
      } catch (error) {
        if (error !== null && typeof error === "object" && "code" in error &&
          typeof error.code === "number" && "stdout" in error && typeof error.stdout === "string") {
          return { stdout: error.stdout, code: error.code, killed: false };
        }
        throw error;
      }
    };
    expect((await exec("git", ["init", "-q"], { cwd })).code).toBe(0);
    expect((await exec("git", ["init", "-q"], { cwd: wrong })).code).toBe(0);
    writeFileSync(join(cwd, "a.txt"), "a\n");
    const baseline = await exec("git", ["status", "--porcelain"], { cwd });
    expect(baseline.code).toBe(0);
    expect(baseline.stdout).toContain("a.txt");
    const recordFailure = vi.fn();
    const controller = createCompletionController({ exec, recordFailure, isSubagentChild: false,
      getSettings: () => ({ active: true, options: { followUp: false, maxFollowUpsPerSession: 1 } }),
    });
    controller.observeToolResult("write", { path: "a.txt" }, false);
    controller.observeToolResult("bash", { command: "git status --porcelain" }, false,
      [{ type: "text", text: baseline.stdout }]);
    writeFileSync(join(cwd, "b.txt"), "b\n");
    const dirty = await controller.collect(cwd);
    expect(dirty?.finish()?.card).toContain("b.txt");
    rmSync(join(cwd, "a.txt"));
    rmSync(join(cwd, "b.txt"));
    const clean = await controller.collect(cwd);
    expect(clean?.finish()?.card).toContain("已恢復成乾淨");
    const actual = await exec("git", ["status", "--porcelain"], { cwd });
    expect(actual.code).toBe(0);
    expect(actual.stdout).toBe("");
    expect(recordFailure).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

負向控制只暫時將 controller 內的 exec options.cwd 改為 `${cwd}/../wrong-repo`，兩個目錄都屬本測試。跑 `npm test -- test/completion-diff-recheck-runtime.test.ts -t 'actual Git'` 得到預期無 b.txt 的失敗，還原後相同命令成功；fake 的 signal／killed 證據仍單獨保留。

- [x] 5.2 更新 README 的 completion 行為／失敗語意／限制，以及 docs/design.md §3.1／§3.3、§5.3–5.5、§7、§8.2 中受此次變更影響的描述。列出新檔責任、零 I/O 條件、collect→finish、三次 inert、stat 降級、未執行驗收；保留 git-evidence 已知限制與 writer advisory，不改歷史 docs/plans／archive。修正碰到的 completion 章節明顯錯字，不擴成全文件重寫。

文件應明說：agent_settled 在執行已穩定結束且無待續跑時觸發；session 曾成功寫入即可符合條件，不限最後一回合；porcelain 相同不代表內容未再變；follow-up 預設關閉且按 session 限額。不要把新的五項 completion 規格提前寫進 canonical specs，Phase 6 再處理。

- [x] 5.3 跑完整 `npm test`、`npm run typecheck`、`npm run lint`，對所有實際 changed TS files 做 primary LSP，確認 lens session 診斷的實際覆蓋；跑 workflow pre-check、OpenSpec strict validation 與 diff check。所有命令 exit 0 才可標記完成；無法跑的驗收明示原因與替代證據，不以 cached lens 或 prior CI 代替。

```bash
npm test
npm run typecheck
npm run lint
node "<USER_HOME>/.pi/agent/skills/openspec-superpowers-workflow/scripts/validate-openspec-workflow.cjs" openspec/changes/refactor-runtime-coordination
openspec validate refactor-runtime-coordination --strict --no-interactive
git diff --check
git diff --stat
```

沒有 build script，不杜撰 build 命令。這些命令不應放進遮蔽 exit code 的管線；分別執行或用明確的失敗即停 shell。確認 package／lockfile／CI、writer module／controller／canonical spec 沒有任務外差異；new files 必須一起完整讀取，不能只看 tracked diff。

- [x] 5.4 自審完整 changed/new-file diff、逐項核對 E1–P3 與 D1–D7，將 RED/GREEN／控制／實際 Git／hook／未執行項目記錄到下方執行證據；準備精確檔案與 baseRef 的唯讀 review brief。完成此 Phase 4 handoff 後凍結 proposal／specs／design／tasks，進入 Phase 5。

## Phase 5 Handoff（非 task checkbox，不回改凍結文件）

正式雙重 review 由一個 async workflowScript 的 runs.all 同時派可用、未停用的 native reviewer 與唯讀 codex-exec，分別查 completion 的 I/O／failure／生命週期與相容性／entry／evidence。執行前列 capabilities；外部 runner 還須 available=true；不讓 reviewer 寫 worktree 或再派子代理。保持 bounded 讀檔輸出，不搜尋 /nix/store／home、不讓外部 reviewer 跑測試或安裝。

launch／工具／parser 等基礎設施失敗就記錄 exact run／錯誤／cwd／branch／HEAD 與 partial diff，暫停該 lane，不靜默改用 foreground／其他 CLI；只經同協定重試或取得 owner 授權。主 agent 親自認證 findings，單一 writer 修 code，再測試／重讀 diff／re-review。

所有 review feedback、修正與最終驗證證據寫入 review-notes.md，不能再回來改這裡的 checkbox。review-notes 的成功證據與核准範圍決定 checkpoint 是否可進行；未完成 review 不宣稱整體完成。Phase 6、遠端整合、安裝各依獨立授權與 gate 進行。

## Execution Evidence

### Task 1 — Phase 4 執行中（2026-09-10）

- **核准紀錄：** 使用者以「核准」批准已提交的 tasks（原 SHA-256 `15f2b33aa83fd562face554d16227bd6c84186fa56c1fc66c84504be3e95a8a8`），進入 Phase 4。上方 Approval 保留 Phase 3 提交時的狀態；本節記錄後續執行，不改 task 說明、proposal／spec／design。尚未進入 Phase 5。
- **狀態：** 1.1–1.5 已完成。初次 review、外部同協定 retry、stat assertion 補強／M8 與局部 re-review 已收斂，詳見 review-notes.md；在 17:10:23 重跑 143 tests／typecheck／lint 後進 Task 2。沒有 commit／push／安裝／發布。
- **Task review：** 已確認 native `reviewer` 與 available 的唯讀 `codex-exec`，透過單一 async `runs.all` workflow `4298e06c-c6b5-4dc9-ada7-cba96444f7be` 派發，分別查 lifecycle／failure／quota 與 hook／相容性／測試品質。這是 Phase 4 task review，不是整體 Phase 5；初次派發時結果待回收；後續 retry／re-review 的實際 output references 與主 agent 認證記於 review-notes.md。
- **檔案：** `src/index.ts`（inline 行為修正）、`test/extension.test.ts`、`test/integration.test.ts`、新 `test/helpers/deferred.ts`。未搬 controllers／contracts／adapter，未改 generic guards、純 modules、writer、git-evidence、package、lockfile 或 CI。
- **基準：** HEAD `bc114950e9ebf8967642007cc99f04522e44fc63`；Node v22.23.2／Darwin arm64。重新以 HEAD 的 Git archive 建立獨立暫存 baseline（沿用 worktree 已安裝 dependencies），執行 `npm test`＝311 tests／16 files、`npm run typecheck`、`npm run lint`，全部 exit 0。這是 HEAD snapshot 驗證，不冒稱新增測試已通過或新版本 CI；沒有為此還原工作區的新測試。
- **RED：** `npm test -- test/extension.test.ts -t 'completion skips Git when no-writes'`，exit 1，實際收到 status／stat 兩次 exec（預期零）。再跑 `npm test -- test/extension.test.ts test/integration.test.ts -t completion`，41 failed／22 passed／58 skipped，exit 1；失敗包含 eligibility、killed、late results、rejection 外洩、既有同步故障診斷洩漏，以及 collect／shutdown API 尚不存在。LSP 當時 20 個錯誤均為缺少新增 API；未把 fixture／語法錯誤當行為 RED。當場原本已綠的相容案例不宣稱為 RED。
- **GREEN：** 同一 completion 命令為 63 passed／58 skipped，exit 0。`npm test -- test/extension.test.ts test/integration.test.ts test/completion-diff-recheck.test.ts` 為 143 passed／3 files，exit 0。完整 `npm test` 為 **364 passed／16 files**（新增 53 cases），typecheck／lint／diff check 均 exit 0。初次 lint 僅有三個格式差異，以具名四檔 Biome check --write 處理，沒有全 repo format。
- **文件閘門：** workflow pre-check 與 `openspec validate refactor-runtime-coordination --strict --no-interactive` 均通過；completion spec SHA-256 仍為核准的 `62feb7d64c6fa6209edfc3a7a795441c2f52b69de8929fbd4f9f03f133db7da6`。
- **診斷：** 四個 changed/new TS files 的 explicit primary LSP（waitMs=2000）全部 clean。早先 LSP 曾保留 RED 的舊 API 缺失訊息，後續 source 更新與重新掃描已清除；不把當時快取當成實作型別結果。最後 `lens_diagnostics mode=all` 回傳主工作區／歷史 cache 的 1274 warnings（文件樣式、既有複雜度等），沒有 blocking error；它不是本 worktree 新程式的完整掃描，未改範圍外檔案消除這些警告。
- **送審後最終本機重驗：** Vitest 16:46:44 為 364／16，typecheck／lint／diff check 皆 exit 0。僅將新增 signal identity 斷言折行以符合 formatter，無行為更動；review patch 已同步。四檔 SHA-256：index=`d5e91de7eb9bbafe6e6b35f336b2a2503fd7c243e9a87bb0ca68479ee3ef615a`、extension test=`a45afbae0e63a5833ed57ca91f86b6adddba8996c59618b8115956880d1e7112`、integration test=`81ded2b284683c7a54ab78d3fce077f94fa032ebb2caff3c40463824e33437c3`、deferred=`63e014a9d9b52b02ac06eae6180ade615e4be43fcea291eb4a0673440fd96ff9`。
- **自審：** 已完整重讀 tracked diff 與新增 helper；確認 Gate→status→stat→一次性 finish→比較／組卡→quota→原 append／emit／send 順序，finish 後無新增 await；baseline 不因查詢改寫，failure counter 仍唯一由 Runtime 管理；shutdown 先使 completion 終止再清 writer。另補 signal 的 `toBe` identity 斷言，不只比對 argv／cwd。

| 負向控制 | 選取測試（`npm test -- test/extension.test.ts test/integration.test.ts -t '<pattern>'`） | 原始結果／還原結果 |
|---|---|---|
| M1 移除 completion 前置 gate | `completion skips Git when no-writes` | exit 1：仍查一次 Git；精確還原後 exit 0，1 passed。 |
| M2 讓 exec catch 重新拋出 | `completion becomes inert despite interrupted logging=false` | exit 1：promise rejected 而非 resolve；還原後 exit 0，1 passed。 |
| M3 略過 generation equality | `completion discards late status result after off-on \(reject=false\)` | exit 1：不該續查卻有第二次 exec；還原後 exit 0，1 passed。 |
| M4 移除 finish 的 current 檢查 | `completion discards a finished collection after off-on` | exit 1：失效結果仍產卡；還原後 exit 0，1 passed。 |
| M5 collect 提前扣 follow-up 額度 | `completion does not reserve quota during collection` | exit 1：同步 check 已無額度；還原後 exit 0，1 passed。 |
| M6 允許重用 finish | `completion consumes concurrent collections in finish order` | exit 1：第二次 finish 仍產卡；還原後 exit 0，1 passed。 |
| M7 附加 signal 控制：status 改傳另一個 signal | `completion uses the event cwd and signal` | exit 1：不同 signal 未符合傳遞契約（1 failed／1 passed）；還原後 exit 0，2 passed。 |

- **還原與工具限制：** 每項 mutation 都以 Task 1 GREEN source snapshot 精確還原並執行相同測試，source SHA-256 `d5e91de7eb9bbafe6e6b35f336b2a2503fd7c243e9a87bb0ca68479ee3ef615a`。AST dry-run 的 follows 變體因本機缺少 CLI（`npx canceled due to missing packages and no YES option: ["ast-grep@0.1.0"]`）不可用；M1／M4 改用已人工確認唯一區段的 edit，其他 AST dry-run／apply 成功。沒有安裝套件，也沒有子代理 fallback。
- **暫存原始證據：** `<LAB_ALIAS>/`，含 baseline logs、RED log、M1–M7 各自 red／restored logs 與原始 exit、source snapshot、review patch。長期交接以本節摘要及後續 review output references 為準。
- **證據分層／未測：** 新增案例是 Runtime／pure 邊界與實際註冊 hook harness，Git／killed／rejection 使用注入 executor；未把它們當真實程序取消或完整 Pi CLI／SDK 驗收。新 completion 的 actual Git 案例待 Task 5；Node 22.19.0、其他平台、writing-subagent、permission-load-order 及安裝驗收仍未跑。既有 writer 的實際 Git／filesystem 測試有隨完整 suite 回歸，但不替代新 completion 驗收。

### Task 2 — Completion Controller 搬移 checkpoint（2026-09-10）

- **狀態：** 2.1–2.4 完成；雙重 task review 與主 agent 認證已收斂，詳見 review-notes.md 的 Task 2 結論。17:37:00 重跑相關四檔 162 tests／typecheck／lint 皆通過，送審 hashes 不變；總計 9／21 checked，允許進 Task 3。尚未凍結為 Phase 5。
- **檔案／責任：** 新 `src/runtime/completion-diff-recheck.ts`、`src/runtime/contracts.ts`、`test/completion-diff-recheck-runtime.test.ts`；index 新增窄 deps 組合及 observe／check／collect／shutdown／invalidate 委派，移除其私有 facts 與 completion 純模組 imports。failure map／安全 completion diagnostic 留在 Runtime；contracts 只有 type imports／types，root type re-exports 保留舊位置。沒有新增 dependencies／執行器形狀或 sidecar plan。
- **基準與 RED：** 搬移前相關三檔 143 tests／typecheck／lint 為 exit 0。先新增 19-case direct-controller suite，`npm test -- test/completion-diff-recheck-runtime.test.ts` 於 17:12:56 為 exit 1，原因精確為尚無 `../src/runtime/completion-diff-recheck.js`。這是核准計畫的 missing-module RED，不把它說成 19 個獨立行為 failures；既有行為的 characterization 初次轉綠後再以 mutations 驗證敏感度。
- **GREEN：** 搬入 controller／contracts 並讓 Runtime 委派後，`npm test -- test/completion-diff-recheck-runtime.test.ts test/integration.test.ts test/extension.test.ts test/completion-diff-recheck.test.ts`＝**162 passed／4 files**，exit 0；direct suite 19 cases。涵蓋 disable facts、first valid text／錯誤與非 porcelain observation、三種成功 writes、child／inactive／無或失敗 writes 零 I/O、instance 隔離、逆序 finish 共享 quota、即時 active／options、terminal shutdown、scoped argv／同 signal／stat，以及 controller 不另建 inert counter。
- **負向控制：** 僅暫時修改新 controller；每次 AST dry-run／apply 均唯一匹配，獨立 shell trap 精確還原 Task 2 GREEN controller，不使用 Task 1 的舊 index snapshot 覆蓋搬移。每項 **3 failed／exit 1 → 同一選取命令 3 passed／exit 0**，原始 failure 全文已讀回，皆為預期 assertions，不是 module／syntax failures。
  - M9：略過 generation equality；direct disable→enable、Runtime 最終 finish window、registered hook late status→stat 三層均紅。
  - M10：移除 consumed guard；direct once／reverse finish 與 Runtime concurrent collections 均紅。此控制沒有宣稱 hook 可重用私有 finish；hook 在該 selection 被 skip，完整 hook 回歸另已通過。
  - M11：刪去非空 stat 附加；direct card、既有 hook entry、同步 Runtime return 三層均紅，證明 Task 1 stat finding 搬移後仍受保護。
- **Fresh 最終本機驗證：** 17:26:55 `npm test`＝**383 passed／17 files**（相對 Task 1 新增 19 cases）；`npm run typecheck`、`npm run lint`（38 files）、`git diff --check` 均 exit 0。具名 Biome check --write 僅格式化兩個新檔。兩次 explicit primary LSP（index／controller／contracts／new test，waitMs=2000）皆四檔 clean，第二次在 M9–M11 精確還原後執行。
- **自審／相容：** 已完整重讀三個新檔與 Task 2 index delta。逐 byte 核對 moved type declarations、原 adapter 全段、generic guards／failure operations 及 git-evidence method 與 Task 1 baseline 相同。公開 types 仍由 index 匯入，既有 integration／extension 未新增 Task 2 修改；Runtime 動態 active 仍包含原三次 inert，completion callback 計數先於 logger 且不外包第二層 guard。新 controller 不 value-import index，未產生循環。
- **原始證據：** `<LAB_ALIAS>/task2/`：`index.before.ts`、`before.patch`、`index.delta.patch`、`controller.green.ts`、`red.log`、M9–M11 各自 red／restored logs 及原始 exit、`run-control.sh`。已精確比對 source restoration。
- **未驗證：** direct-controller／Runtime／registered-hook 都以注入 executor 為主；本步沒有新的 actual Git、完整 Pi SDK／CLI、最低 Node／其他平台或安裝驗收。Task 5 的 actual Git 與 Task 4 shutdown trace 仍待辦。這是 Phase 4 per-task checkpoint，不是整體完成或遠端整合授權。

### Task 3 — Git-evidence Coordinator 搬移 checkpoint（2026-09-10）

- **狀態：** 3.1–3.4 完成，雙重 task review 與主 agent disposition 已收斂（review-notes.md）。17:59:31 重驗相關四檔 164 tests／typecheck／lint 通過，12 個 review hashes 不變；目前 13／21 checked，進 Task 4，仍是 Phase 4；沒有新的 Git／安裝授權或操作。
- **範圍：** 新 `src/runtime/git-evidence.ts`、`test/git-evidence-runtime.test.ts`；修改 index 組合／委派與 integration evidence characterization。純 module、ExecFn、config、completion controller／contracts／其 direct suite、writer、adapter／extension suite、package／lockfile／CI 均未改。
- **搬移前 characterization：** 17:39:55 原 evidence／integration／extension 為 139／3。先補 7 個 Runtime cases；`npm test -- test/integration.test.ts -t 'runtime: git-evidence'` 為 **15 passed／49 skipped**（原 8＋新 7），17:41:07 exit 0。涵蓋 commit→HEAD→upstream→gh 完整 trace／同 signal／固定 cwd／exact parts、global／module off 零查詢、兩種 in-flight disable 保留後續查詢而下一次被 gate、child／completion shutdown 不感染 evidence、單次 failure 與三次 inert 仍歸 Runtime。
- **M12 搬移前控制：** AST 唯一替換原 index 的 upstream await 為相同 stdout 的常數（保留 card 表面內容，僅刪查詢）；`npm test -- test/integration.test.ts test/git-evidence-runtime.test.ts -t 'evidence preserves commit-push query order and signal'`＝**1 failed／exit 1**，trace 精確少 upstream。當時 direct 檔尚不存在，Vitest 只選到 integration；精確還原 index 後同命令 **1 passed／exit 0**。原先綠燈屬 characterization，不稱作既有 bug RED。
- **Module RED／GREEN：** 先寫 direct coordinator 測試；17:45:09 `npm test -- test/git-evidence-runtime.test.ts` 為 exit 1，精確原因是未建立 `../src/runtime/git-evidence.js`，不是 18 個行為 failures。搬移完成後 17:46:49 `npm test -- test/git-evidence-runtime.test.ts test/git-evidence.test.ts test/integration.test.ts test/extension.test.ts` 為 **164 passed／4 files**；direct suite 18 cases。
- **Coordinator 行為／測試：** detector／formatters 仍用真實純 modules，exec 為 fake；no-event 不讀 options／exec；每次有事件在首 await 前取 options 一次；完整 argv／cwd／signal identity／輸出 parts；checkCi=false 無 gh；upstream 非零視 null；gh throw／非零只降級 CI；保留 log／HEAD 的非零／killed 與 upstream／gh killed 舊處置；其他 rejection 原樣向上交 Runtime。已 aborted signal 案例的 executor 刻意忽略取消，只證明 coordinator 不新增 completion gate，不是假稱實際程序不取消。
- **M13 搬移後少查 upstream：** 僅變動新 coordinator，選 `preserves commit-push query order and signal`，direct＋Runtime trace **2 failed／exit 1 → 還原後 2 passed／exit 0**；因此新 owner 確實在 Runtime 路徑上。
- **M14 options snapshot：** deferred 第一個 exec；在等待期間用新物件 B（checkCi=false／budget=20）替換 A（true／4096），A 不被 mutation。當次須完整 CI／未截斷，下一次才用 B。AST 將兩處 opts field 讀取改為 await 後重讀 getOptions；`-t 'coordinator captures options before'` 得到 **1 failed／exit 1**，實際輸出錯誤地沒有 CI 且提前截斷為 20；精確還原後 **1 passed／exit 0**。這是 payload 差異，不僅 mock count 斷言。
- **Fresh 全量驗證：** 17:48:55 `npm test`＝**408 passed／18 files**（Task 3 新增 7＋18＝25 cases）；typecheck／lint（40 files）／diff check 皆 exit 0。具名 Biome 僅格式化本 task touched files；explicit primary LSP 四檔在搬移後與 M13／M14 還原後皆 clean。
- **自審與保留邊界：** 已完整重讀 new coordinator／direct suite、所有 integration additions 與 index delta。逐 byte 確認 generic guards／failure functions、hard-deny→subagent／observations／writer handlers、整段 adapter 不變；Task 2 completion controller／contracts／tests 與 extension/helper hashes 不變。初始 exec／cwd 固定注入符合 Task 3 計畫，只有 options 逐次讀；未宣稱可 hot-swap deps。coordinator 只有原 gh catch；其餘錯誤穿過唯一 Runtime guardedAsync。沒有新 I/O、timers、generation、重試或跨模組 policy。
- **原始證據：** `<LAB_ALIAS>/task3/`：apply guidance、index／integration baseline、兩份 scoped delta patches、module `red.log`、M12–M14 red／restored logs 與原始 exit、精確 `coordinator.green.ts`、具來源／snapshot 配對限制的 `run-control.sh`。每項 mutation 後皆以相同來源 snapshot 還原；沒有把舊 inline index 覆蓋到搬移後狀態。
- **未測：** 本步為 injected executor 與既有 registered-hook 回歸，未新增 actual completion Git／完整 SDK／CLI／最低 Node／跨平台或安裝驗收。Task 4 的 factory seam／shutdown trace 與 Task 5 actual Git／文件仍待做。

### Task 4 — Pi Adapter 搬移 checkpoint（2026-09-10）

- **狀態：** 4.1–4.4 完成；雙重 task review 與 image assertion／M21 局部 re-review 已收斂，詳見 review-notes.md。18:44:30 fresh 130／2、typecheck、lint 通過後接受 4.4，總計 17／21 checked，進入 Task 5；仍為 Phase 4，不是整體結案。
- **範圍：** 新 `src/extension.ts`；修改 index default/imports、extension test 與 harness。整個 createRuntime 本體逐 byte 不變；controllers／contracts／integration／pure modules／package／lockfile／CI 都不動。Adapter 從 flag 註冊到 command/completions 的全部原 body，僅將 ensureRuntime 內 factory 名 createRuntime 改為 makeRuntime；其餘逐 byte 相同，包括原 named emit／ensureRuntime helpers、六個 hooks 與 command body。
- **SDK 核對：** chub `pi-coding-agent` 只有不相關結果，broader `earendil` 為零；沿用已讀的官方 Pi 文件，另查 locked 0.85.1 local types 的 ExtensionAPI、AgentSettledEvent、SessionShutdownEvent。appendEntry／sendMessage 為同步 void；沒有新增 SDK API。沒有安裝、更新 dependency 或用其他版本介面。
- **搬移前 characterization：** 18:02:57 extension＋integration 基準 **128／2**。原 root-default harness 新增 image-only 原始輸出＋status/commit 複合 command 案例；18:04:00 選取 `completion never treats appended evidence as its baseline` 為 **1 passed／64 skipped**。M15 暫時讓原 index 再觀察附加後的 content，錯誤觸發 follow-up，**1 failed／exit 1 → 精確還原後 1 passed／exit 0**；原行為正確，這是 characterization 控制。
- **唯一 seam／module RED：** harness 僅加 optional `activate?: (pi: ExtensionAPI) => void`，呼叫改 `(options.activate ?? activate)(api)`；其餘 mocks／strict checks 不變。只有一個新 factory-spy case 傳 override，其他 65 cases 仍用原 root default。先寫測試再建立 adapter，18:06:15 選取 `adapter creates one lazy Runtime` 出現缺 `../src/extension.js` 的預期 module-load RED／exit 1（0 tests），不稱為行為 failure。
- **Factory／lifecycle 證據：** factory 使用真實 createRuntime，兩個 spies 仍轉呼叫原 shutdown／release 方法。Activation 不建 Runtime；第一個 tool result 建一次，status／settled／command/evidence／shutdown 共用同一 instance。切 context 後 completion 用新 cwd、evidence 用首次 cwd，trace 比對完整 argv；shutdown 嚴格為 completion→writer，之後 settled 零新增 exec。此測試落實 Task 1 延後的 shutdown 順序斷言，也鎖住 Task 3 的初始 cwd 接線。
- **已修正的 fixture 型別錯誤：** 初次 runtime 測試雖為 130 passed，explicit LSP／typecheck 捕捉新 shutdown fixture 遺漏必填 reason（TS2345，typecheck exit 2）；依 SDK 的 `reason: quit|reload|new|resume|fork` 與既有案例，僅補 `reason: "quit"`，沒有放寬 HarnessEvent／cast。這不是 production RED。18:10:13 重跑 **130 passed／2 files**、typecheck、lint、四檔 primary LSP 全通過。
- **搬移後控制：** 每項 AST dry-run 唯一匹配，僅變動指定 index 或 adapter，以正確 post-move snapshot 精確還原並重跑相同 `npm test -- test/extension.test.ts -t '<pattern>'`。每項均 **1 failed／exit 1 → 1 passed／exit 0**；已讀回原始 failure 全文。
  - M16：多註冊一次 tool_result；`registers every expected event exactly once` 的七筆事件陣列出現重複，assertion RED。
  - M17：root default 不呼叫 registerAgentsGuard；相同 selection 在 harness 的必備 command assertion 得到 `Missing agents-guard command`。這是故意破壞 host 註冊所致的 beforeEach failure，不是 module/syntax error，證明 default 入口仍受測。
  - M18：adapter 錯誤再觀察 augmented content；image-only case 產生不應有的 follow-up，重現 M15，證明搬移後仍保護原始 baseline。
  - M19：交換 shutdown／writer cleanup；factory-spy trace 精確得到 writer→completion 而失敗，原 Task 1 deferred finding 的防護已建立。
  - M20：取消 memoization、每次 ensureRuntime 重建；factory case 在 settled 看不到前一 instance 的 writes，預期 completion entry 遺失而失敗，證明不是只檢查 factory export 存在。
- **Fresh 最終驗證：** 18:14:12 `npm test`＝**410 passed／18 files**（Task 4 新增 2 cases）；typecheck／lint（41 files）／diff check 全 exit 0。M15–M20 還原後再跑 explicit primary LSP（index／adapter／extension test／harness）四檔 clean。沒有 build script，不虛構 SDK build／CLI 驗收。
- **完整自審：** 已完整重讀 adapter、兩個新 test callbacks 與三份 scoped patches；程式比對確認所有 hooks/command/helper body（除 factory 名）與舊 root 完全相同、createRuntime 完全相同、8 個 prior source/test hashes 不變。extension 只 type-import contracts，不 value-import index；root type exports／createRuntime 保留原位置。六 handlers、唯一 command、原 flag/save/status/completion 行為、原 content image blocks、append/emit/send 同步順序維持。
- **原始證據：** `<LAB_ALIAS>/task4/`：apply、三份 before snapshots／scoped delta patches、module red.log、M15–M20 red／restored logs 與原始 exit、post-move adapter.green.ts／index.green.ts、具 source/snapshot 配對限制的 run-control.sh。舊 inline snapshot 未覆蓋 post-move source。
- **未測：** 新 factory／baseline／shutdown 都是實際註冊 hook＋真實 Runtime＋fake executor；不是完整 SDK/CLI session 或跨平台驗收。沒有重跑真實安裝、writing-subagent、權限載入順序／最低 Node；Task 5 actual Git 與文件仍待做。

### Task 5 — 真實 Git、文件與 Phase 4 handoff（2026-09-10）

- **狀態：** 5.1–5.4 完成，21／21 checked。這只表示 Phase 4 實作／驗證 handoff 完成，正式 Phase 5 全變更双重審查尚未收斂；不能宣稱 merge／安裝／發布就緒。自此凍結 proposal／delta specs／design／tasks；後續 feedback／修正／驗證只進 review-notes.md。
- **新案例／範圍：** `test/completion-diff-recheck-runtime.test.ts:38–115` 的 `completion observes actual Git changes and dirty-to-clean`，沿用核准 plan 的 execFile／promisify wrapper。每次 mkdtemp 自建 repo＋空白 wrong-repo，隔離 Git system/global config 與 inherited Git env；baseline 來自實際 status。建立 b.txt 後 collect／finish 顯示 b.txt；只刪自身 a.txt／b.txt 後顯示恢復乾淨，另以 Git status 確認空 stdout；finally 僅清理自身 root。不 commit／remote／讀寫使用者工作樹。
- **GREEN／M22：** 18:46:48 controller baseline **19 passed**；加入真實案例後 18:47:40 selection **1 passed／19 skipped**，代表現行行為的 characterization，不冒稱 production bug RED。M22 將兩個 controller exec 的 cwd 暫改 `${cwd}/../wrong-repo`（兩 repo 皆屬同測試）；18:48:47 **1 failed／exit 1**，錯誤 clean card 不含應有 b.txt，明確驗出錯 cwd。精確還原該 controller 自身 snapshot，18:48:48 同 selection **1 passed／exit 0**。stat 未被當成判定資料，控制不是 fixture／環境缺失。
- **工具與證據誠實性：** AST object pattern 經一次 relaxed retry 仍零匹配，按規則改用已完整讀過的唯一 query block 精準 edit；沒有安裝套件。專用 run-control.sh 固定唯一 source／GREEN 配對、EXIT trap 還原、保存原始退出碼，沒有使用 Task 1 inline index snapshot。real ExecFn 對正常 numeric nonzero 回 code，非此形狀才拋錯；本真實案例未注入 subprocess cancellation，不能說它驗了 killed／abort 或每個 error-mapping 分支。
- **文件：** README／docs/design 現況章節說明責任分層、穩定 agent_settled、session 任一回合成功寫入、零 I/O、collect→finish、單次採用／配額、三次 inert／safe logger、stat 降級、dirty→clean／no baseline、porcelain 非 hash／非原子與 delivery 限制。補上 Task 4 note 的 fixed initial evidence cwd、upstream／gh／UTF-16 舊限制；不改 writer advisory。沒有改歷史 plans／archive／canonical completion spec。
- **文件解析：** 使用已安裝 locked SDK 內的 marked CLI（實際 --version **18.0.5**；help footer 舊版字樣不作版本依據），完整 help 後以 task5/marked.json 明確設定避免讀取 home config，將兩份 Markdown 解析成 HTML；stdlib HTML parser 讀回 README 的 16 headings／5 tables、design 的 35 headings／12 tables，10 個 local links 逐一解析存在。這是 parser／link 檢查，不是瀏覽器或 Pi TUI 視覺驗收；未新增 repo dependency／validator。
- **Fresh repo 驗證：** 18:59:46 相關四檔 **168 passed／4 files**；18:59:47 全部 **411 passed／18 files**（基準 311＋本 change 100）。typecheck／lint（41 files）／diff check 全 exit 0。實際 changed/new TS 共 11 檔，explicit primary LSP（waitMs=2000）全部 clean，含還原後 controller。lens mode=all 仍回 No files diagnosed yet，不當額外 active scan；以主動 LSP＋tsc 作型別證據。workflow pre-check／OpenSpec strict 通過。
- **完整自審與防漂移：** 重讀全部 tracked diff（含先前 Tasks 1–4）與七份新增 TS，並核對 Task 5 的三份 scoped patches。Byte-compare 確認 generic isModuleActive／recordModuleFailure／guardedRun／guardedRunAsync、writer lifecycle body、原 RuntimeDeps 與去除兩個 additive 方法後的 Runtime 宣告同 HEAD。Pure modules／shared lib／config／state／types／writer controller、package／lockfile／CI／canonical specs／歷史文件均無差異。預期 source 差異只在 index 與四個新檔，tests 不移除旧 cases；只加新 cases／assertions 與唯一 harness seam。
- **威脅／失敗自審：** 不把 raw error.message／stderr／工具輸入帶入 completion failure log；hostile getter 與壞 logger 有實際注入測試，計數在 log 前。所有新 completion Git 走固定 argv／事件 cwd／signal，無 shell 插值、remote、重試或 kill；generation 為單 Runtime 失效，不是互斥／程序停止。原始 tool content 先觀察再 append，M18/M21 防 baseline 污染及 image 原地 mutation；card 本身仍包含既有原始 porcelain／stat，不宣稱新增通用清洗。Pi output 故障不回滾 request quota。Guard failure chain／denial priority 與其他模組政策未改。
- **原始證據根：** `<LAB_ALIAS>/task5/`：apply、before snapshots、controller.green.ts、M22 red/restored logs/exits、run-control.sh、三份 scoped patches、tracked.patch、targeted/full/typecheck/lint logs/exits、Markdown HTML outputs。完整 M1–M21 與各分批 review 的 references 見上文／review-notes。

#### E1–P3 核對（tested 層級，不等於 SDK acceptance）

| Scenario | 已核對的實際入口 | 控制／邊界 |
|---|---|---|
| E1 disabled／inert | extension:190、340；controller zero-I/O cases | M1；inert 後 exec=0，成功／on 不重設 |
| E2 child／no successful writes | extension:190、215；integration:891 | 只失敗 write 不算，instance facts 不混用 |
| E3 re-enable | extension:227；integration:764 | 停用仍觀察，復原採 live policy |
| Q1 cwd／signal | extension:243、470；actual Git controller test:38 | M7 signal；M22 wrong-cwd |
| Q2 failed status | extension:261 | code／killed 不採 stdout，不查 stat |
| Q3 display-only stat | extension:279、298、636；integration:931 | 非零略統計；killed 放棄；M8/M11 成功 stat literal |
| F1 unexpected rejection | extension:310；integration:854、871 | status／stat／組卡故障；M2 catch |
| F2 repeated failures | extension:340；integration:837 | 中間成功不歸零，第三次使 pending result 無效 |
| F3 unavailable diagnostics | extension:310、340 | hostile error getter／logger throw，安全 detail／單次計數 |
| L1 pre-aborted | extension:190 | 第一個 exec 前零 I/O |
| L2 off→on during await | extension:382；integration:724 | status/stat × resolve/reject，M3/M9 generation；M4 finish-window |
| L3 shutdown／abort | extension:382、470；integration:724 | 兩個 await／final finish-window；M19 shutdown→writer；無立即停止程序聲明 |
| P1 default／no baseline | extension:636、690；direct write cases | dirty 只提醒，clean 無輸出；followUp 預設關 |
| P2 dirty→clean／unchanged | extension:458、682；actual Git test:38 | 真實 a/b 新增／刪除，保留 normalize 比較 |
| P3 instances／budget | extension:701；integration:783、799、891；direct reverse finish | M5/M6/M10，不預扣、不重用、sync/async 共用額度 |

表中 extension／integration 均為 `test/*.test.ts`；controller 為 `test/completion-diff-recheck-runtime.test.ts`。M22 僅選取 actual Git case，其餘 19 skipped 不計為該次控制覆蓋；完整 411 結果沒有 skipped cases。最終 finish-window／新 signal 恢復額度是 Runtime 測試，不冒充 hook scheduler／SDK 併發驗收。

#### D1–D7 核對

| Design | 實作／驗證 |
|---|---|
| D1 專用 owners | runtime/completion、git-evidence、contracts；Runtime config/failure owner、無通用框架 |
| D2 additive compatibility | root exports／createRuntime、原方法 shape／同步性；RuntimeDeps byte-identical，tsc／舊 integration 仍跑 |
| D3 collect→finish→delivery | completion:82–110、extension:130–155；M4–M6/M10；after-finish no-await 靜態核對，無新增 timing mutation 聲明 |
| D4 facts／generation／terminal | completion:43–53、113–136；Runtime transition／shutdown；兩 await 與 final-window controls |
| D5 trusted status／failure | completion:89–109、check；Runtime:135–141 固定安全 logger；killed/nonzero/fault tests |
| D6 evidence compatibility | fixed exec/cwd、每次 options reference、ordered argv／原不對稱；M12–M14，18 direct cases |
| D7 adapter seam | 六 hooks／一 command、lazy real Runtime、原始 blocks、default 委派；M15–M21，root/adapter body 比對 |

#### Phase 5 精確交接 brief

- Repo `<REPO>`；唯一 review cwd `<REPO>/.worktrees/runtime-coordination`；branch `refactor/runtime-coordination`；**baseRef=HEAD**，已解析 HEAD/base=`bc114950e9ebf8967642007cc99f04522e44fc63`。變更均未提交；不能只 diff HEAD 看不到新檔，也不能用上一 task scoped patch 冒充全變更。
- Source：`src/index.ts`、新 `src/extension.ts`、新 `src/runtime/{contracts,completion-diff-recheck,git-evidence}.ts`。Tests：`test/{extension,integration,completion-diff-recheck-runtime,git-evidence-runtime}.test.ts`、`test/helpers/{deferred,extension-harness}.ts`。Docs：README、docs/design；核准範圍與執行歷史在本 change。排除上述驗證過未變的 writer／pure／config／package／CI／歷史資料。
- Native reviewer 查 completion I/O／catch／生命周期／配額與安全 fault；readonly codex-exec 查 root/API／adapter／evidence 相容性、real Git fixture 隔離與文件一致性。兩者都看完整 change 的必要呼叫鏈，給不同焦點、不只看 Task 5。不跑 tests／install／改檔／fanout，不讀真實 agent secrets／state；bounded source reads、報告附 file:line。
- **未驗收：** 本機 Darwin arm64／Node 22.23.2／Git 2.55.0。真實 completion Git 只驗自身 repo 新增 untracked／dirty→clean；正常 numeric-exit wrapper 不等於完整 process cancellation。SDK/CLI／具憑證模型回合／writing-subagent／permission load-order／最低 Node 22.19.0／其他平台與本次 CI／安裝／發布未執行：超出本輪或需要另行 host/auth/環境授權，單元／hook／Git/型別檢查是替代局部證據，不是假裝完成全部驗收。既有 GitHub Ubuntu/Node22 CI 是 baseline，不屬本 change；沒有條件 skip 來遮蔽本機新 Git test。
- **已知限制保留：** porcelain 非內容 hash／status+stat 非原子，重複收尾可重複提醒；request quota 非 transactional delivery；fixed executor／evidence initial cwd，不新增 hot-swap／multi-repo/upstream freshness/UTF-16修正；no-added-await 路徑用源碼比對而非独立 timing mutant；existing image case 的淺拷貝未順手改，新的同 handler 控制已保護本次缺口。其餘範圍外文件舊例／設計債記錄於 review-notes，不藉本重構改產品行為。

Phase 4 每 task 完成時在本節記錄：task ID、具名檔案、RED 原因／命令／exit code、GREEN 命令／實際測試數、負向控制與還原結果、LSP／typecheck／lint 結果、自審／review 結論、殘餘風險。Phase 5 開始後改寫 review-notes.md，不修改本節。
