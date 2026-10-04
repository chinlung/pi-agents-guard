# 正式組合 child 權限補測結果

日期：2026-09-11（臺北時間）。操作者核准改用預先檢查的 `workflowScriptPath`，只補單一 child 的 allow／ask／deny，不重跑已通過的父程序功能案例。

## 結論

**本輪 PASS。** Pi 0.85.1＋pi-guard 1.4.0＋agents-guard＋pi-subagents 0.67.0 的單一 native Pi child，合法 allow 寫入成功、無 UI 的 ask 與 deny 各拒絕一次；沒有父程序確認框、轉送、重試或繞過。

結合[前輪父程序通過的案例](2026-09-11-final-stack-results.md)，目前 macOS／Node 22.23.2 固定組合的計畫內驗收缺口已補齊，**可進入正式安裝收尾，但本輪沒有正式安裝／改設定／reload，也沒有 commit／push**。這不是所有平台、第三方套件、其他 extension 組合或競態情境的完整相容性／安全保證。

前輪的 `PARTIAL_PASS_CHILD_NOT_EXERCISED`、原 driver exit 1 與模型腳本跳脫失敗均保留，不改寫為成功。本輪是另行核准的新 LAB、新 parent session 與一次新派發；詳細資料見[去敏證據 JSON](2026-09-11-child-permission-retry-evidence.json)。

## 固定來源與隔離

- agents-guard source：`3df8f9d4287591de85aa8c056ee77a74501f3054` 的 Git archive，package 0.1.0；87 個 tracked files 逐檔 SHA256 與原 repo 一致，lockfile 未改。
- 宿主：Darwin arm64、Node 22.23.2、npm 10.9.8、Pi 0.85.1；父／子模型皆為 `openai-codex/gpt-5.6-luna`，low thinking。父程序 PID／PGID `89624`，13:46:01 啟動，34.672 秒後 exit 0。
- 唯一 LAB：`<LAB>`。source、unborn `main` fixture、HOME、agent directory、sessions、XDG、npm／Git／GH 設定及 TMPDIR 分離；沒有原 repo node_modules。
- source 依 lockfile 執行 `npm ci --no-audit --no-fund --ignore-scripts`；真實 `pi install` 僅在 LAB 登錄 local source／observer、`npm:pi-guard@1.4.0`、`npm:pi-subagents@0.67.0`。package metadata、選定來源／文件 SHA256、npm integrity 與前輪相同，沒有升降版或額外 force。
- Pi managed installer 內建 `--legacy-peer-deps`。**宣告的 peer 落差仍存在：** pi-guard 宣告 Pi 0.79.1／typebox 1.1.39，本輪是 Pi 0.85.1、LAB npm root typebox 1.1.38。實測通過不會改變 manifest 的宣告，也不代表未測 API 全部相容。
- OAuth snapshot 正確使用 `type: oauth`、空 refresh、0600；複製前有效期超過 30 分鐘，每個操作者模型 prompt 前超過 15 分鐘；`pi auth check --provider openai-codex --json --no-refresh` 回 ready／oauth／exit 0。未補 D0、改真實登入或帶入真實 refresh。
- HOME／環境白名單不是 OS sandbox，offline 不封網；自建 envelope 只是 fixture single-use 範圍限制，不能冒充 pi-guard 判斷。

## 派發與防止重現前輪錯誤

1. 從前輪保存的合法預期 script 建立新 LAB 的 `workflow.js`，只替換 LAB 路徑；檔案 mode 0400。SHA256 為 `45e0f4cce0d2f45cf51b664d07b9f8384903cc7baa99f88335b8071af131f7ac`。
2. 未執行 script 的 `node --check` function-body 包裝檢查通過；父程序再以真實 subagent tool 依序做 `list capabilities:true`、`models final-child`、`validate workflowScriptPath`，native validator 回 `{"ok":true,"errors":[]}`。
3. 父程序只傳 script 路徑，不請模型重寫或複製巢狀字串。唯一 async workflow 內只 `await runs.run("fixture-permissions", ...)` 並回傳其結果；one fresh child、spawn／concurrency／depth 上限 1，無 nested delegation、外部 CLI、foreground fallback、polling、resume 或第二派發。
4. Envelope 僅容許三次管理查詢、一次指定檔案派發及 child 三個精確寫入請求。每次真實 tool call 均通過 envelope，且 workflow digest 不變；unit 自測確認重複、錯誤路徑、變更 digest、越界 cwd 會被拒，刻意放寬 matcher 的 mutant 被抓到。

父程序以 package 自動發現載入 observer → agents-guard → pi-guard → pi-subagents；command provenance 與五模組 enabled 狀態重新核對，但沒有重跑父程序 hard-deny／write／ask 功能案例。Child 自己明確載入 observer、agents-guard、pi-guard；`launchResolvedExtensions.disableAmbientExtensions:true`，自身 command sourceInfo、cwd、HOME、agent directory、Node、model 與 activeTools 均有實際 snapshot，不以 parent 載入狀態推論 child。

## Child 實際結果

| 指定請求（各一次） | 結果 | 獨立核對 |
| --- | --- | --- |
| write `child.txt`＝`CHILD_OK\n` | PASS：allow | core toolResult `isError:false`；檔案實際讀回 9 bytes，完全一致 |
| write `ask-child.txt`＝`ASK_CHILD\n` | PASS：預期拒絕 | `[Blocked by pi-guard: No interactive session available]`、`isError:true`；檔案不存在 |
| write `deny-child.txt`＝`DENY_CHILD\n` | PASS：預期拒絕 | `[Blocked by pi-guard: Security policy]`、`isError:true`；檔案不存在 |

