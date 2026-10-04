# 2026-09-11 Subagent／權限套件隔離驗收

## 結論

選用 **`@pi-lab/permissions@1.0.3`**，與 agents-guard 的兩種明確載入順序均完成實機驗收；另完成已核准的 **`pi-subagents@0.67.0` 單一原生 child** 案例。三案皆 `PASS`，未修改產品程式、正式設定，亦未正式安裝、commit 或 push。

本報告接續[四核心功能驗收](2026-09-11-functional-acceptance-results.md)，補齊[隔離驗收手冊](../validation/isolated-acceptance.md)的 C2／C3 選定案例，不代表所有權限、子代理或跨平台情境均已覆蓋。去敏選錄見[機器證據](2026-09-11-integration-acceptance-evidence.json)；它不是完整 transcript。

## 套件選擇與環境

- 權限套件：[npm 固定版本](https://www.npmjs.com/package/@pi-lab/permissions/v/1.0.3)、[來源專案](https://github.com/anthod0/pi-lab/tree/main/packages/permissions)。已檢視實際安裝產物、README 與 manifest；不是只依搜尋摘要判斷。
- 選擇理由：有 `allow`／`deny`／`ask`、可取消的確認框，以及 `permissions:ask`、`permissions:user_select`、`permissions:deny` 事件，適合驗證 hook 先後順序。Pi peer range 為 `>=0.80.3 <1`，包含受測 `0.85.1`；宣告相容與下述實測證據分開看待。
- 固定產品 source：`3df8f9d4287591de85aa8c056ee77a74501f3054`；Pi **0.85.1**、pi-subagents **0.67.0**、權限套件 **1.0.3**。工具套件僅裝於 LAB，使用 `--ignore-scripts`；原始 repo 沒有安裝依賴。
- 模型：全部為 **`openai-codex/gpt-5.6-luna`**，low thinking，沒有換模型或重跑功能案例。
- 模型程序／npm 測試環境：macOS 26.6.2、Darwin 25.6.0、arm64；Node **22.23.2**、npm **10.9.8**。LSP 是宿主診斷服務，另使用 Node 24.19.0，不混算成受測 Pi runtime。
- 唯一 LAB：`<LAB_ALIAS>`，canonical path 為 `<LAB>`。fixture 是 unborn `main`；沒有建立 commit 或執行 push。
- Pi 使用隔離 HOME／agent／session／XDG、環境白名單，以及明確 `-e` 載入；不自動載入正式 extensions、context files 或 skills。`--offline` 不是封網，這也不是容器或 OS 安全沙箱。
- OAuth 僅複製指定 provider 的短期 access，保留正確 `oauth` 型別、空 refresh；原生 `auth check --no-refresh` 通過，每個操作者模型 prompt 前核對有效期大於 15 分鐘。沒有額外 D0 提示。
- 關閉 Pi 自動 retry／compaction、guard CI 查詢及 completion follow-up。測試用 envelope 只限縮 fixture 操作，不冒充受測權限套件；本輪所有實際工具呼叫皆被 envelope 放行。

## C3：權限整合

隔離規則依優先序：`git add .` 要求確認；`git add allowed.txt` 允許；其他 bash 命令拒絕。實際設定保存在證據 JSON。每個載入順序各執行一個案例；所有確認框均取消，沒有按下 Allow／Allow always。

| 案例 | 真實模型工具與觀察 | 結果 |
| --- | --- | --- |
| guard → permissions | `git add .` 得到 `[agents-guard/hard-deny]`；permission events／確認框均為 0。其後 `git add allowed.txt` 成功，staged names 僅有 `allowed.txt`。 | PASS |
| permissions → guard | `git add .` 觸發 1 個真實 RPC `select`。控制器送出 `cancelled:true`；套件記錄 `selection:null`、`decision:"deny"`、denial source `"user"`。index bytes 不變，結果不是 guard hard-deny。 | PASS |

`allowed.txt` 始終為 `permission-fixture\n`，兩程序均以 EOF／exit 0 結束，presence 清空。第一案含合法 staging，因此整案 index 並非不變；不把最終結果誤寫成兩次操作都未改 index。

**順序確實影響 UI：** 若要 hard-deny 命中時不出現權限確認框，guard 必須先收到 hook。本輪證明的是明確 `-e` 順序；尚未驗證正式套件自動發現時的排序。反向案例只驗「取消即拒絕」，沒有驗證按 Allow 後的後續行為。

## C2：真實原生 child

- 隔離 parent 以真實 `subagent` 工具先執行 `list`＋`capabilities:true`，再執行 `models`。唯一候選 `acceptance-child` 為 executable、runner `pi`，宣告工具 `write`、模型 Luna，並明確指定 guard 與測試 observer extension。
- parent 只派發 **1 個 async workflow**；其內只 `await runs.run("write-once", …)` 一次。沒有 external CLI 替代、foreground fallback、status 輪詢、nested delegation 或第二次派發。
- workflow run：`8b79a4dc-9700-4949-88a1-fa082a89f83e`；child run：`de4bf8b5-4abb-4383-87c0-1f18efaf19c4`。原生 receipt 的 child inventory 完整、僅 1 個 child，workflow／child 皆 complete。
- child PID **69251**，`PI_SUBAGENT_CHILD=1`、fresh context；原生狀態與兩則 assistant session 訊息皆確認 Luna，僅 1 次成功 model attempt。
- 不是以 parent 的 `-e` 推定 child 載入：child 自身 `pi.getCommands()` 讀回 `agents-guard` 的 `sourceInfo.path`，並核對 entry bytes hash；原生 launch metadata 亦記錄 explicit extensions，ambient extensions 關閉。
- 實際 child 工具只有 **1 次成功 `write`**，目標為 fixture `child.txt`；控制器讀回 bytes 為 `CHILD_OK\n`，Git index 未變。沒有其他 child 工具呼叫。
- child 的 start／tool call／tool result／settled／shutdown 觀測均只見原 parent 的同一 presence identity；沒有 child presence，也沒有 child completion-diff card。parent 最後關閉後 presence 歸零。
- child 的頂層 `process-terminal.json` 為 **observed／exit 0／signal null**；另以 OS 確認 PID 與 process group 均不存在，不只採信 workflow 的 complete 字樣。
- 額外 acceptance／review 設為 `level:none` 並附理由，避免超出只派一個 child 的範圍；本案由 parent 讀回驗收。原生 tracked-files effect detector 因 unborn HEAD 回報 unavailable，本案**不拿它當寫入證據，也不宣稱 native checked／reviewed gate 通過**。

## 用量與持久化交叉核對

| Session | 模型回合 | 工具呼叫 | Tokens（含 cache） | SDK 估算 USD |
| --- | ---: | ---: | ---: | ---: |
| C3 guard-first | 3 | 2 | 2,404 | 0.00057380 |
| C3 permissions-first | 2 | 1 | 1,391 | 0.00034320 |
| C2 parent | 7 | 3 | 30,368 | 0.00259988 |
| C2 child | 2 | 1 | 913 | 0.00023160 |
| **合計** | **14** | **7** | **35,076** | **0.00374848** |

- 4 個操作者模型 prompts＋1 個原生 child task。C2 parent 另收到 `subagent-incremental-child-notify` 與 `subagent-notify`，增加 **2 個無工具的原生通知後續回合**；已納入總量，不是模型重試或控制器補提示。
- 7 次工具呼叫中，5 次成功、2 次為預期拒絕。每個 parent 的 RPC events、實際 session JSONL 與 `get_session_stats` 的訊息／工具／用量逐項一致；child 的 session、observer 與原生狀態亦交叉核對。
- 總 tokens＝12,968 input＋604 output＋21,504 cache-read；cache-write 為 0。全部 assistant 的 provider／model 一致，沒有 error／aborted、auto-retry 或 auto-compaction 事件。
- 費用是 SDK 估算，**不是帳單或實際扣款**。證據聚合器以故意改錯 tool 總數的負向控制確認會拒絕錯誤資料。

## 回歸檢查與清理

- 在 archive source 新跑 `npm run typecheck`、`npm run lint`、`npm run test`：皆 exit 0；lint 檢查 41 files、未 autofix；**18 test files／411 tests 通過**。這不是兩個第三方套件的完整上游測試。
- `src/index.ts`、`src/extension.ts` primary LSP：2 files、0 diagnostics。
- 22 筆受控 command／driver／Pi 程序記錄皆 exit 0、process group 不存活；3 個 parent Pi 均正常 EOF。原生 child 的終止證據另列，不混入這 22 筆。
- 最後的 LAB 路徑程序檢查額外抓到本輪 LSP 留下的 TypeScript 助手。核對專屬 cwd 與完整 PGID 73850 後，只對該群組 4 個服務送 SIGTERM；kernel exit、PID／group 消失均已確認。第一次清理 helper 因 Python `kqueue` 不支援 context manager，在送信號前失敗；僅修 helper，未重跑模型或改產品。
- LSP 使用宿主 runtime／TypeScript cache 路徑；未清除共用 cache，也不宣稱所有宿主 cache 均無寫入。這不影響上述 Pi 模型程序的隔離範圍與版本證據。
- 2,611 個 evidence／session／暫存 artifact 檔的 access-token 掃描無命中，OAuth 副本已刪除；真實 auth inode／size／mtime 未變。guard state 目錄／檔案符合 `0700`／`0600`，presence 為空。
- 87 個 tracked source files、lockfile 與原有 5 份報告／證據的 bytes hash 均未改變。
- **2026-09-11 05:44:43 +08:00 完成 LAB 定點刪除**（約 602 MiB）。兩個路徑別名皆不存在，未見引用此 LAB 的殘留程序；原始 repo 仍無 `node_modules`。只保留本報告與去敏 JSON，原始 logs／sessions／controllers／套件副本均已移除。
- 文件檢查：Markdown 實際 render 與 AST parser、2 個表格、3 個相對連結、JSON 聚合／取消回覆身分及 whitespace 通過；`lens_diagnostics` 無阻擋錯誤；初次診斷曾有 2 個拼字 hint 命中原始 tool-call ID，保留 ID 而不改寫證據。

## 邊界與後續

本輪沒有產品行為變更，未新增 OpenSpec change；歷史報告與 archived tasks 不覆寫。這次補上的是 C2／C3 的選定實機案例，並非全面安全稽核或正式安裝授權。

仍未測：永久 Allow／Deny 快取、無效權限設定、child 權限提示轉送、正式自動載入順序、TUI、其他 OS、精確 Node 22.19.0、crash／取消／同時啟動，以及 subagent review／弱模型拒絕的實機負向案例。既有 Git-evidence、completion 文案等改善仍應另案處理。
