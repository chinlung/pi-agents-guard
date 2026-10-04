# Writer-lock 安全停止點：抽離結果、重現證據與待核准契約

- 日期：2026-09-09
- 分支／工作樹：`refactor/progressive-b`／`.worktrees/progressive-b`
- 基準：`1876b59b19af919e65d67dd7dfbb1f5a2c7a760b`；本批未 commit、push 或安裝。
- 本文件為下一階段安全規格的輸入，**不是已核准的協定，也不是安全修復完成宣告**。

## 1. 本批界線與驗證

已將 writer-lock 的狀態與檔案協調抽到 `src/runtime/writer-lock.ts`，保留公開 Runtime／RuntimeDeps、JSON 格式、hooks、設定優先順序與第一個 block 短路。`index.ts` 的設定與 guard 未另建副本。controller 在 init 與 readonly 判定時讀取動態 getter。

驗證命令皆於上述 worktree 執行，未啟動真實 LLM／git commit／push／gh：

| 驗證 | 結果 |
| --- | --- |
| 抽離前 `npm test`／`npm run typecheck`／`npm run lint` | 13 files／230 tests，全部 exit 0 |
| 新接線 characterization（抽離前） | 18 tests 通過；後續加 child 接線與加強 content／signal 斷言 |
| controller 的 RED | 缺少 `src/runtime/writer-lock.ts`，預期 import 失敗 |
| 最終 `npm test` | 15 files／258 tests 通過，原 230 tests 未改動 |
| `npm run typecheck`／`npm run lint` | exit 0；Biome 檢查 33 files |
| 新 production／test 檔 primary LSP | 5 files，0 diagnostics |
| mutation：錯置 turn_end 註冊、丟棄 block、漏傳 signal | 各自正確失敗，已還原 |
| mutation：初始化設定快照、share 誤當 writer 並刪 holder 檔 | 各自正確失敗，已還原 |
| 一次性安全探針 | 8 個重現斷言通過；不納入一般 regression suite |

接線 harness 呼叫真正 default export 註冊的 handlers／commands；未知 API/context 存取或 exec 命令直接拋錯。fixture 擁有唯一 temp root，harness 只還原自己的 environment／console spies，清理由 fixture 精確執行。相同 AbortSignal 另以 `toBe` 驗證物件身分，原 text/image content 及 details/isError 的不覆寫也有斷言。

這不證明真實 pi runner 的跨 extension 順序或並行安全。新增測試沒有真實宿主多 session／跨 process 執行。

## 2. 複雜度：分開看聚合值與本體

使用同一份本機 pi-lens 4.1.5 `functionFactProvider` 對基準及目前原始碼量測；本體探針沿同一 AST 與 decision/operator 規則計數，但在巢狀 function 邊界停止。未調高門檻或加 suppress。

| 位置 | 含巢狀函式聚合 | 僅函式本體 |
| --- | --- | --- |
| 基準 index createRuntime | 66 | 1 |
| 目前 index createRuntime | 47 | 1 |
| 基準／目前 entry | 28／28 | 1／1 |
| 基準 initWriterLock | 16 | 16 |
| 新 createWriterLockController | 22 | 2 |
| 新 readCurrentLock | 6 | 6 |
| 新 applyDecision | 8 | 8 |
| 新 init | 4 | 4 |
| 未搬 handleToolResult | 13 | 13 |

index 768→616 行，controller 212 行。真正改善是 lock 狀態不再與其餘模組共用 closure，且原初始化責任分成讀取／完整性、既有 `decideLockAction` 與套用三部分；不是將 66 誤當單一函式本體複雜度，或聲稱總程式碼更短。entry 與其他模組的聚合警告仍存在，不屬本批阻擋項。

## 3. 重現方式與觀察

探針只使用自己 `mkdtempSync("ag-safety-probe-…")` 建立的目錄，lock 位於該 root 的 `state/agents-guard/locks/`，每個 fixture 結束精確移除。共用測試設定：

- `worktree={root: <temp>/repo, branch:"main"}`；`now=Date.now()`。
- A：sessionId=a、pid=111、host=fixture；B：sessionId=b、pid=222、同 host。
- `isPidAlive=()=>true`；`getSettings=()=>({enabled:true, options:resolveConfig({}).config.modules["writer-lock"]})`。
- `files` 預設使用原 state helpers；只有明確標示的 fault／interleaving 覆寫特定 helper。
- 以 `lockFilePath(worktree.root)` 找到唯一 lock；讀回磁碟 JSON 或檔案存在性，不只比較 memory flags。

### 3.1 實際檔案上的 takeover 缺乏所有權防護

**兩個獨立 fixture：**

