# Runtime Coordination — Review Notes

## Task 1 review 回收與 infrastructure blocker（2026-09-10）

這是 Phase 4 的分批 task review，不是完整變更的 Phase 5 handoff。進度仍為 1.1–1.4 完成；1.5 未通過，Task 2–5 暫停。此輪只回收、認證與記錄 findings，未改 code/tests、未重跑測試，不把前輪 364 tests 當成新驗證。

### Run 與保存狀態

- Workflow `4298e06c-c6b5-4dc9-ada7-cba96444f7be` 已 complete。
- Native `reviewer`：`9c306ca6-a5b9-4540-bb43-2be15681b1f2`，完成靜態審查，結論 **OK with notes**，不是無 finding。
- 外部 `codex-exec`：`8ef6da94-68ec-492e-81bf-5f38d056bd1d`，runner exit 0／state complete，但明確回報缺少 `contact_supervisor` 而停止；只查 status／diff 統計，沒有 source review。**執行結束不等於 review 通過**，本 lane 判為 infrastructure blocked。
- Repo：`<REPO>`（main clean）。Cwd/worktree：`<REPO>/.worktrees/runtime-coordination`；branch `refactor/runtime-coordination`；HEAD/base `bc114950e9ebf8967642007cc99f04522e44fc63`。三個 tracked 修改、未追蹤 change folder 與 helper，沒有 staged 檔案、沒有新 commit。
- 已保存 partial diff：`<LAB_ALIAS>/task1-infra-blocked.patch`。四個 source/test SHA-256 與前輪驗證值完全相同：
  - `src/index.ts`：`d5e91de7eb9bbafe6e6b35f336b2a2503fd7c243e9a87bb0ca68479ee3ef615a`
  - `test/extension.test.ts`：`a45afbae0e63a5833ed57ca91f86b6adddba8996c59618b8115956880d1e7112`
  - `test/integration.test.ts`：`81ded2b284683c7a54ab78d3fce077f94fa032ebb2caff3c40463824e33437c3`
  - `test/helpers/deferred.ts`：`63e014a9d9b52b02ac06eae6180ade615e4be43fcea291eb4a0673440fd96ff9`

### [CODE] N — Native findings 與主 agent disposition

1. **接受，待補測試：成功 diff-stat 附加區塊缺少斷言。** `src/index.ts:237–261` 的完整 checkCompletion 定義確認會 trim 並附加成功 stat；`test/extension.test.ts:569–584` 與 `test/integration.test.ts:804–821` 的成功案例只檢查檔名／follow-up，未直接保護該區塊。這是搬移前應補的 characterization，不是現行程式 bug。最小補強為檢查 `--- git diff --stat ---\na.txt | 1 +`，並以移除 stat 附加的 mutation 證明會失敗。**不直接照抄 reviewer 建議的 leading space**，因 `.trim()` 已移除它。本輪尚未修改或執行該控制。
2. **接受追蹤至 Task 4：shutdown→writer cleanup 順序缺少直接斷言。** `src/index.ts:613–617` 目前順序正確。Task 4.2–4.4 已有 factory seam 與搬移順序契約；屆時以真實 Runtime 加 spy 的序列斷言保護，現在不提前擴 adapter/harness。不是 Task 1 的程式缺陷。
3. **不採納本輪可讀性重寫。** `completionCurrent(completionGeneration)` 在同步 check 故意不檢查舊 generation；collect/finish 另外持有 captured generation。`completionEnabled` 只用來偵測有效開關 transition，`isModuleActive` 另含 inert。兩者職責與核准設計相符，不因風格建議改動行為或新增架構。

### 測試證據邊界

- Abort 後改用新 signal 的配額保留由 Runtime test 證明；hook 使用同一已 aborted signal 的案例只證明後續零 I/O。
- 最終 collect→finish 失效窗口與重疊配額由 Runtime API 測試，沒有宣稱 hook 併發或 SDK/CLI 已驗。
- Killed/rejection/取消皆為 injected executor；真正 completion Git 驗收、文件更新與 controllers/adapter 搬移仍屬 Task 2–5。
- 既有 appendEntry/emit/sendMessage 不作 exactly-once transaction；valid finish 已扣 request quota，不回滾部分輸出，符合 D5，非新回歸。

### Infrastructure 認證與同協定重試

- 原外部 run 報告：「當前工具清單沒有 `contact_supervisor`，無法完成指定的首要協調步驟」。另有 Darwin sandbox `/tmp/xcrun_db-*` cache 寫入警告，但該次狀態查詢 command exit 0；不據此宣稱所有 Git 命令均可用。
- Workflow receipt 明載 `externalAdapter.capabilities.supervisor = "unsupported"`，理由為 generic external CLI adapter 沒有 trusted supervisor event transport；resume/steer 也不支援。這不是可以臨時補上的 native Pi tool。
- `subagent get codex-exec` 確認：builtin、未停用、system prompt 僅要求唯讀／簡潔證據／不得擴權，未要求先聯絡 supervisor。**尚未證實那條首要協調要求實際由哪個 ambient/injected prompt 產生**，不把 child 的說法當作已定位的套件 bug。
- 初始 stdout 只有一個實際 command event；報告中的 `ALL_TOOLS.filter(...)` 沒有相應工具事件，僅當 child 自述，不冒稱主 agent 已執行或可呼叫該介面。
- 處置：停止進入 Task 2，保持相同 `codex-exec`、async workflow、read-only sandbox、approval never 與原 cwd，僅明確說明本 task 以 final response 回到 parent，不需要 native supervisor 起手式，做一次 fresh same-protocol retry。若另有更高優先級指令仍強制該工具，要求回報具體指令／來源並再次停止；不偽造工具、不改 sandbox、不安裝、不改 agent 設定，也不切 foreground/其他 CLI。原 run 不可 resume。

### 原始報告與 receipt

- Native report（receipt 的 outputReference）：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/4298e06c-c6b5-4dc9-ada7-cba96444f7be/review/task1-completion-lifecycle.md`
- External report（實際 read 已確認存在；receipt 未提供 outputReference）：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/4298e06c-c6b5-4dc9-ada7-cba96444f7be/review/task1-hook-compatibility.md`
- Receipt：`<SUBAGENT_TMP>/async-subagent-runs/4298e06c-c6b5-4dc9-ada7-cba96444f7be/workflow-receipt.json`
- External status/stdout：同 async-subagent-runs 下 `8ef6da94-68ec-492e-81bf-5f38d056bd1d/status.json`、`external-0.stdout.log`。其中 state complete/exit 0 只證明程序結束，不能消除上述 review blocker。

### Same-protocol retry 派發

