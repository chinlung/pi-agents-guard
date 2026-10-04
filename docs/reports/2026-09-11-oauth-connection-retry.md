# OAuth 連線重試：D0 通過

## 結論與範圍

**`PASS`：`openai-codex/gpt-5.6-luna` 真實回覆 `ACCEPTANCE_OK`。** 本次只有一個模型回合，沒有工具呼叫、重試或自動壓縮；已驗證保留正確 OAuth 類型的短期憑證副本可用。

本輪依操作者追加授權，只做一次無工具連線確認。未擴跑合法寫入、hard-deny、Git-evidence、completion、subagent 或權限載入順序，也不宣稱完整功能驗收通過。

- 日期：2026-09-11，臺灣時間。
- 程式來源：`3df8f9d4287591de85aa8c056ee77a74501f3054` 的獨立 `git archive` 副本。
- 環境：原生 macOS arm64，Node `22.23.2`、npm `10.9.8`、Pi `0.85.1`。
- 模型：`openai-codex/gpt-5.6-luna`，thinking `low`，transport `sse`。
- [前次認證受阻紀錄](2026-09-11-model-acceptance-blocked.md)與[第一批紀錄](2026-09-11-isolated-acceptance-results.md)保持原樣，不覆寫失敗歷史。

## 認證修正與前置檢查

前次將 OAuth access token 標成 `api_key`，不符合 Codex provider 的 OAuth handler。本次只讀取操作者指定的 `openai-codex` 項目，在隔離 auth 中保留 `type: oauth`、access 與到期資訊；`refresh` 為空字串，只滿足 credential schema，未複製真實 refresh token。

複製前以儲存到期時間與 JWT `exp` 的較早值確認尚有超過 20 分鐘效期；模型啟動前再確認超過 15 分鐘。此餘裕涵蓋 SDK 五分鐘 refresh 窗口及本次 90 秒程序期限。這不是通用的「SDK 永不 refresh」保證；到期不足時應停止，不得自行 refresh 真實登入。

先執行原生、禁止 refresh 的 readiness 檢查，不使用任何輸出憑證的選項：

```bash
pi auth check --provider openai-codex --json --no-refresh
```

退出碼 `0`，原始回覆：

```json
{"status":"ready","provider":"openai-codex","authType":"oauth"}
```

已完整讀取 Pi／auth 子命令 help，並將安裝副本的相關文件與先前讀過的 `0.85.1` 文件逐檔比對。文件查詢工具未找到對應 Pi 項目，因此使用隨附官方文件及已查證的 auth resolver／OAuth adapter，不引用無關搜尋結果。

## 真實模型證據

本次用同版本 Pi 的 **CLI print＋JSON event stream** 做最小 D0，不重建前次 RPC 控制器。明確 `-e <LAB>/source/src/index.ts`，使用 `--no-tools` 及 resource discovery 禁用旗標；HOME、agent dir、sessions、快取、Git config 與 fixture 均在 LAB。模型提示只有：

```text
Reply with exactly ACCEPTANCE_OK. Do not call any tool or add other text.
```

| 判準 | 讀回結果 |
| --- | --- |
| 程序 | PID `35436`，exit `0`，1.754 秒，process group 已退出 |
| 最終模型訊息 | provider `openai-codex`、model `gpt-5.6-luna`、stopReason `stop`、文字 `ACCEPTANCE_OK` |
| 事件 | 各一個 `agent_start`、`turn_start`、`agent_settled`；無 tool execution、auto-retry、compaction |
| 用量 | input `435`、output `8`、cache `0`，total `443` tokens |
| SDK 成本估算 | US$`0.0000966`；為 Pi 定價資料推算，不是 ChatGPT 訂閱帳單或額外扣款證明 |
| 持久化 | 實際保存一份 session JSONL；其中唯一 assistant 訊息與 event stream 的內容／usage 相同 |
| Guard 載入／收尾 | stderr 有 fixture worktree 的 writer advisory；結束後 presence 為空 |

修正驗證限於上述 OAuth readiness 與 CLI 模型連線，不將本輪升格成原 RPC 功能案例、工具阻擋或寫入型 child 已驗證。

## 清理與變更

- 唯一 LAB：`<LAB_ALIAS>`（canonical 為 `<LAB>`）。
- 13 筆受控程序記錄均 exit `0`、無存活 process group；刪目錄前 presence 已清空，extension state 目錄為 `0700`。
- OAuth 副本為 `0600`，已先刪除；掃描 44 個證據／session 檔未見 access token。真實 auth 的 inode／size／mtime 未變。
- 87 個已追蹤檔案與副本逐項 bytes 相同；既有兩份報告 hash 未變。
- **已於 2026-09-11 04:11:50（UTC+08:00）完整刪除 LAB。** 刪除前再次核對 13 筆 process group 不存活、presence 為空；刪除後以 `os.path.lexists` 確認兩個 LAB 路徑均不存在。本次 node_modules、快取、憑證、sessions、fixture、日誌及臨時控制腳本均已清理；原始 repo 仍無 node_modules。
- 此輪只新增本報告，沒有產品修改、正式安裝或本專案 commit／push。

本次重新安裝 lockfile 的 179 packages，並核對版本／help；沒有重跑套件型別、lint 或 411 個測試。那些檢查的最近一次實測見前次報告，不將歷史結果當成本輪新測。
