# 第二批模型驗收：認證前置檢查受阻

## 結論

**`BLOCKED_ENV`：D0 在 Pi 接受模型提示前遭認證解析拒絕，尚未執行模型功能驗收。** 這是本次測試控制腳本選錯憑證格式，不表示使用者登入失效，也不是 agents-guard 產品失敗。未自動重試、未切換模型、未重新登入或修改真實 auth。

- 日期：2026-09-11（臺灣時間）。
- 使用者指定：`openai-codex/gpt-5.6-luna`、沿用目前登入、各功能測一個案例即可。
- 受測來源：`3df8f9d4287591de85aa8c056ee77a74501f3054` 的 `git archive` 副本。
- 環境：原生 macOS arm64，Node `22.23.2`、npm `10.9.8`、Pi `0.85.1`。
- [第一批通過紀錄](2026-09-11-isolated-acceptance-results.md)未修改；本報告不撤銷其無模型驗證結果。

## 已取得的證據

| 檢查 | 實際結果 |
| --- | --- |
| 暫存 `npm ci --no-audit --no-fund` | exit `0`；179 packages；沒有全域安裝 |
| LSP：兩個 extension 入口 | 0 diagnostics |
| `npm run typecheck`／`npm run lint` | 各 exit `0`；Biome checked 41 files，未 autofix |
| `npm run test` | exit `0`；411 tests／18 files passed，1.27 秒 |
| Pi 載入與來源 | 真實 RPC `get_commands` 確認指定副本的 guard；五個模組啟用 |
| 模型選擇 | `get_state.model` 確認 provider `openai-codex`、id `gpt-5.6-luna`；未沿用主 session 的另一模型 |
| D0 提示 | 僅要求 `ACCEPTANCE_OK`、停用工具；`prompt` 回覆 `success:false`，並非已接受後的遠端模型錯誤 |
| 模型活動 | 沒有 `agent_start`、`turn_start`、工具事件或 auto-retry；session messages、tokens、cost 全為 `0` |
| 宿主退出 | Pi PID `28462` 正常 EOF shutdown，exit `0`；Python 驗收器因斷言失敗 exit `1`；presence 清空 |

關鍵原始 RPC 回應節錄（省略日誌中的文件路徑）：

```json
{
  "id": "d0-connect-7",
  "type": "response",
  "command": "prompt",
  "success": false,
  "error": "No API key found for openai-codex.\n\nUse /login to log into a provider via OAuth or API key. See: ..."
}
```

`prompt` 被拒絕不等於模型已執行；本次沒有遠端模型回覆、模型計費用量或產品工具測試結果。

## 根因與認證邊界

目前登入的指定 provider 是 OAuth，access token 尚有充足效期。為避免真實 refresh token 輪替，本次只將該 provider 的 access token 保存到隔離的 `auth.json`，但錯誤標成 `type: api_key`。

Pi `0.85.1` 的 Codex provider 只宣告 `auth.oauth`，沒有 `auth.apiKey`。SDK 的 `resolveProviderAuthWithSignal` 只有在 **stored credential 類型與 provider handler 相符** 時才解析；`api_key` 不符合便回傳 undefined，不會因 token 本身有效就自動轉成 OAuth。這與實際 pre-acceptance 拒絕一致。

查證來源：同版本 SDK 的 `providers/openai-codex.js`（`openaiCodexProvider`）與 `auth/resolve.js`（`resolveProviderAuthWithSignal`、`resolveStoredOAuth`）；受測副本的 `dist/core/auth-storage.js:185–203` 驗證 credential shape，`dist/core/model-registry.js:31–57` 處理缺少 auth 的結果。沒有以改 endpoint、換模型、複製整份 auth 或呼叫會 refresh 真實登入的命令繞過問題。

此外，準備階段的兩次安全斷言先後發現「從 repo 推算 HOME 多走一層」及「Pi 啟動已建立空白 auth.json，不能假設檔案不存在」。均在準備模型憑證／啟動 D0 前停止；只修正測試準備邏輯，不計為模型請求，也未改產品程式。

## 未執行的功能案例

合法 write／read／edit、雙程序下的合法 writer、hard-deny、模型 Git commit／本機 push 證據、completion 基線與差異均維持 **`NOT_RUN`**。D0 未過，不往後跑；原生 subagent／權限套件、其他 OS、最低 Node 等也未驗。

測試已準備一個限定精確 fixture 呼叫的 scope envelope，並以正向／負向控制確認不誤擋預定的負向案例、可拒絕越界與重複呼叫；這只是測試控制器自測，不是模型工具或真實權限套件整合證據。控制器未交付為正式驗收框架，會隨暫存區清理。

## 清理與變更範圍

- 唯一 LAB：`<LAB_ALIAS>`（canonical 為 `<LAB>`）。
- 24 筆受控 process group 均不存活；刪除前 presence 已清空，extension state 權限為目錄 `0700`／檔案 `0600`。
- 僅曾保存單一 provider 的 access token，權限 `0600`，沒有真實 refresh token；已先刪除此 snapshot。掃描 81 個證據／session 檔確認未包含該 token，未將憑證值輸出到工具結果或本報告。
- 真實 auth 的 inode／size／mtime 未變；沒有再讀其他 provider 值來驗證。87 個已追蹤檔案與受測副本逐項 bytes 相同，第一批報告 hash 未變。
- **LAB 已於 2026-09-11 03:58:45（UTC+08:00）完整刪除。** 刪除前重查 24 筆 process group 不存活、presence 為空；刪除後以 `os.path.lexists` 確認 `/tmp` 與 `/private/tmp` 兩個路徑均不存在。暫存依賴、快取、fixture、日誌、控制腳本均已移除；原始 repo 仍無 node_modules，其他暫存盤點／報告未動。
- 本次僅新增本報告；沒有產品修改、正式安裝、本專案 commit／push。第一批尚未提交的報告保留原樣。

## 建議下一步（尚未執行）

修正的是測試認證橋接，不是產品：保留正確 OAuth 類型、access 與到期資訊，不攜帶可用的 refresh token；先驗證宿主可解析，再另行放行一次 D0。需再次確認剩餘效期足以涵蓋測試與 SDK 的安全窗口，不能把空 refresh 欄位宣稱為宿主完全不會嘗試 refresh 的硬保證。

尚未使用上述方式成功呼叫模型，故不宣稱已修復。後續需經操作者確認後繼續；無需把 key 貼到對話或改用不同模型。
