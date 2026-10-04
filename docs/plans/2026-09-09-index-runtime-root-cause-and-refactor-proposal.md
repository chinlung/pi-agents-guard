# src/index.ts 根因調查與修正規劃提案

- 日期：2026-09-09
- 基準：`1876b59`；調查開始時工作樹乾淨
- 狀態：操作者已核准「漸進式 B」設計方向（2026-09-09）；首批實作計畫另列，尚未開始執行
- 範圍：降低 Runtime／extension 接線的維護複雜度；本輪只新增本文件，不修改程式碼、不 commit／push
- 規格來源：`docs/design.md` §3、§4.4、§5、§8；不以本提案覆寫既有行為規格

## 1. 結論與前次回報更正

根因不是單純「檔案太長」，而是原本的純判定核心與 hook 之間，缺少承擔**模組狀態及 I/O 協調**的明確邊界。每個 stage 都把這一層加進同一個 `createRuntime` closure，再把剩餘接線加進同一個 extension entry。

另有兩個放大因素：

1. 複雜度指標遞迴計入巢狀方法／callback，前次把 66／28 直接描述成主函式自身複雜度，容易誤導。
2. 既有整合測試止於 Runtime，未覆蓋真正的 hook 註冊、事件順序與 I/O 邊界；測試全綠不能證明 wrapper 行為符合設計。

`1876b59` 消除重複 fail-open 程式碼是局部改善，不是根因修正。建議採「保留既有 Runtime facade，依狀態所有權抽出 controller，再抽出薄的 hook adapter」，而不是只搬檔案或導入通用 plugin framework。

## 2. 複雜度數值究竟代表什麼

### 2.1 同一套分析器重測歷史版本

以目前安裝的 pi-lens **4.1.5** `functionFactProvider`，對 `git show <ref>:src/index.ts` 取得的各版原文在記憶體中分析；未 checkout 或改寫原始碼。以下為包含巢狀函式的分數：

| 版本 | 階段 | index 行數 | createRuntime | extension entry |
| --- | --- | ---: | ---: | ---: |
| `9b466b3` | Stage 1 | 260 | 17 | 16 |
| `a099991` | Stage 2 | 302 | 23 | 16 |
| `3accf65` | Stage 3 | 559 | 45 | 21 |
| `c5f7d6d` | Stage 4 | 674 | 60 | 24 |
| `77ba562` | Stage 5 接線 | 768 | 72 | 28 |
| `1876b59` | guard 去重後 | 768 | 66 | 28 |

這證明 scope 隨 stage 成長，但不是「執行 createRuntime 必經 66 條控制路徑」。

### 2.2 指標口徑驗證

已完整讀取本機分析器：

- `~/.pi/agent/npm/node_modules/pi-lens/dist/clients/dispatch/facts/function-facts.js:138`：`calcCyclomaticComplexity` 從 1 起算，遞迴 `walk(body)`，未在巢狀 function 邊界停止。
- 同檔 `:170`：`collectOutgoingCalls` 同樣包含巢狀函式中的呼叫。
- `high-complexity.js` 亦明文說明 test organizer 會累計巢狀測試的分支，並對該情境做特例排除。

另以相同 decision node／logical operator 集合，僅增加「遇到巢狀 function 不往下走」的唯讀 AST 探針，結果如下：

| 符號 | 位置 | 原分析器（含巢狀） | 探針（僅本體） |
| --- | --- | ---: | ---: |
| createRuntime | `src/index.ts:114` | 66 | 1 |
| extension entry | `src/index.ts:512` | 28 | 1 |
| handleToolResult | `src/index.ts:252` | 13 | 13 |
| initWriterLock | `src/index.ts:275` | 16 | 16 |
| git-evidence guard callback | `src/index.ts:398` | 8 | 8 |
| status | `src/index.ts:475` | 7 | 7 |
| agents-guard command handler | `src/index.ts:690` | 11 | 11 |

