# 正式 Git 安裝後核對與 AGENTS.md 建議

日期：2026-09-11。範圍：使用者已自行安裝後，核對目前 macOS 主機的套件、設定、檔案與無模型啟動狀態；不是重新安裝、完整安全稽核或重新執行歷史模型驗收。

## 結論

**安裝與無模型載入正常；但有一個建議優先補強的安裝目錄保護缺口，不宜概括宣稱「所有安全設定都正確」。** 既有 `AGENTS.md` 不必為了讓 extension 運作而改寫，也不應刪除已有機械輔助的規則；可補三條簡短的操作邊界。

本輪只新增本報告，不修改正式 settings、AGENTS.md、安裝副本、產品原始碼或歷史驗收文件。不 commit、push、reload 現有 session、停用 guard、修改憑證或派發 child。

## 1. 已確認項目

| 項目 | 實際結果 |
| --- | --- |
| Runtime | Pi 0.85.1；Node 22.23.2 |
| agents-guard | 0.1.0；Git HEAD `3df8f9d4287591de85aa8c056ee77a74501f3054`，與既有驗收來源相同 |
| 安裝位置 | `~/.pi/agent/git/github.com/chinlung/pi-agents-guard`；origin 為 `https://github.com/chinlung/pi-agents-guard` |
| 其他固定組件 | 實際 pi-guard 1.4.0、pi-subagents 0.67.0 |
| Runtime dependencies | `npm ls --depth=0 --omit=dev` exit 0：minimatch 10.2.6、unbash 4.0.11 |
| 設定順序 | user packages 的 agents-guard 在 pi-guard 前面；pi-subagents 位於更前方。此處確認必要的兩個 guard 相對順序，非宣稱整份套件序列與 LAB 完全相同 |
| 重複入口 | settings 未另列 `extensions`；user/project `extensions` 目錄均不存在；本 repo 無 `.pi/settings.json`。新程序無 `-e`，兩個 guard command 各一筆、來源正確 |
| agents-guard 狀態 | global 與五模組全為 `enabled (source: default)`；無 auto-disabled 或設定 warning |
| pi-guard 狀態 | ENABLED；設定驗證無 warning；目前 repo 無 project 規則、無 PI_GUARD env override、新 session 無 profile/session override |
| State | `~/.pi/agent/state/agents-guard` 與 presence 子目錄為 0700；所見 presence JSON 為 0600 |
| 預設設定檔 | `state/agents-guard/config.json` 不存在是正常的「使用 defaults」，不是漏裝；無 AGENTS_GUARD／PI_CODING_AGENT_DIR override |

來源：`~/.pi/agent/settings.json:9–20`；安裝副本 `package.json:1–25`；本次 CLI、RPC、dependency tree 與檔案讀回。

### 新程序的真正載入證據

執行 `pi --mode rpc --offline --no-session --no-tools`，使用真實 HOME/user settings，不傳額外 extension、不換 provider。

1. 先取得 `get_commands`，確認兩個命令存在且 canonical `sourceInfo.path` 正確，才送出 slash commands，避免未知命令落入模型提示。
2. 執行 `/agents-guard status`、`/guard list`，再取 `get_state`、`get_session_stats`。
3. PID 19712、session `01a090c1-67a9-7436-b68d-2eba9d537141`；EOF／exit 0，stderr 空、extension errors 0、dialogs 0。
4. user/assistant messages、tool calls/results、tokens、cost 全為 0；`sessionFile:null`，無串流、compaction 或 pending messages。
5. commands 均為 `scope:user`、`origin:package`：
   - `agents-guard` → `~/.pi/agent/git/github.com/chinlung/pi-agents-guard/src/index.ts`。
   - `guard` → `~/.pi/agent/npm/node_modules/pi-guard/src/index.ts`。
6. 結束後 fresh `ps -p 19712` 無程序，presence 無此 PID；保留原本其他 session 的記錄，沒有刪除或接管他人 presence。

這證明新程序已載入與讀到設定，不證明既有 TUI session 曾否手動切換模組，也不取代真正模型 tool_call 的 first-blocker／child 權限驗收。`--offline` 不是 OS 封網；`--no-session` 也不是所有 extension 都不寫 runtime/cache 資料的保證。

## 2. 優先補強：Git 安裝副本未受兩層寫入政策保護

- agents-guard 的預設 `protectedPaths` 包含 `.pi/agent/npm/**`、`extensions/**` 與自身 state，但**沒有 `.pi/agent/git/**`**：[`src/config.ts:26–49`](../../src/config.ts)。
- 正式 pi-guard 設定 `write`／`edit` 的 `"*":"allow"`，沒有針對這個 Git 安裝目錄的例外：`~/.pi/agent/settings.json:193–220`。
- 本輪以安裝副本的 `decideHardDeny` 及 pi-guard 的 `loadConfig`／`buildEffectiveRules`／`resolveGlobAction` 做唯讀純函式判定，沒有真的執行 write/edit：

| 目標 | agents-guard：write/edit | pi-guard：write/edit |
| --- | --- | --- |
| Git 安裝副本 `src/index.ts` | pass | allow |
| `~/.pi/agent/AGENTS.md` | block | ask |
| `~/.pi/agent/settings.json` | block | ask |
| npm 安裝的 pi-guard `src/index.ts` | block | deny |
| 本 repo 一般 `README.md` | pass | allow |

**影響：** 目前列舉式政策不會阻止模型透過一般 write/edit 修改 agents-guard 的安裝原始碼；變更可能影響後續載入。此結論是兩層政策對指定路徑的可重現結果，不是已觀察到攻擊、已修改檔案或證明正在執行的 handler 立刻失效。

