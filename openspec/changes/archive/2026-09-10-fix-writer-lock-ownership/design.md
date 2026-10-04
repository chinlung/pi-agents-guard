## Context

本設計支援合作式單一 writer 習慣：確認位置、提醒既有變更及可能重複開啟的 session，不建立寫入權限。

Runtime facade、獨立 writer controller 與 Pi adapter 分工處理快照、存在記錄及提示。正式 tool-call path 沒有 writer gate，控制器不管理排他 ownership，命令也不接管或解鎖。

## Goals / Non-Goals

- 保留純判斷 → 同步記錄／狀態控制器 → Pi adapter 的既有分層；只增加取得環境快照所需的非同步流程。
- 不鎖定寫入、不要求互動確認；缺資訊及通知失敗不影響其他模組的判定。
- 不新增 production dependency、SQLite、宿主協定、工具預留、背景輪詢或程序存活／停止追蹤；不執行原五項 Runtime Promise 改造。
- 不追蹤 shell 中的 `cd` 或外部 `git -C`，不盤點所有 Pi session／編輯器，不重構 completion、git-evidence 或 subagent-policy。

## Decisions

### 1. 方案與檢查時機

**採用「環境快照＋獨立存在記錄」**。純 Git 快照成本最低，但不能滿足已核准的 session 存在提醒；逐工具掃描／背景輪詢較即時，卻增加 I/O、生命週期及刷屏成本，對本需求不值得。

| 入口 | 行為 |
|---|---|
| 前景 `session_start` | 檢查開關及 child 身分後，取得環境快照、登記自身、讀取同 worktree 記錄，輸出一則合併摘要。 |
| `/agents-guard`、`status` | 啟用時重新檢查，必定回覆本次結果；停用／child 時只顯示停用／由 parent 管理，不做本模組 I/O。 |
| `on`、`on writer-lock` | 若本模組因此從停用變成啟用，立即完整檢查。已啟用時不額外掃描；其他模組的 on/off 不觸發它。 |
| `turn_end` | 只更新已登記的自身記錄時間，不執行 Git、不掃描 peers、不建立原本不存在的記錄；更新失敗最多提示一次相同原因。 |
| `off`、`off writer-lock`、`session_shutdown` | 先停止後續自動活動，再盡力清理可辨識的自身記錄；停用時的一次自身清理不算持續自動檢查。 |
| `tool_call` | 不執行本模組的 I/O、通知或 readonly gate。hard-deny 仍先於 subagent-policy 判定，其他工具照既有流程。 |

不保證較早啟動的 A 立即看見後來的 B；B 啟動時會檢查，A 可主動查詢。長時間沒有回合結束可能使存在資訊過期，這是提醒的限制，不引入計時器修補。

### 2. 環境快照與責任邊界

在 `src/lib/git.ts` 新增專用 `inspectWorktree`，不改既有 `detectWorktreeRoot` 的 null 契約或 git-evidence 呼叫。快照為 `git`／`not-applicable`／`unknown` 三種；`git` 含 canonical root、分支／detached／unknown、dirty／clean／unknown、檢查時間及診斷原因。

- 沿用注入的 `ExecFn` 與 `pi.exec`，以參數陣列執行只讀 Git 查詢：`rev-parse --is-inside-work-tree`、`rev-parse --show-toplevel`、`symbolic-ref --quiet --short HEAD`、`status --porcelain=v1 --untracked-files=normal`。全部加 Git 全域 `--no-optional-locks`，避免 status 的選用 index 更新。
- root 必須經 `realpathSync`；以 root 而非分支或使用者輸入的子目錄分組。branch 查詢成功可表示尚無 commit 的分支；`symbolic-ref` 的明確非 symbolic-ref 結果表示 detached HEAD。dirty 包含 tracked 與未忽略的 untracked 變更，只顯示有無，不解析或列出檔名。
- Git 明確回覆不在 worktree 才標示不適用。非零退出、不可用的 Git、無法解析的 root、realpath 失敗等標示資訊不完整；不依賴本地化 stderr 猜測非 git 目錄。一般非 git 目錄若只有錯誤退出，保守顯示「無法確認是否為 worktree」，不誤稱衝突。
- 單次 Git 檢查使用 2 秒總預算，各命令傳剩餘 `timeout` 與 caller signal；任何失敗保留已知欄位，其餘標 unknown。這是外部命令的時間預算，不宣稱同步檔案系統 I/O 有硬期限。
- 不修改 repo 內容、不要求先清乾淨、不讀 diff 內容。沒有確認 canonical root 就不探查或登記該未知位置的 presence／v1 記錄；先前成功登記的自身記錄仍可按既知路徑清理。

