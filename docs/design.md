# agents-guard 設計文件

- 日期：2026-09-09
- 狀態：writer-lock 維持 advisory；`refactor-runtime-coordination` 將 completion eligibility／failure／生命週期集中到專用 controller，並抽出 Git-evidence 協調器及 Pi adapter。其餘模組不作廣泛重構。本文件不表示已安裝或完成 CLI／跨平台驗收。
- 專案位置：`~/web/pi-agents-guard/`（獨立 repo，不影響 `~/.pi/agent` 的設定與結構）
- 目標宿主：pi coding agent（`@earendil-works/pi-coding-agent`），extension 形式

---

## 1. 背景與動機

`~/.pi/agent/AGENTS.md`（113 行、約 60 條規則）中有數條標記為 `MUST` 的防線，經實測盤點後確認**沒有任何機械強制**：

| 守則 | 內容 | 現況 |
|---|---|---|
| `AGENTS.md:56` / `:93` | 共用 worktree 只允許一個 writer | **零覆蓋** |
| `AGENTS.md:88` | subagent 派發前須列出可用 agent | 零覆蓋 |
| `AGENTS.md:91` | 高風險 review／audit 維持強模型 | 零覆蓋 |
| `AGENTS.md:92` | native options 不套用 external runner | 零覆蓋 |
| `AGENTS.md:52` / `:53` | commit／push 後須驗證 | 依賴 agent 自律 |
| `AGENTS.md:111` | 最終回報前重跑 `git diff --stat` | 依賴 agent 自律 |

已安裝的套件覆蓋範圍（2026-09-09 實測）：

- **pi-lens 4.1.4** 已覆蓋 `AGENTS.md:41`（read-before-edit 硬擋）與 `:40`（turn-end 診斷注入）。其 git-guard 只在 `--lens-guard` 開啟時、且僅以「未解決 blocker」為條件擋 commit/push，**不涵蓋授權問題**。
- **pi-guard 1.4.0** 已用於命令層權限，覆蓋 `AGENTS.md:49`／`:51`／`:54-55`。

### 1.1 決定性發現：pi-guard 的 `deny` 在互動模式不是硬擋

`pi-guard/src/handlers.ts:handleBashTool` 的流程：

```ts
const unauthorized = findUnauthorizedCommands(...);   // 判定式 action !== "allow" → deny 與 ask 一起收進來
if (!ctx.hasUI) return handleNonInteractiveBash(...); // 只有這條路徑區分 deny / ask
return handleInteractiveBash(...);                     // deny 與 ask 走同一個選單
```

實測（`hasUI: true`）：`cat .env`、`git add -A`、`sudo ls`、`npm publish` 設定值皆為 `deny`，但全部彈出 `[Allow, Always allow X (this session), Reject]` 選單，選 `Allow` 即放行。只有非互動情境（subagent child、`-p`、CI）的 `deny` 才回傳 `[Blocked by pi-guard: Security policy]`。

**結論**：pi-guard 在主 session 提供的是「人工確認」強度，不是機械強制。真正的 MUST 級硬擋必須由 extension 在 `tool_call` 直接 `return { block: true }`（不提供選項）。這是 agents-guard 存在的核心理由。

（附帶實測：選「Always allow cat (this session)」**不會**繞過 `cat **/*.env*` 這類帶路徑 glob 的 deny —— session rules 只加 base name，合併後 key 位置較前，last-match-wins 使 deny 仍勝出。可被繞過的只有單次 `Allow`。）

---

## 2. 範圍

### 2.1 納入（4 個模組）

| 模組 | 覆蓋守則 | 型態 |
|---|---|---|
| `writer-lock` | `:56`、`:93` | worktree／session 提醒，非互斥、非硬擋 |
| `subagent-policy` | `:88`、`:91`、`:92` | 硬擋 |
| `git-evidence` | `:52`、`:53` | 自動補證據（不阻擋） |
| `completion-diff-recheck` | `:111`、`:110` | 顯示卡片（預設）／可選追加一輪 |
| `hard-deny` | `:49`、`:51`、`:101` 的 MUST 部分 | 硬擋（不彈框、不給選項） |

### 2.2 明確排除

- `context-snapshot`（`:29`／`:30`）—— 會增加每個 turn 的 context 佔用，待核心穩定後評估
- `repeat-failure-guard`（`:100`）—— 需調參，誤擋合法重試的風險待驗證
- 所有 advisory-only 的 lint 規則（`:62`、`:45`、`:105`、`:42`、`:66`、`:70`）—— 屬另一個 `agents-lint` 專案的範圍
- 任何基於關鍵詞或意圖推測的閘門 —— 依 `AGENTS.md:69`，判定依據必須是環境事實

---

## 3. 架構

### 3.1 專案結構

以下列出主要結構；writer 詳細契約見 [canonical spec](../openspec/specs/writer-lock-safety/spec.md) 與 [歸檔設計](../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/design.md)。[舊鎖缺陷](plans/2026-09-09-writer-lock-safety-findings.md) 是歷史證據，不是本版互斥實作目標。

```
~/web/pi-agents-guard/
├── package.json                 # name: agents-guard, type: module, pi.extensions: ["./src/index.ts"]
├── tsconfig.json                # strict, ES2022, moduleResolution: bundler
├── vitest.config.ts
├── biome.json
├── README.md
├── docs/
│   └── design.md                # 本文件
├── src/
│   ├── index.ts                 # createRuntime、config / failure owner、root type exports / default
│   ├── extension.ts             # 注入 factory；Pi hooks / command / flag / config load / 顯示
│   ├── config.ts                # 開關解析與 provenance
│   ├── state.ts                 # state 目錄路徑 + 原子讀寫
│   ├── types.ts                 # 共用型別
│   ├── lib/
│   │   ├── bash.ts              # shell AST 與命令解析
│   │   ├── paths.ts             # 路徑解析
│   │   └── git.ts               # worktree 偵測（注入 exec）
│   ├── runtime/
│   │   ├── contracts.ts         # type-only Runtime / RuntimeDeps / CompletionCheck / Notice
│   │   ├── completion-diff-recheck.ts # facts / lifecycle / collect / 單次 finish
│   │   ├── git-evidence.ts      # exec 次序 / 每次 options / evidence 組合
│   │   └── writer-lock.ts       # 自身 presence、提示去重、動態設定 getter
│   └── modules/
│       ├── hard-deny.ts
│       ├── writer-lock.ts
│       ├── subagent-policy.ts
│       ├── git-evidence.ts
│       └── completion-diff-recheck.ts
└── test/
    ├── helpers/extension-harness.ts # 呼叫真正 entry 註冊的 handlers
    ├── extension.test.ts        # hook / command / signal / lifecycle 接線
    ├── writer-lock-runtime.test.ts # controller 狀態與檔案行為
    ├── completion-diff-recheck-runtime.test.ts # direct controller / 真實 Git
    ├── git-evidence-runtime.test.ts # query trace / options 取得時點
    ├── config.test.ts
    ├── writer-lock.test.ts
    ├── subagent-policy.test.ts
    ├── git-evidence.test.ts
    ├── completion-diff-recheck.test.ts
    └── integration.test.ts
```