探針是釐清歸屬的輔助量測，不是另一套正式 linter；不得將兩種分數混用。先前的 fan-out 數字也不能當成 factory 執行時的直接呼叫數。

**裁決：指標是責任集中訊號，不是單獨證明函式難以執行／測試的依據；只把 nested functions 搬出去會使數字下降，卻不一定降低耦合。**

## 3. 已證實的結構性根因

### R1：純決策與宿主 API 中間缺少模組協調層

- `docs/design.md:120` 要求 wrapper 收集事實、呼叫判定、執行決策；但沒有為 stateful orchestration 指定獨立歸屬。
- Stage 3 plan `:39`、Stage 4 plan `:39`、Stage 5 plan `:38` 都明確把新增 orchestration 指向 `src/index.ts`。
- 實際 `createRuntime` 同時處理 config、guard、writer-lock 檔案 I/O、subagent 觀察狀態、git 驗證與 completion 比對。

這是逐階段計畫累積出的結構，不是 TS、closure 或純函式模式本身有錯。

### R2：獨立狀態群共用過大的 lexical scope

| 狀態所有權 | 目前位置 | 實際使用者 |
| --- | --- | --- |
| commandLayer/config/provenance/warnings | `src/index.ts:115-131` | status、save、各模組設定 |
| failureCounts | `:133`、`:173-211` | guard 與 status |
| capabilitiesListed | `:139`、`:240-261` | subagent-policy |
| hadWrites/observedPorcelain/followUpCount | `:140-142`、`:262-269`、`:454-473` | completion-diff-recheck |
| writerLockMode/selfSessionId/selfLock/selfLockWritten | `:144-165`、`:272-395` | writer-lock lifecycle 與 readonly gate |

這些狀態大多本來就可分離。問題是所有方法都可以碰到所有群組，新增功能必須理解整個 closure；沒有必要為分離而改動現有 Runtime 的呼叫介面。

尤其 config 每次 `recompute()` 會**替換物件**（`:120-131`、`:493-503`）。抽模組時若只傳初始化的 `config.modules[name]`，會引入設定快照過期，破壞 `/agents-guard on/off` 立即生效的契約。

### R3：I/O 與失敗邊界分散，接線責任不一致

- git-evidence 把 exec 放在 `guardedAsync` 內（`:397-452`）。
- writer-lock lifecycle 直接呼叫 fs helper，未經 guard（`:275-395`）；`writeJsonFileAtomic` 的 write／rename 例外會傳出（`src/state.ts:35-43`）。
- completion 的 `agent_settled` 先跑兩個 git 命令（`:611-625`），才進 Runtime 的 child／enabled／hadWrites 判定（`:454-463`）。

因此「有 guard helper」不代表「所有模組 I/O 都受 guard 保護」。這是已能從完整呼叫鏈確認的結構不一致，不應以統一命名掩蓋。

### R4：測試邊界沒有跟著接線複雜度擴展

- `test/integration.test.ts:5` 只 import `createRuntime` 與型別；全部 cases 直接呼叫 Runtime。
- 搜尋並讀取既有測試後，未見 default extension 註冊與事件 callback 的測試；與 `docs/design.md:628` 的 mock ExtensionAPI／Context 接線測試策略有落差。
- child writer-lock case（`test/integration.test.ts:409-420`）只把 `env.PI_SUBAGENT_CHILD` 設成 1，`writerLockDeps()` 的 self flag 仍是 false（`:247-254`）。它只斷言 return／放行，沒有檢查 lock 未被建立，故無法證明「完全跳過」。
- CI 執行 typecheck、Biome recommended、tests（`.github/workflows/ci.yml`）；目前沒有明確的結構性驗收。測試全綠只能證明既有斷言成立。

## 4. 修正邊界與替代方案

### A：只抽 registerXxxHooks

優點：移動較少，entry 變薄。缺點：400 行 Runtime closure、模組狀態與 I/O 混雜仍在；不解根因。可作遷移中的一步，但不作完成條件。

