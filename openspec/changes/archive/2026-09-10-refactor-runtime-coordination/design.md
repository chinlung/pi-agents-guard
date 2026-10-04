## Context

**Change：** `refactor-runtime-coordination`。動機與範圍見 [proposal.md](proposal.md)，五項需求／十五個 scenarios 見 [completion-recheck spec](specs/completion-recheck/spec.md)。

本設計使用「專用協調器＋共用 Runtime」：`src/index.ts` 負責 Runtime 組合，`src/extension.ts` 負責 Pi 接線；completion 與 git-evidence 各有協調 owner，純 modules 不承擔 I/O。Eligibility 與 failure policy 必須在 completion 查詢之前生效，而非只在取得結果後判斷是否顯示。

Pi 介面依鎖定的 0.85.1；`agent_settled` 是自動重試、compaction 與已排隊 continuation 都不再接續的穩定收尾點。資格使用 session 任一回合的成功寫入事實，不要求最後一回合有寫入。工具鏈為 Node >=22.19.0、strict TypeScript、Vitest 5、Biome 2；沒有新增 dependency 或 build script。

## Goals / Non-Goals

- Runtime 保有 config、provenance、failureCounts 的單一來源；controllers 不互相匯入，不直接依賴 Pi API。
- completion 的非同步收集與同步結果採用分開，但共用同一 eligibility／failure policy。Pi adapter 不持有 completion facts 或重複計數。
- 先修行為，再搬移責任；每一批搬移以已鎖定的行為作基準，不用重寫掩蓋回歸。
- 不加入新的持久狀態、計時器、重試、佇列、通用 registry 或宿主停止協定。writer 模組與 canonical writer-lock-safety 規格不變。
- 不更改 proposal 列出的 git-evidence cwd／upstream／exit-code 文案／UTF-16 預算等獨立問題。

## Decisions

### D1. 專用協調器，不建立通用框架

採用已確認的分層。只補 gate／catch 雖然 diff 小，但會留下 entry 與 Runtime 分掌協調的問題；通用 module/event framework 則增加遷移面，沒有本 change 的必要消費者。

| 檔案／邊界 | 責任及依賴 |
|---|---|
| `src/modules/completion-diff-recheck.ts` | 原有工具／baseline 偵測、normalize、decideRecheck；保持純函式及文案。 |
| `src/runtime/completion-diff-recheck.ts`（新增） | `createCompletionController`：completion facts、檢查有效性、Git 收集、單次結果採用；依賴 ExecFn、純 module 與窄 policy callbacks。 |
| `src/modules/git-evidence.ts` | 原有事件偵測、formatters、combineEvidence；保持純函式。 |
| `src/runtime/git-evidence.ts`（新增） | `createGitEvidenceCoordinator`：原有 exec 順序與格式組合，不擁有 config／failureCounts。 |
| `src/runtime/contracts.ts`（新增） | Runtime／RuntimeDeps 及新增 completion 協調契約；只有 types，不包含 Pi instance、factory 或 I/O。 |
| `src/index.ts` | 繼續定義 createRuntime，組合 controllers、config、guard；重匯出公開契約，default export 委派 adapter。 |
| `src/extension.ts`（新增） | `registerAgentsGuard(pi, makeRuntime)`：Pi flags、config 載入、lazy runtime、hooks／command 與顯示；接收 factory，不反向 value-import index。 |

contracts 由 index／adapter／completion controller 共用，避免 adapter 與 index 的循環依賴；不再細拆沒有獨立責任的 helper 檔案。writer controller 保留原檔與原接線語意。

### D2. 公開相容與窄注入介面

`src/index.ts` 保留 `Runtime`、`RuntimeDeps`、`createRuntime` 的匯入位置，既有方法的參數、同步／非同步性與回傳形狀不變；package entry 不變。新增下列 types／方法，舊 RuntimeDeps 物件不用增加欄位：

```ts
export type CompletionNotice = { card: string; shouldFollowUp: boolean };
export interface CompletionCheck {
  finish(): CompletionNotice | undefined;
}

// 僅列新增成員；Runtime 的其餘既有方法及原簽章保持不變。
export interface Runtime {
  collectCompletionDiff(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<CompletionCheck | undefined>;
  shutdownCompletion(): void;
}
```