- Workflow `29b3b02f-c754-4b7d-b4e6-725217dc4025`，key `task1-compatibility-same-protocol-retry`，沿用 mission `a5d577fd-a715-46e7-9181-a1844fa50a77`；已重新確認 codex-exec executable、未停用且 runner available。
- 僅以同一 async subagent 協定重試外部 lane；不重跑已完成的 native 審查、不 resume 不支援續接的舊 external run。明確限定 final-response 交接，不解除更高優先級指令或擴權；若仍衝突則要求精確回報來源並停止。
- 此時尚無重試結果，不算 review 通過；code/tests 仍未修改，stat 測試補強與 Task 2 均待後續處理。

## Task 1 retry 結果與 stat characterization 補強（2026-09-10）

- **外部 blocker 已解除：** workflow `29b3b02f-c754-4b7d-b4e6-725217dc4025`／child `4e4b0d93-7022-4f04-9474-3f1ac6bea138` 完成真正的唯讀靜態審查，未提出既有 notes 以外的 production／相容性缺陷。報告已完整讀回：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/29b3b02f-c754-4b7d-b4e6-725217dc4025/review/task1-hook-compatibility-retry.md`。沒有切換執行模式或擴權；初次失敗紀錄仍保留，不回溯改為成功。
- **[CODE] N — stat 測試缺口已修正，待 scoped re-review：** `test/extension.test.ts:578–580` 透過真正 registered hook 的 entry，及 `test/integration.test.ts:820` 透過同步 Runtime return，新增成功 stat 的 literal assertion `--- git diff --stat ---\na.txt | 1 +`。既有檔名、通知與 follow-up 斷言全部保留；只增加四行 assertion，沒有新增 mock、fixture、test case 或 production 行為。
- **Characterization／負向控制 M8：** 原 behavior 正確，新增斷言後先為 2 passed；這個綠燈不稱為新功能 RED。接著 AST dry-run 確認唯一匹配，暫時讓 checkCompletion 的非空 stat 分支只回 result.summary；同一命令得到 **2 failed、exit 1**，兩處恰在新增的 stat 斷言失敗。精確還原 source 後 **2 passed、exit 0**。
  - 命令：`npm test -- test/extension.test.ts test/integration.test.ts -t 'shows a completion entry without injecting|returns a card without a follow-up'`。
  - 原始證據：`<LAB_ALIAS>/M8.red.log`、`M8.restored.log`、`M8.exits`。
- **Fresh 驗證：** 修改前基準（17:02:41）364／16、typecheck、lint 全通過。修改後（17:04:56–17:04:58）相關三檔 143 tests、完整 364 tests／16 files、typecheck、lint、diff check 全部 exit 0。四個 changed/new TS files 的 explicit primary LSP（waitMs=2000）全部 clean。
- **完整差異／還原：** 已重讀兩個完整 callback 與前後 patch 差異，只多出上述四行測試斷言；source 與 helper SHA-256 不變，沒有 mutation 殘留。source=`d5e91de7eb9bbafe6e6b35f336b2a2503fd7c243e9a87bb0ca68479ee3ef615a`；extension test=`ef91aa9af8efe919041f5bd7e90ae7f571eddfbcff0c9d733b78474cca0beec7`；integration test=`28f1fe33612cc9bd81582c59ad9b8f6f31680bd54a854ac5bc98b32df58d319a`；deferred=`63e014a9d9b52b02ac06eae6180ade615e4be43fcea291eb4a0673440fd96ff9`。
- **界線：** 這是 injected executor／Runtime／registered-hook characterization；沒有實際 Git CLI 或完整 SDK session 新驗收。shutdown 次序斷言仍追蹤至 Task 4，沒有為此提前增加 adapter seam。Task 1.5 待原 native reviewer 的局部 re-review，不把外部 review／本機綠燈當作整個 change 完成。
- **局部 re-review 已派發：** workflow `84139fba-c004-414e-b3cc-9dea552a43fa`，key `task1-stat-assertion-recheck`；已核對原 reviewer `9c306ca6-a5b9-4540-bb43-2be15681b1f2` 為 resumable，透過同一 async subagent 協定續接。範圍僅四行 assertion、完整 callback 與 M8 證據，不另做一輪全量雙重 review。回收後才判定 1.5 與 Task 2 readiness。

## Task 1 結案與 Task 2 搬移 checkpoint（2026-09-10）

- **[CODE] N — stat finding 已結案：** 已讀回 workflow `84139fba-c004-414e-b3cc-9dea552a43fa` 的 complete receipt 與 child `c3f8b169-f499-40ee-a543-dc09ad699fb7` 全文。Reviewer 確認兩層 literal assertion 與 trim 語意相符、未削弱既有 assertions、M8 確實保護整段輸出；結論 **No issues found within this scoped delta；可繼續 Task 2**。報告：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/84139fba-c004-414e-b3cc-9dea552a43fa/review/task1-stat-assertion-recheck.md`。
- **主 agent 認證：** 已核對完整兩個 callback／checkCompletion 與前後 patch；同意 stat 缺口解決。分隔用空行未精確鎖成兩個 newline 屬微小排版覆蓋限制，不擴張修補。shutdown→writer cleanup 直接 trace 仍依核准安排留至 Task 4。此結論不代表 whole-change merge／發布就緒。
- **搬移前 fresh gate：** Task 2 動手前 17:10:23 重跑 Task 1 三檔 **143 passed**、typecheck、lint，皆 exit 0；source 與已審查版本相同，HEAD／branch 未改，沒有 staged 檔案。因此完成 1.5，再依核准 Task 2 執行。
- **Task 2 本機 checkpoint：** 新增 completion controller、type-only contracts 與 19 個 direct-controller cases；index 只組合／委派，failure map 仍唯一由 Runtime 擁有。詳細 module-missing RED、M9–M11 控制與 383／17 fresh 驗證記於 tasks.md 的 Phase 4 Execution Evidence。2.1–2.3 已完成；2.4 待唯讀雙重 task review，尚不進 Task 3。

## Task 2 雙重 review 收斂（2026-09-10）

