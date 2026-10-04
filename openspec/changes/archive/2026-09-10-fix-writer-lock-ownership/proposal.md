## Why

操作者不刻意在同一 worktree 同時開啟兩個 session 修改，需要的是避免進錯工作位置、忽略既有變更或誤開重複 session。強 ownership、工具停止證明與 Pi 宿主改造的成本超出此需求，本能力採輕量的工作環境確認與衝突提醒。

## What Changes

- **BREAKING：** `writer-lock` 改為提示型功能，不再因其他 session、記錄異常或缺少宿主能力而鎖定寫入；不要求確認對話框才能繼續。
- 確認 canonical worktree、分支／detached HEAD 與未提交變更；既有變更只提醒保留，不要求工作樹乾淨。
- 依同一主機與 state 範圍內的參與 session 記錄，提示同 worktree 可能已有另一個 session；不同 worktree 不因分支同名而誤報。
- 相同提示去重；資料過期、不可讀或檢查失敗時，說明資訊不完整，不把它當成「已確認沒有其他 writer」。
- 存在記錄不是鎖，只維護自身記錄，不自動接管、終止程序或修改別人的記錄。
- 其他模組的拒絕政策、開關及工作流程維持不變；不能只改文案而留下舊 writer-lock 的強制阻擋。

### Non-goals

- 不提供排他鎖、雙 writer 防護、在途工具撤銷或安全交接保證；同時啟動、忽略提示與未參與程式可能不被偵測。
- 不新增 SQLite、native dependency、持久工具預留、全程序追蹤或 Pi 宿主協定；沿用現有 extension API，不要求 Pi 為本功能改版。
- 不追求通用 shell 寫入偵測，不重構 completion、git-evidence 或 subagent-policy。
- 本功能不自動 push、安裝、發布、修改工作樹、切換分支或清理其他 session 的狀態。

## Capabilities

### New Capabilities

- `writer-lock-safety`：工作環境確認、session 存在提示及不誤導的保障邊界。保留原 capability 路徑便於追蹤，名稱不代表提供互斥鎖。

### Modified Capabilities

無；本 change 新增 `writer-lock-safety` 能力，不修改其他能力的規格。

## Impact

- 實作範圍限於 `src/modules/writer-lock.ts`、`src/runtime/writer-lock.ts`、`src/index.ts` 的相關接線，以及必要的 types／config／git／state helper 調整。
- 保留 package entry 與模組識別；既有設定可 round-trip，`takeover`／`unlock` 僅回覆相容提示，v1 記錄唯讀探測。這些介面不取得或交接寫入權。
- 測試涵蓋提示、去重、錯誤不中斷、只維護自身記錄，以及其他模組仍會拒絕；不驗收強 ownership 協定。
- README 與現行設計明示從強制鎖定改為提示的行為差異；實測層級及未驗證項目由 review-notes 記錄，不以本機 harness 冒充正式 CLI 驗收。