`CompletionCheck` 是僅限本 Runtime 記憶體的單次採用入口，不是持久 reservation、跨程序許可或可序列化 token。它只暴露 finish，不讓 adapter 自行拼出可繞過有效性檢查的快照。原 `checkCompletionDiff(actualPorcelain, diffStat)` 仍接受 caller 提供的字串，同步比較並在應 follow-up 時扣一次配額；不做 Git I/O。

Completion controller 的依賴固定為：`exec: ExecFn`、`isSubagentChild: boolean`、`getSettings(): { active: boolean; options: CompletionDiffRecheckOptions }`、`recordFailure(): void`。Runtime 於組合時固定注入既有 `deps.gitEvidence.exec`，不重命名舊依賴，也不要求 caller 提供第二份 executor；active 每次讀取 `isModuleActive("completion-diff-recheck")`。

Controller 提供 `observeToolResult`（參數同 Runtime.handleToolResult）、`check(actualPorcelain, diffStat)`、`collect(cwd, signal?)`、`invalidate()`、`shutdown()`。最後兩個只處理本機有效性，皆為同步、零 I/O。Runtime 的舊／新 completion 入口委派到同一 controller，不各自保有 baseline 或配額。

Git-evidence coordinator 的依賴為 `exec: ExecFn`、`cwd: string`、`getOptions(): GitEvidenceOptions`；提供 `augment(command, isError, signal)`，回傳 `Promise<string | undefined>`。原 Runtime.augmentGitEvidence 仍在既有 guardedAsync 內呼叫它。

### D3. 兩階段完成，封住最後一個 await 的窗口

選擇 **async collect → 同步 finish → 同步顯示**，而非 async 方法直接回傳已扣配額的 card。原因：async 方法內最後一次有效性檢查，不能涵蓋 Promise resolve 到 adapter 恢復執行之間的停用／取消；只在 entry 再加 if 又可能已提前消耗配額。

替代方案是把同步顯示 callback 傳入 controller，但那會使 UI 例外與模組判定邊界混合；此次保留資料回傳及原 adapter 顯示責任，使用一個 finish closure 即可，不建立 ticket registry。

每次 agent_settled 的流程：

1. 以本次 ctx.cwd／ctx.signal 呼叫 collectCompletionDiff；controller 在任何 Git 前判定 D4 eligibility。
2. 在 try 邊界內依序執行 `git status --porcelain`、`git diff --stat`，兩者使用同一 cwd／signal。每次 await 後、下一次 exec 前重新判定有效性；結果採用規則見 D5。
3. 收集成功只回傳 CompletionCheck，不比較、改 baseline 或扣配額。
4. adapter await 返回後，立即同步呼叫 finish。finish 先標記本入口已使用，再重新檢查有效性，讀取當下 facts／options，執行原比較、組 card，最後才在應 follow-up 時遞增配額。
5. adapter 對 undefined 不做事；有結果時依既有順序 appendEntry → emit →（如需要）sendMessage。finish 與三個既有同步輸出呼叫之間不加 await、timer 或排程 callback。

重複呼叫同一 finish 永遠回 undefined，即使第一次因失效或比較異常沒有 card。同步舊 check 與 finish 共用同一比較／配額邏輯；card 完整建立成功前不得遞增配額。相同結果的不同收尾事件仍可各自顯示，維持原有非去重行為。

不新增互斥或 latest-request-wins：若 caller 重疊啟動兩次收集，每次各持有自己的 signal／快照，finish 按實際執行順序讀取當下配額，因此不超額；不預先保留兩份 follow-up 配額。Coalescing 屬額外行為變更，不在本設計內。

### D4. Facts 與有效性生命週期

每個 controller 有 `hadWrites = false`、`observedPorcelain = null`、`followUpCount = 0`、`completionGeneration = 0`、`completionClosed = false`；下文以 generation／closed 簡稱後兩者。沒有模組層 singleton；新 createRuntime 得到全新 facts／counter／failure map，不從其他 instance 或 session 檔還原。

`observeToolResult` 保留原觀察規則：成功 write／edit／ast_grep_replace 設 hadWrites；成功 bash 且匹配 porcelain command 時，只取原 content 中第一個有效 text。Runtime 先更新 capabilitiesListed，再委派 completion observation；即使 completion 停用，仍持續記錄已發生的成功工具結果，供重新啟用後使用。此次不修改 isWriteTool 的成功定義或既有 command parser。