### B：漸進式責任拆分（已核准）

保留既有公開入口及 Runtime 方法，按狀態所有權逐批抽 controller。不是一次拆成十多個檔案：每次新增邊界都必須能獨立測試，且讓下一步修正更安全。

首批依賴方向：

```text
src/index.ts
  ├─ 原有 Runtime facade、設定、guard、小型 subagent 狀態與 hooks
  └─ runtime/writer-lock.ts（新：lock 狀態與 I/O 協調）
       ├─ modules/writer-lock.ts（既有：純決策）
       └─ state.ts（既有：檔案 I/O）
```

- 先補真正的 hook／command 測試，避免只靠 Runtime 單元測試搬接線。
- 第一個 production 新檔只有 `src/runtime/writer-lock.ts`：擁有 mode、session identity、cached lock、hash／mtime。傳入必要依賴及動態設定 getter，不傳整個 Runtime。
- `Runtime`／`RuntimeDeps`、config state、failureCounts、guard helper、小型 subagent observation 暫留 index；不預先建立 contracts.ts、configuration.ts 或 module-guard.ts。
- writer-lock 抽離後先處理獨立的鎖安全修正；不先花時間整理其餘模組的外觀。
- 鎖安全修正驗證通過後，再按需要新增 `src/runtime/completion-diff-recheck.ts` 與 `src/runtime/git-evidence.ts`。
- 最後才量測 entry；只有 command 或 hook 群仍需單獨理解／測試時，才抽 `command.ts` 或 hook adapter。這些檔案不是預定必建清單。
- 保留 `src/index.ts` exports 與 package entry，不以修改所有測試 import 來強迫換介面。

Controller 採 factory 閉包；不導入 DI container、plugin registry、event bus 或全域狀態容器。不把整個巨型 closure 原封搬到另一個檔案。

### C：通用模組註冊框架

優點：新增模組可能更容易。缺點：現在只有五個、生命週期又不對稱的模組，會新增抽象與動態分派；測試與除錯成本大於收益。本次不採用。

## 5. 建議修正順序（設計核准後才細化成可執行計畫）

### 步驟 1：先補可保護重構的接線測試

新增 `test/extension.test.ts` 與 `test/helpers/extension-harness.ts`：載入真正的 default export，用有型別的 fake API 記錄註冊 callbacks，並呼叫其真實 handler；不只測直接呼叫 Runtime。

必要 cases：

- 六個事件註冊存在且各一次：session_start、turn_end、session_shutdown、agent_settled、tool_call、tool_result。
- tool_call 的 block／pass、hard-deny 優先順序；不同 module 的關閉互不干擾。
- tool_result 先記錄原輸出，再附加 evidence；原有 content blocks 不被改寫。
- session_start 傳遞正確 cwd／sessionId，turn_end heartbeat，shutdown 釋放；takeover 使用最新 lastWorktree。
- status／on／off／save／takeover／unlock／未知命令，UI 與非 UI 輸出皆保留。
- completion 有／無 baseline、follow-up 預設關閉與上限；傳遞同一 AbortSignal。

測試只用 mock exec 與本測試建立的 temp state root，afterEach 精確清理；不觸碰真實 `~/.pi/agent`。既有 helper 留下暫存目錄是測試衛生問題，應在觸及該 fixture 時改用可追蹤、可清理的路徑，禁止掃描刪除他人的 temp dir。

既有正確行為的 characterization test 原本應綠；用暫時移除一個 hook 註冊／反轉 block／漏傳 signal 證明對應測試會紅，再還原。不要為配合 TDD 而把既有正確行為假裝成新功能。

### 步驟 2：優先抽 writer-lock，保留 facade 與 guard

只新增 `src/runtime/writer-lock.ts` 及 controller tests；原有 Runtime import、方法簽章與斷言保持。controller 不反向 import index。

