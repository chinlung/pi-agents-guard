# 隔離實機驗收結果：第一批（無模型憑證）

## 結論與範圍

**已核准的第一批檢查通過：套件驗證、真實 Pi CLI／RPC 命令、設定保存與重啟、雙程序 presence 及正常關閉清理。** 最終驗收器退出碼為 `0`，10 項檢核通過；先前三次驗收器的錯誤假設與修正依據見下文，不將失敗嘗試隱藏成一次成功。

本批沒有發現需要修改 agents-guard 的產品回歸。這不是完整模型／工具整合驗收：hard-deny 的真實模型工具呼叫、completion 收尾、寫入型 subagent、權限套件順序、互動 TUI 畫面、最低 Node 等仍未驗。沒有因此正式安裝或修改真實 Pi 設定。

- 日期／時區：2026-09-11，臺灣時間（UTC+08:00）。
- 實際受測 commit：`3df8f9d4287591de85aa8c056ee77a74501f3054`。
- [手冊](../validation/isolated-acceptance.md) 的程式基準為 `90e055e…`；兩者差異經 Git 核對只有兩份新增文件，無程式／依賴變更。本次採已提交的 main 副本，不測未提交內容。
- 平臺：原生 Darwin `25.6.0`／arm64；Node `22.23.2`、npm `10.9.8`、Git `2.55.0`、Pi `0.85.1`。
- Lockfile SHA-256：`01812e132fee06c41757bfe863511cc03e37a84f4bb6389a1144e6028c61918c`；安裝後未變。
- 授權：暫存安裝與套件測試、無模型憑證的 Pi 命令／presence 驗收、去敏報告與清理。不包含模型費用、額外 subagent／權限套件、正式安裝或本專案 commit／push。

## 隔離方式與證據層級

- 以 `git archive` 建立獨立 source 副本；沒有共享原始 repo 的 `.git`、worktree 或 node_modules。
- 唯一測試根目錄：`<LAB_ALIAS>`（Darwin canonical path 為 `<LAB>`）。下文以 `<LAB>` 簡寫。
- Pi 的 `HOME=<LAB>/home`、`PI_CODING_AGENT_DIR=<LAB>/home/.pi/agent`、session 路徑、npm／XDG／GitHub／文件查詢快取均在 LAB；使用白名單環境，未繼承模型 key、SSH agent、child 標記或真實 Pi 設定。
- Git 使用空白 global config／template；測試 repo 僅有假的 `.env.acceptance`。本批沒有額外執行模型 commit／push 案例；既有套件測試中的自建 Git fixture 仍依既有測試邏輯執行。
- Pi 以 `--offline --no-approve --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files` 啟動，明確 `-e <LAB>/source/src/index.ts`。RPC 另加 `--no-tools`，避免把此批誤當工具阻擋測試。
- RPC 使用真實 `pi --mode rpc` 程序、LF JSONL framing 與官方 `extension_ui_request` 通知；不是 fake ExtensionAPI 或直接呼叫 Runtime。
- 只使用 `get_commands`、`get_state`、`get_session_stats` 及已確認註冊的 `/agents-guard` 命令。RPC 的 `prompt` 僅承載 slash command，沒有自然語言模型提示、RPC bash 或 `!command`。
- `--offline` 不是網路沙箱；本次 npm／文件查詢有網路操作。這是設定與資料隔離，不宣稱 OS 層阻止任意主機檔案存取。

## 套件與載入驗證

命令均在暫存副本及隔離環境執行，保留原命令退出碼，不靠輸出管線判定。

| 檢查 | 結果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | exit `0`；安裝 179 packages；未變更 lockfile |
| `pi --version`／完整 `pi --help` | 各 exit `0`；版本 `0.85.1`、必要旗標存在 |
| LSP：`src/index.ts`、`src/extension.ts` | primary 診斷 2 files clean，0 diagnostics |
| `npm run typecheck` | exit `0`；`tsc --noEmit` 通過 |
| `npm run lint` | exit `0`；Biome checked 41 files，沒有 autofix |
| `npm run test` | exit `0`；Vitest `5.0.0`，411 tests／18 files passed，無 skipped |
| 副本一致性 | 87 個已追蹤檔案逐項 byte 比對原始 repo 相同；寫本報告前工作樹乾淨 |

