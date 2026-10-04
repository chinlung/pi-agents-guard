# Advisory 審查紀錄

## Round 1 — 完整 diff 自審與雙重唯讀審查（2026-09-10）

**已完成本機驗證與雙重唯讀審查，採納 findings 均已修正並複審；不表示已安裝或完成 CLI／跨平台驗收。**

- 範圍：`<REPO>/.worktrees/progressive-b`，branch `refactor/progressive-b`，base／審查開始時 HEAD `da38ac6866ab8fb0deb90f83818aed2808dbdbc3`；審查未提交實作及新增 `test/writer-presence.test.ts`。
- 主 agent 已完整重讀 tracked patch 與新測試 patch；tracked snapshot SHA-256 `a6bae761f509bc9b651e26f141f90038701d46ed6841cdb426228a9b526a1d14`，並與當時工作樹即時 diff 比對相同。
- 雙重唯讀 workflow：`db049620-0717-4012-9b6b-f1bf122385a2`；mission `b2914dab-0eb6-496c-917e-50aa09681aa4`。`reviewer` 採 fresh context，審 lifecycle／非破壞性 fs／診斷；`codex-exec` 審 adapter／ordering／相容及測試缺口。兩者不得修改 repo、index、HEAD 或派發子代理。native reviewer 與同協定重試的 external reviewer 均已回收；external 的 heartbeat recurrence finding 與後續 status-only 邊界均已修正，Round 3 的最後 scoped 雙重複審通過。
- [CODE] N — Phase 4 自審曾重現「新 root 登記成功掩蓋舊 root 清理失敗」：已以獨立 `cleanupIssues` 保留診斷，回歸案例位於 `test/writer-lock-runtime.test.ts`。
- [CODE] N — Phase 4 自審曾重現「完整 refresh 後又重播舊 root pending notice」：fresh report 吸收診斷並清空舊 pending；RED／GREEN 證據已記於 tasks。

### Native reviewer feedback 與主 agent 裁決

原報告：`<USER_HOME>/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/db049620-0717-4012-9b6b-f1bf122385a2/review/lifecycle-safety.md`，child `1f962173-9dba-483f-afaf-8a334548fad7` completed；提出三項 P2、無 P0／P1。其「OK with notes」不是主 agent 的最終通過判定。

- [CODE] N — P2-1：重複 `on writer-lock` 若 ctx sessionId 已改卻未收到 session_start，`src/index.ts:656` 的 `setSessionId` 會清理自身，而 `:248` 的 enabled 早退不重登。**不採為正式宿主缺陷，reviewer 在 Round 2 明確撤回**：主 agent 已完整讀 command handler、Runtime refresh/setSessionId、controller；條件成立時程式路徑確實如此，但 Pi 0.85.1 的 `agent-session-runtime.js:102-250` 對正常 switch/new/fork 都 teardown 舊 session 並 create 新 runtime、指定 session_start；`interactive-mode.js:316-319` 的 rebind callback → `rebindCurrentSession:1505-1524` → `bindCurrentSessionExtensions:1400` → `agent-session.js:1906-1927` emit session_start。這些正式轉換不保留 reviewer 假設的未重新啟動 Runtime。任意修改 harness ctx 並省略宿主事件，不等於正常 CLI 可達回歸；沒有因此修改 code 或擴大新 API。
- [CODE] N — P2-2：`src/modules/writer-lock.ts:70-85` 對自身 stale/clock 異常仍加診斷，但不將自身列為 peer。**不採移除診斷建議**：主 agent 已完整讀 assessPresence 與 controller publish/refresh/heartbeat；自身記錄確實可能因持續 EIO 保留舊時間，或遇時鐘倒退。固定文案只稱「存在過期記錄」，並未宣稱是另一 session；peer 排除與全體記錄品質診斷是兩回事。移除自身診斷反而隱藏真實資訊缺口，保留現有保守語意。
- [CODE] N — P2-3：`src/state.ts:291-301` 的 statMtimeMs/removeFile 目前只有測試呼叫。**記錄、維持原狀**：主 agent 已完整讀定義並核對 src/test 呼叫；無本次執行期影響，依已核准 bounded scope 不順手移除通用 legacy helpers 或其測試。
- [CODE] N — 覆蓋補充：detached/not-applicable 有 Git／純 formatter 測試，但目前沒有各自的 default-export 端到端案例；並行啟動尚未看到彼此的情境未做雙程序測試。明示測試層級，不以單元測試或互斥聲明冒充 CLI／雙程序驗收。其餘已聲明的 crash residue、非對抗性 TOCTOU、同步 I/O 無硬期限與既有其他模組邊界均非本次擴充範圍。