### 3.2 模組契約

每個模組匯出**純函式決策核心**，與 pi API 完全解耦：

```ts
// 決策結果的統一形狀
type Decision =
  | { kind: "pass" }
  | { kind: "block"; reason: string }
  | { kind: "augment"; append: string }        // git-evidence 用
  | { kind: "notify"; level: "info" | "warning" | "error"; message: string };

// 每個模組的核心判定都是這個形狀：輸入 → 決策，無 I/O、無副作用
type Decide<Input, State> = (input: Input, state: State, now: number) => Decision;
```

`Decision` 是**hook 層的統一決策形狀**。模組內部允許有更表達性的中間型別（`WriterReport`、`WriterNotice`、`RecheckResult`），由該模組的 wrapper 負責轉換為 `Decision`。轉換函式同樣是純函式，同樣納入測試。

Runtime 是 config／provenance／failureCounts 的唯一 owner，組合專用 controllers；純 modules 不做 I/O。`index.ts` 保留 createRuntime、既有 Runtime／RuntimeDeps 匯入位置及同步方法，type-only 宣告移至 contracts 並由 root 重匯出。新增 `collectCompletionDiff(cwd, signal?)` 與 `shutdownCompletion()`，不增加 RuntimeDeps 必填欄位；同步 `checkCompletionDiff` 仍零 Git I/O。

`registerAgentsGuard(pi, makeRuntime)` 只負責 Pi 接線／顯示，Runtime 按首次需要 lazy 建立一次；root default 以 createRuntime 委派。Adapter 不反向 value-import index，controllers 不互相匯入、不持有 Pi instance；沒有通用 registry 或 event bus。Completion／evidence 的 exec 在建立時固定注入，policy／options 透過 live getters 讀取，不提供 executor hot-swap 契約。

writer 的 `inspectWorktree` 是新增非同步快照入口；`createPresenceFiles` 提供同步 own-only 檔案操作。Runtime 的本機 revision 在 refresh、實際身分變更、相容 init、停用或 release 時使舊 await 失效，回來後再驗開關／child／revision；不是跨程序 fencing。tool_call 移除 writer 分支，保留 hard-deny → subagent-policy 短路順序。舊同步相容方法保留，isReadonly 固定 false、checkReadonlyCall 固定 pass。

### 3.3 hook 使用一覽

| Hook | 模組 | 用途 |
|---|---|---|
| `session_start` | writer-lock | 啟用的 foreground 檢查位置、登記自身、掃 peer、去重提示 |
| `turn_end` | writer-lock | 僅更新已知自身記錄、drain notice；無 Git／peer scan |
| `session_shutdown` | completion → writer-lock | 先終止 completion，再清理自身 presence／drain notice |
| `tool_call` | writer-lock | 無 I/O、提示或寫入 gate |
| `tool_call` | **hard-deny** | 硬擋絕不該發生的命令與寫入（含 shell 重導向目標解析） |
| `tool_call` | subagent-policy | 檢查 `subagent` 派發參數 |
| `tool_result` | subagent-policy | 記錄 `{action:"list", capabilities:true}` 已完成 |
| `tool_result` | git-evidence | 偵測成功的 commit／push，附加驗證證據 |
| `tool_result` | completion-diff-recheck | 記錄成功寫入與原始 porcelain 觀察，先於 evidence await／append |
| `agent_settled` | completion-diff-recheck | eligibility → collect → 單次同步 finish → 顯示／可選跟進 |

以上為同一 adapter 的六種事件各一次註冊（表格按模組拆列），另有一個 agents-guard command。`agent_settled` 表示執行穩定結束，沒有自動重試、compaction 或 queued continuation，不等於每一個 turn_end。

---

## 4. 開關機制

### 4.1 兩級粒度

- **整體**：`enabled: boolean`
- **每模組**：`modules.writerLock.enabled`、`modules.subagentPolicy.enabled`、`modules.gitEvidence.enabled`、`modules.completionDiffRecheck.enabled`

### 4.2 四層來源，後者覆寫前者

| 層 | 來源 | 生效時機 |
|---|---|---|
| 1 | 內建預設（4 模組全啟用） | — |
| 2 | `~/.pi/agent/state/agents-guard/config.json` | extension 載入時 |
| 3 | 環境變數 `AGENTS_GUARD`（`"off"` 或 JSON 物件） | extension 載入時 |
| 4 | CLI flag `--agents-guard=off\|writer-lock,git-evidence` | 啟動時 |
| 5 | `/agents-guard` 命令（in-memory） | **立即生效，不需 `/reload`** |

`AGENTS_GUARD` 與 flag 的簡寫語意：
- `off` → 整體停用（等同 `{ enabled: false }`）
- `writer-lock,git-evidence` → 只啟用列出的模組，其餘停用
- JSON 物件（僅 env 支援）→ 與較低層做**深度合併**（per-key 覆寫），不是整層取代。未出現的 key 保留較低層的值。同一 key 出現在多層時，較高層勝出。

### 4.3 命令介面

```
/agents-guard                      # 狀態總覽：每模組 啟用/停用 + 生效來源(provenance)
/agents-guard on | off             # 整體
/agents-guard on <module>          # 單模組，module ∈ {writer-lock, subagent-policy,
/agents-guard off <module>         #                  git-evidence, completion-diff-recheck}
/agents-guard save                 # 明確持久化當前 in-memory 狀態到 config.json
/agents-guard takeover             # deprecated：只顯示不需接管的相容提示
/agents-guard unlock               # deprecated：只顯示提示，不移除記錄
```

writer 啟用時，空命令／status 以目前 ctx 的 cwd／session 重查再合併成一份輸出；停用／child 不做 writer I/O。on／on writer-lock 僅有效 false→true 重查；off 清理自身。狀態總覽輸出每個模組的**生效來源**（例如 `writer-lock: enabled (source: default)`、`git-evidence: disabled (source: /agents-guard command)`），仿 pi-lens `effective_config` 的可追溯精神。

### 4.4 五個設計原則（全部源自 pi-guard 實測教訓）

1. **`config.json` 只寫操作者明確設定過的欄位**，絕不把預設值序列化寫回。
   - 對照：pi-guard 的 `saveConfig` 會把 in-memory 的 `DEFAULT_CONFIG.matchers` 顯式寫入檔案，把 matcher 集合凍結在當時版本（陷阱 A 復發風險）。