```typescript
A.init(worktree, now);
B.takeover(worktree, now + 1); // 先讀回 disk sessionId === "b"
A.heartbeat(now + 2);         // 實際 disk sessionId === "a"，應保持 b
```

```typescript
A.init(worktree, now);
B.takeover(worktree, now + 1);
A.release();                 // 實際 lock 不存在，應保留 B 的檔案
```

來源：`src/runtime/writer-lock.ts:189-199`；基準 `src/index.ts:371-380` 已存在相同問題。heartbeat 只信任 cached selfLock，release 不驗證磁碟所有權。

影響：新 writer 的鎖被舊 holder 覆寫／刪除，第三者可能取得 writer 身分。違反 `docs/design.md` §5.1 的單一 writer 與 shutdown 釋放自己 lock 的目標。這是實際 filesystem 的序列重現，**不是兩個真 process 的 race test**。

### 3.2 Child 未在 lock I/O 前退出；注入的身分可能矛盾

先寫入有效 schema，但 heartbeat 比實際 mtime 舊 20 秒的 holder；child 設 `self.isSubagentChild=true`。注入 `vi.fn(state.readJsonFile)` 與 `vi.fn(state.writeJsonFileAtomic)`：

- 實際 read=1、write=0，init 回 error，`isReadonly()===true`。
- 目標應為 skip、不做 lock I/O、不因 holder 完整性而擋 child。
- 來源：`src/runtime/writer-lock.ts:172-186`，先 read/integrity 才進 `decideLockAction`；違反 design §5.5 background child 規則。

另用真正 `createRuntime`，注入 `env.PI_SUBAGENT_CHILD="1"`、`writerLock.self.isSubagentChild=false`：subagent prerequisite 為 pass，但 init 仍在磁碟取得 lock。來源是 `src/index.ts:121` 與 controller 的 self 兩條來源。舊 integration fixture 也有此矛盾（`test/integration.test.ts:248-254`、`:409-420`）。目前實際 entry 同時從 process.env 建立兩者（`src/index.ts:404-408`）；**沒有證據顯示真宿主目前會產生這個矛盾**。新 hook 測試已覆蓋正常環境 child 不取得乾淨 worktree 的 lock，尚未修正 Runtime 的雙來源契約。

### 3.3 Lifecycle 失敗未進入 guard，狀態先於寫入成功改變

| 探針 | 實際結果 | 影響 |
| --- | --- | --- |
| B 先 readonly，再讓 `files.writeJsonFileAtomic` 拋錯後呼叫 takeover | 錯誤外拋、readonly=false、磁碟仍為 A | 記憶體已放棄 readonly，但沒有取得 lock |
| 建立「lock 路徑是一個目錄」後 init，讓真正 rename 失敗 | 錯誤外拋、readonly=false、同目錄留下 `.tmp-` 檔 | 寫入不是完整的 rollback transaction |
| writer 的 `files.removeFile` 拋錯後 release，再呼叫 heartbeat | release 外拋；後續 heartbeat 仍更新原 lock | release 失敗時 cached writer 尚存，不能宣稱已釋放 |

來源：`src/runtime/writer-lock.ts:82-92`、`:193-202`；直接委派 `src/index.ts:240-244`；實際 temp 寫入／rename 為 `src/state.ts:35-43`。本次 write/remove fault 是注入 helper 例外；rename fault 是真實 filesystem 目的路徑形態衝突，不是假稱測過權限／磁碟滿。例外未計入 module failures，也不會因第 3 次 lifecycle failure 自動 inert。

design §4.4／§7 fail-open 與上述實作有落差。但安全修正不能只 catch 一切：必須先決定失敗後權限、cached ownership、重試與是否保留 readonly，再隔離例外；否則 catch 可能使無鎖 writer 繼續寫入。

### 3.4 並行取得：目前只有模擬交錯，尚未跑真 process barrier

兩個 controller 的 `files.readJsonFile` 都回傳同一份「無檔案」快照，模擬 A/B 都已讀到 absence 再先後寫入：

1. A.init 與 B.init 都回 undefined，兩者 readonly=false。
2. 磁碟最後為 B；接著 A.heartbeat 又改回 A。

原 `state.writeJsonFileAtomic` 的 rename 只避免讀到半份 JSON，**不提供 exclusive acquire 或 compare-and-swap**（`src/state.ts:35-43`）。`docs/design.md` §5.1／§6.3 的 `O_EXCL` 要求尚未實作。

這個探針證明 controller 沒有後續競爭／所有權驗證；**不能宣稱已重現真實排程機率、測過兩個 process 或驗證跨平台原子性**。

### 3.5 本機重跑入口

