# agents-guard 安裝與使用手冊

適用版本：agents-guard 0.1.0。固定驗收組合為 Pi 0.85.1、pi-guard 1.4.0、pi-subagents 0.67.0；實機環境為 macOS Darwin arm64／Node 22.23.2。本頁是操作文件，**不是已替操作者完成正式安裝的聲明**。

[回專案首頁](../README.md) · [文件與驗收索引](./README.md)

## 1. 功能與分工

agents-guard 將部分 AGENTS.md 工作守則轉成 Pi extension 的機械檢查；不會讀取任意 AGENTS.md 並自動編譯成規則。五個模組預設全開：

| 模組 | 做什麼 | 不保證什麼 |
| --- | --- | --- |
| `hard-deny` | 不彈框拒絕列舉的危險命令與受保護寫入目標；解析 shell AST | 不是完整 shell 沙箱、權限邊界或對抗性安全系統 |
| `subagent-policy` | 檢查派發前 capabilities、明確弱模型降級及外部 runner 的 native-only 參數 | 不審查任意 workflow 腳本內的每個派發，也不保證 agent 預設模型強度 |
| `writer-lock` | 顯示 worktree、分支、dirty 與其他參與 session；維護自身 presence | 名稱保留相容性，但**只有 advisory，不鎖定、不擋寫入** |
| `git-evidence` | 成功 commit／push 工具結果後附加 Git／近期 CI 資訊 | 不代替人工授權、遠端真值與本次 SHA 的 CI 最終驗證 |
| `completion-diff-recheck` | `agent_settled` 時重查 porcelain 與 diff stat，必要時提醒 | 不比對檔案內容雜湊；沒有卡片不代表沒有漏改 |