### External lane 基礎設施阻擋與同協定恢復

- 失敗 child：`48ae8d10-39a3-49a8-85da-343ca1786977`，status `failed`，原始錯誤 **`External CLI parser line exceeded its byte limit.`**；沒有 final report。external process exit 0 不代表 lane 成功，adapter step exit 1 才是本次結果。
- `external-0.stdout.log` 共 690,691 bytes；最後記錄的 command 為尋找 runtime 而列出 `/nix/store` 等路徑，造成超量事件。只抽查 command／事件 metadata 定位，不把未完成輸出當 review 結論。
- 已停止原 lane 路徑、不轉 foreground／其他 CLI、不改 runner 或 parser 上限。repo/cwd 仍為本 worktree、branch `refactor/progressive-b`、HEAD `da38ac6`，全部實作仍 unstaged；除主 agent 的 review-notes 外，tracked diff SHA 與原審查相同，新測試 patch 也 byte-for-byte 相同。
- 失敗時完整 partial diff：`<LAB_ALIAS>/post-review-blocker.patch` 及 `post-review-blocker-new-test.patch`。
- 明確同協定重試：workflow `16246fd6-3b55-4d71-99db-a4a87d12e644`，同 mission、同 `codex-exec` read-only adapter；再次 capability discovery 通過。限定 static review、每次輸出 <12 KiB、已知 repo 檔案，不搜尋 runtime、不列系統目錄、不執行測試或修改任何檔案。**已完成**：child `df0928f0-76f7-4317-8717-3c28f9be6ec6` completed，主 agent 亦實際讀回報告 `.../subagent-artifacts/outputs/16246fd6-3b55-4d71-99db-a4a87d12e644/review/adapter-compatibility-retry.md`（前綴同上述 native 報告的 sessions 目錄）；本次 parser 阻擋解除，但報告有一項應修的 code finding，不把程序成功當 review 通過。

### Round 2 — heartbeat 恢復／復發修正（2026-09-10）

- [CODE] N — 接受 external P2：`src/runtime/writer-lock.ts:220-240` 的 heartbeat 成功後沒有更新失敗時留下的自動 signature；因此 failed→done→failed 的第三次更新不提醒。主 agent 已完整讀 controller、實際 turn_end／drain 呼叫與 state 的 I/O 錯誤轉換，並實際 RED 重現。
- 修正：只在先前有 operation issues、此次 done 且沒有新 operation issue 時，用 currentReport 更新自動去重基準；不發恢復通知、不清除持續的 cleanup 診斷。普通成功 heartbeat 不動去重記憶，避免把 status 才看到的 peer 當成已自動通知。
- 新增測試：`test/writer-lock-runtime.test.ts:231-274` 使用自建真實 presence fs，只注入 rename EACCES；驗證第一次／復發各提醒一次、中間真正更新 lastSeenAt、連續相同故障不刷屏。另一案例保護普通 heartbeat 不消耗 status-only peer 變化。
- RED：`npm test -- test/writer-lock-runtime.test.ts` exit 1，復發時 `takeNotice()?.message` 在 line256 為 undefined；12 passed／1 failed。GREEN：controller／Runtime／實際 hooks 共 81 tests exit 0，typecheck／lint exit 0。
- 負向控制：暫將 hadOperationIssues 條件取反，兩個新增案例各在 line256／270 因缺 notice 失敗（exit 1，11 passed／2 failed）；精準還原後同一命令 13 tests exit 0，未留 mutation。
- 13:57 最新全套：`npm test` **310 tests／16 files**、`npm run typecheck`、`npm run lint`（34 files，無 fixes）、`git diff --check` 全部 exit 0；兩個修改 TS 檔 LSP clean。
- scoped 雙重唯讀複審：workflow `54756336-422d-4f5b-bdf8-268e1014660a`，同 mission；native 審 recovery／status／cleanup 與 P2-1 裁決，codex 審原 finding 修復及測試。**兩者 completed**：native `8cabe11f-c430-4543-a98b-7bc1b115399e` 撤回 P2-1，確認自身診斷與 helpers 裁決，但另提出 status-only fault 邊界；codex `15ea9292-0cbe-4618-8999-1bf80fb4385f` 未見 blocker。報告位於同 sessions artifact 根下 `54756336-422d-4f5b-bdf8-268e1014660a/review/{recovery-lifecycle,recovery-adapter}.md`；主 agent 不以多數／非阻擋評級略過新 finding。