2. **開關變更立即生效**（改 in-memory），只有 `save` 落盤。
   - 對照：pi-guard 的 `/guard disable` 會同時改狀態並寫檔，操作者無法只做暫時變更。
3. **不使用 `"*"` 這類依賴 key 插入順序的規則結構。**
   - 對照：pi-guard 的 `mergeLayerRules` 用 spread 合併，`"*"` 永遠停在索引 0，導致用 `"*"` 收緊權限完全無效（陷阱 B）。
4. **阻擋一律 `return { block: true, reason }`，不彈確認框。** writer 僅提示，不用 `ctx.ui.confirm`；takeover 不再是權限操作。
   - 對照：pi-guard 陷阱 D —— 互動模式下 `deny` 退化成可一鍵放行的 `ask`。
5. **既有模組的 fail-open 目標不變。** writer 預期 I/O 錯誤另存為去重診斷，不走三次自動停用。其他模組內部異常時放行，並 `notify`（一次性去重）+ widget 標示「模組異常」+ 寫 log。同一模組異常累計 3 次即自動停用該模組並提示。
   - 理由：pi 平台對 `tool_call` handler 拋錯是 fail-safe（會擋掉工具），因此必須明確 catch 才不會讓一個 bug 癱瘓整個 session；且依 `AGENTS.md` 的取捨，誤擋成本高於漏擋。

---

## 5. 模組詳細設計

### 5.1 writer-lock（`AGENTS.md:56`、`:93`）

**目的**：協助人工確認 worktree、既有修改及可能重複開啟的 session。**advisory（不鎖定寫入）**，不是互斥、權限或程序停止證據。

**快照**：`inspectWorktree` 以 `git --no-optional-locks` 的參數陣列依序查 inside-work-tree、toplevel、symbolic-ref、porcelain status，總查詢預算兩秒並傳遞 timeout／signal。root 經 realpath 正規化；branch 包含 detached／unknown，dirty 包含 tracked 與非 ignored untracked。一般 Git 錯誤是 unknown，不冒充非 Git；保留部分已知欄位，不列檔名或 stderr。不保證 SDK 於兩秒內停止所有程序。

**存在記錄**：`state/agents-guard/presence/<full SHA-256(canonical root)>/<instance UUID>.json`；schema v1 包含 instanceId、sessionId、pid、host、root、startedAt、lastSeenAt（實際 root 欄位為 worktreeRoot）。同 namespace／host／root 的其他 instance 才是 peer；相同 PID 或 sessionId 不等於自身。四小時 heartbeatTimeoutMs 只是新鮮度；過期／時間倒置／超前五秒仍保留為 uncertain，無 PID 探測或接管。

**生命週期**：啟動、空命令／status、有效停用→啟用時完整檢查。turn_end 只更新成功建立且仍符合身分的自身記錄、drain 待送診斷；不跑 Git／掃 peer／重建遺失記錄。停用、shutdown、位置／身分改變或 unknown 時停止舊記錄更新，盡力 own-only 清理。相同 sessionId 不重建；失去歸屬後下一次完整檢查才換 UUID。

**去重**：自動 signature 包含 session、位置、branch、dirty、排序 peers／freshness／原因，不含 heartbeat 或檢查時間。status 每次 fresh 回應且不重設自動去重。訊息轉義控制字元、單欄位最多 256 code points、最多列五個 peer。無 peer 僅說「本次未觀察到其他參與記錄」，不能推論無其他 writer。輸出失敗不引發 follow-up 或阻擋。

**相容**：保留 writer-lock 名稱、開關與同步 Runtime 方法；新增 refreshWriterNotice 及 takeWriterNotice。blockedTools／blockedGitSubcommands 已 deprecated，仍可載入與 save，但不影響任何工具決策。takeover／unlock 只顯示提示，無 Git／檔案／程序副作用。不存在 authorizer 整合、唯讀模式或 SQLite。

**遷移**：v1 locks 只對匹配的 canonical root 做存在探測，絕不解析為權威、轉換、覆寫或刪除。混版不構成安全協調；先停止舊版 session，再另行核准 reload／安裝。回退會恢復舊版阻擋與 ownership 缺陷。

**測試**：純 schema／peer／signature、實際暫存 Git/fs、有界與 own-only 故障注入、實際 default-export hook harness；驗證 peer／dirty／invalid 下不新增 block，其他政策仍生效。CLI、最低 Node 與 Linux／CI 必須另列覆蓋。

---

### 5.1b hard-deny（`AGENTS.md:49`、`:51`、`:101` 的 MUST 部分）

**目的**：補上 2026-09-09 實測確認的兩個權限層缺口，讓 MUST 級操作**不彈框、不給選項**地被擋下。

**為什麼需要**（皆為實測，不是推測）：

| 缺口 | 證據 |
|---|---|
| pi-guard 的 `deny` 在互動模式退化為可一鍵放行的 `ask` | `handlers.ts` 的 `findUnauthorizedCommands` 把 deny 與 ask 一起收進 `unauthorizedCommands`，互動路徑一律彈出含 `Allow` 的選單（含真實 TUI 截圖佐證） |
| shell 重導向目標不被視為寫入 | `pi-guard/src/extract.ts:290-304` 的 `collectRedirect` 只呼叫 `collectWord` 找嵌套命令。實測 `echo {} > ~/.pi/agent/settings.json` **通過** |

**關鍵實作發現**：pi-guard 使用的 `unbash` parser **本身就提供 redirect 節點**（`extract.ts` import `Redirect` 型別、存取 `redirect.target`），pi-guard 只是沒把 target 當成寫入路徑。因此本模組可直接用 `unbash` 取得重導向目標，**不需要自行實作 bash parser** —— 這也避免重演 MasuRii 版「整串字串正則、複合命令全漏」的錯誤（見 `docs/permission-systems-comparison.md` §3）。

**判定核心（純函式）**：

```ts
function decideHardDeny(
  toolName: string,
  input: Record<string, unknown>,
  opts: HardDenyOptions,
  fs: { realpathSync: (p: string) => string },   // 注入以便測試 symlink
): Decision;
```

**三類判定**：

1. **命令層**：以 `unbash` 解析，逐一檢查每個 sub-command（含 `&&`／`;`／`|`／subshell／command substitution／wrapper 展開）。命中清單即 `block`。
   - 預設清單：`git add -A|--all|.`、`git commit -a*`、`git push --force*|-f|--delete`、`sudo`、`npm publish`、`gh release delete`、`crontab`、`at`、`chown`
