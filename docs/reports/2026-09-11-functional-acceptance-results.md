# 真實模型功能驗收結果

## 結論

**本輪四個核心案例均 `PASS`，整體仍是部分驗收。** 已經由真實 Pi RPC／Luna 工具流程驗證合法寫入與 writer advisory、hard-deny、Git-evidence、completion-diff-recheck。真實 subagent-policy／writing child 與權限套件整合尚未執行，不宣稱五模組全數實機驗收完成。

- 日期：2026-09-11，臺灣時間。
- 來源：`3df8f9d4287591de85aa8c056ee77a74501f3054` 的獨立 archive 副本；原始 repo 的 87 個已追蹤檔案與副本逐項 bytes 相同。
- 環境：原生 macOS arm64，Node `22.23.2`、npm `10.9.8`、Pi `0.85.1`。
- 模型固定：`openai-codex/gpt-5.6-luna`，thinking `low`、SSE。17 則實際 assistant 訊息的 provider／model 都一致，無錯誤或 aborted stop reason。
- [去敏證據 JSON](2026-09-11-functional-acceptance-evidence.json)保存工具 input／result、事件計數、session 身分、Git 讀回及用量摘要；不是完整原始轉錄。案例編號對應[隔離驗收手冊](../validation/isolated-acceptance.md)。
- 前置連線已在[OAuth 重試](2026-09-11-oauth-connection-retry.md)驗證。本輪只重新做禁止 refresh 的原生 auth readiness 檢查，沒有額外重跑 D0 模型提示。

## 執行邊界

唯一 LAB 為 `<LAB_ALIAS>`（canonical：`<LAB>`），包含獨立 source、HOME、agent dir、sessions、快取、Git config、fixture repo 及本機 bare remote。環境白名單不繼承真實 provider keys、SSH agent、GitHub token 或其他 Pi session 標記；**這不是 OS 安全沙箱，`--offline` 也不封鎖網路。**

真實登入只取指定 Codex provider 的有效 access，以正確 OAuth 型別建立 `0600` 副本，refresh 為空字串；使用儲存到期值與 JWT 到期值的較早者。複製時保留超過 30 分鐘效期，每個模型提示前再確認超過 15 分鐘；未攜帶真實 refresh token。`pi auth check --provider openai-codex --json --no-refresh` 回覆 OAuth `ready`，exit `0`。

每個 Pi 程序都顯式載入測試副本的 guard；關閉 extension／skill／context discovery，只開該案必要工具。啟動 status 讀回全域及五模組 enabled；Git／completion 設定來源為 file：

```json
{
  "version": 1,
  "modules": {
    "git-evidence": { "checkCi": false },
    "completion-diff-recheck": { "followUp": false }
  }
}
```

另在 guard 前載入一次性測試限制器，只接受當案精確、單次的 fixture 操作，越界或重複則停止。限制器的七個匹配案例、重複阻擋及刻意不安全的 mutant 負向控制已驗證；**它不是權限套件或 guard 的替代實作。** 本輪 11 個真實工具呼叫均通過此限制器，三個拒絕結果均來自 `[agents-guard/hard-deny]`，沒有將測試限制器的拒絕算成產品成功。

## 案例與讀回

| 案例 | 結果 | 實際證據 |
| --- | --- | --- |
| B1＋C1：合法寫入／writer | `PASS` | 在兩個不同 session／PID 互見時，唯一寫入者依序 `write allowed.txt = alpha\n`、`read`、`edit alpha → beta`。三個工具成功，讀回為 `beta\n`；writer 有 peer 提示而未阻擋。 |
| B2＋B3：hard-deny | `PASS` | 對假的 `.env.acceptance` 執行 `write` 與 bash 重導向，再執行 `git add .`，三者各一次、皆為真實 guard error。原內容 `fixture-only\n` 與 Git index bytes 未變。 |
| B3＋B4＋B7：Git 證據 | `PASS` | 模型具名 staging `allowed.txt`；控制器先讀回 staged 名單、完整 diff 與 index 內容，再放行模型 commit／本機 push。原工具結果保留並附 guard card，commit tree 只含 `allowed.txt`。 |
| B6：completion | `PASS` | 新 session 成功 `write completion-a.txt`，再由模型單獨執行 `git status --porcelain` 建 baseline；第一次 settled 無卡。閒置後控制器新增 `completion-b.txt`，同 session 第二次只要求回覆、零工具；settled 後保存一張差異卡，無自動 follow-up。 |

writer 關閉後，以 instanceId、sessionId、PID、host、root、branch 核對只留下原 observer；其後關閉 observer，presence 為空。這只證明本次順序啟動、單一寫入者案例，不是強互斥、同時啟動競態或 crash cleanup 保證。