Vitest 原始輸出節錄：

```text
Test Files  18 passed (18)
     Tests  411 passed (411)
  Duration  1.26s
```

安裝時只有 `node-domexception@1.0.0` 的 deprecated 警告及 npm 更新通知；未升級 npm、未為測試順手更新依賴。此批沒有執行依賴漏洞稽核，也不把安裝成功視為無漏洞證明。

## 真實宿主驗收結果

| 檢核 | 實際結果／判準 |
| --- | --- |
| A1-print | `pi … -p '/agents-guard status'` exit `0`；五個模組及來源可見。本版本 stdout 為空，狀態在 stderr；退出後自身 presence 已移除 |
| A1-RPC | 成功取得註冊命令與來源，guard 確實來自指定副本；接收真實 notify 事件。另有宿主內建 `llama`，不是繼承個人 extension |
| A2 | 同 session 的 `off writer-lock`／`on writer-lock` 立即生效；off 移除自身 presence、on 重新登記，不需 reload；未執行 save 前沒有 config.json |
| A3 | `off writer-lock`＋`save` 只保存明確值；重啟後來源為 file 且停用。再 on＋save 恢復；重啟與結束都沒有遺留自身 presence |
| A4 | 新程序以 `--agents-guard=off` 啟動，顯示 flag 來源；同 session 的 `/agents-guard on` 以 command 層覆寫並恢復登記 |
| A5 | 全域 off／on 的 presence 生命週期正確；takeover／unlock 顯示「已改為提示，不需接管或解鎖」，前後 state 檔案 bytes 相同 |
| C1-presence | 兩個真實程序共享 agent namespace／fixture cwd，使用不同 session／instance。兩邊 status 互見；關閉其一只清自身記錄，另一筆身分屬性保留。全部關閉後 presence 為空 |
| C1-non-git | 普通非 Git 目錄的真實 Git 查詢 exit `128`；guard 如實顯示「無法確認是否為 worktree，資訊不完整／Git 檢查失敗」，不冒稱衝突或已確認不適用，不建立 presence |
| C1-confirmed-non-worktree | fixture 的 `.git` metadata cwd 查詢 exit `0`、stdout `false`；guard 顯示「不適用 worktree 檢查」，不建立 presence |
| no-model | 全部 RPC session 的 user／assistant messages、tool calls／results、tokens、cost 均為 `0`；沒有 `agent_start`／模型工具事件 |

A3 實際保存的 JSON：

```json
{
  "version": 1,
  "modules": {
    "writer-lock": { "enabled": false }
  }
}
```

C1 最終一輪的程序一／二 PID 為 `1622`／`1632`。程序一主動查詢時的通知節錄：

```text
可能重複開啟 session；請確認其他視窗或改用不同 worktree。
  session=01a08cb8-6349-745c-888e-b044c18fff2c pid=1632（近期登記，非存活保證）
僅供提醒，不是互斥鎖。
```

關閉程序二後，程序一 status 回覆「本次未觀察到其他參與記錄」。核對包含 instanceId、sessionId、host、pid、canonical root、startedAt，不只比較記錄數量。這是**順序啟動後的互見與正常關閉**，不是 simultaneous-start 排他性、crash cleanup 或實際寫入工具放行保證。

## 驗收器三次失敗與處置

本次使用暫存的一次性 Python RPC driver，不改產品程式。前三次 driver 退出碼均為 `1`；其 Pi 子程序仍正常 EOF shutdown、exit `0`，每次重跑前都先確認無存活程序與 presence，保存舊證據並重設自己建立的測試 config。沒有改用其他宿主／runner 繞過問題。

| 嘗試 | 原因與查證 | 處置 |
| --- | --- | --- |
| 1 | 驗收器依文件範例假設只有 guard command、來源為頂層 `path`。實際 Pi `get_commands` 使用 `sourceInfo.path`，並註冊內建 `llama` | 讀回 Pi `dist/modes/rpc/rpc-mode.js:542–568`、`dist/extensions/index.js:2`、`dist/main.js:439`，限定接受指定 CLI guard 與已確認的 inline llama；不廣泛忽略其他 extension |
| 2 | 驗收器要求 takeover 回覆必含英文 `deprecated`，但現行相容回覆是中文 | 依 `src/runtime/writer-lock.ts:246–250` 與既有歸檔設計核對實際文字，仍驗前後 state bytes 不變 |
| 3 | 驗收器誤把普通非 Git 目錄一律視為「已確認不在 worktree」 | 真實 Git 正向對照 exit `0`／`true`，普通目錄 exit `128`，metadata cwd exit `0`／`false`。依既有設計分成 unknown 與 confirmed-not-applicable 兩案，不把錯誤空輸出視為成功 |
| 4（最終） | 完整重跑修正後的 driver | exit `0`，上述 10 項檢核全部通過，無 cleanup error |