2. **寫入目標層**：從每個 sub-command 抽出寫入路徑 —— **重導向目標（`>`／`>>`／`>|`／`&>`）**、`tee`／`cp`／`mv`／`ln` 的目的端、`sed -i` 的目標。經 `realpath` 正規化後比對受保護路徑清單，命中即 `block`。
3. **工具層**：`write`／`edit`／`ast_grep_replace` 的 `path` 參數，同樣經 `realpath` 後比對受保護路徑。

**受保護路徑清單（預設）**：

| 類別 | 路徑 |
|---|---|
| pi 設定與程式碼 | `<agentDir>/settings.json`、`AGENTS.md`、`SYSTEM.md`、`APPEND_SYSTEM.md`、`keybindings.json`、`npm/**`、`extensions/**`、`auth.json`、`trust.json` |
| agents-guard 自身 state | `<agentDir>/state/agents-guard/**`（§5.6 第 2 層） |
| 專案層 pi 設定 | 任何 `**/.pi/settings.json`、`**/.pi/extensions/**` |
| shell 啟動檔 | `~/.zshrc`、`.bashrc`、`.bash_profile`、`.profile`、`.zshenv` |
| git hooks | `**/.git/hooks/**` |
| 密鑰 | `**/.env*`、`**/*.pem`、`**/id_rsa*`、`**/.netrc`、`**/.npmrc` |

`realpath` 正規化是刻意的：pi-guard 沒有 symlink 解析，`ln -s ~/.pi/agent/settings.json /tmp/s && echo x > /tmp/s` 可繞過純字串比對。

**與 pi-guard 的關係（刻意重疊）**：本模組的清單與 pi-guard 的 `deny` 規則故意重疊，形成雙層防護。理由是 hard-deny 的價值就在「不依賴 pi-guard」—— 權限層日後換成 `@gotgenes/pi-permission-system`（其 `deny` 為真硬擋且有 `redirect-analysis.ts`）時，本模組可整個移除，其他四個模組完全不動。

**載入順序要求（實作階段必須實測）**：`tool_call` handler 依 extension load order 執行。agents-guard 必須**先於** pi-guard 執行，否則會出現「pi-guard 先彈框、操作者按了 Allow、agents-guard 才擋下」的糟糕體驗。實測方式：在兩者的 handler 加暫時性 log，觀察觸發順序，並確認 `packages` 陣列與 `extensions` 陣列的相對優先。

**誤判防護**：
- 只擋清單內項目，其餘一律 `pass`（不做任何「可疑則擋」的推測）
- 清單完全可由 config 覆寫（`modules.hardDeny.commands`／`protectedPaths`）
- `realpath` 對不存在的路徑會拋錯 → 退回未解析的絕對路徑比對，並記錄
- 解析失敗（unbash 拋錯）→ **fail-open + 警告**，與其他模組一致（§4.4 原則 5）。理由：hard-deny 是補強層，pi-guard 仍在下游；讓一個解析 bug 癱瘓所有 bash 是更差的結果

**測試案例**：
- 六種複合命令形式（`&&`、`;`、`|`、`$()`、`bash -c`、`find -exec`）各自命中 → block（這組正是 MasuRii 版全部漏掉的案例）
- `echo x > <protected>`、`>> `、`&> `、`tee <protected>`、`cp a <protected>`、`sed -i <protected>` → block
- `ln -s <protected> /tmp/alias && echo x > /tmp/alias` → block（symlink 解析）
- `echo x > /tmp/ok.txt`、`write src/index.ts` → pass（合法變體）
- unbash 解析失敗 → pass + 警告（fail-open 驗證）
- config 覆寫清單後行為隨之改變

---

### 5.2 subagent-policy（`AGENTS.md:88`、`:91`、`:92`）

**目的**：擋掉三類明確違規的 subagent 派發。判定完全基於呼叫參數與 session 事實，零語意推測。

**判定核心（純函式）**：

```ts
function decideSubagentCall(
  input: Record<string, unknown>,           // subagent tool 的 input
  facts: { capabilitiesListed: boolean },   // session 事實
  opts: {
    weakModelPatterns: string[];            // 預設 ["haiku","mini","flash","lite","small"]
    externalCliAgents: string[];            // 預設 codex-exec(-writer), claude-code(-writer), cursor-agent(-writer)
    nativeOnlyOptions: string[];            // 預設 model, context, acceptance, outputSchema, toolBudget, fast, skill, mission
    reviewIntentPatterns: string[];         // 預設 ["review","audit","security","threat"]
  },
): Decision;
```

**三條規則**：

1. **`:88` 派發前置檢查** —— 若為**執行型**呼叫（含 `agent`／`workflowScript`／`workflowScriptPath`／`workflow` 且**不含** `action`）且 `facts.capabilitiesListed === false` → block，reason 指示先跑 `{action:"list", capabilities:true}`。
   - `action` 型呼叫（管理／控制）全部放行，不受此規則約束。
   - `facts.capabilitiesListed` 由 `tool_result` 觀察：`toolName === "subagent"`、`input.action === "list"`、`input.capabilities === true`、`isError !== true`。
   - **在 subagent child session 中停用此規則**（`facts.isSubagentChild === true`）。理由：child 的 agent 選擇已由 parent 的 brief 決定，要求 child 再自行 list 一次沒有下游消費者，只會造成摩擦。規則 2、3 是純參數檢查、無 session 事實依賴，在 child 中**仍然啟用**。
2. **`:91` 高風險不得降級** —— 若 `agent` 名稱或 `task` 命中 `reviewIntentPatterns`，且 `model` 命中 `weakModelPatterns` → block。
3. **`:92` external runner 不吃 native options** —— 若 `agent` ∈ `externalCliAgents`，且 input 含任一 `nativeOnlyOptions` → block，reason 列出違規欄位名。

**必須自建 `tool_call` 攔截（已驗證的限制，非設計選擇）**：`@gotgenes/pi-permission-system` 的 authorizer link 收到的 `PromptPermissionDetails`（`src/authority/permission-prompter.ts:48`）與 `PromptPayload`（`src/presentation/prompt-payload.ts:49`）**不含原始 tool input** —— 只有 `toolName`、`value`（command／path／MCP target／skill name）、`matchedPattern` 等顯示層事實，以及可截斷的 `toolInputPreview`。本模組要檢查的是 `input.agent`／`input.model`／`input.acceptance`／`input.action` 等欄位，因此無法透過該 seam 實作。詳見 `docs/pi-permission-system-evaluation.md` §5.2。

**誤判防護**：
- 規則 2 只在**明確指定了 `model`** 時觸發（未指定 → 用 agent 預設 → 不干涉）
- 規則 3 逐欄位列出，讓 agent 知道要移除哪些
- 三個 pattern 清單皆可由 config 覆寫（`weakModelPatterns` 等）