`src/modules/writer-lock.ts` 改為驗證存在資料、分類 peers、組成摘要及去重 signature 的純函式；不執行 Git／fs。`src/runtime/writer-lock.ts` 延用單一 controller 與可注入 files seam，管理自身記錄、快照與提示狀態，不再管理 writer/share/readonly。

`src/index.ts` 新增 `refreshWriterNotice(cwd, now, reason, signal?) -> Promise<Notice | undefined>` 的 Runtime 入口；reason 為 startup／status／enabled。既有 `handleToolCall`、init／heartbeat／release／takeover 的同步回傳型態保留。`status()` 保持同步，呈現最近快照及其時間；命令 adapter 在主動 status 前 await refresh，之後只輸出一份合併 status，不另輸出 refresh notice，避免重複及把舊快照冒充本次檢查。

- `initWriterLock(worktree, now)` 作相容入口：只初始化已提供的位置與存在記錄，未提供的 Git 資訊標未檢查；正式 adapter 改走完整 refresh。
- `heartbeatWriterLock`／`releaseWriterLock` 只處理本執行個體的存在記錄，維持 void。新增無 I/O 的 `takeWriterNotice() -> Notice | undefined`，供 adapter 取出並清空這些同步操作產生的單筆待送提示；診斷本身仍保留於 status。`takeoverWriterLock` 只回傳停用舊語意的提示。controller 的相容 `isReadonly()` 固定 false、`checkReadonlyCall()` 固定 pass，正式 tool-call path 不呼叫它們。
- 設定仍由動態 `getSettings()` 取得；`setEnabled` 負責停用時的自身清理，adapter 負責重新啟用後的 async refresh。Runtime 使用既有 `env.PI_SUBAGENT_CHILD === "1"` 作唯一 child 事實並傳入 controller，避免與注入 self 的旗標分歧；其餘 subagent-policy 規則不變。
- refresh 開始時保留本機 revision；新的 refresh、身分變更、停用或 shutdown 都使舊結果失效。await 完成後先驗 revision、enabled 與 child，再處理記錄，避免晚回覆在停用後重新登記。這只是本 Runtime 的回覆排序，不是跨程序 fencing。

### 3. 存在記錄：小型、獨立、不接管

使用 `stateDir/presence/<SHA-256(canonicalRoot)>/<instanceId>.json`，不共用 v1 的單一 worktree 鎖檔。instanceId 在每次 controller 建立時產生隨機 UUID，不把 sessionId 或 PID 當檔名／排他身分；session 身分更換時先清理自身舊記錄，再換 instanceId。adapter 每次完整檢查前更新目前 sessionId；同值不重建身分。位置改變或變為 unknown／不適用時，停止更新舊位置記錄並盡力清理自身舊檔，再依本次結果決定是否登記。reload 的殘留記錄可能造成提醒，不能把相同 sessionId 的另一執行個體直接當成自身刪掉。

最小 schema：`version: 1`、`instanceId`、`sessionId`、`pid`、`host`、`worktreeRoot`、`startedAt`、`lastSeenAt`。這是 presence schema v1，與 `locks/` 中的舊 lock v1 無關。pid 只供辨識，不執行 `kill`／存活判定；不儲存分支以免 heartbeat 產生看似最新的舊分支資訊。