- Child PID `90042`；session `01a08f00-abc4-71f7-ae2b-93568de44ab1`。各 snapshot 都是 `hasUI:false`、activeTools 僅 `write`，cwd／HOME／agent directory 均位於本 LAB。
- LAB pi-guard rules 僅 allow `child.txt`（相對／精確絕對路徑）與父程序需要的 subagent 工具，`ask-child.txt` 為 ask，其餘 write deny；沒有全域 allow 或永久批准 cache。這不是正式設定的預先批准，不假設 parent 的互動授權會傳給 child。
- 三個持久化 toolResults 與 child observer 的 toolCallId／順序一一對應；兩個 refusal 是 pi-guard 的真實 core error results，不依賴會被 before-hook block 略過的 extension tool_result hook。Child 最後如實報告一個成功、兩個拒絕，沒有重試。
- Parent select／confirm／input／editor dialogs 為 0；child 的 pi-guard nudge／herdr approval events 為 0。無 UI ask 的拒絕是[已接受的預期限制](2026-09-11-permission-forwarding-impact.md)，不把「無轉送」當本輪失敗，也不把 workflow complete 當寫入成功。
- Child 從 start、tool callbacks、settled 到 shutdown 的 presence 都只包含原 parent 的相同 instanceId／sessionId／PID／startedAt／worktree identity；容許 heartbeat 的 lastSeenAt 更新。Parent 關閉後 presence 空。這只驗證選定的 child suppression／生命週期，不是 writer 互斥或 race 保證。
- Fixture 最終 `git status --porcelain` 僅 `?? child.txt`，仍是 unborn `main`；Git index 不存在，沒有 commit／push。

## Native 生命週期與用量

Workflow `ec7f471a-275f-4672-a87c-30f93a90b405`，child run `d37a375e-a297-43fc-ba81-ca8b1aa346f5`。Receipt 為 complete、inventoryComplete、恰一 child；requested／resolved context 皆 fresh，fanout `{used:1,limit:1,remaining:0}`。Child 只有一次 Luna model attempt，成功且 exit 0；native process-terminal 為 **observed／exit 0／signal null**，OS PID／PGID 也不存在。

本 disposable probe 使用明確 `acceptance.level:none`，由控制器獨立核對 session、檔案與程序，避免多派 reviewer；native acceptance 實際為 not-required，**沒有宣稱 checked／reviewed gates 通過**。這不是一般正式實作應停用驗收的建議。

| Session | 回合 | Tools | 拒絕 | Tokens | SDK USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Parent | 8 | 4 | 0 | 30,646 | 0.00330376 |
| Child | 4 | 3 | 2 | 2,035 | 0.00054000 |
| 合計 | 12 | 7 | 2 | 32,681 | 0.00384376 |

共 2 個操作者模型 prompts＋1 個 child task；五個成功工具是三次管理查詢、一次派發與一次 write。Parent 兩個原生通知 `subagent-incremental-child-notify`／`subagent-notify` 所引起的後續回合已全數計入，不漏算為零成本。總 input 14,832、output 441、cacheRead 17,408、cacheWrite 0；費用是 SDK 估算而非帳單。

Parent RPC／完整 session／最終 session stats 逐項一致；child session 的用量、回合與工具數也與 native status／model attempt 一致。十二個 assistant messages 都使用指定 provider／model，stopReason 僅 stop／toolUse；沒有自動 retry／compaction 事件。聚合負控制會拒絕少算一個 tool 或把 ask refusal 改成成功。

## 完整性與清理

- 19 份受控 process records 全 exit 0、PID／PGID 已停止；native child 的 observed exit 0 另列，不重複計入 19。Workflow controller PID 與 parent 相同，沒有以 complete 取代程序停止證據。
- OAuth snapshot 已先刪；掃描 2,663 個 LAB 檔案無該 access token（排除 source、npm 依賴／cache、auth snapshot 與 symlink）。真實 auth／正式 settings 的 inode、size、mtime、mode 未變；不冒稱全磁碟掃描或 auth content hash。
- Guard state 目錄 0700、檔案 0600、presence 空；source 87 檔／lockfile／HEAD 及原十二份報告 SHA256 均未變。前輪失敗 status／driver exit 1 再次核對保留。
- 本輪只有隔離驗收與新增報告；public API、data contract、schema、migration、backward compatibility、security／permissions、concurrency／consistency、cross-module behavior 八面均不改，無新 OpenSpec change。沒有新 unit／typecheck／lint／source LSP 回歸；歷史 411 tests 不當作本輪重跑。
- **14:00:36 +08:00 已定點刪除完整 LAB，485,154,231 bytes（約 462.68 MiB）**。刪除前再確認受控 PID／PGID 與 native child 已停止，同使用者程序 command／cwd 無 LAB references；canonical 與 `/tmp` 別名皆不存在，未清共用 cache。Raw logs、sessions、helpers、fixtures、依賴均已刪，只保留本報告與去敏選錄 JSON，不宣稱保留完整 transcripts。
- Markdown 已實際 render，AST 兩個表格／三條相對連結、JSON、用量聚合、whitespace、`git diff --check` 通過；renderer 程序／暫存目錄已清理。`lens_diagnostics mode=all` 無 error／warning；11 個拼字 hints 都命中真實 toolCallId 的十六進位片段，已逐項查證並保留原 ID。這些是文件／證據檢查，不是 source 回歸。