**測試案例**：每條規則各有「觸發→擋下」與「合法變體→放行」；`action:"list"` 放行；先 list 再派發放行；review 但未指定 model 放行；external agent 不帶 native options 放行。

---

### 5.3 git-evidence（`AGENTS.md:52`、`:53`）

**目的**：把「commit／push 後應該做的驗證」變成自動附加的環境事實。**不阻擋任何操作。**

**偵測（純函式）**：

```ts
function detectGitEvents(command: string, isError: boolean): GitEvent[];
```

Pi bash tool_result 提供 isError，而非數字 exitCode。只有成功工具結果才偵測事件；使用既有 AST 解析（避開 `echo "git push"`），複合命令可依序回傳 commit 與 push 多事件，解析失敗回空陣列。

**附加內容**：

| 事件 | 執行的驗證命令 | 附加到 tool_result 的內容 |
|---|---|---|
| commit | `git log -1 --format=%H %d %s` | 新 commit 的 SHA、ref、標題 |
| push | `git rev-parse HEAD`、`git rev-parse @{u}` | 本地／遠端 SHA 與是否一致的明確結論 |
| push（`gh` 可用時） | `gh run list -L 3` | 最近 CI 執行狀態 |

**附加方式**：在 `tool_result` handler 回傳 `{ content: [...event.content, { type: "text", text: evidence }] }` —— 於 content 陣列**尾端新增一個 text block**，不修改原有 block，也不動 `details`。

附加格式（明確標示來源，避免與原輸出混淆）：

```
--- [agents-guard] commit 驗證 ---
HEAD: a1b2c3d (HEAD -> main) fix: …
```

**協調／成本與保留限制**：
- Runtime 在呼叫開始時以既有 guardedAsync 檢查 enabled／inert；不套用 completion 的 child／closed／generation gate。中途 off 不停止已開始的流程，下一次呼叫才跳過。
- 每次偵測到事件的 augment 呼叫在第一個 await 前讀一次 options 參考，依 detector 順序組合各事件的證據；後續呼叫讀新的 options。不是 clone／freeze，也不保證外部原地 mutation 同一 options object 的隔離。
- commit 一個 Git 查詢，push 依序 HEAD→upstream→（checkCi 時）gh；複合命令可能有多個事件，不是整次固定最多三個查詢。每次傳相同 signal，但不保證外部程序立即停止。
- cwd 固定為 Runtime 首次建立時的 resolver.cwd；不跟隨之後 ctx.cwd，不解析 shell `cd`／`git -C`／多 repo 實際位置。`@{u}` 是本地 tracking ref，沒有 fetch 或遠端即時確認；gh list 也不等於已追到本次 push 的 CI 結論。
- upstream 非零為 null，明示略過比較；gh 非零／throw 降級為「未檢查 CI（gh 不可用）」。其他 exec throw 回原 Runtime guard；log／HEAD 沿用 stdout，沒有新增非零／killed 驗證，也沒有套用 completion 的 killed 規則。
- `maxAppendBytes` 預設 2048，現行按 UTF-16 `.length`／`.slice` 計量，不是真正 byte budget；截斷後另附說明。文案及此限制均未改成新協定。

**測試案例**：純 detector／formatter、direct coordinator 的完整 argv／順序／cwd／signal／options A→B 時點，以及 Runtime enabled／failure ownership；actual registered hook 保留原 content／image blocks 後 append。注入的 gh／killed／取消資料不等於真實 subprocess 或 CI 驗收。

---

### 5.4 completion-diff-recheck（`AGENTS.md:111`、`:110`）

**目的**：在穩定的 `agent_settled` 邊界重新確認 Git 狀態，捕捉工具完成後 formatter／外部修改；不擋工具，不自動 commit。

**Owner 與觀察**：專用 controller 每 instance 持有 hadWrites、observedPorcelain、followUpCount、generation 與 closed。成功 write／edit／ast_grep_replace 在 session 任一回合發生即可，不限最後一回合；成功的 porcelain status command 只取原 content 第一個有效 text 作 baseline，人類可讀 status 不算。停用期間仍觀察，重新啟用保留 facts；附加 evidence 永不作 baseline。只有新 Runtime 才獲得獨立 facts／預算，writer setSessionId／init／release 不重設 completion。

**零 I/O eligibility**：全域／completion 停用、inert、env child、無成功寫入、closed 或已 aborted 時，第一個 completion Git 前即返回；沒有 card／follow-up。這不限制其他模組的 I/O。

**兩階段採用**：
1. `collect(cwd, signal?)` 捕捉 generation，在 try 邊界內依序查 `git status --porcelain`、`git diff --stat`，均使用事件 cwd／同一 signal；每次 await 後重驗 current。
2. 成功只回傳 CompletionCheck，不改 baseline、不預扣配額。adapter 恢復後立即呼叫同步 `finish()`；先標記 consumed，再驗 current、讀當下觀察／options、呼叫純 decideRecheck、組卡，最後才增加跟進請求計數。
3. finish 永遠只可使用一次；重疊 collect 不互斥、不採 latest-request-wins，依 finish 執行順序共用配額。原同步 `Runtime.checkCompletionDiff` 也共用此判斷與上限，且不做 Git。
4. 有結果時同步依序 appendEntry→emit→optional sendMessage，沒有中途 await／timer／排程 callback。appendEntry 是不進 LLM context 的記錄；emit 用 UI notify 或非互動 console。follow-up 以 `agents-guard-diff-followup` 與 `{ deliverAs: "followUp", triggerTurn: true }` 請求模型跟進，不新增自定義 TUI component。

**純判定與顯示**：decideRecheck(observed, actual, facts, options) 不接收 diff-stat，stat 僅供附加顯示。空字串與 `(no output)` 等價；忽略空白行／行尾空白，但不是內容雜湊。無 baseline 且 dirty→提醒、不 follow-up；無 baseline 且 clean 或快照相同→無輸出。有 baseline 且不同（包含 dirty→clean）才比較 `config.modules["completion-diff-recheck"].followUp`（預設 false）及 maxFollowUpsPerSession（預設 2），滿足才請求跟進。

**生命週期與查詢可信度**：
- 有效 global／completion 開關 transition 才 invalidate；重複 on／off 或無關模組切換不影響 generation。off→on 不復活舊 collect／finish；停用與失效不清除 facts。
- shutdown 先令 completion terminal closed，再清理 writer；同一 Runtime 不能靠 on 復活。abort 只失效該 signal 的工作；每次 await 後及 finish 前都需有效，不保證已啟動的程序立即停止。
- status 非零或 killed：不用 stdout、不查 stat。stat 正常非零：保留成功 status、略去統計；stat killed：整次放棄。失敗或取消不冒充乾淨。
- 尚有效時的 unexpected rejection／比較或組卡錯誤，每次最多記一個 completion failure；失效後晚到的 rejection 不污染計數，失敗不改 baseline／扣配額。三次後由 Runtime 的唯一 map 令其 inert，成功或 on 不歸零；固定安全診斷先計數再 log，壞 logger 亦被隔離。