collect 捕捉 generation。current 必須同時滿足：generation 相同、未 closed、非 env 判定的 child、getSettings.active、有 hadWrites、caller signal 未 aborted。前置 gate、await 後、finish 時都使用此條件。

| 事件 | generation／狀態處置 |
|---|---|
| global 或 completion 的有效設定開關發生變化 | Runtime.setEnabled 在 recompute 前後比較有效 enabled；有 transition 才 invalidate。off→on 不能復活舊 generation。 |
| 重複 on／off，或切換其他模組 | 不增加 generation；不啟動 completion Git。writer enable refresh 仍遵循原規則。 |
| unexpected failure 達第三次 | Runtime map 令 active=false；所有尚未 finish 的工作失效。on 不清除 inert。 |
| session_shutdown | hook 先同步 shutdownCompletion（closed=true、invalidate），再照原流程 releaseWriterLock／emitPending。沒有等待或停止外部程序的新協定。 |
| caller abort | 只使該 signal 的工作失效；不關閉整個 controller。 |
| setSessionId／writer init／release | 保留 writer-specific 用途，不藉它們重設 completion facts 或配額。正常 session 替換由新的 Runtime 提供 instance 隔離。 |

關閉是 terminal；同一 Runtime 在 shutdown 後不能靠 on 復活 completion。disable／enable 則不清除 facts。失效時只丟棄結果，不回寫 baseline、不登記取消為 unexpected failure，也不動其他 controller。

### D5. 查詢可信度、失敗隔離與診斷

保留既有兩個 Git argv，不加入 shell command interpolation、timeout 或自動重試；本次 cwd 是明確參數，不使用 resolver 的初始化 cwd，也不重用 writer snapshot。diff-stat 永遠不進 decideRecheck。

| 結果 | 後續處置 | failure／配額 |
|---|---|---|
| 前置不符、已 aborted、await 後失效 | 不開始／不繼續查詢，不回傳可採用結果 | 均不增加 |
| status code≠0 或 killed=true | 丟棄 stdout；不跑 diff-stat | 均不增加 |
| status 成功；diff-stat 正常非零返回且未 killed | 保留 status，附加統計用空字串 | 只在有效 finish 得到 shouldFollowUp 時扣配額 |
| 任一查詢 killed=true 或 caller abort | 放棄本次結果，不以部分輸出組卡 | 均不增加 |
| 仍有效時 exec unexpected rejection | catch，回 undefined，不讓 rejection 逸出 hook | completion failure +1，配額不增加 |
| finish／同步 check 比較或組卡拋錯 | catch，回 undefined | completion failure +1，配額不增加 |
| 失效之後才 reject | 丟棄，不能藉晚到錯誤污染新啟用期間 | 均不增加 |

取消以 caller signal／lifecycle 事實辨識，不以 exception message 猜測。正常非零／killed 沿用安靜略過，不建立「已乾淨」card，也不新增每次都刷出的未知狀態通知。

Runtime 是唯一 failure owner。新增 completion 專用 `recordCompletionFailure()`：以固定安全 detail 呼叫既有 recordModuleFailure，外層吞下故障診斷通道的例外；計數在既有 logger 呼叫之前更新。不得把 caught error、stderr、工具輸入或錯誤物件的 String/error.message 傳給此路徑。

collect 與 finish 各守自己的執行段，但不互相巢狀套 guard：collect 失敗沒有 finish 可用，finish 又只能使用一次。因此單次檢查最多記一次 failure。Runtime 的 completion 委派入口不得再外包 guardedRun／guardedRunAsync 而重複記錄；其他模組的 generic guards 與 logger 語意完全保留。

三次 failure 累計後，原 status 的 `[auto-disabled after repeated failures]` 持續可查詢；成功檢查不把 counter 歸零。壞 logger 也不阻止計數到 inert，不新增 retry／log fallback loop。

此 failure 邊界保護 Git 收集、比較與其故障診斷，不把所有 Pi 輸出改成可回復 transaction。有效 finish 仍按原 check 語意消耗「請求 follow-up」配額，不代表模型已執行或 UI 已收件；appendEntry／emit／sendMessage 的既有失敗與部分送達限制不在此次全面修復範圍。收集／判定失敗與失效則一定不消耗配額。

### D6. Git-evidence 僅做相容性搬移

