## Purpose

在 session 收尾時確認 agent 最後觀察到的 Git 狀態是否與實際工作樹不同，協助修正最終回報。只有符合條件的前景 session 才執行檢查；檢查失敗、停用或取消不應被誤認為乾淨工作樹，也不得造成無關工具阻擋或無限制的自動跟進。

## ADDED Requirements

### Requirement: Eligibility before completion I/O

系統 SHALL 在每次收尾檢查啟動任何 completion Git 查詢之前，確認全域與 completion 模組均啟用、該模組未因重複失敗成為 inert、目前不是 parent-governed background child，且本 session 至少有一次成功的受追蹤寫入工具結果。任一條件不成立時，系統 MUST NOT 啟動本模組查詢、送出 completion card 或觸發 follow-up；其他模組的 I/O 與政策不在此零 I/O 保證內。

#### Scenario: Disabled or inert module

- **WHEN** 全域或 completion 被停用，或 completion 已達本 session 的失敗上限
- **THEN** 收尾事件不執行 completion Git 查詢，也不送出 completion card／follow-up

#### Scenario: Child or no successful writes

- **WHEN** session 是 background child，或只讀取資料、只出現失敗的寫入工具結果
- **THEN** 收尾事件不執行 completion Git 查詢；不同 instance 的寫入紀錄不會使本 session 符合條件

#### Scenario: Re-enabled eligible session

- **WHEN** 尚未 inert 的前景 session 已有成功寫入，completion 從停用重新啟用後收到新的收尾事件
- **THEN** 依目前設定重新判斷 eligibility，不使用初始化時的開關快照，也不遺失本 session 已觀察的狀態

### Requirement: Scoped and trustworthy completion queries

系統 SHALL 使用該次收尾事件的工作目錄與 caller signal 執行 Git 查詢，並僅以成功且未被取消或 killed 的 porcelain 結果作為實際狀態。系統 MUST NOT 把失敗查詢的空輸出當成已確認乾淨，也不得將其他工作目錄的結果當成本次結果。diff-stat SHALL 僅供附加顯示，不參與是否變更的判斷。

#### Scenario: Current event location

- **WHEN** 符合條件的 session 收到收尾事件
- **THEN** completion 查詢使用事件提供的 cwd 及同一個 signal，不修改工作樹或自動建立 commit

#### Scenario: Status query is unsuccessful

- **WHEN** porcelain 查詢非零退出或被標記 killed
- **THEN** 不使用其 stdout、不執行依賴該快照的後續查詢，不送出狀態比較 card 或 follow-up

#### Scenario: Display-only statistics unavailable

- **WHEN** porcelain 已成功，但 diff-stat 查詢以非零狀態正常返回
- **THEN** 仍可依 porcelain 產生比較結果，略去無效附加統計，不以 diff-stat 的失敗改寫狀態比較

### Requirement: Bounded completion failure isolation

系統 SHALL 在 completion 的模組失敗邊界內處理 Git 執行的 unexpected rejection 與比較異常，MUST NOT 讓這些錯誤逸出收尾 hook 或改變其他模組的拒絕判定。每次失敗檢查最多登記一次 completion failure；本 session 累計三次後 SHALL 停止本模組後續自動檢查，並維持可查詢的 inert 狀態。正常非零退出及使用者取消 MUST NOT 被冒充成功，亦不作 unexpected failure 累計。

#### Scenario: Exec throws during collection

- **WHEN** porcelain 或 diff-stat 執行拋出 unexpected exception
- **THEN** 本次收尾回退而不拋出、不觸發 follow-up，只記錄 completion 的失敗，不消耗 follow-up 配額或停用其他模組

#### Scenario: Repeated unexpected failures

- **WHEN** 同一 session 的 completion 已累計三次 unexpected failure
- **THEN** 後續收尾事件不再啟動本模組 Git 查詢，status 可辨識其 auto-disabled／inert 狀態

#### Scenario: Failure reporting is unavailable

- **WHEN** completion 的故障診斷輸出通道也拋出錯誤
- **THEN** 原始檢查失敗仍不得逸出 hook，不建立重試迴圈，不將 raw stderr 或完整工具輸入寫入診斷

### Requirement: Stop after cancellation or lifecycle invalidation

系統 SHALL 在查詢前及非同步查詢返回後重新確認本次檢查仍有效。caller signal 已中止、completion 被停用或 session shutdown 時，系統 MUST NOT 再為該次檢查啟動剩餘查詢、送出 card 或觸發 follow-up。停用後重新啟用 MUST NOT 使先前已失效的查詢恢復有效；此保證不宣稱已啟動的外部程序立即停止。

#### Scenario: Already aborted signal

- **WHEN** 收尾事件的 caller signal 在第一個查詢前已中止
- **THEN** 零 completion Git 查詢、零 card／follow-up，不登記 unexpected failure

#### Scenario: Disabled then re-enabled while awaiting

- **WHEN** 查詢尚未返回時 completion 被停用，再重新啟用
- **THEN** 舊查詢返回後不再繼續查詢或送出結果；新的收尾事件可啟動新的有效檢查

#### Scenario: Shutdown or abort during collection

- **WHEN** 第一個查詢啟動後，session shutdown 或 caller signal 中止
- **THEN** 該查詢即使稍後成功返回，亦不啟動後續查詢、不送 card／follow-up、不消耗跟進配額

### Requirement: Preserve completion observations and follow-up limits

系統 SHALL 保留每個 session 的成功寫入事實、最後有效的 agent porcelain 觀察與 follow-up 計數，並維持既有比較與顯示行為。沒有 baseline 時 SHALL 只在實際有未完成變更時顯示提醒，MUST NOT 觸發 follow-up；有 baseline 且狀態不同時，只有 follow-up 啟用且未達 session 上限才可請求跟進。失敗、略過或失效的收尾檢查 MUST NOT 改寫 baseline 或消耗跟進配額。

#### Scenario: Default and no-baseline behavior

- **WHEN** session 有成功寫入且實際仍有變更，但沒有可比對的 agent porcelain 觀察
- **THEN** 顯示 card，不因 follow-up 已啟用而請求額外回合；follow-up 預設仍關閉

#### Scenario: Dirty-to-clean and unchanged snapshots

- **WHEN** 有效 porcelain 與最後觀察不同，或兩者相同
- **THEN** 不同時保留既有 dirty→clean 等提醒語意；相同時不送 card／follow-up，diff-stat 不改變此判斷

#### Scenario: Independent sessions and bounded follow-ups

- **WHEN** 不同 session instances 或重複收尾事件執行檢查
- **THEN** 觀察與配額不跨 instance 混用，follow-up 不超過該 session 設定上限；重構不新增事件註冊或重複派送