### Round 3 — 保留 status-only 去重記憶（2026-09-10，完成）

- [CODE] N — 接受 native P2：若主動 status 同時 update 失敗且看到新 peer，Round 2 的普通 hadOperationIssues 條件會在下一次 heartbeat 恢復時，把 status-only peer 納入 lastAutomatic。主 agent 完整重讀 controller 與測試，實測確認下一次自動 refresh 缺 notice。
- 最小修正：`src/runtime/writer-lock.ts:225-242` 在操作前取得 failedReport，且只有其 signature 與 lastAutomatic 相同才視為自動通道已觀察的故障；done／無新 issues 後才靜默更新恢復基準。正常 heartbeat 不多算 signature、不增加 Git／peer scan。
- 測試：將原 status-only 案例擴為 status publication 成功／失敗兩種，真實 fs 保留，僅失敗分支注入 PresenceMutation；先驗 status 的讀寫失敗狀態，再驗恢復及後續自動 peer 提示。原真實 rename EACCES 的 recurrence 案例仍保留。
- RED：`npm test -- test/writer-lock-runtime.test.ts` exit 1，status update failed=true 在當時 line282 缺 notice（13 passed／1 failed）。GREEN：14 tests、typecheck、lint exit 0。
- 負向控制：signature equality 暫改為 inequality，原 recurrence 及 status-fault 兩案例於 line256／286 同時失敗（exit 1，12 passed／2 failed）；精準還原後同一命令 14 tests exit 0，無 mutation 殘留。
- 14:05 最新全套：`npm test` **311 tests／16 files**，typecheck、lint、diff check exit 0；兩檔 LSP clean。只有 controller 與其測試受修正，formatter 也僅作用於這兩檔。
- 最終 scoped 雙重複審 workflow：`64803862-a1aa-4e88-ba3d-5b8554282595`，同 mission；受審 git blobs 分別是 controller `71f0ea63002b7648c5088f58682ce4aa4efca1df`、test `ffef1a2bbd7c96dcd824edee9f937df417d7945b`。兩者均 completed：native `a8cf60c1-8339-4fa9-80bb-2d42050e3884` 回覆 No issues found；codex `5b054d11-2afe-41af-8b10-82105cae27a3` 未發現具體可達回歸。主 agent 實際讀回 `64803862-a1aa-4e88-ba3d-5b8554282595/review/{status-isolation,recovery-regression}.md`，並親自重新核對兩個 blob 與恢復前後的資料流，通過此次 scoped gate。
- 文件裁決：native 複審誤查 canonical `openspec/specs/...`；正確 delta 路徑一直是 `openspec/changes/fix-writer-lock-ownership/specs/writer-lock-safety/spec.md`。已在複審 brief 明示，不為此建立／同步 canonical spec。

### 第一輪完整驗證（修前 baseline；修後結果見 Rounds 2–3）

2026-09-10 13:37，本機 Node `v22.23.2`／Darwin arm64：

- `lsp_diagnostics` 明確指定 15 個變更 TS 檔：15 clean、0 diagnostics、無 unsupported／unavailable／failed。
- `npm test`：**308 tests／16 files 通過**。
- `npm run typecheck`、`npm run lint`（34 files，無 autofix）、workflow pre-check、`openspec validate fix-writer-lock-ownership --strict --no-interactive`、`git diff --check`：全部 exit 0。
- `lens_diagnostics mode=all` 在此恢復 session 回覆「No files diagnosed yet this session」；補跑限定路徑 full／cheap 仍未提供逐檔診斷。不能把空 cache 當完整掃描通過，型別證據採上述明確成功的 LSP 及 tsc；沒有宣稱 CVE／dead-code 掃描全面通過。

### 需求覆蓋與未驗證界線