- **Run／實際報告：** workflow `4e4e9642-9a1e-432b-90a5-cbaf6f5aaeb0` complete；native child `1ab31742-c7e1-4441-8159-782bd46d5071` 為 **OK with notes**，external child `f6862507-2687-4c75-82f3-3dc00780bc3e` 未發現可採納程式缺陷。兩者均判 Task 3 ready；主 agent 已讀回兩份完整報告，不能把 native 的 notes 說成零 finding。
  - Native：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/4e4e9642-9a1e-432b-90a5-cbaf6f5aaeb0/review/task2-completion-owner.md`。
  - External：同目錄 `task2-contract-compatibility.md`；雖通知顯示 Saved output unavailable，實際檔案已讀回，確有 source review／baseline 比對，不只 runner exit 0。
- **[CODE] N — direct suite 的覆蓋形狀：** native 建議 direct controller 再補非零／killed status、killed stat、pre-aborted signal；主 agent 核對 `test/extension.test.ts` 的 completion boundary 及 Runtime collection 案例，這些行為已有外層測試，M9／M11 又證明委派確實抵達新 owner。故不為對稱性重複新增測試，也不將它列為 Task 5 必須補做的新需求。
- **[CODE] N — executor 注入時點：** `src/index.ts:159` 確實由原逐次讀 `deps.gitEvidence.exec` 改為建構時固定注入；這是 tasks 2.2 明定的組合形狀。已檢查目前 production 建構／測試呼叫端使用穩定函式；不改核准設計以加入 executor hot-swap。此結論只限目前穩定依賴用法，不能從 repo 零命中推論外部 caller 絕不會修改 deps。Task 3 保持同一固定 exec／initial cwd 注入形狀，writer 的 revision-scoped wrapper 不搬、不改。
- **[CODE] N — inline return type：** contracts 的同步 check 回傳 literal 與 CompletionNotice 結構相同，且是按計畫逐字搬移。沒有型別缺陷；不採納額外一行整理。
- **環境限制：** external 自述一個 shell heredoc 因唯讀 sandbox 不能建立暫存檔而失敗；同一 child／runner／read-only 權限內改用 `python3 -B -c` 完成比對，未切 CLI／foreground 或擴權。保留該失敗而不稱所有命令成功；不存在未處理的 launch／parser blocker。Reviewer 的 changedFiles／testsAdded 欄列的是 parent 改動，並非 reviewer 寫入。
- **主 agent fresh 驗證：** 全部送審 source／test／doc hashes 與 `task2/review-hashes.json` 相同；17:37:00 相關四檔 **162 passed**、typecheck、lint 皆 exit 0。先前 after-mutation explicit primary LSP 已四檔 clean，source 未變；cached lens 的 No files diagnosed 不算另一輪主動掃描。HEAD `bc114950e9ebf8967642007cc99f04522e44fc63`、branch `refactor/runtime-coordination` 未改，無 staged 檔案。
- **Checkpoint：** 接受 Task 2，完成 2.4（9／21），進入已核准的 Task 3。仍為 Phase 4 分批 review，不是 whole-change Phase 5／merge／安裝／發布驗收；原 actual Git 與 SDK／CLI／最低 Node 等限制不變。

## Task 3 雙重 review 收斂（2026-09-10）

- **Runs／實際報告：** workflow `fa5b6cfb-35d2-4e12-97e0-31e57cee9c73` complete。Native child `636f1234-a5ce-4714-b51e-7422e27af726` 為 **OK with notes**；external `35eb06eb-6650-411f-a3f0-ce16fceab3af` 未發現阻擋問題。主 agent 已讀兩份完整實體報告，含通知 Saved output unavailable 的 external 檔案：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/fa5b6cfb-35d2-4e12-97e0-31e57cee9c73/review/task3-evidence-semantics.md`、同目錄 `task3-root-compatibility.md`。
- **[CODE] N — 固定 cwd／exec：** 確認建構時注入是 Task 3 已批准的形狀，production ensureRuntime 只建立一次 literal resolver 與穩定 exec arrow。維持上輪 disposition：不加入 hot-swap、也不宣稱外部 caller 絕不 mutation deps。Task 4 原訂單次 factory 測試會順帶斷言首個 context cwd 決定 evidence cwd；不新增 Runtime 公開介面。
- **[CODE] N — options 覆蓋分層：** M14 只在 direct coordinator 驗 A／B，Runtime in-flight disable 只驗 enabled；主 agent 核對 public setEnabled 與 recompute，不能把它宣稱成 Runtime options payload 更新測試。getter 本體明確讀目前 config，現有產品 command 只改 enabled，因此不為 report-only note 增加 options mutation API 或測試 seam。單純斷言 getter 次數也不足以排除「每次回傳舊物件」，不採用該弱替代。保留分層限制，沒有待修程式缺陷。
- **證據措辭校正：** reviewer 所述「same {cwd, signal} object」應解讀為相同 cwd 值及 signal identity；程式每次建構新的 options object，沒有承諾該 object identity。
- **環境限制：** external 的不存在 `.codex` 路徑探索 exit 2 與 xcrun 暫存快取權限訊息保留記錄；後續具名讀取／比對在相同 read-only runner 成功，未切模式／擴權，沒有未解決的 launch/parser blocker。兩位 reviewer 都未跑 tests／typecheck／lint。
- **主 agent 重驗／結案：** 12 個 Task 3 review hashes 全部相同，17:59:31 相關四檔 **164 passed**、typecheck、lint 皆 exit 0；Git HEAD／branch／staged 狀態不變。接受 3.4（13／21），仍屬 Phase 4，進入 Task 4；actual Git、SDK／CLI／最低 Node／其他平台／安裝等未驗收項目照舊。

## Task 4 雙重 review 回收與 image assertion 補強（2026-09-10）

