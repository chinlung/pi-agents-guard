# 正式目標組合驗收：父程序通過，child 尚未執行

日期：2026-09-11（臺北時間）。本輪由操作者授權補做正式組合驗收；不含正式安裝、產品修改或 commit／push。

## 結論

**`PARTIAL_PASS_CHILD_NOT_EXERCISED`。** Pi 0.85.1＋pi-guard 1.4.0＋agents-guard 的父程序案例通過，pi-subagents 0.67.0 的真實能力／模型查詢也成功；但模型送出的 workflowScript 漏掉內嵌字串跳脫，被自建驗收 envelope 在派發前拒絕。**沒有 native workflow／child 啟動，child 的 allow／ask／deny 不能記為 PASS。**

這不是已證實的 agents-guard、pi-guard 或 pi-subagents 相容性失敗；也不足以宣稱整個正式組合已驗收完成。依事前「失敗停止、不自動重跑」限制，本輪沒有修正模型輸入後再派發。原始 driver exit 1 與被拒請求保存在[去敏證據](2026-09-11-final-stack-evidence.json)。

## 固定版本、來源與隔離

- agents-guard：`3df8f9d4287591de85aa8c056ee77a74501f3054` 的 Git archive，package 0.1.0；87 個 tracked files 與原 repo 逐檔 SHA256 一致。
- 宿主：Darwin arm64、Node 22.23.2、npm 10.9.8、Pi 0.85.1；模型固定 `openai-codex/gpt-5.6-luna`、low thinking。父程序 PID／PGID `19544`，11:36:11 啟動，35.905 秒後正常退出。
- 唯一 LAB：`<LAB>`。source、unborn `main` fixture、HOME、agent directory、sessions、XDG、npm／Git／GH 設定及暫存路徑分離；無正式 repo 依賴安裝。
- source 使用 `npm ci --no-audit --no-fund --ignore-scripts`；透過真實 `pi install` 在 **LAB user scope** 登錄 source、observer，以及 `npm:pi-guard@1.4.0`、`npm:pi-subagents@0.67.0`。只安裝 LAB 套件，npm lifecycle scripts 關閉；固定版本 metadata、npm integrity 與已讀文件／來源的 byte 比對列於 JSON。
- **Peer 限制沒有消失：** pi-guard 宣告 Pi `0.79.1`、typebox `1.1.39`；本輪 Pi 是 `0.85.1`，LAB npm root 實際 typebox 是 `1.1.38`。Pi 0.85.1 的 managed installer 本身使用 `--legacy-peer-deps`（`dist/core/package-manager.js:1462–1479`）；操作者／驗收器未另加 force 或版本覆寫。安裝成功不代表符合宣告的 peer 契約；本輪只提供下述實際執行證據。
- 短期 OAuth snapshot 保留 `type: oauth`，refresh 空字串、mode 0600；複製時有效期超過 30 分鐘，每個模型 prompt 前超過 15 分鐘，`pi auth check --provider openai-codex --json --no-refresh` 回 ready／oauth／exit 0。無額外 D0、refresh、模型替換、自動 retry 或 compaction。
- HOME／環境白名單不是 OS sandbox，`--offline` 也不是封網。自建 envelope 是精確 single-use fixture 範圍限制，**不是 pi-guard 或 agents-guard 的產品驗證替身**。

## 實際案例

| 案例 | 結果 | 權威證據與邊界 |
| --- | --- | --- |
| 自動發現負控制 | PASS | 同 settings 加 `--no-extensions --no-tools`；guard／agents-guard／observer commands 與 presence 不存在，零模型／工具，沒有 session JSONL |
| 正向 package 自動載入 | PASS | 父程序不帶 `-e`／`--no-extensions`；三個 command 的 canonical `sourceInfo.path`、`origin: package`、`scope: user` 正確；agents-guard status 顯示全域與五模組 enabled |
| hard-deny 優先 | PASS | 真實模型 `bash {command:"git add ."}` 得 `[agents-guard/hard-deny]`；沒有該 call 的 pi-guard approval event／dialog，Git index 未建立 |
| 合法 allow | PASS | 真實 write 將 `allowed-parent.txt` 寫成 `PARENT_OK\n`；core toolResult 成功，控制器獨立讀回一致 |
| 父程序 ask 取消 | PASS | write `ask-parent.txt` 觸發唯一真實 pi-guard select；控制器以同 request ID 回 `cancelled:true`，未選 Allow／Always；結果為 `[Blocked by pi-guard: User rejected this invocation]`，檔案不存在 |
| native child 能力／模型 preflight | PASS | 真實 `subagent {action:"list",capabilities:true}` 再 `action:"models",agent:"final-child"`；唯一 executable native Pi agent、write only、Luna low、三個明確 extension 路徑、無 fallback |
| 單一 child allow／ask／deny | NOT_EXERCISED | 唯一派發請求在自建 envelope 被拒；無 native run ID、child PID、child session、workflow receipt 或 process-terminal artifact；三個 child 目標均不存在 |

選定 package 順序為 observer → agents-guard → pi-guard → pi-subagents。LAB settings 的 local-package 相對路徑由 settings 目錄解析核對，npm 來源另以真實 command provenance／lockfile 核對。正向與負控制使用同一組 settings，不以已安裝 metadata 冒充 runtime 載入。