**限制**：porcelain 相同不代表內容未再修改，例如已是 `M` 的檔案繼續變動可能無提醒；status／stat 也非原子快照。有效 finish 消耗的是跟進「請求」配額，不是 UI／模型端 exactly-once 送達；Pi 輸出部分失敗不回滾、不重試。沒有持久 completion state、timeout、排程器或程序停止協定。

**證據分層**：direct controller／同步與 async Runtime、registered hooks 的 eligibility／deferred await／最終 finish 窗口／單次採用／共享配額／安全故障注入；自建 Git repo 實測未追蹤檔案新增與 dirty→clean，wrong-repo 控制會失敗。它們不等於完整 SDK／CLI 或取消程序驗收。

---

### 5.5 subagent child 情境處理

這是自審階段發現的設計缺口，必須明確處理，否則 agents-guard 一啟用就會癱瘓所有 subagent 派發。

**環境事實（2026-09-09 實測）**：

- `PI_SUBAGENT_CHILD=1` 由 pi-subagents 設定，標示 child process（`pi-subagents/src/runs/shared/child-runtime-config.ts:15`）
- 依 `pi-subagents/docs/watchdog.md:154`：**foreground children 是 parent process 內的 pi session**，background children 在 detached runner process
- 背景 children 會把全域 extension 當 ambient extension 撿到，因此 agents-guard **會**在 child 中被載入

**兩種 child 的識別與處理**：

| child 型態 | 識別方式 | writer-lock 行為 |
|---|---|---|
| 明確 child | `process.env.PI_SUBAGENT_CHILD === "1"` | 在 writer Git／presence I/O 前完全跳過 |
| 未設 child flag 的 session | 不以 PID／sessionId 推定 parent-child | 各有獨立 instance；同 root／host 可提示 peer，但不阻擋 |

env 是唯一 child 事實；Runtime 不採信相反的 injected self flag。舊 share 語意已移除，沒有 session 可因此刪除另一 instance 的記錄。worktree 隔離仍是人工並行紀律，不由提醒模組保證。

**各模組在 child 中的啟用狀態**：

| 模組 | 在 child 中 | 理由 |
|---|---|---|
| writer-lock | child flag 時跳過，否則獨立登記 | 不阻擋寫入、不共享記錄歸屬 |
| subagent-policy | 規則 1 停用；規則 2、3 啟用 | 規則 1 依賴 session 事實且無下游消費者；2、3 是純參數檢查 |
| git-evidence | 啟用 | 加值不阻擋，child 的 commit/push 同樣需要證據 |
| completion-diff-recheck | **在第一個 completion Git 前跳過** | env child 的收尾由 parent 彙整；零 completion Git／card／follow-up，非所有模組零 I/O |

**測試案例**：child 的 writer exec／files 零呼叫；同 PID 或 sessionId 的別 instance 可提醒但不阻擋，shutdown 不移除別人記錄。subagent-policy 的 child 政策不變；completion 另驗收收尾時 exec 零呼叫，不只檢查沒有卡片。

---

### 5.6 state 完整性與自我保護（自審發現的缺口）

**威脅模型**：保留 hard-deny 對自身 state 的工具／shell 重導向保護；presence 只提供非破壞性觀察，不授予 writer 權限。這不是針對惡意同使用者路徑替換 race 的安全邊界，真正邊界仍是 OS 權限／sandbox。

- schema 檢查 version、合法 UUID、非空身分、絕對 root、正整數 pid、有限非負時間；invalid／超量／I/O 故障均明示資訊不完整，不阻擋。
- scan 最多 256 個項目，`.tmp-<UUID>` 也計入；regular file 用 fd 最多讀 16 KiB＋1 byte 判斷超限並 finally close，不先 stat 後無界 readFile。不跟隨 presence 目錄／leaf symlink，檔名與 record.instanceId 不符也無效。
- 只有成功 create 的 handle 才能 update/remove；先核對 instanceId、sessionId、host、pid、worktreeRoot。缺失、損壞或被替換時放棄，不覆寫／刪別人，不清目錄或 peer。
- 新目錄 0700／檔案 0600；tmp 必須由本呼叫 wx 成功建立才可清理。link 不支援只回診斷，不改用覆寫 fallback。
- v1 lock 只 lstat；從未成為本版 ownership 證據，也無 mtime tampered→readonly 行為。清理失敗診斷不因新根目錄登記成功而被抹掉。

**測試案例**：真實 bytes／mode／fd 關閉檢查、五個 immutable identity 欄位逐一替換、EACCES／rename／link／cleanup 注入、symlink／尺寸／scan cap、legacy bytes 不變；hard-deny 既有 state 路徑測試保留。

---

## 6. 狀態儲存

### 6.1 目錄

```
~/.pi/agent/state/agents-guard/
├── config.json              # 只含操作者明確設定的欄位
├── presence/<full-root-hash>/<instance UUID>.json # 每個 instance 一筆
└── locks/<prefix16-hash>.json # 可能殘留的 v1，只探測，不遷移／修改
```

**Extension state 僅限 `state/agents-guard/` 子樹**。本輪測試用自建暫存根；未修改真實 `settings.json`、`AGENTS.md` 或安裝設定。啟用本版仍需獨立授權。

### 6.2 config.json schema

```jsonc
{
  "version": 1,
  "enabled": true,                           // 選填
  "modules": {                               // 選填，只列要覆寫的
    "writer-lock": {
      "enabled": true,
      "heartbeatTimeoutMs": 14400000,          // 4h，只是新鮮度
      "blockedGitSubcommands": [               // deprecated，保留但不阻擋
        "checkout", "switch", "rebase", "merge", "reset", "stash",
        "restore", "clean", "apply", "cherry-pick", "revert", "commit"
      ],
      "blockedTools": ["write", "edit", "ast_grep_replace"]   // deprecated，無阻擋作用
    },
    "subagentPolicy": {
      "enabled": true,
      "weakModelPatterns": ["haiku", "mini", "flash", "lite", "small"],
      "externalCliAgents": [
        "codex-exec", "codex-exec-writer", "claude-code", "claude-code-writer",
        "cursor-agent", "cursor-agent-writer"
      ],
      "nativeOnlyOptions": [
        "model", "context", "acceptance", "outputSchema",
        "toolBudget", "fast", "skill", "mission"
      ],
      "reviewIntentPatterns": ["review", "audit", "security", "threat"]
    },
    "hardDeny": {
      "enabled": true,
      "commands": [                            // 選填，覆寫預設清單
        "git add -A", "git add --all", "git add .", "git commit -a*",
        "git push --force*", "git push -f", "git push --delete",
        "sudo", "npm publish", "gh release delete", "crontab", "at", "chown"
      ],
      "protectedPaths": ["…見 §5.1b 表格…"]    // 選填
    },
    "gitEvidence": { "enabled": true, "maxAppendBytes": 2048, "checkCi": true },
    "completionDiffRecheck": { "enabled": true, "followUp": false, "maxFollowUpsPerSession": 2 }
  }
}
```