一次性原始探針保留於此 worktree 的 ignored `.vitest/writer-lock-safety.probe.test.ts`。Vitest 設定只收 `test/**/*.test.ts`，直接指定 `.vitest/` 會報 no test files；重跑方式如下，無論測試成功或失敗都搬回 ignored 位置：

```bash
mv .vitest/writer-lock-safety.probe.test.ts test/writer-lock-safety.probe.test.ts
npm test -- test/writer-lock-safety.probe.test.ts
rc=$?
mv test/writer-lock-safety.probe.test.ts .vitest/writer-lock-safety.probe.test.ts
exit "$rc"
```

以上腳本限在新 shell、正確 worktree 且目的檔不存在時執行。探針斷言現有缺陷以固定 trace，不是希望保留的正確行為，所以不進一般 suite；未保存至 Git 的探針不是日後 clone 的依賴，§3.1–3.4 的 fixture／步驟／actual 才是耐久交接。複雜度探針同樣是本機 ignored `.vitest/complexity.mjs`。

## 4. 下一階段建議契約（待核准）

### 4.1 先決定完整的互斥與所有權模型

- acquisition、takeover、heartbeat、release 必須使用同一套跨 process serialization；持有 token／generation 的比較與寫入／刪除必須在同一臨界區。
- 單獨為 acquisition 加 `O_EXCL`，擋不住 takeover 之後的舊 heartbeat/release；check-then-write 仍有比較後遭替換的空窗。
- 失去 token 的舊 session 必須在下一次寫工具判定降為 readonly，不能只停止 heartbeat。release 不刪其他 generation。
- **Metadata fencing 不能撤銷已開始或已獲准執行的工具。** 若要保證真正「同時一個 writer」，takeover 還必須等舊 writer 的進行中操作結束；活著的 holder 未確認停止時，不應承諾強制接管是安全的。
- 建議優先評估本機 OS 管理、process 崩潰會釋放的互斥原語／可驗證 helper；持久 JSON 只作身份與診斷。若採 portable filesystem mutex，必須連它自己的 stale lock 回收一起設計，不能用第二個同樣有競態的 lock 當修復。

### 4.2 恢復與相容性選項

| 情境 | 建議 | 代價／替代方案 |
| --- | --- | --- |
| process 已死 | 以 OS 釋放與身份驗證後回收，建立新 generation | PID 可能重用，僅 `kill(pid,0)` 不夠；需 process identity 或保守人工裁決 |
| heartbeat 逾時但 holder 活著／暫停 | 不只因 TTL 自動偷鎖；先保持 readonly | 犧牲便利，避免長工具／暫停 process 的 split-brain |
| 不同 host／網路共享 state | 預設 readonly、不自動回收；首版明確限制本機 filesystem | 若要跨 host，需分散式租約／fencing，不是加 PID 檢查 |
| 舊版 version=1 lock | 不靜默忽略；確認舊 writer 停止後由操作者遷移／接管 | 新舊 process 並存時舊版不懂 generation，可破壞新版安全；需明確阻擋混用 |
| 人工 takeover | 優先「已停用舊 writer 後接管」，失敗保持原權限，不預先切為 writer | 保留現有任意強制接管會留下 in-flight 工具風險，須另行接受降級保證 |
| unlock／重新啟用 | 明確定義是否降為 readonly、是否要重新 acquire | 現有 unlock 會 disabled 且不再擋寫；改變需新的行為規格 |
| I/O 失敗 | 明確 rollback／quarantine／通知與 failure counter，再決定 fail-open 範圍 | 全部 catch 後 pass 不等於安全；可能需要對權限判定採不同失敗政策 |
| background child | 在任何 lock I/O 前由單一 canonical self 判斷 skip | 公開 Runtime 注入與 env 的相容策略需定義；不靠修改測試旗標掩蓋 |

這些是建議，不代表已取得改 fail-open、TTL、unlock 或 takeover 的授權。

### 4.3 schema、API 與依賴成本

- generation／owner token 可能需要 lock version=2；要寫升級與拒絕混用策略，不能聲稱 JSON 完全相容。
- 同步 Runtime 方法無法等待可取消的跨 process lock；若選 async primitive，應明確評估 lifecycle／takeover 方法改 Promise 的公開相容成本。
- 可替代為同步非阻塞 try-lock（忙時保持 readonly，稍後重試），但需定義退避、UI 與活性；不要用同步長時間 busy-wait 卡住 pi。
- OS helper 或 lock 套件可能新增 native binary／依賴；實作前需核對 Node 支援平台、CI、crash/recovery 原語，不在本批偷偷加套件。

### 4.4 真實跨 process 驗收

下一份安全規格至少要要求：