- **Runs／實際報告：** workflow `c382be13-607c-4c00-9e13-5eac5a9b8c4d` complete；native `d3ee1ac0-3705-4a27-9803-c62232d2174f` 為 **OK with notes**，external `b1ba301b-50d2-4491-92eb-a120315edeac` 未發現 blocker。兩份完整實體報告已讀回：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/c382be13-607c-4c00-9e13-5eac5a9b8c4d/review/task4-hook-lifecycle.md`、同目錄 `task4-entry-compatibility.md`（後者雖通知 Saved output unavailable，實體檔存在）。兩位做 source review，不把完成通知當作唯一證據。
- **[CODE] N — cwd 不對稱維持既定契約：** `src/index.ts:153–157` 建構 evidence 時固定 resolver.cwd，adapter `src/extension.ts:132` 將事件 ctx.cwd 傳 completion。這不是 Task 4 引入的 bug，也不改成 shell-cd／multi-repo detection。Task 4 factory case `test/extension.test.ts:520–525` 現已明確斷言；Task 5.2 原訂「保留 git-evidence 已知限制」將補寫初始 cwd，文件 owner 為主 agent。
- **[CODE] N — 採納 image assertion 補強，待局部 re-review：** 原 `test/extension.test.ts:671` 的 `[...event.content]` 與 input 共用 block，若原地改 image.data，預期值也會被改。親讀完整 callback 與 adapter hook；production 目前只 spread，不存在現行 block mutation。只把這一行改為 `structuredClone(event.content)`；其餘 assertions／mock／fixture／66 cases 不動，其他既有測試不順手整理。
- **M21 親證缺口與修正敏感度：** AST dry-run 唯一匹配後，故意在真實 tool_result handler 將第一個 image block 的 data 改為 `"mutated"`，其他行為不動。舊淺拷貝 test 在 18:36:16 **1 passed／exit 0**，直接證實此 blind spot。精確還原 adapter，再改上述一行；正常 production selection 先為 1 passed。重套 byte-identical mutant 後，18:37:01 **1 failed／exit 1**，明確在輸出 image 的 `data: fixture` vs `data: mutated` 失敗；正確 post-move snapshot 精確還原後同 selection **1 passed／exit 0**。不稱這是新 production 修復，也不把負向控制暫時碼留在 source。
  - 命令：`npm test -- test/extension.test.ts -t 'completion never treats appended evidence as its baseline'`。
  - 原始證據：`<LAB_ALIAS>/task4/` 的 `M21.before-fix.log/.exit`、`M21.red.log/.exit`、`M21.restored.log/.exit`、`M21.mutant.ts`、`extension-test.reviewed.ts`、`image-fix.delta.patch`。沿用只允許正確 source/snapshot 配對、保存原始退出碼的 run-control.sh。
- **[CODE] N — no-added-await 測試限制：** Reviewer 指出現有 h.fire callers 都 await，沒有直接強制 finish 至輸出不可插 await 的測試。接受為覆蓋限制，不增加 scheduler／new seam／Task 4 規格。親核 `src/extension.ts:130–155` 仍只有 collect 的一個 await，之後 finish→appendEntry→emit→optional sendMessage 同步；完整 body 比對與 Task 1/2 final-window tests 是不同層的證據，不能稱為新增 await 的 mutation coverage。
- **[CODE] N — 進度與 reviewer 措辭：** 4.4 未勾是刻意等待本 review gate，16／21 與 checkbox 相符；`apply.json` 的 13／21 是開工前 snapshot，不覆寫歷史讓它假裝即時。M15–M20 有六個 controls／十二個 exit records，native prose 的「all ten」不採用。Task 4 已跑過 OpenSpec pre-check／strict validation；Task 5 要重跑完整 final gate。Reviewer 提到 commit 尚待並非核准任務或本次完成條件，沒有 commit 授權。原 Task 1 延後的 shutdown trace 已由 Task 4 真實 forwarding spies 與 M19 落實。
- **環境界線：** external 的 macOS xcrun cache permission 訊息仍保留；讀取／hash/body 比對 command exit 0 且有結果，不是未處理的 launch/parser blocker，未換 runner／foreground 或擴權。Reviewers 沒有執行 tests／typecheck／lint，相關成功紀錄均來自主 agent。
- **Fresh 驗證與 scope：** 修改前 11 review hashes 全吻合；18:25:37 相關兩檔 **130 passed**、typecheck、lint 通過。補強後 18:37:56 相關 **130／2**、18:37:57 全套 **410／18**、typecheck／lint（41 files）／diff check 全 exit 0；explicit primary LSP 對 test 與還原後 adapter 均 clean。程式比對確認只有上述一行測試差異，另外十個 review hashes 不變，index／adapter 仍與 post-move GREEN snapshots 完全相同。新 test SHA-256：`9b378e0f81e60c185e50408010ecc7ed46bfe3131c92219df715411ebab910b3`。
- **Checkpoint：** 仍為 Phase 4，4.4 待這一行測試補強的唯讀 scoped re-review；不重做已完成的整輪 dual review，Task 5 尚未開工。Repo/worktree `<REPO>/.worktrees/runtime-coordination`，branch `refactor/runtime-coordination`，HEAD `bc114950e9ebf8967642007cc99f04522e44fc63`，沒有 staged files／新 commit／push。完整 SDK/CLI、最低 Node、其他平台／安裝與 Task 5 actual Git 仍未驗收。

## Task 4 scoped re-review 收斂（2026-09-10）

- Workflow `a215df09-88e9-4eb3-8606-fb2c19779b8e`／native child `28828b44-adfb-4124-9114-1162b2c975ba` 完成。已完整讀回 `<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/a215df09-88e9-4eb3-8606-fb2c19779b8e/review/task4-image-assertion-recheck.md`：**OK with notes**，明確認證一行 clone 解決 reference alias、未削弱原 assertions、M21 實際證明敏感度，可以關閉本 scoped gate。
- **[CODE] N — 既有另一個淺拷貝不順手修改：** reviewer 提到 `test/extension.test.ts:601` 的既有 evidence case 同樣不能單獨攔 block 內部 mutation；Task 4 新增案例已覆蓋相同 tool_result handler 的 M21 mutation。保留既有 case 與本次最小修改，不宣稱所有可能的 command-specific mutation 均已覆蓋。
- **[CODE] N — M21 證據範圍：** RED 命中第一個 patched-content assertion（:673），沒有分別隔離第二個原 event assertion（:676）；後者深拷貝不再共用 reference 是可直接查證的程式性質，不冒稱另跑過第二個獨立 mutant。無需新增重複控制。
- **Fresh acceptance：** 六個 image-review hashes 完全相同，18:44:30 重跑 extension／integration **130 passed／2 files**、typecheck、lint 皆 exit 0；先前 clean primary LSP 對應的 source/test 未變。主 agent 以完整 snapshot 比對認證 production 還原，不只用 grep 零命中。HEAD／branch／無 staged 狀態不變。
- **Checkpoint：** Task 4.4 完成（17／21），進入已核准 Task 5；不是 whole-change Phase 5、merge、SDK／CLI／最低 Node／平台／安裝驗收。無 commit／push／額外授權。

## Phase 4 完成／Phase 5 全變更 review handoff（2026-09-10）

- **Task 5 完成：** 自身 mkdtemp 的 actual Git case 已跑；新增 untracked b.txt、刪除 a/b 後 dirty→clean、最後 status 為空均通過。M22 把 controller 的兩個 exec cwd 導向同 root 空白 wrong-repo，明確在應含 b.txt 卻回 clean card 處失敗，exit 1→精確還原 exit 0。Tests 20 direct completion／18 evidence／66 hook／64 integration，相關總計 168；全套 411／18。沒有新的 production 修改。
- **文件與 full self-review：** README 與 docs/design 依已批准範圍更新現況，保留 evidence cwd／upstream／CI／UTF-16 限制與 writer advisory，§9 亦補入對應限制供 README 的連結讀者查閱。已重讀完整 tracked diff、新增檔、完整 callbacks 與 pure helpers；generic guards／writer lifecycle／原 public contracts 另做 byte 比對。已安裝的 marked 18.0.5 CLI 以自建明確 config 解析兩份 Markdown 至 HTML，HTML parser／local links 檢查通過；最後 §9 更新後再重新解析 design，非瀏覽器驗收。
- **範圍外既有文件債（未靜默修整）：** docs/design.md §4.1／§6.2 仍留有早期 camelCase 模組鍵範例，§4.4 的 notify/widget 設計目標亦不是目前 generic guard 的完整實作；本輪只按 Task 5 更新受影響現況章節，實際 completion key 及 failure 語意已在 §5.4／§7 明確說明。這些不是新增 aliases／widget 的產品承諾，也不是本次 source 引入的回歸；不得據此順手改 config/schema 或 logger。歷史 stage plans／archive 不改。
- **Fresh verification：** 11 個 actual changed/new TS 的 explicit primary LSP 全 clean；18:59:46 四檔 168／4、18:59:47 全部 411／18、typecheck／lint／diff 全 exit 0。完成文件／task metadata 後，19:06:02 再跑 **411 passed／18 files**、typecheck、lint（41 files）、workflow pre-check、OpenSpec strict、diff check，全通過。cached lens 仍 No files diagnosed，不當第二輪 active scan；沒有 build script／新依賴／新 skip／CI 宣稱。
- **Phase boundary：** 21／21 task checkboxes 完成，Phase 4 handoff 結束；**正式 Phase 5 全變更雙重 review 待回收**，不是已整體完成。原 Task 1–4 reviews 不代替本輪。Reviewer 的改進若只修 code/tests/docs，可在 Phase 5 單 writer 處理；feedback 全記本檔，以下四份 artifact 保持 frozen。
- **Frozen SHA-256：**
  - proposal.md：`1b153fd2904391734c77b8b903a38d0a03dd6394b20e1f755399b94ab9f116ca`
  - design.md：`b05dd079762f64dc63cb6272f7711c94c4861c5255b908cbc98bd302a6e746b9`
  - tasks.md：`1b45b70d48fecf1391add90fb303374a9604f91825d8f0c2972c0df96eddca9f`
  - specs/completion-recheck/spec.md：`62feb7d64c6fa6209edfc3a7a795441c2f52b69de8929fbd4f9f03f133db7da6`（核准 normative delta 未變）
- **Review baseline／原始檔：** `<REPO>/.worktrees/runtime-coordination`；branch `refactor/runtime-coordination`；baseRef HEAD=`bc114950e9ebf8967642007cc99f04522e44fc63`。Task 5 evidence root `<LAB_ALIAS>/task5/` 含所有 logs/exits／full tracked.patch／scoped patches、phase5-freeze-hashes.json；正式 review 使用全部 changed/new files，不只 Task 5 diff。原核准 tasks header「尚待核准」是歷史提交文字，使用者後續核准與執行證據已明載，不是尚缺 approval。
- **未驗收與權限：** 本機 Darwin arm64／Node 22.23.2／Git 2.55.0；actual Git 是 untracked／dirty→clean，不是 subprocess cancellation／remote CI。完整 SDK/CLI／具憑證模型回合／writing-subagent／permission load-order／最低 Node／其他平台／本次 CI／安裝／發布未執行，不用 unit 或先前 main CI 代替。writer／pure modules／config／state／types／package／lockfile／CI／canonical／歷史檔未改；無 staged、commit、push、安裝或真實 agent settings/state 寫入。Phase 6 reconciliation／sync／archive 及遠端操作仍需各自授權。

## Round 1 — Phase 5 whole-change review 收斂（2026-09-10）

### Review 結果與主 agent 認證

- Workflow `0586a7f1-6416-46a6-afbd-aac010765235` complete；native `6156e944-db78-4752-ad93-6a759d6aac15` 為 **OK with notes**，external `5a059958-984d-4b70-99b9-83571b17f7cf` 未發現新增 blocker。兩者皆完成 whole-change source review，不以 per-task 結論或 runner exit 0 代替。
- 已完整讀回兩份實體報告：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/0586a7f1-6416-46a6-afbd-aac010765235/review/phase5-completion-safety.md`、同目錄 `phase5-runtime-compatibility.md`。後者通知雖為 Saved output unavailable，檔案存在且含實際 source／19 hashes／snapshot／原始 log 比對。
- **[CODE] N — 設定 accessor 的信任邊界，記錄、不改 code。** 親讀完整 completion controller、Runtime getter／guard 與 `resolveConfig`。`src/runtime/completion-diff-recheck.ts:60,88,104,109` 的 current 評估不全在 catch 保護內；任意 injected `getSettings` 若拋錯，不能宣稱會被安全吞下。實際 Runtime 在 `src/index.ts:145–150` 僅讀 private resolved config 與 failure map；`src/config.ts:402–512` 建立 plain config，再套已驗證欄位，沒有外部 I/O accessor。舊 generic guard 也在 try 前判 active。故接受為信任假設，不把「目前 production 呼叫鏈沒有此 throw 路徑」誇大成任意 controller caller 都受保護；不為 report-only note 改 frozen D5 的失敗範圍或新增 counter policy。
- **[CODE] N — completion 輸出不具 writer 式隔離，記錄、不改 code。** `src/extension.ts:130–155` 是 finish→appendEntry→原 emit→optional sendMessage；`:34–48` 的 emit 無 try/fallback，壞 UI／console 可使 hook 在部分輸出後拋錯。這與基準一致，且核准 D5 明確把 Pi delivery 與 Git／比較 failure boundary 分開；有效 finish 消耗 request quota、不 rollback/retry。不能因 writer 的 UI 故障測試通過，就宣稱 completion output 也已隔離。建議改用 emitWriter 也不會自動解決 appendEntry/sendMessage 的全部送達問題，本次不採納擴張修補。
- **證據措辭校正：** Native 對 race matrix 的概括不能解讀成所有 action 都測後續跟進：hook 的 off/on 類有後續成功 follow-up；abort／shutdown 類用同 signal／closed instance 繼續驗零 I/O。新的 signal 可恢復額度在 Runtime final-window case 另驗。仍沒有 finish 後插 await 的獨立 timing mutant；M21 命中 patched image assertion，不是所有 conditional mutations 的窮舉。