| Requirement | 已執行的證據 | 界線 |
|---|---|---|
| Advisory behavior without write locking | Runtime／實際 default-export 註冊 hooks 的 peer 寫入放行、既有政策仍阻擋；peer-block mutation 預期失敗 | 非完整 CLI 驗收 |
| Basic worktree awareness | 實際暫存 Git 的 canonical alias、unborn／detached、dirty／clean、linked worktree；注入 timeout／signal／partial failure | Git/fs 僅本機平台 |
| Scoped session presence notices | 純函式分類、controller 共存／自身排除、不同 host／root／namespace | 不宣稱偵測所有 writer 或互斥 |
| Truthful and non-disruptive diagnostics | signature、pending drain、UI＋console 故障、partial facts；對應 negative controls | 未測完整 SDK session.prompt／登入模型 |
| Non-destructive presence lifecycle | 實際 bytes／mode／fd、五種身分替換、symlink、scan／size cap、legacy 不變；精準 fs faults、late-result mutation | 不抵抗惡意同使用者路徑替換 race |
| Bounded compatibility and honest guarantees | 動態設定、同步介面、deprecated arrays round-trip、takeover／unlock 零副作用、child 零 writer I/O | 最低 Node 22.19.0、Linux／遠端 CI、Pi CLI 未跑 |

### 最終驗收與 checkpoint（2026-09-10）

- 14:10 fresh verification：`npm test` **311 tests／16 files**，`npm run typecheck`、`npm run lint`（34 files，無 autofix）、workflow pre-check、OpenSpec strict validate、`git diff --check` 全部 exit 0。15 個變更 TS 檔的 primary LSP 全部 clean，無不支援／不可用／失敗。lens session cache 仍有前述工作樹範圍限制，不冒充完整安全掃描。
- 已完整讀過的初始 diff，除 controller／其測試／本紀錄外，逐檔 section 與目前 diff 精確相同；兩個後續 code/test blobs 與最後雙 reviewer 的受審值一致。沒有 package／lockfile／CI 或其他模組 source 變更，沒有 mutation 殘留。
- [CODE] N — 最後 native 報告提及未 drain 的 pending 可能被後續 refresh 吸收：不是此次 recovery 精修引入；正式 `turn_end` 在同步 heartbeat 後立即 `emitPending`，沒有中間 await，因此該 undrained 呼叫順序不在正式自動通道發生。相容 caller 仍須取出 pending；status 永遠可查診斷，不擴大本輪 API。
- 全部 feedback 已裁決：兩項採納的去重問題 RED→GREEN＋負向控制＋複審完成；on/sessionId finding 由原 reviewer 撤回；自身 stale/clock 診斷與 legacy helpers 維持既定範圍。沒有待修阻擋問題，沒有需要 Phase 6 更動 requirement/design 的 Y 項。
- Tasks 5.3 與 5.4 的審查／驗證部分已完成。本 change 在 Phase 5 凍結 tasks，因此保留原 checkbox 作進入本階段時的歷史，完成證據以本檔為準。Checkpoint 使用既有授權，只包含本次實作、測試與文件；不授權 push／merge／安裝／發布／sync／archive。
- Checkpoint SHA 以包含本次變更與本紀錄的 Git commit 為準；可由 `git log -1 --oneline -- openspec/changes/fix-writer-lock-ownership/review-notes.md` 定位。提交前不預填不存在的 SHA，提交後由主 agent 讀回 HEAD／parent／tree／status 驗證並回報。

### Phase 5 凍結與權限

從本輪開始凍結 active change 的 proposal／specs／design／tasks；feedback 與後續驗收狀態只寫本檔，不為完成 checkbox 改寫已凍結的 tasks。最終驗證已再次逐一比對以下雜湊。

凍結 SHA-256：

- proposal：`360ea38b24882fc709788d8759d0af920a12e677602e8abda705ce311b2f4a89`
- design：`f4e8e3c438fe39b8cc28351f40591f43e7248440052635a9c45fdafa0cd8f581`
- tasks：`a1ad8118f483e40d681bca341cea9d4df2b1d6db5466ea8a64f197a9ceaa311b`
- spec：`259b81ad0a83aa95f60f8b0f45c3352b91f054564780ffcf28f49180a42134f9`

Phase 5 只建立已授權的 scoped checkpoint `db2160565dae89f575ade5f45cd2e103060ef7dd`；當時未 push／merge／安裝／發布／canonical spec sync／archive。主 checkout 保留原有兩份 untracked plans，真實 agent settings 不在該輪寫入範圍。

## Phase 6 — Reconcile 與歸檔授權（2026-09-10）