**建議：** 由操作者在正式 agents-guard `hard-deny.protectedPaths` 保留全部現行 defaults，再加入精確安裝目錄的 `/**` 規則；pi-guard write/edit 可同步設該目錄 deny。若要保護所有 Git 安裝套件，可另評估 `.pi/agent/git/**` 的維護影響，不預設擴張到所有工作區。

agents-guard 的陣列是整份替換，不能只寫新增那一條而移除 defaults。兩個正式 config 路徑本身受 hard-deny 保護，應由操作者在 agent 工具通道之外維護，完成後以新程序核對。不得為了完成任務自行停用 guard 或換工具繞過。這仍只是列舉式誤操作防護，不是 OS sandbox。

## 3. 檔案差異與固定版本

### 安裝副本的 lockfile

安裝副本 `git status` 只有 `M package-lock.json`；逐 byte 對照 HEAD 的 87 個 tracked files，另外 86 個完全一致。

表面 diff 為 3,779 additions／3,779 deletions；遞迴 JSON 比對只有兩個語意差異：

- `package-lock.json:2` 的根 `name`：`agents-guard` → `pi-agents-guard`。
- `package-lock.json:8` 的 `packages[""].name`：同樣更新。

其餘是格式差異；沒有 dependency version、integrity、resolved URL 或依賴拓撲差異。原 repo 的 `package.json:2` 已是 `pi-agents-guard`，但原 lockfile 兩處仍為舊名。此結果符合 npm 安裝時正規化套件名稱，不是來源碼遭改寫；本輪未持有使用者安裝時的完整 log，不將原因推論冒稱完整重播。

不需因此重裝或強制還原安裝副本。原 repo 的 manifest/lock 名稱同步可於後續維護處理，本輪不修改。安裝副本不是完全乾淨工作樹，日後更新仍應保留並檢視差異。

### 版本目前相同，但設定未釘選

`~/.pi/agent/settings.json:11,19–20` 登錄的是無版本 npm sources 與無 ref Git source。現在實際版本符合既有驗收組合，但未來 package update 可能改變它們。若要持續維持這套組合，建議由操作者分別固定 agents-guard 的已驗收 commit、`npm:pi-guard@1.4.0`、`npm:pi-subagents@0.67.0`；本輪未執行 install/update 或修改設定。

pi-guard 的 exact peers 仍是 Pi 0.79.1／typebox 1.1.39，與此組合存在已知宣告落差；此次載入成功不把它改寫成 exact-peer 相容性認證。

## 4. 原 AGENTS.md 是否需要調整？

**不需因安裝而刪減或重排原檔。** Extension 不會把 AGENTS.md 自動編譯成硬擋規則，也不依文件行號決定執行；實際行為來自設定與程式碼。

建議保留現有：

- 使用者授權與具名 staging：`~/.pi/agent/AGENTS.md:49–55`。工具放行不等於使用者已授權，且其他 harness 未必載入此 extension。
- 單一 writer：`:56,93`。writer-lock 是 advisory，不是互斥鎖。
- 強模型及 capabilities/runner contract：`:88–92`。參數檢查不代表每個預設模型或 workflow 內部派發都已核對。
- 測試、遠端 SHA／CI、最終 diff：`:28,52–53,58–70,111`。自動補卡與 porcelain 提醒不能取代這些要求。

可選的最小補充，建議放在「工具使用」段落，不新增長篇版本／安裝清單：

> - agents-guard／pi-guard 是輔助防線；工具放行不代表取得授權，沒有提醒不代表驗證完成，仍遵守本檔的 Git、單一 writer、review 與驗證規則。
> - 遇 hard-deny 應停止該操作並回報理由；不得改用其他工具、命令或停用 guard 繞過。合法的受保護設定、守則與安裝來源維護交由操作者手動處理。
> - 安裝、更新或 reload guard 後核對實際來源、狀態與相對載入順序；若出現載入失敗或 auto-disabled，先排查，不將「沒有阻擋」當成可安全繼續的證據。

原本「同步修正守則」的要求（`:23`）現在遇到全域 AGENTS.md 的硬擋時，可採原條文已允許的「明示使用者」，再交由操作者修改；不需要為了讓 agent 自行修改而移除保護。

## 5. 檢查限制與意外指令紀錄

第一次套件查詢誤寫成 `pi --offline list`。Pi 0.85.1 的 package dispatcher 只從第一個 argv 辨識子命令（`dist/package-manager-cli.js:304–315`），所以它進入一般 session，將 `list` 當作提示；選用既有預設 Bedrock Sonnet 5，因 `Could not load credentials from any providers` exit 1。這是本次查詢方法的錯誤，不是套件安裝失敗；未重試該模型或切換 provider。正式預設 selector 位於 `~/.pi/agent/settings.json:4–5`，本輪未處理其認證。

查明原因並閱讀完整 help 後，改用真正的管理命令 `PI_OFFLINE=1 pi list`，exit 0，列出正確 user packages。上述零 tokens／cost 統計只屬於其後獨立 RPC 狀態檢查，不回溯套用到第一次失敗的普通 session；未對該失敗程序另作完整用量稽核。

本輪沒有新的產品 411-test run、實際拒絕寫入、child 派發、完整權限／沙箱攻擊測試，亦未補跑之前因 Bedrock credentials 失敗的獨立 reviewer。沒有聲稱雙獨立 review 通過。

正式 settings 與 AGENTS.md 在 RPC／政策檢查前後 SHA256 相同；auth 只比 inode/size/mtime/mode metadata，不開啟憑證內容，RPC 前後 metadata 相同。新 RPC 的自身 presence 已清理；沒有清共享 cache、既有 session 或其他 worktree。既有 README 修改及 19 份未追蹤文件保留，本輪只新增本報告。