正式權限層選用 **[pi-guard 1.4.0](https://github.com/jdiamond/pi-guard/tree/v1.4.0)**：agents-guard 先執行 MUST 硬擋，通過後才由 pi-guard 處理 allow／ask／deny。pi-subagents 是可選整合套件，不是 agents-guard 本身的 runtime dependency。

Pi extensions 有宿主程序權限；本套件只防部分誤操作。作業系統隔離、人工單一 writer、最小權限與 AGENTS.md 仍須保留。

## 2. 前置需求

- Node 宣告最低 `22.19.0`；已實測 `22.23.2`，尚未精確驗證最低版本。
- Pi `0.85.1`、npm 與 Git；模型工具回合使用 Pi 原有登入，extension 不另持有模型 API key。
- `gh` 僅在 `git-evidence.checkCi:true` 時用於近期列表；缺少 CLI／登入會顯示未檢查 CI，不是 CI 通過。
- 本 repo 為公開 snapshot，可匿名 clone；尚未發布 npm（`private:true` 僅限制 npm 發布，不限制 GitHub 可見性）。不要將 token 寫進 URL 或文件。
- Runtime dependencies 為 `minimatch`、`unbash`，不能只複製 `src/index.ts` 而漏掉其他 source 與依賴。Pi 直接載入 TypeScript，沒有 build script。

先由操作者確認環境；不要為此自動更新既有 Pi／Node 或安裝全域套件：

```bash
node --version
npm --version
pi --version
git --version
```

若尚未安裝 Pi，先依自己的 toolchain 政策準備固定版本；npm 管理環境可由操作者選擇執行：

```bash
npm install --global --ignore-scripts @earendil-works/pi-coding-agent@0.85.1
```

**Peer 宣告落差：** pi-guard 1.4.0 宣告 Pi 0.79.1／typebox 1.1.39；已驗組合為 Pi 0.85.1，LAB npm root typebox 1.1.38。Pi 0.85.1 managed installer 自帶 `--legacy-peer-deps`。選定 smoke PASS 不代表符合精確 peer 契約；不要遇到安裝錯誤就額外 force、升降版或換權限套件。

## 3. 取得 source 與單次試用

在適合長期保留、且不會被 extension 自動掃描的 checkout 位置執行：

```bash
git clone https://github.com/chinlung/pi-agents-guard-public.git pi-agents-guard
cd pi-agents-guard
npm ci --no-audit --no-fund --ignore-scripts
git rev-parse HEAD
```

歷史固定實機驗收來源為 `3df8f9d4287591de85aa8c056ee77a74501f3054`，來自原私人 repo；本公開 snapshot 不帶該 commit 的 Git 歷史，不能直接 checkout 此 SHA。使用本 snapshot 時須檢查其程式與驗證結果，不將舊 smoke 自動套用到不同 source。既有 checkout 先看 `git status`，不要為試用 reset、clean 或覆蓋未提交內容。

還沒設定 agents-guard 持續載入時，可使用單次入口：

```bash
pi -e "$PWD/src/index.ts"
```

- `-e` 不會登錄正式 package settings，但 session 可以寫 presence／Pi 自身資料，模型也可執行工具；不是無副作用的 sandbox。
- Pi 的 cwd 就是工作目標。要保護其他專案，在該專案目錄啟動並傳入 source 的**絕對路徑**。
- 已有 package／extensions 設定者不要再加 `-e`。先核對實際載入來源，避免重複或混版。
- 要做安全驗收請使用[隔離手冊](validation/isolated-acceptance.md)，不要在正式 repo 試破壞性命令或真實秘密檔。

## 4. 正式持續載入

### 4.1 先備份與停止舊程序

1. 確認沒有其他 writer，讓舊版 Pi 與其 children 正常結束；不要拿歷史 PID 直接 kill。
2. 備份 `~/.pi/agent/settings.json`、若存在的 `.pi/settings.json`，以及 `~/.pi/agent/state/agents-guard/config.json`。記錄當時 package 版本、source SHA 與載入方式。
3. 備份放在私有目錄（目錄 0700／檔案 0600），不要提交可能含敏感設定的備份；**不用複製 auth.json 或整個 agent directory**。
4. 若設定了 `PI_CODING_AGENT_DIR`，Pi／agents-guard 的路徑須按實際值核對；pi-guard 1.4.0 自己從 `HOME/.pi/agent/settings.json` 讀 user 規則，不可假設兩者總是同一位置。

**自訂目錄的保護限制：** `PI_CODING_AGENT_DIR` 只決定 state 存放處，預設 hard-deny patterns 不會動態加入該目錄。它們仍匹配 `.pi/agent/...` 等固定形狀；例如 `/tmp/custom-agent/state/agents-guard/config.json` 不會只因設了此環境變數就自動受保護。自訂位置須由操作者核對並補足完整規則（陣列整份替換，勿遺漏原規則），未驗證前不能宣稱與預設位置同等防護。

以下操作由操作者在確認後執行；agents-guard 的預設保護涵蓋符合內建 patterns 的 Pi 設定／extension／自身 state，不要叫模型換工具或停用 guard 繞過。

### 4.2 推薦：同一 user scope 的 local package

```bash
pi install /absolute/path/to/pi-agents-guard
```

需要整合套件且尚未登錄固定版本時，才另行安裝：

```bash
pi install npm:pi-guard@1.4.0
pi install npm:pi-subagents@0.67.0
```

**注意：** 安裝命令成功不等於載入順序正確。若 pi-guard 已存在，後加 agents-guard 通常不能只靠 append；須由操作者保留其他設定，調整相關項目的順序。

預期 user settings 的相關片段如下，**不是可整份覆蓋的 settings.json**：

```json
{
  "packages": [
    "/absolute/path/to/pi-agents-guard",
    "npm:pi-guard@1.4.0",
    "npm:pi-subagents@0.67.0"
  ]
}
```

- Local package 只登錄路徑，不複製 source、不替它安裝本地 dependencies；先前的 `npm ci` 不能省略。不要移走 checkout 或在使用中的 source 做大改。
- **安裝 source 不會自動受保護：** 預設 `protectedPaths` 不會涵蓋任意 local checkout，也沒有 `.pi/agent/git/**` 規則。若 pi-guard 的一般 write/edit 為 allow，兩層可能都放行修改該原始碼，影響後續載入。由操作者保留完整 defaults，再加入實際安裝目錄的保護並重新驗證；陣列是整份替換，不可只留下新增規則。詳見[安裝後核對報告](reports/2026-09-11-post-install-check.md)，不要叫模型停用 guard 或繞過受保護設定來完成維護。
- Pi 可能保存 settings-relative 路徑；要以 settings 所在目錄解析／realpath 後比對，不能只比較字串。
- 先清查已存在的 `packages`、`extensions`、CLI `-e`、自動發現目錄與 project overrides。這些若有其他權限 extension，不代表本文件已驗證其組合。
- 本地目錄已有 `pi.extensions` manifest 指向 `src/index.ts`。不要將整個 `src/` 當作 extensions 目錄逐檔載入。
- 單次 `-e`、user package、`extensions` 直接入口是**替代方案，不是要同時設定**。直接 `extensions`／混 scope 要重新驗證實際順序。
- `pi install -l` 改寫 project `.pi/settings.json`，涉及 project trust 與 overrides；不是本案已驗 user package 的等價證據，不建議第一次導入同時混用。

### 4.3 新程序驗證清單

從真正的工作專案目錄啟動**新的 Pi 程序**，不用原 session 的 package metadata 冒充新載入：

```text
/agents-guard status
/guard list
```

確認：

- `/agents-guard` 只有預期入口；全域與五個 kebab-case 模組已啟用，沒有 `auto-disabled`／載入錯誤。status 是設定與 writer 狀態，不會完整列出所有規則或證明來源路徑。
- `/guard list` 顯示預期規則與來源；另核對 guard 啟用狀態。沒有預期規則時先停止，不放寬成全域 allow。
- `pi list` 可核對登錄來源，但不是 runtime 載入證明。需要機器證據時，RPC `get_commands` 的 `sourceInfo.path` 可核對實際 command canonical 來源，並結合 package scope／origin 判讀。
- 在**另行核准的 disposable fixture**，以真實模型 tool call 驗證 hard-deny 優先、合法 allow、取消 ask 與檔案／index 讀回。手動 `!command`、外部 shell 或 RPC 的 bash 請求不能冒充模型 `tool_call` 攔截驗收。
- `tool_call` 依實際 extension 順序處理；先載入的權限系統可能先 ask。單看 settings 順序或沒有提示框不能證明安全結果。
- 新程序結束後只清理自身 presence；不要因出現其他記錄就替其他 session 刪除。

目前固定組合的隔離驗收已通過，**但不等於上述正式安裝／正式設定的讀回已替你完成**。

## 5. 命令與設定

### 命令

```text
/agents-guard status
/agents-guard on
/agents-guard off
/agents-guard on writer-lock
/agents-guard off git-evidence
/agents-guard save
```

- 不帶參數等同 status；啟用時會重查當前 cwd／presence。
- on／off 立即生效；全域 off 不抹掉個別模組選項，重新 on 不代表把所有個別 off 都改成 on。
- `save` 才會保存明確設定到 config；它不保存 pi-guard 的 session approval，也不更新 Pi packages。
- `takeover`／`unlock` 是相容提示，**不接管、不解鎖、不刪記錄**。
- 模組三次 unexpected failures 後可變成 inert，status 顯示 `auto-disabled`；on 不會重設失敗計數。先排查，不以開關指令冒充復原。

### 五層設定優先權

```text
default → state config.json → AGENTS_GUARD → --agents-guard → /agents-guard 命令
```

File path 為 `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/state/agents-guard/config.json`，不是 `.pi/settings.json` 裡的 `guard`。File／env 在 extension 載入時讀取；命令直接覆寫當前 Runtime。Env 與 CLI 支援 `on`、`off` 或逗號模組清單（清單會啟用全域、只開列出的模組）；只有 env 另支援完整 JSON。

```bash
AGENTS_GUARD='{"modules":{"git-evidence":{"checkCi":false}}}' pi
```

這個例子假設 extension 已持續載入；不修改檔案，除非之後執行 save。未知 module（如舊 `hardDeny`）會警告並忽略；錯誤 JSON 不會成為有效規則。

| 模組 | 選項 | 預設與注意事項 |
| --- | --- | --- |
| 全域／各模組 | `enabled` | `true` |
| `hard-deny` | `commands`、`protectedPaths` | 完整預設見 [src/config.ts](../src/config.ts)；陣列整份替換 |
| `subagent-policy` | `weakModelPatterns`、`externalCliAgents`、`nativeOnlyOptions`、`reviewIntentPatterns` | 各清單整份替換，非追加 |
| `writer-lock` | `heartbeatTimeoutMs` | `14400000`（四小時）；只表示新鮮度，非驅逐權限 |
| `writer-lock` | `blockedTools`、`blockedGitSubcommands` | deprecated，保存相容性但不介入決策 |
| `git-evidence` | `checkCi`、`maxAppendBytes` | `true`、`2048`；現行長度計量是 UTF-16 units，不是真實 bytes |
| `completion-diff-recheck` | `followUp`、`maxFollowUpsPerSession` | `false`、`2`；開啟 follow-up 可能新增付費模型回合 |

需要示例可用下列最小 config，不覆寫安全清單：

```json
{
  "version": 1,
  "modules": {
    "completion-diff-recheck": {
      "followUp": false,
      "maxFollowUpsPerSession": 2
    }
  }
}
```

`save` 略過沒有明確來源的模組；明確模組會保存 enabled 與非預設選項，而非整份 defaults。模組來源是摘要，不能當作每個選項的完整 provenance。若需覆寫安全清單，從當前 `src/config.ts` 核對完整內容、保留其他規則並驗證差異，不直接複製歷史 design 的舊鍵名。

## 6. Native child 與 pi-guard 權限

先使用 `subagent` 工具做真正的能力查詢：

```json
{"action":"list","capabilities":true}
```

成功後才派發。管理呼叫含 `action`；執行呼叫使用 `agent`／`workflowScript`／`workflowScriptPath`／`workflow`，不混用 action。這只是 agents-guard 的前置條件；模型選型、runner preflight、one writer、fresh context 等仍按 pi-subagents 的實際 contract 執行。

**pi-guard 1.4.0 在已載入啟用、規則匹配的無 UI child：**

| 規則 | 結果 |
| --- | --- |
| allow | 通過此權限層；仍可能被 agents-guard 或工具本身拒絕 |
| ask | 拒絕：`No interactive session available`，不轉送 parent |
| deny | 拒絕：`Security policy` |

這是已接受的預期限制，不是 agents-guard 的必要修正。父程序曾按 Allow／Always 不表示 child 繼承授權。`complete`／exit 0 只描述執行生命週期，不能替代成功 toolResult 與檔案讀回。

正式 writer 應事前確認最小必要工具與路徑；例如由操作者在**合併既有規則後**，只批准一個輸出檔案的 write：

```json
{
  "guard": {
    "rules": {
      "write": {
        "*": "ask",
        "/absolute/path/to/project/docs/result.md": "allow"
      }
    }
  }
}
```

這只是 pi-guard 設定形狀示例，不是已套用的正式批准：

- 替換成審查過的真實絕對路徑；child brief 必須要求同一個絕對 `path`。相對路徑是不同輸入，不能假設匹配，也不要為方便廣泛加 allow。
- 若需要 edit、bash 或自訂工具，逐一另定規則；write allow 不代表其他工具獲准。pi-guard 一般 pattern 採 last match wins，合併後須檢查後續層／profile／session 的覆寫。
- 這不是 OS containment；縮小 tools、固定 cwd、審查 source 並使用隔離工作目錄，避免未列舉工具成為繞道。
- 必須核對 **child 自己的** launch-resolved extensions、真實 source、activeTools、model、cwd 與 HOME；parent 的 `-e`／status 不證明 child 載入。
- 由 pi-subagents 設定真實 child identity；不要在一般父程序偽造 `PI_SUBAGENT_CHILD=1`。該 flag 會略過 writer presence 與 completion、以及 child 的 capabilities 前置要求；hard-deny 與其他適用檢查仍在。
- 長 workflow 可用預先語法檢查及 native validate 的 `workflowScriptPath`，避免重複巢狀字串；這不改變腳本來源信任或派發權限。

歷史 pi-lab forwarding 的 FAIL 與正式 pi-guard 測試是不同結果，見[影響判讀](reports/2026-09-11-permission-forwarding-impact.md)。不要為了轉綠換套件、假造 hasUI、停用 guard 或直接套用 LAB fixture rules。

## 7. 日常工作 SOP

1. **開始前：** 人工 `git status`、確認 cwd／branch，查看 `/agents-guard status`。沒有 peer 只表示「本次未觀察到其他參與記錄」，不是無其他 writer 的證明。
2. **編輯時：** 單 worktree 一個 writer；平行寫入用各自隔離 worktree。遇到 hard-deny，先辨識原因；應由操作者明確處理的設定／刪除操作不要叫模型繞過。
3. **派發前：** 真實 capabilities／runner／model preflight；必要 child allow 事前核定，child 回報要讀回驗證。
4. **提交前：** 跑相關測試、typecheck、lint，具名 staging，核對完整 staged diff。commit／push 仍須明確授權，Git-evidence 不代行授權。
5. **push 後：** 人工查遠端 SHA，再追蹤該 SHA 的 CI 最終結論。產品的 `@{u}` 是本地 tracking ref，`gh run list -L 3` 不是此 SHA 必然成功的證據。
6. **回報前：** 重新讀 `git status --porcelain`、`git diff --stat`、完整 diff 與 untracked。Completion 卡片比對快照、顯示全部 dirty 數；同一 `M` 檔內容再改可能不觸發。不要只靠卡片。
7. **結束時：** 正常關閉 child／parent；確認自身記錄已清理。不要刪除他人 presence 或把 stale 記錄當作可接管的鎖。

## 8. 停用、卸載與回退

- 暫停當前 session 用 `/agents-guard off`；只有 save 才會持久保存該關閉選擇。這是操作者維護操作，不是遇到拒絕時模型自行放行的方法。
- 卸載前先備份並正常結束所有使用此 source 的 session／children。
- local package 由操作者使用**原 scope／原 source** 移除；user scope 範例：

```bash
pi remove /absolute/path/to/pi-agents-guard
```

- 原本透過 `extensions` 載入者只移除對應 entry；單次 `-e` 下次不要再帶。不要連帶刪除 pi-guard／pi-subagents 或其他套件。
- `pi remove` 不應被當作 source／自有 state 已安全清空的證據。保留 config 與 presence 供診斷；要刪 source／state 必須另核對所有程序停止、資料歸屬及授權，避免廣泛 `rm -rf ~/.pi`。
- 回退時對照備份，只還原本次更改的相關設定，保留之後別人新增的設定；重新準備該版本 dependencies，從新程序讀回來源／狀態。
- 退役的 v1 writer locks 不轉換、不覆寫、不刪除；回退舊強鎖版會恢復已知 ownership 缺陷。不能用 takeover／unlock 當復原手段，也不能把混版當安全協調。

## 9. 常見問題

| 現象 | 先檢查 |
| --- | --- |
| 沒有 `/agents-guard` 命令 | package 是否被停用／忽略、project trust、入口是否 `src/index.ts`、dependencies 是否齊全；新程序看載入錯誤與 sourceInfo |
| status 看不到改過的設定 | 檔案位置、合法 JSON、kebab-case；env／flag／command 是否覆寫，是否開了新程序 |
| 模組 `auto-disabled` | 該 Runtime 的失敗計數；on 不重設，不可繼續假設硬擋有效 |
| 權限框先出現，之後才 hard-deny | 實際載入順序／混 scope／重複 extension；先在隔離 fixture 重驗 |
| child 完成但檔案不存在 | core toolResult `isError`、pi-guard 無 UI ask、child 載入／規則及精確 path；不是 workflow complete 就代表成功 |
| writer 顯示資訊不完整 | Git 是否可用、cwd、查詢逾時與 state 權限；非零 Git exit 不冒充已確認非 Git |
| 沒有 completion 提醒 | 是否有成功 write／edit／ast_grep_replace、是否 child／disabled、baseline 與 porcelain 是否相同；bash 寫檔 alone 不設寫入條件 |
| 提示數量大於剛新增的檔案 | 卡片列全部 dirty，不是精確差集；獨立看 status、untracked 與 diff |
| 缺 CI 資訊 | `gh` 可用性／登入與 checkCi；不能解讀為 CI 成功 |

## 10. 開發與驗證

```bash
npm ci --no-audit --no-fund --ignore-scripts
npm test
npm run typecheck
npm run lint
```

沒有 build 指令。不要用會修改整個 repo 的 `npm run format` 取代唯讀 lint。

- [原始碼入口](../src/index.ts)、[Pi hooks／命令](../src/extension.ts)、[設定預設](../src/config.ts)、[測試](../test/)是現行行為證據。
- writer 與 completion 的需求以 [canonical specs](../openspec/specs/) 為準；archived tasks／review 是執行歷史，不把舊 checkbox 全部重開。
- Linux CI 的 unit／typecheck／lint 與 macOS Pi 實機驗收分開記錄；最低 Node、其他 OS／TUI、更多 crash／race、完整第三方安全稽核等未測，不一律變成本機安裝阻擋。
- 實機驗收需保留失敗批次與去敏證據，不自動 retry 轉綠。完整矩陣、清理與剩餘邊界見[文件索引](./README.md)。