LAB pi-guard rules 只明確 allow 兩個合法 fixture 路徑與 `subagent` 工具，指定 ask 目標及 `git add .` ask；其餘 write deny。`subagent` 的可執行請求再受 envelope 的兩次管理查詢／一次派發限制。這不是正式權限設定建議，不代表現有正式 session 已具備必要 allow 規則。agents-guard 五模組保持啟用，僅在 LAB 設 `git-evidence.checkCi:false`、`completion-diff-recheck.followUp:false`。

## 派發失敗根因與保存方式

1. 驗收器提供的 workflowScript 是合法 JavaScript function body，task 字串內含三個 JSON 寫入請求。模型複製時遺失內部雙引號的跳脫，使 task 出現未跳脫的 `{"path":...}`，破壞外層 JavaScript 字串。
2. 真實 tool-call ID 為 `call_DWszOiDQEZPdirigYmpddOPJ|fc_06c11802569d2e79016aa37748103c87d08e2dc344988ca9de`。observer 的 `envelopeAllowed:false` 及持久化 core toolResult 的 `[stack-envelope]` 拒絕一致；此請求沒有進入 native subagent 派發器。
3. 離線只做語法檢查，沒有執行 script：將預期與實際 function body 各包入不呼叫的 async function，`node --check` 分別 exit 0／exit 1；實際輸入錯誤為 **`SyntaxError: Unexpected identifier 'path'`**。原 script、模型實際 script、差異、錯誤及原 assertion／driver exit 1 均保留在 JSON。
4. 模型最後回覆 `Workflow launch refused by the stack envelope. No child was launched.`，沒有重試、改工具或規避。原生 run ID／child ID 是「尚未產生」，不是遺失或推定完成；fixture 仍為 unborn `main`，`git status --porcelain` 僅 `?? allowed-parent.txt`。
5. Envelope 自測確認精確匹配、重複／越界拒絕，刻意放寬 matcher 的 mutant 會失敗；聚合器也拒絕將 child 改記 PASS 或少算一個 tool 的記憶體 mutant。未放寬 envelope 迎合錯誤輸入。

後續若核准補測，只需補單一 child 的三種結果；建議使用同一 native workflow 協定的 `workflowScriptPath` 指向事前檢查過的 LAB script，避免要求模型重複巢狀跳脫。這只是下一輪建議，**本輪沒有建立該替代派發、重跑模型或改產品**。無 UI ask 預期拒絕、不要求轉送的需求判讀，仍依[既有說明](2026-09-11-permission-forwarding-impact.md)。

## 用量與交叉核對

| 項目 | 本輪實際值 |
| --- | ---: |
| 操作者模型 prompts／真正開始的 child tasks | 3／0 |
| 模型回合／tool calls | 9／6 |
| 成功／拒絕工具 | 3／3 |
| Input／output tokens | 12,367／629 |
| Cache read／write tokens | 24,064／0 |
| Total tokens | 37,060 |
| SDK 估算費用（非帳單） | US$0.00370948 |

三個成功工具為 allow write 與兩次 native 管理查詢；三個拒絕為 hard-deny、取消 ask、envelope 拒絕派發。九個 assistant messages 均為指定 provider／model，stopReason 僅 stop 或 toolUse。RPC message_end 與 session `01a08e89-8177-774f-990a-b447d4d853f2` 的 assistant messages 逐項一致，六個 core toolResults 的 ID／error／content 也逐項一致。失敗後未取得新的最終 RPC session stats；用量來自以上兩份一致的原始 usage，不冒稱另有 stats readback。

## 完整性、驗證與清理

- 25 份受控 process records：23 個 exit 0；兩個 exit 1 分別是原 stack driver 與刻意檢查錯誤模型 script 的離線 parser。parent PID／PGID 均不存在；沒有 child 程序啟動證據。所有已記錄 process groups 均停止。
- OAuth snapshot 已先刪；936 個 evidence／session／tmp／observer／helper 檔案掃描無該 access token。真實 auth 與正式 settings 的 inode／size／mtime／mode 不變；不聲稱這是全磁碟秘密掃描或 auth content hash。
- agents-guard state 目錄 0700、檔案 0600；最終 presence 空。87 個 tracked files、lockfile、HEAD 及原十份報告 SHA256 不變；原 repo 無 node_modules、tracked／staged diff 空。
- 本輪未重跑 unit tests、typecheck、lint 或 source LSP；過往 411 tests 是歷史證據，不當作本輪回歸結果。沒有修改 source、正式 settings 或 OpenSpec 契約；API、data contract、schema、migration、backward compatibility、security／permissions、concurrency／consistency、cross-module behavior 八面均不改。
- **11:47:58 +08:00 已定點刪除完整 LAB，479,994,157 bytes（約 457.76 MiB）**。刪除前再核對全部受控 PID／PGID 已停止，同使用者程序 command／cwd 無 LAB references；canonical 與去 `/private` 別名均不存在，未清共用 cache。完整 raw logs、sessions、helpers、fixtures、依賴已刪，只保留本報告與去敏選錄 JSON，不宣稱仍持有完整 transcripts。
- 文件已實際 Markdown render，AST 確認兩個表格／兩條相對連結；JSON、用量聚合、whitespace、`git diff --check` 及 `lens_diagnostics mode=all`（14 個 session 檔案、零問題）通過。renderer 暫存目錄及程序已清理；這些是文件與證據驗證，不是 source 回歸。

**安裝準備度：父程序的正式目標組合缺口已補上；child 仍未實測，不能宣告本輪完整通過。正式安裝仍需另行授權。**