Git fixture 的唯一 origin fetch／push URL 都先核對為 LAB 的 `remote.git`，無 hooks，Git transport 限制為 `file`。獨立讀回 fixture HEAD、bare `refs/heads/main` 與 `git ls-remote origin refs/heads/main`，三者均為：

```text
84ac2ec24b34c3867a3f154f9c7a3e6d4e4673da
```

這不是本專案 commit／push，也沒有 GitHub repo 或 CI 查詢。產品 push card 使用本地 upstream tracking ref 的既有限制仍在；本案另用 `ls-remote` 驗證這個測試 remote，不代表已改善產品證據策略。

### Completion 呈現注意事項

baseline 為 `.env.acceptance` 與 `completion-a.txt` 兩個 untracked 項目；真正的新增差異只有 `completion-b.txt`。目前 card 的「3 個檔案」是列出所有當前 dirty 項目，不是逐檔 baseline 差集（`src/modules/completion-diff-recheck.ts:57–72`）。已保留原始 card，不把它解讀成三個檔案都新增變動；文案精確度可另列改善，這不是本輪引入的變更。

## 回合、成本與持久化

每個功能只跑一個案例，各操作一次，沒有重試。Git 案例為了在 commit 前確認 staged diff，分成 staging、commit/push 兩個提示；completion 亦分 baseline、差異兩個提示。**單一案例不等於單一模型回合**，模型每次工具呼叫後還需取得結果並繼續。

| 階段 | 模型回合 | 工具呼叫 | tokens |
| --- | ---: | ---: | ---: |
| 合法寫入／writer | 4 | 3 | 4,970 |
| hard-deny | 4 | 3 | 4,205 |
| Git staging | 2 | 1 | 1,427 |
| Git commit／push | 3 | 2 | 3,215 |
| Completion baseline | 3 | 2 | 2,569 |
| Completion 差異 | 1 | 0 | 928 |
| **合計** | **17** | **11** | **17,314** |

共六個模型提示，8 個工具成功、3 個預期的 guard 阻擋。input `16,794`、output `520`、cache `0`；SDK 估算 **US$0.0039828**，不是訂閱帳單或實際扣款證明。reasoning 欄位 `172` 不再額外加入 total。

五個 Pi RPC 程序均正常 EOF、exit `0`。四個有模型活動的 session 實際保存 JSONL；已逐一比對 11 個 tool result 的內容／isError、訊息數量、tokens 與成本，與 RPC event stream／session stats 一致。observer 的模型訊息、工具與用量均零，只有分配 session 路徑，沒有實際保存 JSONL。全程未觀察到 auto-retry／auto-compaction 事件，相關設定亦關閉。

## 回歸與清理

在本輪同一份 source 副本、同一套已安裝 lockfile 依賴上：

- `src/index.ts`、`src/extension.ts` 的 primary LSP：兩檔、零診斷。
- `npm run typecheck`：exit `0`。
- `npm run lint`：exit `0`，41 files，未 autofix。
- `npm run test`：exit `0`，18 files／411 tests 全通過，1.71 秒。

核對 38 筆受控程序記錄與五個 Pi 生命週期均結束；刪目錄前 presence 已空，只剩測試 `config.json`，extension state 目錄為 `0700`、檔案為 `0600`。144 個證據／session 檔未見 access token；模型結束後已先刪 OAuth 副本，真實 auth 的 inode／size／mtime 未變。既有三份未提交驗收報告 hash 未變。

**已於 2026-09-11 04:46:01（UTC+08:00）完整刪除 LAB。** 刪除前再次核對 38 筆 process group 不存活、presence 為空，並確認三份既有報告 hash 與 87 個來源檔案未變。刪除後以 `os.path.lexists` 確認 `/tmp` 與 `/private/tmp` 兩個別名均不存在；原始 repo 仍無 node_modules。原始 logs、sessions、控制器與依賴均已移除；只保留上述去敏 JSON 與本報告。

## 尚未涵蓋

- **C2／subagent-policy 真實整合：`NOT_RUN`。** 本機可查到 `pi-subagents 0.67.0` metadata，但未將套件載入本輪隔離 Pi，也尚未設定專用 agent、child guard 載入及 child 模型／費用界線。現有單元測試不替代真實派發；未造同名假工具冒充通過。
- **C3／權限套件順序：`NOT_RUN`。** 尚未指定固定套件、版本與測試規則；測試限制器不構成真實權限 extension 的證據。
- B5 的失敗 commit／字串誤判反例、`followUp:true` 及上限、精確最低 Node、其他 OS、TUI、取消、crash、simultaneous-start 等仍未補實機案例。

本輪沒有產品程式、契約或 OpenSpec 變更，也沒有正式安裝、reload、發布，或本專案的 commit／push。只新增本報告及證據 JSON，留待操作者決定後續驗收與提交。