### Runner／驗證範圍

- External `status.json` 確認 same read-only／approval-never one-shot runner、exit 0、完整 final report，無 launch/parser failure；xcrun cache permission 診斷與 nonexistent AGENTS 探索保留為讀取限制，不稱所有 shell 子命令皆成功。沒有切換 runner／foreground 或擴權。
- External 自述找不到「指定 review-branch skill」。主 agent 核對本次派發 brief、builtin `agents/codex-exec.md`（inheritSkills=false，只要求唯讀分析與證據）、run metadata 的 `skills: []`，沒有查到本 parent 要求該 skill 的依據；不採用其「指定」來源宣稱，也不宣稱額外雙輪 skill 流程已完成。這不替代或取消本次已實際完成的 native＋external whole-change 審查契約；目前無已證實未處理的 mandatory tooling/setup blocker。
- 兩位 reviewer 皆未跑 tests／typecheck／lint。主 agent 於修改任何檔案前確認 **19 個 review hashes、4 個 frozen hashes** 全相同；親讀 findings 的完整 symbols 與呼叫鏈，再執行 fresh 驗證。
- **19:23:39** targeted＝**168 passed／4 files**；**19:23:40** full＝**411 passed／18 files**；typecheck、lint（41 files）、workflow pre-check、OpenSpec strict、diff check 均 exit 0。11 個 changed/new TS 的 fresh explicit primary LSP 全 clean。lens cached coverage 不當作新增 active scan；沒有 build script、沒有未揭露的測試 skip。