Git-evidence coordinator 保留 augmentGitEvidence 的查詢／組合語意。Runtime 在呼叫之初用 guardedAsync 決定是否執行；不加 completion 的 child／generation／closed policy。這是刻意不對稱，避免改變另一模組的取消／停用語意。

- detectGitEvents 保留失敗工具結果不觸發、單一 command 可產生 commit＋push 多事件的順序。
- 偵測到事件後、第一個 await 前讀一次 options 參考；執行中的呼叫繼續使用該物件，後續呼叫才取得新的 options。這不是 clone／freeze，不保證同一物件被原地 mutation 時的隔離。cwd 固定為組合時的 deps.resolver.cwd，不改為 event cwd。
- commit：`git log -1 --format=%H %d %s`。
- push：`git rev-parse HEAD` → `git rev-parse @{u}` →（checkCi 時）`gh run list -L 3`；每次傳入同一 cwd／signal。
- 保留 upstream 非零視 null、gh 非零／throw 只降級為 CI 未檢查、其他 exec throw 回到原 guardedAsync 的行為；不增加 HEAD／log／killed 的新判讀規則。
- 保留 parts 順序、formatters 與 maxAppendBytes 的現有 UTF-16 計量方式。

不把純模組、shared ExecFn、failure policy 複製到新檔。新增 coordinator 測試保護 args／順序／捕捉 options 時點，而非只驗某段文案存在。

### D7. Adapter 薄化與唯一事件接線

`src/index.ts` 的 default export 只呼叫 registerAgentsGuard(pi, createRuntime)。factory 用 `(deps: RuntimeDeps) => Runtime` 型別注入；extension.ts 不 import createRuntime 值，contracts 也不 import adapter。public createRuntime 本體仍在 index，無需新建第二個 runtime entry。

adapter 保留 flag、home／stateDir／configPath 計算、啟動時讀 config、lazy ensureRuntime，以及原 command parsing／completions。setEnabled 與 completion invalidation 是 Runtime 的同步責任，不放在需要 UI 或 async writer refresh 才能抵達的位置。

只註冊六種事件各一次：session_start、turn_end、session_shutdown、agent_settled、tool_call、tool_result；一個 agents-guard command。各 hook 明確註冊，共用具名 emit／emitWriter／emitPending／ensureRuntime helpers，不建立自動掃描／registry。

- tool_call：維持 hard-deny → subagent-policy；writer 不新增 gate。
- tool_result：先用原始 event.content 記錄 completion／capabilities，再 await evidence，最後回傳 `[...event.content, evidenceText]`。不 mutation 原陣列，不丟 image 或其他 blocks，不分成有先後不確定性的兩個 listener。
- agent_settled：只有 collect → finish → 顯示，沒有直接 pi.exec，也沒有未受 completion boundary 保護的 Git await。
- session_shutdown：completion close 在任何 writer cleanup／通知前執行；其他 writer hooks、pending drain、status 合併、effective-enable refresh 均維持原行為。
- 完成 card 的 customType `agents-guard-diff`、data.card、follow-up customType、content、deliverAs／triggerTurn 都保留；沒有結果時三個輸出通道均不呼叫。

最後同步採用／顯示段依賴現有 Pi 呼叫沒有中途 await；未來若 host 改成需 await 的 delivery API，必須重新設計有效性及配額交接，不能機械加 await。

## Requirement / Scenario Coverage

下表列出每個 requirement 的三個 scenarios，共五項／十五個；設計由 controller、Runtime 及 registered-hook 層測試覆蓋，查詢 cwd 與 dirty→clean 另有 actual Git 測試。各層證據與未驗收範圍見後兩節。

| Requirement | Scenarios → 設計 | 驗證入口 |
|---|---|---|
| Eligibility before completion I/O | Disabled or inert module；Child or no successful writes；Re-enabled eligible session → D2／D4／D5 | controller＋實際註冊 hook：exec／entries／notices／messages 全部零呼叫；重新啟用保留 facts。 |
| Scoped and trustworthy completion queries | Current event location；Status query is unsuccessful；Display-only statistics unavailable → D3／D5 | argv、當次 cwd、signal identity；status 非零／killed 不跑第二次查詢；diff-stat 非零不污染 card。 |
| Bounded completion failure isolation | Exec throws during collection；Repeated unexpected failures；Failure reporting is unavailable → D5 | status／stat rejection、比較異常、固定診斷、三次 inert、壞 console.warn；其他模組仍有效。 |
| Stop after cancellation or lifecycle invalidation | Already aborted signal；Disabled then re-enabled while awaiting；Shutdown or abort during collection → D3／D4 | deferred status／stat，兩個 await 及最後 finish 窗口均驗失效、不輸出、不消耗配額。 |
| Preserve completion observations and follow-up limits | Default and no-baseline behavior；Dirty-to-clean and unchanged snapshots；Independent sessions and bounded follow-ups → D2／D3／D4／D7 | 舊同步 API＋新 hook；基準字串／card 不變；新 instance 重設；finish 不可重用；重疊收集共用上限。 |