非 Git 降級不是本次新增的產品 bug：[歸檔設計](../../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/design.md):37 已明定普通非 Git 若只有錯誤退出，保守顯示 unknown；[實作](../../src/lib/git.ts):57、70 與 [既有測試](../../test/git.test.ts):131–133 一致。本次未改規格、手冊或程式來迎合實測。

Pi 的 RPC 文件範例與實際 metadata 欄位存在落差；後續自動化應核對實際版本的註冊回應。API 參考使用已完整讀取且與安裝副本內容一致的 Pi `0.85.1` README／RPC 文件及官方 example；文件查詢工具未找到本套件項目，未引用不相關結果。

## 程序、state 與清理

- 含失敗重跑，共檢查 17 個 RPC session；全部透過關閉 stdin 觸發正常宿主 shutdown、exit `0`，沒有強制 kill。全部 session usage 為 `0`。
- RPC 配置有獨立 session 路徑／ID，但零模型訊息的本批沒有實際持久化 session JSONL 檔；驗收器直接保存 RPC request／response／notify 串流作核對，不把分配的檔名冒充已落盤檔案。
- 完成驗收時核對 37 筆受控程序／process group 記錄，均已退出、無存活 group；這不是以單一主程序 exit 猜測其他程序已停止。
- 刪目錄前先核對 presence 為空；extension state 只剩本次 save 的 `config.json`，state 目錄 `0700`、檔案 `0600`。沒有把整個 LAB 刪除當成 presence cleanup 通過。
- 清理狀態：**已於 2026-09-11 03:15:33（UTC+08:00）完成**。刪除前再次核對 37 筆受控 process group 均不存活、presence 為空；刪除後以 `os.path.lexists` 確認 `/tmp` 與 `/private/tmp` 兩個 LAB 路徑均不存在。原始 repo 仍無 node_modules，Git 僅新增本報告。
- 原始日誌、一次性 driver、安裝內容、node_modules、npm／文件查詢快取、測試 HOME／state／session 路徑與 fixture 都只在該 LAB；清理後僅保留本去敏報告，不保留 auth、token、完整 agent 目錄或全域安裝。

## 尚未驗收／不可推論的項目

| 範圍 | 狀態／原因 |
| --- | --- |
| B／D：真實模型與模型工具事件 | `NOT_RUN`；未核准憑證、provider／model 與費用。不能用這批命令測試或 411 個套件測試替代 |
| completion 真實收尾／follow-up | `NOT_RUN`；本批沒有成功模型寫入工具或 agent 回合，不宣稱實機觸發 |
| 寫入型 subagent／child 跳過 I/O | `NOT_RUN`；沒有安裝／派發真實 subagent 套件 |
| 權限 extension 載入順序 | `NOT_RUN`；未加入真實權限套件 |
| 互動 TUI 畫面／確認框 | `NOT_RUN`；本批覆蓋 print 與 RPC 的真實命令／通知，不是終端畫面操作 |
| Git-evidence commit／push／CI | `NOT_RUN`；本批不做該模型工具整合，沒有推送遠端驗收 |
| 最低 Node 22.19.0、其他 OS | `NOT_RUN`；只驗上述精確原生環境 |
| detached、同時啟動競態、實際雙 writer 寫入、crash／取消 | `NOT_RUN`；未擴張本次正常生命週期與順序啟動的保證 |
| 正式安裝、release、本專案 commit／push | 未執行；這次測試授權不涵蓋 |

下一步可另行核准 B／D 的模型及費用，再做真實工具整合；若要保留可重複執行的正式驗收 runner，再另行規劃，不把本次一次性控制腳本當成已交付的 CI 框架。