init 拆成讀取／驗證現有 lock、純判定、套用決策三段，保留現有決策順序。使用動態設定 getter，測試 Runtime 建立後 on/off、以及 config 物件被替換後仍讀到新值。這一步不改 ownership 協定、child 事實來源或例外語意。

### 步驟 3：鎖安全檢查點（先於其餘模組搬移）

對 §6 的 acquire／takeover／heartbeat／release 問題建立精確重現，先形成獨立的安全修正規格與計畫。純重構驗收不代表安全修正完成。不得用 check-then-write 或單純 O_EXCL 取得，宣稱已解決所有接管後競態。

在安全契約、舊 lock 相容性、cross-process 同步方式尚未核准前，不實作新的鎖協定、不繼續搬其他模組，也不正式安裝 extension。

### 步驟 4：安全修正通過後，再依需要整理其他模組與 entry

先抽 completion／git-evidence 的協調邏輯，最後量測是否仍需 command／hook adapter；不強制將所有 helper 各拆一檔。

每次保持 package entry 與 Runtime 介面、單一 tool_result handler 及其附加順序。保留正式 UI／console 輸出，不為警告數量改變宿主 handler 回傳契約。

### 步驟 5：驗證與文件同步

更新 `docs/design.md` 的架構圖／目錄與 README 的責任說明，不覆寫過去 stage plan 的執行歷史。新增以下可追蹤的驗收記錄；若要增加 CI 閘門，須選可在 repo 環境重現的工具，不能硬編本機 pi-lens 路徑。

1. `npm test`、`npm run typecheck`、`npm run lint` 全部通過。
2. 既有 230 tests 不刪除／放寬斷言，新 hook tests 確實執行，不條件 skip。
3. module factory 不捕捉其他 module 的可變狀態；沒有相互 import 的 controller cycle。
4. 分批驗收責任轉移：首批 index 不再持有 lock 狀態／lock fs 細節；後續抽出 completion／git-evidence 後再驗收其狀態／命令細節歸屬。設定與小型 helper 允許留在 index。
5. 分別報告含 nested 與單一函式本體的複雜度。目標是 `initWriterLock` 不再單獨達原閾值 15；剩餘 aggregate 警告逐項解釋，不用提高門檻或全面 suppress 達標。
6. 不以「index 變短」代替第 3、4 項；確認沒有把整個 closure 原封搬到另一個巨型檔案。
7. 在完全隔離的 agent/state 環境做 pi entry 載入 smoke；完整 agent-turn 的未驗證項須明示。
8. 非 trivial 實作完成後，以唯讀 reviewer／codex-exec 雙角度審查 guard 邊界、狀態生命週期、接線相容性；主 agent 查證 findings。

以上步驟皆由單一 writer 依序執行。沒有新的 Git 授權時不 commit／push。

## 6. 行為缺口必須與純重構分開

以下是調查時確認的現有缺口／風險，不能藏在「行為不變」的重構裡修，也不能宣稱重構後就已解決：

| 項目 | 證據與影響 | 後續修正驗收 |
| --- | --- | --- |
| completion 的 disabled／child／無寫入仍執行 git | `src/index.ts:611-625` 在 `:454-463` gate 之前；exec throw 不在 module guard 內 | 增加 hook 層 RED tests，斷言零 exec；exec reject 由 module 邊界處理、可中斷；需獨立批准行為修正 |
| writer-lock lifecycle 例外未受 guard | `src/index.ts:275-395` → `src/state.ts:35-43` | 注入 fs failure，確認 fail-open／警告／三次停用契約與 lock 狀態一致；不只加外層 catch 就結案 |
| writer-lock child skip 測試不足 | `test/integration.test.ts:409-420` 的 env/self 不一致，沒有無 I/O 斷言；`src/index.ts:283-317` 先讀 lock 才作 child 決策 | 統一 child 事實來源，測 damaged lock 下 child 也不讀寫；這是另行修正的行為，純抽檔不得靜默變動 |
| lock 取得非互斥、接管後舊 holder 仍可改寫／刪除 | `src/state.ts:35-43` 只有 rename，`src/index.ts:371-380` 只依 cached ownership；規格 `docs/design.md:277` 要求 O_EXCL | 獨立處理 exclusive acquire、競態重讀、heartbeat/release 的 ownership fencing；用兩個競爭者 barrier 測試驗證，風險高於一般重構 |