使用者在已收到 Phase 6／規格同步／歸檔、push／主線合併的待辦摘要後，明確授權「繼續完成 openspec 作業 / push / 主線合併」。本輪依此完成既有 advisory 的收尾；不包含安裝、發布、刪分支或強鎖擴張。後續 completion／git-evidence 工作另建 change，不納入本 capability。

- 初次 C5 核對發現 proposal/design 仍含 Phase 2/3 的「尚未實作／待核准」時間性敘述，判定 `corrected`；只在 Phase 6 清理，不回填 Phase 5 的歷史。
- [REQUIREMENT] Y — `proposal.md` 清除過時 approval／未實作敘述，把操作授權與功能 non-goals 分清。六項規範性 requirements、scope、相容行為皆不變，delta spec 無需改寫。
- [DESIGN] Y — `design.md` 清除過時階段敘述及 draft 語氣，保留已核准分層、介面、生命週期、去重與測試契約；沒有新增設計選項或未決架構。
- [CONSTITUTION] Y：無；專案規則保留 `openspec/config.yaml`，feature spec 沒有納入跨專案操作守則。
- 所有 [CODE] N 的修復／不採納／覆核理由維持上述裁決；沒有待修 code blocker。proposal/design 的機械性收尾屬此次已授權 OpenSpec 作業，不重新定義需求。
- tasks baseline 為 Phase 5 的 SHA-256 `a1ad8118f483e40d681bca341cea9d4df2b1d6db5466ea8a64f197a9ceaa311b`；保留 19/21 checkbox，5.3／5.4 的實際完成以本檔及 `db21605` 的 Git 證據為準。歸檔警告不以修改 tasks 或停用 validation 消除。
- **Deferred verification:** Pi CLI／完整 SDK 模型與寫入型 subagent、最低 Node、Linux／CI 的已揭露界線不被歸檔抹除；CI 在本次推送主線後另外取得結果。detached/not-applicable 的獨立 hook 情境與雙程序啟動仍屬覆蓋補強；無 deferred constitution item。

### Reconciliation Gate

清理後從 C1 全部重跑，結果如下；此次使用者已明確授權完成 OpenSpec 作業，包含前次摘要列出的同步與歸檔，不另外擴張功能或安裝範圍。

| 項目 | 結果 | 證據 |
|---|---|---|
| C1 Y 項路由 | verified | proposal 的階段敘述與 design 的時間性文字各歸原檔；規範性 delta 未變；所有 CODE N 保留既有裁決。 |
| C2 Constitution 隔離 | verified | 完整重讀 proposal／delta／design／config；沒有新增跨功能 constitution，也沒有 deferred constitution。 |
| C3 tasks 未變 | verified | SHA-256 與上述 baseline 精確相同，Git diff 不含 tasks 變更。 |
| C4 規範及 validation | verified | workflow pre-check、`openspec validate fix-writer-lock-ownership --strict --no-interactive`、diff check 均 exit 0。 |
| C5 clean rewrite | verified | 已完整重讀收尾後 proposal/design；無過時 Phase 2/3 敘述或修訂對照，delta 六項 requirement 原文保留。 |
| C6 coverage/deferred | verified | REQUIREMENT／DESIGN Y 均已處理；CONSTITUTION Y 無；全部 N 有裁決；平台／CLI 覆蓋界線明示且不冒充已驗收。 |

裁決：`verified`。延後項目：僅前述 CLI／平台／覆蓋補強；無 deferred constitution 或未處置的 code finding。同步新增 canonical `writer-lock-safety`，包含原 Purpose、6 requirements 與 12 scenarios，無修改或刪除其他 capability。

### 歸檔後讀回驗證

- `openspec archive fix-writer-lock-ownership --yes` exit 0；保留 19/21 歷史 checkbox 的兩項警告，沒有使用 `--no-validate`。
- active 路徑已不存在；本日期 archive 存在，`.openspec.yaml`／review-notes 保留，tasks SHA-256 不變。
- canonical 的 Purpose 與全部 requirement/scenario body 逐項比對原 delta 一致，沒有 delta operation headers；README 與目前設計連結皆指向存在的 canonical／archive 檔案。
- 14:41：`npm test` 311 tests／16 files、typecheck、lint、`openspec validate --all --strict --no-interactive`、diff check 均 exit 0。此次 archive checkpoint 沒有 src／test／package／lockfile／CI 變更。
- push、主線合併與 CI 結果屬接續 Git 整合步驟；本段不預先宣稱成功。