### 6.3 原子寫入

config 儲存 helper 不變。presence 初次以 wx／0600 建立完整 tmp，再用 link 不覆寫發布；更新先驗自身 immutable identity，再 tmp＋rename。只清理由該呼叫成功建立的 tmp，發布成功但 tmp 清理失敗仍保留自身 handle 並報診斷。不是 writer 取得協定。

---

## 7. 錯誤處理

| 情境 | 行為 |
|---|---|
| `config.json` 損壞 | 使用預設值 + 一次性 warning notify + log |
| presence 損壞／無法讀／超量／清理失敗 | 固定診斷、保留不確定性，不阻擋，不清理其他人的檔案 |
| writer Git 命令失敗 | unknown／部分已知快照＋診斷，不冒充確認非 Git |
| writer UI／fallback 輸出失敗 | best-effort，無拋錯阻擋／follow-up |
| completion status 非零／killed、signal abort 或 lifecycle 失效 | 放棄，不冒充乾淨、不跟進、不累計 unexpected failure |
| completion stat 正常非零 | 保留成功 status，略去統計；killed 則整次放棄 |
| completion unexpected collection／comparison／組卡錯誤 | 最多計一次、固定安全 log；logger 失敗被包含，失效後 late rejection 不計數 |
| completion 累計三次 unexpected failure | Runtime map 令模組 inert；後續零 completion I/O，status 可查 auto-disabled，on 不重設 |
| 其他已包裝模組判定拋錯 | 維持既有 guardedRun／guardedRunAsync、recordModuleFailure log 與三次 inert；不宣稱 completion 專用壞 logger 隔離已套用全部模組 |
| `gh` 不可用 | git-evidence 降級 CI 區塊並註明 |

**completion 邊界**：不讀取 caught error／stderr／工具輸入來組診斷；failureCounts 先更新再 best-effort log。card 仍含原 porcelain／stat，沒有一般內容清洗或輸出交易保證。既有其他 guards／logger 未改，不新增一次性 notify 或 widget。

**writer 去重**：依最近自動 signature，狀態轉變可再次提示；主動 status 永遠回應。診斷與 pending notice 分開，drain 不清除 status。writer 及其他模組既有 failure policy 不在本次修改。

---

## 8. 測試策略與驗收條件

### 8.1 策略

- **框架**：vitest
- **TDD**：依 test-driven-development skill，先寫失敗測試再實作
- **純函式優先**：所有 `decide*` 不做 I/O，可直接測
- **依 `AGENTS.md:65`**：每條 block 規則都要有兩組測試 —— 刻意觸發（確認擋下）與合法變體（確認放行）
- **整合測試**：mock `ExtensionAPI`／`ExtensionContext`（此手法已在 2026-09-09 驗證 pi-guard 時證明有效），涵蓋 hook wiring、fail-open、開關切換
- **writer-lock**：暫存 Git/fs、精準 fs fault、deferred exec 與實際 default-export harness，測 own-only／有界讀取／非阻擋／late result／去重；不探測 PID，不以共存測試宣稱排他性。

### 8.2 驗收條件

1. `npx vitest run` 全綠，且每個 block 規則都有 block/pass 雙向測試
2. 五個模組可各自獨立開關，`/agents-guard off <module>` 立即生效（不需 `/reload`）
3. `/agents-guard` 狀態總覽正確顯示每個模組的生效來源
4. `/agents-guard save` 寫出的 `config.json` **只含明確設定過的欄位**（驗證：對照預設值不得出現在檔案中）
5. writer-lock：不同 instance 可同時登記並提醒；write/edit/AST/Git 不因 writer 被擋；takeover/unlock 零副作用，shutdown 只移除自身。
6. subagent-policy：三條規則各自 block 正確違規、放行合法變體
7. git-evidence：commit／push 成功後 tool_result 附加正確證據；失敗或誤判樣本不附加
8. completion-diff-recheck：不符合條件零 I/O；cwd／signal、status 可信度、stat 降級、三次 inert／壞 logger、兩個 await＋finish 窗口、shutdown、單次採用／共享配額、保留 observations 與 dirty→clean 均有測試。followUp 預設 false，無 baseline 不跟進，同一 session 上限生效。
9. 對 `~/.pi/agent` 的副作用僅限 `state/agents-guard/`（驗證：跑完整測試後 `git -C ~/.pi/agent status` 不得出現新的變更）
10. **child 零 writer I/O**：env flag 優先；未設 flag 的同 PID／sessionId 以別 instance 參與提醒，其他模組 child 政策不變。
11. 以 `pi -e ~/web/pi-agents-guard/src/index.ts` 實機載入，`/agents-guard` 可執行且狀態正確
12. **實機派發一次 subagent**（含寫入型）確認未被 agents-guard 誤擋 —— 這是無法只靠單元測試涵蓋的整合風險
13. **hard-deny 生效**：六種複合命令形式（`&&`／`;`／`|`／`$()`／`bash -c`／`find -exec`）各自命中即 block；`echo x > <protected>` 與 `tee`／`cp`／`sed -i` 的寫入目標被擋；symlink 別名被 `realpath` 解析後擋下；合法變體放行
14. **載入順序**：實測確認 agents-guard 的 `tool_call` handler 先於 pi-guard 執行（否則會出現「先彈框後被擋」）
15. **state 自我保護保留**：hard-deny 的工具／重導向規則不變；presence 歸屬不符時不修改、不刪除、不接管。
16. 新 presence 目錄 `0700`、檔案 `0600`；config helper 保持既有語意。

以上為驗收類別，不表示全數執行。Runtime coordination 本機證據：Darwin arm64／Node 22.23.2／Git 2.55.0；pure／controller／Runtime／registered-hook tests，以及自身 mkdtemp repo 的真實 Git（無 commit／remote，精確 finally 清理）。對應負向控制與 fresh tests／typecheck／lint／primary LSP／OpenSpec 證據記在 active change 的 tasks／review-notes。