- 初次登記不得覆寫既有路徑。更新／清理只使用本 controller 成功建立並留在記憶體的路徑，且讀回 instanceId、sessionId、host、pid、root 必須符合自身；若損壞、消失或歸屬不符，放棄該記錄並提示，不盲目重建、覆寫或刪除。下一次完整檢查可用新的 instanceId 登記，保留未知舊檔。
- 記錄新建目錄 0700、檔案 0600；不跟隨 presence 子目錄或記錄的 symlink。使用自身 tmp＋rename 避免正常讀者看到半份 JSON，失敗只清理本次成功建立的 tmp；不沿用會殘留 tmp 的一般寫入流程，不改 config 儲存語意。
- presence 檔案讀取區分 ENOENT 與其他 I/O 失敗，不用會把錯誤混成缺檔的 `existsSync` 前置檢查。每次只掃目前 canonical worktree 的目錄，最多 256 個目錄項目、每筆最多 16 KiB。schema 不符、symlink、I/O 錯誤或超限一律彙總為資訊不完整；不得跳過後仍宣稱完整掃描。訊息最多列 5 個參與者，其餘用數量摘要。
- 只有合法、同 host、同 canonical root、非自身 instance 的記錄才是 peer；同 sessionId 的不同 instance 仍可能是另一個視窗或 reload 殘留。不同 worktree／host 不報同位置衝突。未知或無法歸屬的記錄只報檢查不完整。
- `heartbeatTimeoutMs` 保留原預設 4 小時，只決定資訊新鮮度，不是租約。不是有限正數的值回退預設並提示；過期或時間不合理者標為「記錄存在但狀態不明」，不自動刪除。新鮮也只表示近期登記，不代表正在寫入或程序仍存活。

不建立排他交易或 owner 世代協定。自身檔名與讀回檢查避免合作程式誤操作別人的記錄；不宣稱能抵抗有同一使用者檔案權限的惡意程序在檢查後替換檔案。

### 4. 提示、去重與錯誤

摘要包含位置、分支／detached、既有變更是否存在、可能重複的參與者及資訊缺口；固定說明「僅供提醒，不是互斥鎖」。沒有 peer 時只說「本次未觀察到其他參與記錄」，不說「沒有其他 writer」。訊息不含 raw stderr、JSON、任意檔案內容或完整工具輸入；顯示字串跳脫控制字元並限制長度。

自動提示比較最近一次自動摘要 signature：sessionId、canonical root／未知位置、branch、dirty、排序後 peer instanceIds、穩定原因碼；不納入 heartbeat 或檢查時間。連續相同狀態不重複；位置或原因改變可提示，解除後再出現視為新變化。主動 status 不受去重限制，也不清除自動去重記憶。身分切換才重設該記憶。

所有 writer 相關自動及主動輸出經專用 best-effort emitter：UI 可用則通知，否則輸出文字；UI／輸出通道拋錯均捕捉，不拋入工具 hook、不觸發模型 follow-up 或確認對話框。重複輸出失敗不形成重試迴圈，使用者仍可再查 status。其他模組的 failure counter、guard wrapper、拒絕理由及處理順序不改。

Git／presence 故障保留為本模組診斷，不借用「反覆失敗後默默停用」隱藏缺口；heartbeat／cleanup 的同步相容方法也不得向外拋出預期 I/O 錯誤。停用時若自身清理失敗，回覆一次清理未完成，之後不繼續自動處理；殘留不是鎖，不影響工具。

### 5. 命令、設定與舊記錄相容

| 項目 | 本版行為 |
|---|---|
| 模組名、flag、環境變數、設定層級 | 保留 `writer-lock` 識別與現有 precedence；狀態加上 advisory／不鎖定寫入。 |
| `blockedTools`、`blockedGitSubcommands` | 保留讀取、驗證及 save round-trip，但明示 deprecated、已無阻擋效果；不新增改名欄位或暗中轉成別的模組規則。 |
| `heartbeatTimeoutMs` | 保留為記錄新鮮度門檻，不作接管或解鎖判斷。 |
| `takeover`、`unlock` | 保留可辨識命令與相容回覆，無狀態／檔案／程序副作用：「已改為提示，不需接管或解鎖；status 重新檢查，off writer-lock 停用提示。」 |
| v1 `locks/<舊 root hash>.json` | 完整檢查時只探查當前 worktree 對應路徑是否有舊記錄；存在或無法判定時說明舊版記錄不參與新協調。絕不覆寫、轉換或刪除，不以內容決定寫入權。 |

