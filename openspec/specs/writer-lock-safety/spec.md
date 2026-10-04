# writer-lock-safety Specification

## Purpose
協助遵循單一 writer 工作習慣的開發者確認工作位置、保留既有修改，並察覺同一 worktree 可能重複開啟的 session。本能力提供資訊與提醒，不管理排他 ownership、不鎖定寫入，也不保證偵測所有其他 writer 或防止同時修改。

## Requirements

### Requirement: Advisory behavior without write locking

啟用本模組時，系統 SHALL 提供基礎檢查與提醒，MUST NOT 因 session 衝突、髒工作樹或檢查異常而拒絕工具、切成唯讀或要求互動確認才能繼續。其他模組的拒絕判定與失敗策略 SHALL 維持不變。

#### Scenario: Another session is observed

- **WHEN** 本模組觀察到同 worktree 的其他參與 session 記錄
- **THEN** 顯示衝突提醒，但本模組不阻擋寫入；後續仍由其他模組判定

#### Scenario: Another module blocks the call

- **WHEN** 工具命中 hard-deny 或 subagent-policy 的拒絕
- **THEN** 拒絕仍然生效，不能因本模組採提示模式而被放行

### Requirement: Basic worktree awareness

系統 SHALL 在啟用的前景 session 啟動及使用者查詢本模組狀態時，提供目前 canonical worktree、分支或 detached HEAD 狀態，以及是否有未提交變更的檢查結果。既有修改 SHALL 僅提醒保留，MUST NOT 自動還原、stash、commit 或切換分支。

#### Scenario: Existing changes in a worktree

- **WHEN** session 在有未提交變更的 worktree 啟動
- **THEN** 顯示工作位置、分支狀態與既有變更提醒，不要求乾淨工作樹，也不修改既有內容

#### Scenario: Detached HEAD or non-git directory

- **WHEN** 已確認工作目錄為 detached HEAD 或非 git 目錄
- **THEN** 如實顯示 detached HEAD，或將非 git 目錄標示為不適用 worktree 檢查，不將兩者誤報為衝突或拒絕原因

### Requirement: Scoped session presence notices

系統 SHALL 使用同一主機、同一 state 範圍內可辨識的參與 session 記錄，對相同 canonical worktree 提示可能重複開啟的 session，排除本 session 自身。提示 SHALL 建議確認其他視窗或改用不同 worktree，MUST NOT 只憑分支名稱相同判定衝突。

#### Scenario: Aliases of the same worktree

- **WHEN** 另一個參與 session 的記錄指向同 worktree 的不同子目錄或可解析路徑別名
- **THEN** 將其視為相同工作位置的可能衝突，提示而不鎖定

#### Scenario: Different worktrees with the same branch name

- **WHEN** 記錄指向不同 repository 或不同 canonical worktree，即使分支名稱相同
- **THEN** 不因分支同名發出同 worktree 衝突提醒

### Requirement: Truthful and non-disruptive diagnostics

系統 SHALL 對相同 session、工作位置及未變的提醒原因去重，自動檢查不得在每次工具呼叫重複輸出相同提醒；使用者主動查詢仍 SHALL 取得檢查結果。記錄過期、損壞、不可讀或 Git 偵測失敗時，系統 SHALL 說明檢查不完整，不宣稱安全、無其他 writer 或成功取得寫入權。通知本身失敗 MUST NOT 中斷工具執行。

#### Scenario: Repeated observation and explicit status request

- **WHEN** 自動檢查重複觀察相同衝突，之後使用者主動查詢狀態
- **THEN** 相同自動提醒不重複刷出，但主動查詢仍顯示目前結果；不同工作位置或新的提醒原因不被一律壓掉

#### Scenario: Uncertain records or failed checks

- **WHEN** 存在過期或無法解析的記錄，或讀取／Git 檢查失敗
- **THEN** 提示資訊不完整，不將失敗當成「沒有其他 session」，也不因此拒絕寫入

#### Scenario: Notification cannot be delivered

- **WHEN** 顯示提醒的通道拋出錯誤或沒有互動 UI
- **THEN** 不要求使用者回覆才能繼續，不讓通知錯誤改變其他模組的判定或中斷工具

### Requirement: Non-destructive presence lifecycle

系統 MUST 僅建立、更新或清理由本執行個體建立且可辨識為自身的存在記錄；其他 session、無法確認歸屬與既有 v1 鎖記錄 MUST NOT 被自動覆寫、轉換或刪除。系統 MUST NOT 為解除提醒而終止程序或接管 ownership。明確停用時 SHALL 停止本模組的自動檢查與提示；既有 parent-governed background child SHALL 在本模組的 worktree／記錄 I/O 前跳過，不變更其餘模組的政策。

#### Scenario: Shutdown or legacy record encountered

- **WHEN** session 結束或檢查時發現另一 session、未知歸屬或 v1 記錄
- **THEN** 只處理可辨識的自身記錄，保留其他記錄；必要時說明其限制，不宣稱已安全接管或釋放寫入權

#### Scenario: Disabled module or background child

- **WHEN** 本模組被明確停用，或 session 是既有 parent-governed background child
- **THEN** 不進行本模組的自動 worktree／記錄檢查與提示；background child 不產生本模組的 worktree／記錄 I/O，也不被當成獨立 writer 登記

### Requirement: Bounded compatibility and honest guarantees

本能力 SHALL 使用現有 Pi extension API，不要求宿主新增執行許可或完成證據協定，MUST NOT 僅因缺少此類新能力而鎖定寫入。狀態、命令回覆與文件 SHALL 明示這是提示而非互斥鎖，不能把「未觀察到其他 session」等同排他安全。

#### Scenario: Existing host and concurrent starts

- **WHEN** 在現有 Pi 0.85.1 執行，或兩個 session 同時啟動且尚未看到彼此記錄
- **THEN** 不要求新的宿主協定，不因缺少強 ownership 能力而拒絕工具，也不宣稱兩者已被排他協調或不可能同時寫入