完整 Pi CLI／具憑證 SDK 模型回合、writing-subagent、權限載入順序、最低 Node 22.19.0、其他平台／本次 CI、安裝與發布未驗收；既有 main CI 只屬基準版本，不用本機 harness 或舊 CI 代替。新增 Git 測試無 conditional skip；真實 Git 與 injected killed／cancel faults 分開，未跑即時 remote／CI acceptance。

---

## 9. 已知限制與殘餘風險

1. **只在 pi 內生效**。其他 harness（Claude Code 等）不受保護；`AGENTS.md` 的對應條文因此不可刪除，writer 條文仍由操作者維持，不能標註已機械強制。
2. **writer 提醒不防止任何來源的寫入**；也無法涵蓋所有 editor／未參與 session／其他 state namespace。
3. **presence 不是存活證明**。僅同 host／root 的記錄參與衝突提醒，不查 PID；混版與跨機器不保證協調。
4. **git-evidence 依賴 `gh`** 才能檢查 CI；缺少時降級並註明。固定初始 cwd、本地 upstream tracking ref、只列近期 CI 與 UTF-16 budget 等限制見 §5.3，不提供多 repo／遠端即時狀態保證。
5. **completion-diff-recheck 的 followUp 有 LLM 成本**，預設關閉。porcelain 相同不等於內容不變，已為 `M` 的檔案再修改可能無提醒；兩個 Git 查詢非原子快照，Pi 輸出也非交易式送達（§5.4）。
6. **subagent-policy 的 pattern 清單需維護**（新的弱模型名、新的 external runner 名）。清單可由 config 覆寫，但預設值會過時。
7. **own-only 是非破壞性協定，不是對抗同使用者替換 race 的安全邊界**。hard-deny state 保護保留，但真正的邊界仍在 OS 權限／sandbox。
8. **shell 重導向的解析由本專案自行實作**（§5.6 第 2 層）。pi-guard 不把重導向目標視為寫入（`src/extract.ts:290-304` 的 `collectRedirect` 只用來找嵌套命令），因此這層不能外包給它。若日後改用 `@gotgenes/pi-permission-system`（其 `access-intent/bash/redirect-analysis.ts` 有完整處理），第 2 層可簡化為只擋工具層。
9. **`config.json` 與 `settings.json` 分離**帶來一個學習成本：pi 生態多數 extension 用 `settings.json`。這是刻意取捨 —— 換取「不影響 `~/.pi/agent` 結構」與「不重演 pi-guard 的寫回陷阱」。

---

## 10. 設計決策記錄

| # | 決策 | 選擇 | 核准 |
|---|---|---|---|
| 1 | 模組範圍 | 4 個（writer-lock、subagent-policy、git-evidence、completion-diff-recheck） | 操作者 2026-09-09 |
| 2 | writer-lock 衝突行為 | advisory／不阻擋，取代原唯讀降級 | OpenSpec 需求與設計已核准 |
| 3 | lock 作用範圍 | git worktree root | 操作者 2026-09-09 |
| 4 | presence 位置 | `state/agents-guard/presence/<full-root-hash>/<instance UUID>.json`；v1 locks 保留 | OpenSpec 設計已核准 |
| 5 | 專案位置與 tooling | `~/web/pi-agents-guard/`，TS + biome + vitest | 操作者 2026-09-09 |
| 6 | 開關機制 | 兩級粒度 + 四層來源 + 明確 `save` | 操作者 2026-09-09 |
| 7 | 測試策略 | TDD + 純函式解耦 + mock ctx 整合測試 | 操作者 2026-09-09 |
| 8 | completion-diff-recheck followUp | 預設關閉（只出卡片），可選開啟 | 操作者 2026-09-09 |
| 9 | 失敗語意 | 統一 fail-open + 顯性警告 + 3 次自動停用 | 本設計提出 |
| 10 | 阻擋方式 | hard-deny／subagent-policy 保留 block；writer 無 gate，takeover／unlock deprecated | OpenSpec 已取代 writer 舊行為 |
| 11 | child 處理 | env flag 在 writer I/O 前跳過；無 share；其他模組政策不變 | OpenSpec 設計已核准 |
| 12 | 實作順序 | 開關機制 → subagent-policy → writer-lock → git-evidence → completion-diff-recheck | 本設計提出（見 §11） |
| 13 | 與 pi-permission-system 的關係 | 該套件取代 pi-guard 作為權限層；agents-guard 4 模組皆不被其覆蓋，照本設計獨立實作；writer authorizer 模式 B 已由 advisory 決策取消 | 2026-09-09 評估，見 `docs/pi-permission-system-evaluation.md` |
| 15 | 新增 hard-deny 模組 | 採選項 A（維持 pi-guard 作為確認層，MUST 級硬擋由 agents-guard 承擔）；清單與 pi-guard 刻意重疊形成雙層防護；日後換 gotgenes 可整個移除 | 操作者 2026-09-09 同意 |
| 14 | state 完整性 | hard-deny 保留；presence 有界讀取及 immutable identity 比對，不再進唯讀 | OpenSpec 設計已核准 |

---

## 11. 建議實作順序

模組之間互不耦合，可分階段交付並各自驗證。建議順序：

| 階段 | 內容 | 理由 |
|---|---|---|
| 0 | 專案骨架 + `config.ts` + `state.ts` + `/agents-guard` 命令（狀態總覽／開關／save） | 開關機制是所有模組的前置；先做完可獨立驗證且讓後續每個模組一落地就能開關 |
| 1 | `hard-deny` | 立即補上目前權限層的兩個實測缺口（`deny` 語意弱、重導向不解析），安全價值最高；純判定 + unbash 解析，無跨 session 狀態 |
| 2 | `subagent-policy` | 純參數判定、無檔案 I/O、無 git 依賴，與 hard-deny 共用 `tool_call` wrapper 機制 |
| 3 | `writer-lock` | 歷史 Stage 3 已完成；本版按 OpenSpec 改為 worktree／session 提醒 |
| 4 | `git-evidence` | 不阻擋，風險低 |
| 5 | `completion-diff-recheck` | 依賴 agent_settled 時機與追蹤狀態，最後做 |

每階段的完成定義：該階段測試全綠 + 可用 `/agents-guard off <module>` 停用 + 不影響其他模組。

---

## 12. 不在本次範圍（未來可能）

- `context-snapshot`、`repeat-failure-guard`（原盤點的另 2 個模組）
- `agents-lint`（advisory-only 的 bash hygiene／版本同步／測試 skip 偵測）
- 發布為 npm package（目前只做本機 `extensions` 路徑載入）
- 向 pi-guard 回報兩個 upstream 問題：`.pi/settings.json` 未檢查 project trust、互動模式 `deny` 語意不一致