## Testing Strategy

行為修正與結構搬移分開驗收：先以 hook 回歸測試鎖定 zero-I/O／failure／lifecycle 行為，再以 characterization 與 mutation 保護協調器、contracts、adapter 的抽離。測試與負向控制的執行歷史保留在 [tasks.md](tasks.md)，獨立 review 與處置保留在 [review-notes.md](review-notes.md)。

| 層級／檔案 | 直接驗證的範圍 |
|---|---|
| `test/completion-diff-recheck.test.ts` | 原純函式的 normalize、比較、no-baseline、dirty→clean 與 follow-up 規則。 |
| `test/completion-diff-recheck-runtime.test.ts` | Controller facts／失效／單次 finish／共用配額、當下 settings，以及自有 repo 的 actual Git。 |
| `test/git-evidence-runtime.test.ts` | 固定 argv／cwd／signal、查詢順序、既有非零／killed／throw 語意，以及 options A/B 參考在第一個 await 前捕捉的輸出效果。 |
| `test/integration.test.ts` | 舊 root API／必要 deps 相容性、唯一 failure map、collect→finish 的最後窗口、同步／重疊配額及 writer lifecycle 隔離。 |
| `test/extension.test.ts` | 真實 root default export 註冊的 hooks、zero-I/O／三個輸出通道、原 content observation、lazy Runtime、shutdown 順序。只有單次 factory 測試覆寫 activate，且仍建立真實 Runtime。 |

- **I/O 分離：** zero-I/O 測試關閉 writer 或分開 startup／command 記錄，斷言 exec 與 entries／notices／messages，而非只驗沒有 card。inert 以三次注入 executor fault 建立，不直接修改私有 counter。
- **生命週期：** `test/helpers/deferred.ts` 控制 status／stat 等待點，不使用 sleep。Hook 矩陣驗 late resolve/reject 與無晚到輸出；off/on 類另驗後續有效 follow-up。Abort 使用新 signal 的配額保留與最後 finish 窗口由 Runtime API 測試；shutdown 對同 instance 永久關閉。
- **Actual Git：** `completion observes actual Git changes and dirty-to-clean` 使用 mkdtemp 自有 root、repo 與空白 wrong-repo，隔離 Git config／env。取 a.txt 的實際 baseline、加入 b.txt 後驗 card，再刪除自有檔案驗 dirty→clean 與空白 status；finally 只清自己的 root，不建立 commit 或 remote。
- **Negative controls：** M1–M11 保護 eligibility／catch／generation／finish 有效性／不預留配額／單次使用／signal／stat；M12–M14 保護 evidence upstream 與 options timing；M15–M20 保護 observation／事件唯一性／root delegation／shutdown 順序／Runtime memoization；M21 保護 image block 的深拷貝預期值；M22 以同 root 的 wrong-repo 證明 cwd 測試具辨識力。控制均精確還原；新 module 的 suite-load RED 不冒充 behavioral failure。
- **命令與靜態檢查：** 相關 tests → `npm test` → `npm run typecheck`／`npm run lint`，另做 explicit primary LSP、OpenSpec pre-check／strict validation 與 diff check。沒有 build script；cached lens 無診斷紀錄時不當作 active scan。

沒有直接驗證「finish 之後加入 await」的 timing mutant；同步交付段靠 source 核對，不能與 Runtime 最後窗口測試混稱。M21 也不是所有 command-specific block mutation 的窮舉。注入 killed／rejection／cancellation 與 actual Git 的一般退出分開計算；它們不代替完整 Pi CLI／SDK 驗收。

## Security / Privacy / Operational Boundaries