優先級建議：對正式安裝而言，writer-lock ownership／競態應列為安全阻擋項，先查證與修正；不得用 230 tests 通過或 complexity 下降作為正式安裝安全保證。本輪沒有做真實跨 process race 測試，表中相關後果來自 source call-chain 分析。

## 7. 不變契約與 OpenSpec 路由

本 repo 沒有 `openspec/`，也沒有專案層 AGENTS.md／CLAUDE.md；CLI 存在（1.12.0）。本輪不自行初始化 OpenSpec、不建立已批准 change，沿用既有 `docs/plans/` 保存調查提案。

| 契約面 | 純重構方案約束 | 若包含 §6 修正 |
| --- | --- | --- |
| Public API | 保留 `src/index.ts` exports、Runtime/RuntimeDeps、commands/flags | 先定義是否需內部 preflight 新介面，不破壞舊呼叫者 |
| Data contract | config／lock JSON 與 tool result／card 內容不變 | ownership protocol 如改資料格式，需明確規格 |
| Schema | 不改 `src/types.ts` 的公開 schema | 獨立評估 lock token／generation |
| Migration | 不新增遷移 | 若 lock schema 更動需相容／遷移策略 |
| Backward compatibility | 舊 import、設定、狀態檔照用 | 明示舊 lock 處理方式 |
| Security / permissions | 保留 hard block 順序與 scope，不擴大 allow／deny | writer-lock 與 child gate 命中權限風險 |
| Concurrency / consistency | 不改 ownership、event order、reset/retry 語意 | 競態與失敗邊界需正式定義 |
| Cross-module behavior | guard counter 隔離、dynamic config、observation timing 保持 | 零 I/O／fail-open 變動需獨立驗收 |

若採用 OpenSpec，初始化將新增 `openspec/` 與 Pi 專案整合檔（`.pi/skills/`、`.pi/prompts/`）；必須先取得同意。初始化後，涉及權限／一致性的行為修正需從 Phase 1 規格開始，不能以小重構跳過。

## 8. 本輪驗證與後續核准

已實跑：

- `lsp_diagnostics src/index.ts` primary：無 TypeScript 錯誤。
- `npm test`：13 test files／230 tests 通過。
- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0，29 files checked。
- 使用目前同版 pi-lens 對歷史原文重測，並以跳過 nested functions 的 AST 探針驗證計量口徑。

本輪未新增程式測試、未做重構、未實機跑跨 process race；測試綠燈不作現有安全缺口的反證。

工作 checklist：

- [x] 確認 repo／規格／既有測試與版本基準。
- [x] 重現歷史複雜度並驗證量測口徑。
- [x] 追查狀態、I/O、guard 與 hook 呼叫鏈。
- [x] 提出三種替代方案與推薦切法。
- [x] 自審規劃範圍、相容性與驗收缺口。
- [x] 操作者核准漸進式 B：先測試、writer-lock、獨立安全修正，再評估其他拆分。
- [x] 首批 exact interfaces、測試與執行順序已整理至 `2026-09-09-progressive-b-writer-lock-plan.md`。
- [ ] 操作者審核首批實作計畫，之後才開始程式變更。
- [ ] writer-lock 抽離後，核准獨立安全契約／修正計畫；OpenSpec 初始化另需明確同意。

設計方向已核准，但不代表已授權 commit、push、安裝 extension 或初始化 OpenSpec。正式安裝前必須解決 writer-lock ownership／競態；不得將它當一般非阻擋殘餘項。
