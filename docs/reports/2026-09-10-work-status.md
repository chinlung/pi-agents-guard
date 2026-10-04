# pi-agents-guard 工作盤點與優先順序

- 盤點日期：2026-09-10（臺灣時間）
- 專案：[pi-agents-guard](https://github.com/chinlung/pi-agents-guard)
- 基準分支／HEAD：`main`／`90e055ebf25f65261f52b9901cf4356be10e6b39`
- 範圍：盤點 Git、OpenSpec、既有計畫／review、相關原始碼及 GitHub CI／待辦；不是新一輪全面 code/security review，也不授權實作、安裝或發布。
- 本檔將同日暫存報告正式保存到 repo。以下狀態與行號以基準 HEAD 為準，不宣稱後續 checkout 永遠乾淨或遠端狀態永遠不變；不回改凍結 tasks、不將歷史未勾選項目直接視為現在未完成。
- 後續操作入口：[隔離實機驗收手冊](../validation/isolated-acceptance.md)。**手冊已建立不等於驗收已執行。**

## 結論

盤點時沒有 active OpenSpec change、未提交程式變更、open PR 或 open issue。五個模組已有實作，writer advisory 與 runtime coordination 兩輪變更均已歸檔並進入主線。本機 HEAD 與即時查詢的遠端 main 相同，該 SHA 的 CI 已成功。

剩餘工作主要是尚未完成的實際宿主／最低版本驗收、已接受的文件及測試債；Git-evidence 的可信度補強是值得優先規劃的新工作，不是已歸檔 change 尚未完成的任務。正式安裝尚缺 repo 內驗收紀錄，需在驗收後另行授權；盤點沒有讀取真實 agent 設定，因此不判定操作者機器是否已載入其他版本。

## 已完成／不應重複列為待辦

| 項目 | 判定與證據 |
| --- | --- |
| 五個模組基本實作 | `README.md:28–38` 列明 hard-deny、subagent-policy、writer-lock advisory、git-evidence、completion-diff-recheck 已實作；對應 source/tests 存在，主線 CI 執行全部 18 suites。 |
| Writer advisory 收尾 | `openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/review-notes.md:77` 明載 tasks 5.3／5.4 已完成；`:102` 說明保留 19/21 是凍結歷史，不代表欠兩個工作。歸檔結果見 `:122–126`。 |
| Runtime coordination | `openspec/changes/archive/2026-09-10-refactor-runtime-coordination/tasks.md` 為 21/21；review gate 見同目錄 `review-notes.md:149`，歸檔／canonical 同步及驗證見 `:254–262`。 |
| Git 整合 | 本機及 `git ls-remote origin refs/heads/main` 均為完整基準 SHA；歷史已有 writer merge `bc11495` 與 runtime merge `90e055e`，不再列 push／merge 待辦。盤點時只有 main 及一個登記中的 worktree。 |
| 本次主線 Linux CI | CI run `34480170276` 對應完整基準 SHA；Ubuntu 24.04.5 x64／Node 22.23.2。Types、Lint and format、Tests 均 success；原始 log 為 411 tests／18 files passed，沒有 skipped cases。這補上歸檔時「本次 CI 未驗收」的時間性缺口，但不等於完整 Pi CLI 驗收。 |
| OpenSpec 現況 | `openspec list --json` 回傳空 changes；`openspec validate --all --strict --no-interactive` 為 2 passed／0 failed。此驗證是 canonical specs，不宣稱所有歷史 archive checkbox 全部完成。 |
| GitHub 待辦 | 盤點時 open PR／open issue 查詢均為空；不代表文件揭露的剩餘工作不存在。 |

CI：[run 34480170276](https://github.com/chinlung/pi-agents-guard/actions/runs/34480170276)

## 尚未完成項目與建議排序

優先序是建議，不是新的需求批准或實作授權。P1＝優先處理的驗收／可信度工作；P2＝相容性與文件收尾；P3＝非阻擋補強。不是宣稱已找到 P1 production 回歸。

| 順序 | 優先級 | 項目／性質 | 下一個可驗收成果 |
| --- | --- | --- | --- |
| 1 | P1 | **完整 Pi／SDK 實機整合驗收**（已揭露未驗收） | 在隔離 agent/state 與暫存 repo 驗證 CLI 載入、命令／開關、具憑證模型回合、寫入型 subagent、不誤擋及權限 extension 載入順序；分別記錄通過、失敗、缺憑證／環境。不能用 hook harness 代替。 |
| 2 | P1 | **Git-evidence 證據可信度補強**（建議另立 OpenSpec change） | 先定義實際目標 repo／remote／ref、失敗／killed 結果與遠端狀態的保證；確保不把本地 tracking ref 或其他 commit 的 CI 說成本次遠端驗證。較小方案先修正證據標示／降級，完整方案再做目標解析及 SHA 綁定。 |
| 3 | P2 | **最低 Node 22.19.0 驗證**（已揭露未驗收） | 在精確 22.19.0 下執行 lockfile 安裝、typecheck、lint、tests，必要時成為 CI matrix 一格；目前浮動 Node 22 實際跑 22.23.2，不能覆蓋最低版本。其他 OS 只在決定支援範圍後增加，不先假定要支援 Windows。 |
| 4 | P2 | **現況文件對齊**（已記錄文件債，可與驗收準備並行） | 修正 docs/design 的 camelCase 模組鍵、模組／來源數量及未實作 notify/widget 敘述；更新 README 的主線 CI 現況，提供不修改歷史 tasks 的狀態入口。設定範例必須經真正 parser／既有測試驗證。 |
| 5 | P3 | **剩餘測試覆蓋補強**（report-only，非歸檔 blocker） | 依價值補 writer detached／not-applicable 的獨立 hook 情境、雙程序 presence 啟動、真實 subprocess cancellation；如需擴大同步送達保證，再評估 finish 後新增 await 的負向控制及 Pi 輸出故障測試。不重新要求互斥鎖。 |

### 1. 實機驗收：為何排第一

- `docs/design.md:558–561` 將 CLI 載入、寫入型 subagent 與權限載入順序列為驗收條件。
- `README.md:230` 明示最新 runtime 版本尚無完整 CLI／具憑證模型／writing-subagent／permission-load-order 驗收；既有 README 的早期 `pi -e` 載入順序實測，不等於目前版本及正式安裝方式已驗。
- 這是正式使用前的整合風險，與單元／注入 executor／真實 Git fixture 是不同證據層。先完成可在隔離環境做的 smoke；實際模型或宿主整合需要的憑證、成本與操作範圍另確認。

### 2. Git-evidence：已證實限制，不冒充新回歸

完整讀取 [協調器](../../src/runtime/git-evidence.ts) 與 [純決策／格式化模組](../../src/modules/git-evidence.ts)，與 `README.md:169`／`docs/design.md:364–370` 的保留限制一致：

- `src/runtime/git-evidence.ts:34` 使用建構時 cwd，不解析後續 `cd`、`git -C` 或多 repo 操作。
- `src/runtime/git-evidence.ts:39–44` 的 commit log 與 `:48–60` 的 HEAD 沿用 stdout，未全面檢查非零／killed。
- `src/runtime/git-evidence.ts:52` 查的是本地 `@{u}`，但 `src/modules/git-evidence.ts:50–56` 使用「本地與遠端 SHA」文案。它不足以證明遠端即時狀態；這是現有能力的誠實性補強方向，不是本輪重構破壞了原語意。
- `src/runtime/git-evidence.ts:67` 的 `gh run list -L 3` 不綁定本次 push SHA，也不追到結論。
- `src/modules/git-evidence.ts:70–72` 的 byte budget 實際是 UTF-16 code-unit 長度；此項可排在目標／結果可信度之後。

此工作會改變可觀察證據與跨模組行為，需要新 change 的需求／設計核准，不重新打開已歸檔 runtime change 或逕行重寫。

### 3. 最低版本：Linux CI 不再是待辦

- `package.json:8–9` 宣告 Node >=22.19.0。
- `.github/workflows/ci.yml:19–31` 僅 ubuntu-latest／Node 22，沒有精確最低版本矩陣。
- 盤點查得 CI 原始 log 的實際版本是 22.23.2；因此 Linux 上目前版本的套件測試已驗，但 22.19.0 仍未驗。

### 4. 文件債的具體影響

- `docs/design.md:165`、`:480–503` 仍用 subagentPolicy／hardDeny／gitEvidence／completionDiffRecheck 等舊鍵。
- `src/types.ts:7–18` 的合法名稱為 kebab-case；`src/config.ts:267–272` 的 validateLayer 會警告並忽略未知模組。複製舊範例可能使設定不生效，不只是排版問題。
- `openspec/changes/archive/2026-09-10-refactor-runtime-coordination/review-notes.md:119` 已明列這些文件債及 notify/widget 與現況不同，不應據文件舊例擴張 alias／UI 功能。
- 保留 archive 的 approval／checkbox 歷史，改現況文件或導覽即可；不要機械勾滿歷史 Stage 1–5 plans。
- **本次正式保存盤點與新增手冊，只提供現況入口；未順手修正 README／design，上述內容對齊仍是待辦。**

### 5. 測試補強的界線

- Writer 端的已接受缺口見 `openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/review-notes.md:20,103`。
- Runtime 端接受的限制見 `openspec/changes/archive/2026-09-10-refactor-runtime-coordination/review-notes.md:178–196`：direct／outer 測試分層、finish 同步窗口、另一個 shallow-copy case、自訂 getter 信任與非交易式 delivery 等，已有明確 disposition。
- 不把所有 report-only note 自動升級成必修 bug，不為測試對稱性新增不必要 seam。

## 正式安裝與未來功能

- **正式安裝：等待驗收及另行授權。** Repo 文件未宣稱安裝完成（`README.md:42`）。安裝前至少完成第一項、修正易誤用的設定文件，確認實際 Node 範圍，並理解 git-evidence 不能取代人工遠端驗證；若產品要宣稱完整自動驗證，第二項亦為前置。本報告不修改 settings、不 reload、不安裝套件。
- **npm 發布不是本次未完成承諾。** `package.json` 為 private，`docs/design.md:626–629` 明列發布、context-snapshot、repeat-failure-guard、agents-lint 與 upstream 回報為未來範圍；沒有自行建立發布工作。
- **不要重啟退役的強鎖需求。** SQLite、ownership fencing、takeover／unlock 強互斥已由 advisory 規格取代。保留人工單一 writer 紀律，不把歷史安全停止點當目前需實作的強鎖計畫。

建議節奏：先做隔離實機驗收；同步整理現況文件及最低版本驗證；依 Git-evidence 實際使用需求另立可信度 change；最後決定正式安裝。P3 在重現缺口或需要擴張保證時再排。

## 盤點驗證與未做事項

盤點已實際執行並讀回：

- `git status --short --branch`／`git diff --stat`／`git diff --check`：盤點時 main 工作樹乾淨；不包含後續新增的兩份文件。
- `git rev-parse HEAD` 與 `git ls-remote origin refs/heads/main`：完整 SHA 一致，未使用舊 tracking ref 冒充即時遠端。
- `git branch -vv`／`git worktree list`：僅 main／目前工作樹。
- `openspec list --json`：零 active change。
- `openspec validate --all --strict --no-interactive`：兩個 canonical specs 通過。
- `gh run list --commit <基準完整 SHA>`、`gh run view 34480170276 --json ...` 及完整 `--log`：確認該 SHA 的所有驗證步驟 success、411／18 tests、實際 OS／Node。
- `gh pr list --state open`／`gh issue list --state open`：皆空。

正式保存前再次唯讀確認本機／遠端 main SHA、該 CI run 的 headSha／success 及 open PR／issue 均與盤點一致；沒有把這次 CI metadata 查詢寫成重新執行 CI。

盤點時 `lens_diagnostics mode=all` 回覆尚無已診斷檔案；此空 cache 不當作專案零錯誤證據。

盤點及本次文件整理沒有執行本機 npm test／typecheck／lint，因 checkout 沒有 node_modules；沒有為文件工作安裝依賴。上述 411 tests 是讀回的主線 CI 證據，不是本 session 重跑的本機結果。沒有 source 修改，未進行新一輪完整安全 review、SDK 模型回合或真實 agent 設定檢查。沒有 commit／push／merge／部署／發布／安裝副作用。

## 相關來源

- [README](../../README.md)、[設計文件](../design.md)、[CI 定義](../../.github/workflows/ci.yml)
- [Writer canonical spec](../../openspec/specs/writer-lock-safety/spec.md)
- [Completion canonical spec](../../openspec/specs/completion-recheck/spec.md)
- [Writer 歸檔 review](../../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/review-notes.md)
- [Runtime 歸檔 review](../../openspec/changes/archive/2026-09-10-refactor-runtime-coordination/review-notes.md)