1. 兩個獨立 Node process 用 barrier 同時競爭，只有一個成功；逐項驗證 sessionId、generation、工具 gate 與檔案權限。
2. takeover 後舊 process 的 heartbeat、release 與下一次寫工具不破壞新 owner；另測已開始的長工具與接管如何協調。
3. 在取得前、持有中、寫 temp 後、rename 前後強制結束測試 child；重啟後不 split-brain、不永久卡死、不誤刪新鎖。
4. 真正 write／rename／remove 故障與 PID reuse／stale／foreign-host／v1 混用；不能靠 mock 次數判定互斥成立。
5. 所有測試僅管理自己 spawn 的 PID、自己建立的 temp root；finally 回收，無真實 agentDir 副作用。
6. CI 使用 repo 的 Node >=22.19.0 環境；若宣稱跨平台，Linux/macOS/Windows 均提供關鍵 primitive 並實跑，不用條件 skip 假裝覆蓋。遠端 CI 尚未執行，本批未 push。

## 5. 停止點

本批在 writer-lock 抽離、接線保護與安全重現後停止。不繼續拆 completion／git-evidence／command，不安裝 extension。下一步須核准安全模型、相容性與實作計畫；若採 OpenSpec，再明確授權初始化，才開始 Phase 1。

## 6. Review 結果與處置

單一 async workflow `942b80dd-1675-4acd-893a-8fc7c323b74a` 的兩個 child 均 completed：

- reviewer（compatibility，`81b9361b-fc80-47e6-8bdf-73569cd20a72`）：完整比對基準 index 與新 facade/controller，未發現行為退化，結論為 **OK with notes，僅限抽離**。
- codex-exec（wiring-safety，`cf43fcb2-a57e-4eed-9141-dcb58631e1f4`）：核對接線測試、隔離清理及八個探針原始碼，未發現可確認的新增 P0/P1/P2 缺陷；列出非阻擋性的覆蓋缺口。
- 主 agent 已用 Git 確認主 checkout 的 source 仍等於 `1876b59`，以及本批沒有改既有 tests、config/state/pure modules、package/lockfile；不以符號行號相同取代檔案差異驗證。

| 意見 | 主 agent 處置 |
| --- | --- |
| `checkReadonlyCall` 未寫明前置 gate | 採納；在 `src/runtime/writer-lock.ts:64-67` 補註 facade 必須先確認 readonly、enabled 與 failure counter。只改註解，不新增重複 gate |
| `files` 注入分支只由 ignored 探針消費 | 屬本計畫明確批准的故障注入邊界，不是新增 runtime bug；保留。`typeof DEFAULT_FILES` 與計畫四個 State helpers 的 Pick 結構等價，無需為命名額外 export |
| 尚無同時命中 writer-lock/subagent-policy 的先後順序案例 | 來源 `src/index.ts:202-217` 順序正確，本批未改；記為後續接線測試補強，不宣稱已測此衝突案例 |
| flag 註冊次數/options 未被 harness 保護 | CLI flag 的套用已有斷言，但不能攔截刪除 registerFlag；記為非阻擋性的 harness 補強 |
| facade 缺少先建 runtime、切換設定、再首次 start 的 acquire 案例；options 替換只測 controller | 動態 getter 的實作已逐項核對，現有 controller／readonly toggle 測試仍有效；記為後續 coverage，不誇大端到端覆蓋 |
| lifecycle 故障、真 process 競爭未進一般 suite | 維持安全停止點；在下一份核准規格中寫正確行為的 regression，不把既有缺陷鎖成期望值 |

兩份完整 review 由 harness 存於 session 的 `subagent-artifacts/outputs/942b80dd-1675-4acd-893a-8fc7c323b74a/review/`（`compatibility.md`、`wiring-safety.md`），此表為 repo 內耐久摘要。兩個 reviewer 僅做靜態檢查，沒有重跑測試；codex 的 macOS Git cache 警告未阻止取得 status/diff/SHA，未更換 runner。

補註後主 agent 再執行 `npm test && npm run typecheck && npm run lint`：15 files／258 tests、TypeScript、Biome 皆 exit 0；5 個變更 TypeScript 檔的 explicit primary LSP 為 0 diagnostics，複雜度與 §2 相同。`lens_diagnostics mode=all` 的 session cache 只有主 checkout 的既有警告；對 ignored worktree 做指定路徑 full 掃描仍回 no files diagnosed，**不把這個覆蓋缺口視為乾淨結果**。本批以明確檔案 LSP、worktree tsc/Biome 與測試作驗證；沒有為消掉主 checkout 既有 Markdown／聚合複雜度警告改動其他檔案。

結論：首批抽離可驗收，鎖安全修復與安裝仍待後續核准。本輪沒有 commit、push 或安裝；工具正常寫入的 session/review artifacts 不等於修改真實 agent 設定或 lock。
