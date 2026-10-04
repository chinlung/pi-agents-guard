## Why

Completion 的自動 Git 查詢需要先通過 eligibility 與失敗邊界，避免停用、background child 或未成功寫入的 session 執行無用查詢，也避免 unexpected exec rejection 逸出收尾 hook。將 completion 狀態、git-evidence 命令協調與 Pi adapter 分開，可讓這些邊界由明確的 owner 維護，降低接線與搬移的回歸風險。

## What Changes

- **行為修正：** completion 在任何自身 Git I/O 前，判斷全域／模組開關、inert、child、成功寫入紀錄及 caller cancellation；不符合時零 completion I/O、零 card／follow-up。
- Git 收集與比較各由 completion 失敗邊界保護，unexpected exec rejection 不逸出 hook；Runtime 維持唯一的累計三次 inert 政策。非零退出、killed 與取消不能被當成有效狀態；正常非零的 diff-stat 僅略去顯示資料。
- 非同步檢查期間停用、取消或 session shutdown，使該次工作失效；off→on 不復活舊結果。同步單次 `finish()` 在最後一個 await 之後重新驗證，完成組卡後才消耗可用 follow-up 配額，不增加 timeout、timer 或宿主停止協定。
- **結構重構：** completion controller 擁有 facts／生命週期／收集與採用；git-evidence coordinator 保留查詢順序與組合；Runtime 擁有設定與失敗政策；Pi adapter 擁有註冊與輸出。
- 保留 package entry、`Runtime`／`RuntimeDeps`／`createRuntime` 的 root 匯入位置、既有方法簽章及同步行為。新增 completion 介面為 additive，不新增舊 caller 必須提供的依賴欄位。
- 保留 hard-deny → subagent-policy 順序、writer advisory、動態設定、唯一 tool_result handler，以及觀察原始 content 後才附加 evidence 的順序。

### Non-goals

- 不改 writer advisory／presence 協定，不引入強鎖或 SQLite。
- 不擴充 shell `cd`／`git -C`／多 repo command 的解析，不修 git-evidence 的初始化 cwd 歸屬、upstream 新鮮度、exit-code 文案或 UTF-16／byte 預算等獨立語意問題。
- 不全面重寫所有 module guard、logger、設定來源、命令語法或權限規則；completion 錯誤隔離只處理本能力的收集／比較及其故障診斷，不提供 Pi 輸出 transaction、回滾或重送。
- 不引入通用 module registry／event bus／dependency framework，不以檔案數或 complexity 數字為目標。
- 不改 package／lockfile／CI 或新增 production dependency；安裝、發布及操作真實 agent state 不在此 change 範圍。

## Capabilities

### New Capabilities

- `completion-recheck`：收尾 Git 檢查的 eligibility、查詢可信度、失敗隔離、取消／停用處理及既有 card／follow-up 行為。契約見 [delta spec](specs/completion-recheck/spec.md)，包含五項需求／十五個 scenarios。

### Modified Capabilities

無。Canonical `writer-lock-safety` 六項需求不變；git-evidence 與 adapter 的搬移不新增能力，也不為純重構建立 requirement。

## Impact

| 範圍 | 檔案與相容性 |
|---|---|
| Runtime 與 entry | `src/index.ts` 保留 `createRuntime`、type re-exports 與 default export；`src/extension.ts` 接收 factory，保留六個事件各一次及一個 command。 |
| Completion | `src/runtime/completion-diff-recheck.ts` 擁有協調狀態；`src/runtime/contracts.ts` 定義公開契約。原純 module 與 `src/lib/git.ts` 的 ExecFn 不變。 |
| Git evidence | `src/runtime/git-evidence.ts` 保留 detector／queries／options 時點與格式組合，固定使用 Runtime 初始化 cwd；純 module 與 generic failure guard 不變。 |
| 測試 | `test/extension.test.ts`、`test/integration.test.ts`、兩個 controller suites、`test/helpers/extension-harness.ts` 與 `test/helpers/deferred.ts`，涵蓋真實 root 註冊、單次 factory、生命週期及自有暫存 repo 的 actual Git。 |
| 文件 | `README.md`、`docs/design.md` 的現況章節說明責任與限制；歷史 plans／archives 不改。 |

Completion 保留成功寫入事實與最後有效 porcelain 觀察、無 baseline 不 follow-up、dirty→clean 提醒、預設關閉的 follow-up 與 session 上限；diff-stat 只供顯示。Porcelain 比較不是內容雜湊或自然語言回報分析；status／stat 也不是原子快照。

## Contract Boundaries

| 契約面 | 本 change 的影響 |
|---|---|
| Public API | 保留舊 API，增加 collect／finish 與 shutdown 協調入口，不新增必要依賴。 |
| Data contract | Card／follow-up／evidence 格式與參數傳遞保持；completion 結果只在本 Runtime 記憶體內採用。 |
| Schema | 不新增設定鍵或持久 schema。 |
| Migration | 無資料遷移。 |
| Backward compatibility | 舊 Runtime 同步方法與動態設定保持；固定 executor 注入不提供 hot-swap API。 |
| Security / permissions | Completion 的 child／disabled 零 I/O 與故障邊界受到保護，其他模組政策不變。 |
| Concurrency / consistency | 每次 await 後及 finish 時驗證有效性；配額按 finish 順序共用，不做預留、互斥或跨程序停止保證。 |
| Cross-module behavior | Runtime 統一設定與 failure owner；completion、evidence、writer 的生命週期不混用。 |

## Validation Scope

對應設計與測試入口見 [design.md](design.md)；執行紀錄與 review 處置保留於 [tasks.md](tasks.md)／[review-notes.md](review-notes.md)。Controller／Runtime／registered-hook tests 與 actual Git 各自提供不同層級的證據，不互相冒充。

完整 Pi SDK／CLI、具憑證模型回合、writing-subagent、permission load-order、最低支援 Node、其他平台及本 change 的 CI、安裝／發布不屬已驗收結果；不能用本機測試或基準版本 CI 代替。