無正式呼叫者的舊純 ownership 判斷與 readonly gate 不保留；v1 路徑計算只用於唯讀相容檢查。保留同步 Runtime 相容入口不等於保留其強制鎖定語意；測試驗收新契約，不以舊強鎖測試的通過當成新需求驗收。

## Testing / Requirement Coverage

| 已核准 requirement | 設計與驗證策略 |
|---|---|
| Advisory behavior without write locking | 真實 extension wiring：有 peers、dirty、損壞記錄仍不由 writer-lock block；hard-deny／subagent-policy 仍拒絕並保持先後順序。 |
| Basic worktree awareness | 暫存 Git repo／worktree、子目錄與 symlink alias、未提交變更、detached／unborn branch；注入非適用與失敗，驗證未確認非 git 不冒充已確認。 |
| Scoped session presence notices | 同位置不同 instance 提醒；同名分支不同 root、不同 host、不把自身當 peer；兩個獨立 controller 使用同一暫存 state。 |
| Truthful and non-disruptive diagnostics | signature 去重、改變原因、主動重查；Git deadline、部分結果、檔案過期／損壞／不可讀／超限；UI 與 fallback 都拋錯仍不中斷。 |
| Non-destructive presence lifecycle | own-only 更新／清理、UUID 路徑碰撞、歸屬變更、rename 失敗無自身 tmp 殘留、0700／0600、symlink、v1 不變；off／child 的前置零 I/O、晚回覆丟棄。 |
| Bounded compatibility and honest guarantees | 舊設定 round-trip、兩個舊命令零副作用、動態開關、同步 Runtime 契約；沿用現有 Pi 0.85.1 harness，不依賴新宿主能力。 |

驗證採 RED/GREEN/REFACTOR，並以去掉去重／略過自身檢查／讓 peer 觸發 block 等 mutation 證明測試防護力；驗證入口為 `npm test`、`npm run typecheck`、`npm run lint`、LSP、diff 與唯讀雙 review。實際 CLI 及平台驗證另記執行環境與結果，不拿注入 fixture 冒充完整平台驗收。

## Risks / Trade-offs

- 啟動競態、忽略提示、未參與工具及長時間 idle 可漏報；以誠實文案處理，不補上互斥或輪詢。
- crash／reload／清理失敗可能留下記錄，造成一次提醒或資訊不完整；不為消除誤報自動清理他人狀態。
- 掃描及顯示有上限，超限會漏列但明示不完整；同步本機檔案 I/O 仍可能慢。
- 不建立非 git 目錄錯誤訊息的多語言解析器；無法明確確認時顯示 unknown，避免把 Git 故障當成正常不適用。
- 行為從阻擋改成提醒是刻意 breaking change。其他模組依舊可能阻擋，不能把其拒絕誤判為 writer-lock 沒移除。

## Migration Plan

不做檔案格式遷移。README、`docs/design.md`、命令及狀態須同時說明行為變更、舊設定已無阻擋效果、v1 記錄保留及混用版本的限制。操作者應先關閉仍執行舊版的 session，再在已授權的安裝範圍 reload／重啟；新版本無法改變舊程序既有的 readonly 狀態。

若日後需回退版本，先停止新版 session，再在另行授權後切回舊版；不將 presence 轉成鎖、不自動清理任何殘留 v1。回退會恢復舊版的強制鎖定行為及既知缺陷，不能宣稱為安全修復。

安裝、發布、Git 整合及真實 state 操作須有操作者授權；規格歸檔與程式合併不代表已安裝，也不替代正式 CLI／平台驗收。