### Checkpoint／下一個 gate

- **Phase 5 review gate 已收斂：沒有尚待修正的本次 blocker。** 此輪只更新本 review-notes，沒有 code／test／README／docs-design 修補，也不需要再派 scoped code review。兩項 N notes 為已處置的限制，不產生新的 requirement/design Y 項。
- proposal／delta spec／design／tasks 的四個 frozen SHA 維持上一節所列；21／21 是 Phase 4 的執行歷史，不回改 checkbox。Repo/worktree `<REPO>/.worktrees/runtime-coordination`，branch `refactor/runtime-coordination`，HEAD `bc114950e9ebf8967642007cc99f04522e44fc63`；未 staging／commit／push／安裝。
- **等待使用者核准 Phase 6 reconciliation。** 尚未 rewrite／sync canonical／archive；archive 及 Git／安裝／發布仍需各自明確授權。完整 SDK／CLI、具憑證模型回合、writing-subagent、permission load-order、最低 Node、其他平台／本次 CI 等未驗收限制不因本輪 review 通過而消失。

## Phase 6A–6C — Reconciliation（2026-09-10）

使用者在 Phase 5 結案後回覆「核准」，批准進入 reconciliation；本次明確不含歸檔或 Git 寫入操作。依整合流程先整理文件，再於 6C 呈交確認；不套用一般 update-change 的 tasks 聯動修改，不進行 canonical sync。

### Baseline 與執行清單

- Cwd/worktree：`<REPO>/.worktrees/runtime-coordination`；branch `refactor/runtime-coordination`；HEAD `bc114950e9ebf8967642007cc99f04522e44fc63`，無 staged 檔案。
- `phase5-accepted-hashes.json` 的 19 個檔案全部吻合；另保存 config／canonical writer spec，共 21 個 baseline hashes 及逐檔副本至 `<LAB_ALIAS>/phase6/{baseline-hashes.json,before/}`。
- `tasks.md` baseline SHA-256：`1b45b70d48fecf1391add90fb303374a9604f91825d8f0c2972c0df96eddca9f`。Active change 尚未追蹤，空白 git diff 不是不變證據；以此 hash／副本核查，不修改其內容或 21／21 歷史。
- [x] 6A：保存 baseline，完整讀 proposal／delta spec／design／review-notes／config，逐項核對路由。
- [x] 6B：clean rewrite proposal／design 的過期流程與路徑／驗證描述；保持核准行為、spec、tasks、code 不變。
- [x] 文件完整重讀、Markdown parser／本地連結、strict validation、baseline 差異與相關測試驗證。
- [x] 6C：使用者以「核准」確認送審的 proposal／design，批准執行正式 C1–C6 gate；不含歸檔或 Git 寫入。

### Feedback 路由與最終 disposition

本檔所有功能 feedback 均為 **[CODE] N**；沒有 `[REQUIREMENT] Y`、`[DESIGN] Y` 或 `[CONSTITUTION] Y`。以下列出每個不同建議及非 code 的操作／證據備註；歷史的 pending 狀態由後續已完成處置接續，不抹除原始紀錄。

| Feedback | 最終處置／證據 | Phase 6 路由 |
|---|---|---|
| Task 1 成功 stat 缺斷言 | 已補 literal；M8、搬移後 M11 RED→還原 GREEN；scoped review 通過 | N，已解決，不改 spec |
| Task 1 shutdown 直接 trace | 已於 Task 4 真實 Runtime forwarding spies 與 M19 證明 completion→writer | N，已解決，無待辦 |
| Task 1 generation／enabled 可讀性重寫 | 不採納；同步 check 與 captured generation 職責不同 | N，維持 D3／D4 |
| Task 1 stat 前空白／兩個 newline | trim 字串已正確；未獨立精確斷言兩個 newline，接受微小排版覆蓋限制 | N，無新需求 |
| Task 2 direct status/killed/pre-aborted 測試重複 | 不重複新增；外層 hook／Runtime 與委派 mutation 已有覆蓋 | N，接受分層證據 |
| Tasks 2／3 固定 exec／initial cwd | 核准注入形狀；不新增 hot-swap；Task 4 factory／Task 5 文件已說明 | N，維持 D2／D6 |
| Task 2 inline structural return type | 保持舊簽章，不為風格重寫 | N，無型別缺陷 |
| Task 3 options A/B 覆蓋 | direct coordinator payload test／M14；Runtime 測 in-flight enabled，不冒稱 Runtime options payload 測試 | N，接受已明示限制 |
| Task 3 options object identity 用語 | 同 cwd 值與 signal identity，不承諾每次 options object 同一參考 | N，證據措辭已校正 |
| Task 4 初始 evidence cwd／事件 completion cwd | 保留不對稱；factory 斷言與 README／docs-design 已落實 | N，不擴 multi-repo parser |
| Task 4 image shallow snapshot | 單行 structuredClone；M21 舊測試 GREEN、加強後 RED、還原 GREEN；scoped review 通過 | N，已解決 |
| Task 4 finish 後新增 await | 原始碼同步段已查證；沒有獨立 timing mutant，不加 scheduler seam | N，接受測試限制 |
| Task 4 checkbox／controls 數量／commit 用語 | 21／21 是完整執行歷史；M15–M20 六 controls；未授權 commit | N，metadata／證據已處置 |
| Task 4 另一個既有 shallow case | 不順手修改；共同 handler 有 M21，但不宣稱窮舉 command-specific mutation | N，report-only 測試債 |
| Task 4 M21 命中哪個 assertion | RED 證明 patched-content assertion；不冒稱第二個 event assertion 有獨立 mutant | N，證據限制已明示 |
| Phase 5 設定 getter 的信任假設 | production callback 讀 resolved config；不保證任意自訂 throwing getter 受保護 | N，不擴 failure policy |
| Phase 5 completion delivery 不隔離／不 rollback | 保持 D5；UI／console 失敗與 partial delivery 不等於 Git／比較故障處理 | N，不擴輸出協定 |
| Phase 5 race matrix 用語 | off/on 後續跟進與 abort 新 signal 的 Runtime 證據分開 | N，證據措辭已校正 |
| 原外部 reviewer infrastructure／讀取限制 | Task 1 同協定重試完成；其他非致命 cache／路徑探索錯誤保留，沒有未解決 mandatory setup blocker | 操作紀錄，不進 feature spec |
| README／docs-design 歷史 schema／notify debt | 不新增 aliases／widget／logger 行為；現況 completion 章節已正確，範圍外文字債維持 | Report-only，不改 requirement |