- child 判斷沿用 Runtime 建立時 env.PI_SUBAGENT_CHILD === "1"；不是從 tool input、sessionId 或 caller 自報的 isSubagentChild 決定。completion 的零 I/O 保證不代表其他模組全部停用。
- exec 使用既有固定 argv 與明確 cwd／signal，不拼 shell；不查網路、upstream 或 CI，不自行 commit／stash／checkout。git-evidence 原有 gh 行為保持，不能宣稱整個 extension 零網路。
- unexpected failure 的新診斷是固定文字＋既有計數，不輸出 raw stderr／exception／工具輸入；既有 card 仍含 porcelain／diff-stat，並未因這次重構新增一般內容清洗保證。
- 不新增磁碟狀態或設定鍵；config save 與 writer 的 state/agents-guard 權限政策維持。closure 只由該次 caller 持有，finish 後不進行 registry 留存或持久化。
- generation 只是本機失效標記；不是跨程序 fencing，也不能證明已 spawn 的 Git 立即停止。傳入 signal 沿用 Pi 行為，不新增 timeout 或直接 kill。

## Risks / Trade-offs

- **多一個 finish 入口** → 換取最後 await 後才比較／扣配額；以單次採用、停用／取消窗口、重複呼叫測試保護，舊 caller 不必改用新 API。
- **不同收集可重疊，兩次 Git 非原子快照** → 不聲稱強一致性；每次回覆限定自己的 cwd，stat 僅顯示，finish 重新讀取配額。不增加互斥／最新請求優先規則。
- **公開契約搬移造成匯入或 module cycle 回歸** → root re-export 保留；contracts 無執行副作用，adapter factory 注入；由原 index 匯入的 compile／hook tests 驗證。
- **把安全修正套用到其他模組** → completion-only policy seam；明確保留 git-evidence 在開始後的既有行為，以及 writer 的提示／清理生命週期。
- **輸出 channel 部分失敗不具 transaction 性質** → 不回滾已 append 的 entry 或已請求的 message，不自動重送；維持既有相容範圍，不宣稱端到端 exactly-once delivery。
- **logger 壞掉仍需 inert** → 共用 count 先更新，再 best-effort 診斷；測試驗 status 而非只等一條 log。

## Migration / Rollout / Rollback

本 change 無 schema／持久狀態遷移，package entry、設定鍵與原 Runtime caller 不需轉換。`README.md`／`docs/design.md` 的現況章節描述協調器與限制；歷史 stage plans 保留執行脈絡，不作當前實作的唯一依據。

此 change 不包含安裝、reload、發布或操作真實 agent state。部署前仍需在實際 host／操作環境完成適用驗收；本機單元與 harness 綠燈不代表已部署。

回退至缺少 completion 修正的版本會重新引入前置 I/O／錯誤邊界缺口，雖不需要資料轉換，不能視為保留修正的 rollback。Controller／adapter 的回退不要求把 writer advisory 變成歷史強鎖。

## Evidence and Unverified Acceptance

| 範圍 | 已取得的證據／限制 |
|---|---|
| 本機測試 | Darwin arm64、Node 22.23.2、Git 2.55.0：411 tests／18 files；completion controller 20、evidence coordinator 18、hook 66、integration 64，共 168 個相關 cases。原始命令／RED-GREEN／review 紀錄見 tasks 與 review-notes。 |
| 靜態與規格 | Typecheck、lint、11 個 changed/new TS 的 explicit primary LSP、OpenSpec strict 已驗；不是完整 host 執行證據。 |
| Actual Git | 自有 repo 的 untracked 新增與 dirty→clean、wrong-cwd 負向控制；沒有實際 subprocess cancellation、remote push 或 CI 結論驗證。 |
| Pi 介面依據 | 鎖定 0.85.1 的 `dist/core/extensions/types.d.ts`、`dist/core/exec.d.ts`／`exec.js` 與官方 extensions／SDK 文件；正常非零退出與 injected unexpected rejection 分開描述。 |
| 完整環境驗收 | Pi SDK／CLI、具憑證模型回合、writing-subagent、permission load-order、最低 Node 22.19.0、其他平台、本 change 的 CI、安裝／發布尚未驗收，不以基準版本 CI 代替。 |

沒有待延後決定的 requirement 或設計問題；未驗收環境與已接受的測試限制不是已完成的驗收。此文件說明最終設計，不攜帶流程批准史；執行與審查紀錄分別保留在 tasks／review-notes。