**Clean rewrite 範圍：** proposal／design 仍有「Phase 2／3、tasks 待核准、未實作」、過期 source line／預期檔案等流程文字；刪除它們並填入確定的責任邊界與分層驗證描述。這是本次批准的文件調和，不把上述 N notes 轉成新需求／架構，也不把批准史 append 進最終 proposal／design。Delta 的五項需求／十五 scenarios 已一致，保持原文；config 沒有需新增或 defer 的 constitution 項目。

**延後項目：** 無需延後決定的功能／設計／constitution 項目。完整 SDK／CLI、具憑證回合、writing-subagent、permission load-order、最低 Node／其他平台／本次 CI、真實 subprocess cancellation／remote CI 仍為未驗收範圍；現存測試／文件債為已接受的 report-only 限制，不宣稱已完成，也不追加為本次必做需求。

### Clean rewrite 結果與四面 coverage

- `proposal.md`：移除過期 Phase 2／3、尚未實作、舊 source lines／基準 CI 當前狀態敘述，改為確定的作用範圍、檔案／API 影響及驗收邊界。沒有擴張能力。
- `design.md`：保留 D1–D7 決策，將 Context／Impact／Testing／Rollout 的未定流程改為可獨立理解的最終版；明列實際 symbols／helpers、固定注入、options 參考及分層證據。沒有引入新 owner、介面、policy 或把 report-only notes 變成實作需求。
- Delta spec 原文已符合 clean-document 與 normative 要求，五項需求／十五 scenarios 完整不變；不為 zero Y 製造無意義的 spec diff。`tasks.md`／config／canonical、source／tests／README／docs-design 亦與 6A baseline 一致。

| Coverage | 結果／依據 |
|---|---|
| Requirement Y → proposal/specs | 無 requirement Y；scope 不變，spec SHA 與核准版相同。Proposal 只移除過期流程並具體化核准設計。 |
| Design Y → design | 無 design Y；D1–D7 與既有實作一致，沒有未整合架構決策。 |
| Constitution Y → global/config | 無 constitution Y／無 defer；feature artifacts 不含新增跨 change 規則，config 未改。 |
| Feedback／deferred／tasks | 上表逐項有 disposition；無未決功能／設計／constitution 項；未驗收與 report-only 限制明示，tasks SHA 不變。 |

### 驗證與保存

- **20:16:30** 四個相關 suites **168 passed／4 files**；**20:16:31** 完整 **411 passed／18 files**；`npm run typecheck`、`npm run lint`（41 files）、workflow pre-check、`openspec validate refactor-runtime-coordination --strict --no-interactive`、`git diff --check` 均 exit 0。原始 logs／exits 在上述 phase6 evidence root，已逐份讀回。
- 使用 repo 鎖定 Pi 依賴內既有 marked CLI **18.0.5**，指定自有 config，把 proposal／design／spec 解析為 HTML；Python HTMLParser 確認 2／6／0 個 tables、D1–D7、五個 requirements／十五 scenarios 及 **8 個本地連結**，皆符合。不是 browser／TUI 或完整 SDK render；未安裝套件或讀取 real user marked config。初始 PATH／頂層 .bin 探測不存在，改用查得的 nested CLI，沒有更動環境。
- 已完整重讀最終 proposal／design／delta；源檔及 scoped patches 人工核對，另以 parser／字元與 placeholder 檢查輔助確認。以 21 baseline hashes 證明僅 proposal／design／review-notes 改變，並核對全部 tracked＋untracked paths 仍是 Phase 5 的 19 檔、沒有額外 repo 檔案或 staged 變更。本輪只改 Markdown，沒有新增 behavioral tests 或 mutation，也不把上一輪 11 檔 LSP 冒稱本輪新掃描。未限路徑的 lens mode=all 回傳 root／歷史檔案的 cached style／complexity warnings；以本 worktree 絕對路徑過濾後為 No files diagnosed，不當作本工作樹的主動掃描或零 warning 證明，也不順手修改範圍外檔案。
- 初始 proposal／design 的批准史從最終文件移至本紀錄：2026-09-10 proposal／spec 以「核准」獲批（proposal 原 SHA `43666462784cb53d228106eea0fad821b68f878d87d5bc494edfd12960655f58`；spec 原 SHA 同下）；完整設計以「好，了解，繼續」同意進入任務規劃（原 design SHA `9c984fc0f7d18c8aef4779a9c35e381df3547cd80f3c2d6a763e9a75e2dc2fe5`）。Tasks 原送審 SHA `15f2b33aa83fd562face554d16227bd6c84186fa56c1fc66c84504be3e95a8a8` 的後續「核准」仍完整保留於 tasks.md:499，不改歷史 header。

### 6C 送審版本／下一步

- `proposal.md` SHA-256：`dd430ed31985de51faec246becb12ecee2e5de47871d6bbacf82c8025de76a7d`。
- `design.md` SHA-256：`37e14634d938069719f0e830b8edf0f3ad4652b4514827e0515b399a30b72a7d`。
- 不變的 `tasks.md` SHA-256：`1b45b70d48fecf1391add90fb303374a9604f91825d8f0c2972c0df96eddca9f`；delta spec：`62feb7d64c6fa6209edfc3a7a795441c2f52b69de8929fbd4f9f03f133db7da6`。
- **送審時狀態：** 6A／6B 已完成，6C 等待使用者確認上述整理版本；本節保留送審依據。後續核准及正式 gate 結果見下節，歸檔仍需獨立授權。

## Phase 6D — Reconciliation Gate（2026-09-10）

**6C 核准：** 使用者以「核准」接受上述最終 proposal／design，並授權本次正式 C1–C6 檢核。開始前 21 個 `submitted-final-hashes.json` 全部吻合，包含 proposal `dd430ed3…`、design `37e14634…`；完整 SHA 保留於上節。本輪只更新本 review-notes，不重新改寫批准文件。

| 項目 | 結果 | 證據 |
|---|---|---|
| C1 Y 項路由 | ✅ | 完整逐行重讀 review-notes；功能 feedback 均為 [CODE] N，上方 Feedback 表逐項已處置。沒有 requirement／design／constitution Y，沒有未批准 constitution defer。既有 infrastructure blocker 有同協定成功重試紀錄，不把失敗 run 回溯改成通過。 |
| C2 Constitution 隔離 | ✅ | 完整重讀 proposal／delta spec／design 及 openspec/config.yaml；文件只定義本能力及其既有相容邊界，沒有加入適用所有 future changes 的新規則。Config 與 baseline byte/hash 一致。 |
| C3 tasks.md 未變 | ✅ | 與 Phase 6A 的 before/tasks 副本逐 byte 比對相同；SHA-256 持續為 `1b45b70d48fecf1391add90fb303374a9604f91825d8f0c2972c0df96eddca9f`，21／21 歷史不改。亦跑 git diff，但 active change 未追蹤，故不以空 diff 代替實體比較。 |
| C4 Normative／strict validation | ✅ | 五個 Requirement 的第一段皆含 SHALL／MUST，各三個 scenarios，共十五個。Workflow pre-check 及 `openspec validate refactor-runtime-coordination --strict --no-interactive` 均 exit 0；delta 與原核准副本逐 byte 相同。 |
| C5 Clean rewrite | ✅ | 完整重讀 proposal／design／spec，沒有過期階段、未定路徑、Round 修訂史或互斥的新舊敘述；D1–D7 與完整需求／scenario mapping 自足。Tasks／review-notes 獨立保留執行史，不拿歷史 pending 敘述當當前未決事項。 |
| C6 Coverage／deferred | ✅ | 上節四面 coverage 全部核查；無待落盤 Y、無待決功能／設計／constitution 項。完整 SDK／CLI、真實程序取消、最低 Node／其他平台／本次 CI 等未驗收，以及 report-only 測試／文件債仍明示，不冒充完成或變成本次新需求。 |

**裁決：`verified`。** 無需 corrected／重新改寫，六項全數通過。延後決策項目：**無**；已接受的限制與未驗收範圍維持上節記錄。

### Fresh verification 與工作樹界線

- **20:28:25** 相關四檔 **168 passed**；**20:28:26** `npm test` **411 passed／18 files**。`npm run typecheck`、`npm run lint`（41 files）、OpenSpec pre-check／strict、`git diff --check` 全部 exit 0。這些是主 agent 本輪執行，不是引用 reviewer 或前輪結果。
- 需求 paragraph／scenario 數量與 stale-marker 腳本只作補充；C1／C2／C5／C6 的結論來自完整內容核對，不以關鍵字零命中或測試總數代替。
- Branch `refactor/runtime-coordination`、HEAD `bc114950e9ebf8967642007cc99f04522e44fc63`、19 個 changed/new repo paths 及無 staged 狀態不變；沒有 code／tests／proposal／design／spec／tasks／config／canonical 修改。仍在 `<REPO>/.worktrees/runtime-coordination`，未 commit／push／安裝。

### 6E — 歸檔授權（2026-09-10）

使用者在 `verified` gate 呈交後以「授權」批准 canonical sync 與 archive。開始前重新比對 21 個 gate hashes 全數吻合；C1–C6 的已核准文件及 dispositions 未變，並重新通過 workflow pre-check、strict validation。此授權不包含 commit、push、merge、分支／worktree 刪除、安裝或發布。

CLI 1.13.0 的 archive guidance 要求先完成 review／reconciliation 並取得授權，已滿足；specs instructions 的兩項 rules 以既有 SHALL／MUST、WHEN／THEN 與不誇大跨 process 安全的內容滿足，未複製為新規則。Status 確認 repo-local root、spec-driven schema、四項 artifacts done、21／21 tasks，唯一 delta 為 `completion-recheck`。

依 inline sync 流程新增 canonical Purpose 與五項需求／十五個情境；不修改 writer canonical、tasks 或任何批准的需求文字。同步後先讀回逐 byte 比對 Purpose 與全部 requirement／scenario 主體，再執行 CLI archive。Archive 使用 `--skip-specs --yes`，僅避免 CLI 再次套用已完成的同步，不表示略過使用者批准的 spec sync；保留正常 validation。

### 6F — 歸檔後驗證（2026-09-10）

- `openspec archive refactor-runtime-coordination --skip-specs --yes`：exit 0；目的地為 `openspec/changes/archive/2026-09-10-refactor-runtime-coordination/`。Active folder 已消失，`openspec list --json` 在相同 worktree 回傳空 changes。
- 移動後六個 artifacts 均與 pre-move hashes 一致，包含 `.openspec.yaml`、批准的 proposal／design／delta、21／21 的 tasks 與 review-notes；之後只有本節新增歸檔結果。`tasks.md` 仍為 Phase 6 baseline 的 `1b45b70d48fecf1391add90fb303374a9604f91825d8f0c2972c0df96eddca9f`。
- Canonical `openspec/specs/completion-recheck/spec.md` 的 Purpose、五項需求及十五個 scenario 全文與 delta 逐 byte 比對一致；差異僅增加 canonical 標題、將 ADDED Requirements 改為 Requirements。Writer canonical 與 config 不變。
- 歸檔後 `openspec validate --all --strict --no-interactive`：兩個 canonical specs 通過、零失敗；此命令不宣稱驗證所有歷史 archive 的 tasks。對本次 archived folder 另跑 workflow pre-check，exit 0。
- **20:45:31** `npm test`：**411 passed／18 files**；`npm run typecheck`、`npm run lint`（41 files、no fixes）、`git diff --check` 全部 exit 0。這是歸檔後的主 agent 驗證；完整 SDK／CLI、最低 Node／其他平台／本次 CI 等未驗收範圍維持既有揭露。
- 完整 changed/new 路徑為原 19 檔的 archive 映射加一個 canonical，共 20 檔；實作、測試、README、專案 design、branch／HEAD 均未變。沒有 staging、commit、push、merge、刪除分支／worktree、安裝或發布。
- 歸檔證據（before／pre-move／post-move hashes、CLI 原始 log／exit）保存在 `<LAB_ALIAS>/archive/`；本 review-notes 保留批准事實、gate 裁決與驗證摘要作為 repo 內耐久紀錄。
