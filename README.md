# agents-guard

為 `AGENTS.md` 中**權限系統未充分覆蓋的 MUST 條文**提供機械防線的 Pi extension。

**公開 snapshot：** 本 repo 從已去識別的檔案建立，不攜帶原私人 repo 的 Git 歷史。文件中的歷史 commit SHA、CI URL 與驗收 hashes 是原始驗收的引用，不代表本 repo 有那些 commits，亦不保證私人連結可存取；程式與套件名稱仍為 `pi-agents-guard`。

**文件入口：** [安裝與使用手冊](docs/user-guide.md) · [完整文件索引](docs/README.md) · [隔離驗收手冊](docs/validation/isolated-acceptance.md)

它刻意不做權限系統已經做好的事。它做的是權限系統做不到的事：不彈框的硬擋、worktree 與 session 衝突提醒、工具參數的語意檢查、以及事後自動補驗證證據。

## 為什麼需要它

2026-09-09 對 `pi-guard@1.4.0` 的實測發現兩個結構性缺口：

| 缺口 | 實測結果 |
| --- | --- |
| **Bash pattern 的 `deny` 在互動路徑可能進入含 Allow 的選單**（不是所有工具的 deny） | `handlers.ts` 的 `findUnauthorizedCommands` 把 deny 與 ask 一起收進 `unauthorizedCommands`，互動路徑一律彈出含 `Allow` 的選單 |
| **shell 重導向目標不被視為寫入** | `src/extract.ts:290-304` 的 `collectRedirect` 只用來找嵌套命令。`echo '{}' > ~/.pi/agent/settings.json` **通過** |

所以主 session 的 MUST 級防線必須由自己控制的 extension 承擔。完整比較見 [`docs/permission-systems-comparison.md`](docs/permission-systems-comparison.md)。

## 分工

```
agents-guard          → 不彈框硬擋、位置／session 提醒、參數檢查、事後補證據
   ↓ 未被硬擋的才往下
pi-guard 1.4.0       → 需要人工確認的操作（ask）；無 UI 時拒絕
```

`agents-guard` 的規則與權限系統的 `deny` **刻意重疊**，形成雙層防護。權限層日後換掉時，本 extension 不需改動。

## 目前狀態

下文的 `AGENTS.md` 行號沿用初始設計快照，不代表讀者目前文件的行號；實際規則由 `src/config.ts` 與各模組實作決定。

| 模組 | 對應守則 | 狀態 |
| --- | --- | --- |
| `hard-deny` | `AGENTS.md:49` `:51` `:101` | ✅ Stage 1 已實作 |
| `subagent-policy` | `:88` `:91` `:92` | ✅ Stage 2 已實作 |
| `writer-lock` | `:56` `:93` | advisory 已實作，協助人工單一 writer 紀律，不強制互斥 |
| `git-evidence` | `:52` `:53` | ✅ Stage 4 已實作 |
| `completion-diff-recheck` | `:111` `:110` | ✅ Stage 5 已實作 |

設計文件：[`docs/design.md`](docs/design.md)。實作計畫：[`docs/plans/`](docs/plans/)。

`src/index.ts` 保留公開 Runtime／RuntimeDeps／createRuntime 與既有同步方法，負責動態設定及唯一的模組失敗計數；`src/runtime/` 的 completion／Git-evidence 協調器各自負責狀態與查詢流程。`src/extension.ts` 接收 Runtime factory，集中六個 hooks、command、flag 與顯示，root default export 委派給它。writer-lock controller 仍只協調獨立 presence 記錄，不取得或阻擋寫入權。

**版本 0.1.0，尚未發布 npm；正式安裝仍是另行授權的操作。** 2026-09-11 已完成 Darwin arm64／Node 22.23.2 上 Pi 0.85.1＋pi-guard 1.4.0＋pi-subagents 0.67.0 的選定實機驗收：[父程序案例](docs/reports/2026-09-11-final-stack-results.md)與[child 補測 PASS](docs/reports/2026-09-11-child-permission-retry-results.md)須合併判讀，前輪 partial 不追溯改綠。無 UI child 的 ask／deny 預期拒絕、不轉送；必要寫入須事前窄範圍 allow。這不代表精確 peer 宣告、最低 Node、其他平台或所有第三方組合已相容。

writer 需求以 [canonical spec](openspec/specs/writer-lock-safety/spec.md) 為準，設計與驗證見 [歸檔 change](openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/design.md)；[歷史鎖缺陷](docs/plans/2026-09-09-writer-lock-safety-findings.md) 是退役協定的證據，不表示已完成強鎖修復。實際 Pi CLI、最低 Node 及 Linux／CI 驗收須與本機測試分開判讀。

## 安裝

需要 Node `>=22.19.0`（實測 `22.23.2`）、Pi `0.85.1` 與 Git。先在本機 clone 安裝 lockfile 依賴；本套件直接載入 TypeScript，沒有 build script：

```bash
git clone https://github.com/chinlung/pi-agents-guard-public.git pi-agents-guard
cd pi-agents-guard
npm ci --no-audit --no-fund --ignore-scripts
```

尚未有既有 agents-guard 載入設定時，可先單次載入，不登錄正式 settings：

```bash
pi -e "$PWD/src/index.ts"
```

在新 session 輸入 `/agents-guard status`，確認全域與五模組狀態。這仍可能登記自身 presence，不是無副作用的沙箱；模型操作需 Pi 原有認證。

正式持續載入建議採 local package：由操作者備份後執行 `pi install /absolute/path/to/pi-agents-guard`，並核對同一 user `packages` 中 agents-guard → pi-guard → pi-subagents 的順序。Local package **不複製 source、不代裝本地依賴**，移動／修改 checkout 會影響後續載入。不要同時設定 package、`extensions` 與 `-e` 來重複載入。

完整安裝、備份、固定版本、載入順序驗證與卸載見[使用手冊](docs/user-guide.md)。不要整份覆蓋既有 settings；既有 pi-guard 的單純 append 安裝不保證順序正確。若權限系統先載入，可能先彈框再被 agents-guard 擋；其他順序／混 scope 必須另驗。pi-guard 1.4.0 宣告 Pi 0.79.1／typebox 1.1.39，與實測 Pi 0.85.1／typebox 1.1.38 有 peer 落差；Pi managed installer 內建 `--legacy-peer-deps`，實測 PASS 不等於符合精確 peer 契約。

**安裝原始碼的保護限制：** 預設 `protectedPaths` 不會自動保護任意 local checkout，也沒有涵蓋 Git 套件的 `.pi/agent/git/**`；安裝成功不代表 source 已受寫入保護。若要補強，由操作者保留完整預設規則，再加入實際安裝目錄並重新驗證；詳見[安裝後核對報告](docs/reports/2026-09-11-post-install-check.md)。

## 命令

```
/agents-guard [status]        # 啟用時重新檢查位置／presence，再合併顯示狀態與來源
/agents-guard on | off        # 整體開關
/agents-guard on <module>     # 單一模組
/agents-guard off <module>
/agents-guard save            # 把當前狀態明確寫入 config.json
/agents-guard takeover        # deprecated：只顯示相容提示，不接管
/agents-guard unlock          # deprecated：只顯示相容提示，不移除記錄
```

開關**立即生效，不需 `/reload`**。`save` 是唯一寫入 config.json 的命令；writer 提示的啟動／重新檢查／停用另會登記、更新或清理自身 presence。takeover／unlock 不做 Git、檔案或程序操作。

## 設定：五層來源

後者覆寫前者，per-key 深度合併：

| 層 | 來源 | 生效時機 |
| --- | --- | --- |
| 1 | 內建預設（全部啟用） | — |
| 2 | `~/.pi/agent/state/agents-guard/config.json` | extension 載入時 |
| 3 | 環境變數 `AGENTS_GUARD` | extension 載入時 |
| 4 | CLI flag `--agents-guard=...` | 啟動時 |
| 5 | `/agents-guard` 命令 | 立即 |

第 3、4 層支援簡寫：`off`、`on`、或 `hard-deny,git-evidence`（只啟用列出的）。第 3 層另接受完整 JSON。

若設定 `PI_CODING_AGENT_DIR`，state 根目錄改為其下的 `state/agents-guard`；**預設 hard-deny patterns 不會隨之搬移**，仍以 `.pi/agent/...` 等固定形狀匹配。任意自訂目錄的 config／state 不一定受保護，須由操作者另核對完整規則，不能只改環境變數就宣稱同等防護。模組名稱一律 **kebab-case**；`hardDeny` 等舊設計示例鍵名不支援，會警告並忽略。這不是 Pi `settings.json` 內的 `guard` 設定，兩者分開管理。

`save` 不會序列化整份 defaults：未有明確來源的模組略過；明確模組保留 `enabled` 與非預設選項。這不是逐鍵完整 provenance；status 的模組來源是摘要。設定陣列是**整份替換，不是追加**，請勿貼上縮短的 `commands`／`protectedPaths` 當作安全預設。

以下只調整非安全清單選項，不移除任何預設 hard-deny：

```json
{
  "version": 1,
  "modules": {
    "git-evidence": { "checkCi": false },
    "completion-diff-recheck": { "followUp": false }
  }
}
```

`checkCi` 產品預設為 `true`；範例的 `false` 是明確選擇略過近期 CI 列表。檔案修改需重新載入 extension／開新程序；命令開關則即時生效。完整選項見[使用手冊](docs/user-guide.md)。

## `subagent-policy` 的三條規則

對 `subagent` 工具呼叫做純參數判定，零語意推測。三條規則依序評估，第一個命中即擋下：

**1. 派發前置檢查（`:88`）** — 執行型呼叫（含 `agent`／`workflowScript`／`workflowScriptPath`／`workflow`，且不含 `action`）在本 session 觀察到 `{action:"list", capabilities:true}` 成功回應之前一律擋下。管理／控制呼叫（含 `action`）不受此規則約束。**在 subagent child session 中停用**（`PI_SUBAGENT_CHILD=1`）——child 的 agent 已由 parent 的 brief 決定，要求它自行 list 一次沒有下游消費者。

**2. 高風險不得降級（`:91`）** — `agent` 或 `task` 命中 review/audit/security/threat 類 pattern，且明確指定了 `model` 並命中弱模型 pattern（`haiku`／`mini`／`flash`／`lite`／`small`），才會擋下。未指定 `model` 表示使用 agent 預設，不算降級。

**3. native-only 選項不套用外部 runner（`:92`）** — `agent` ∈ `codex-exec(-writer)`／`claude-code(-writer)`／`cursor-agent(-writer)`，且 input 含 `model`／`context`／`acceptance`／`outputSchema`／`toolBudget`／`fast`／`skill`／`mission` 任一鍵即擋下，reason 列出全部違規欄位。

四個 pattern／選項清單 `weakModelPatterns`、`externalCliAgents`、`nativeOnlyOptions`、`reviewIntentPatterns` 皆可由 `config.json` 覆寫。它們與 `hard-deny` 的 `commands`／`protectedPaths` 一樣是**整份替換**；縮短任一清單會減少檢查覆蓋。請從當前 [`src/config.ts`](src/config.ts) 核對完整預設，再針對明確需求調整，不貼上局部清單當作安全預設。

## `writer-lock`：worktree 與 session 提醒

**advisory（不鎖定寫入）**：只協助確認位置、既有修改及可能重複開啟的 session。即使有 peer、dirty tree 或診斷錯誤，writer 模組也不擋工具；hard-deny 與 subagent-policy 的拒絕仍有效。

| 觸發 | 動作 |
| --- | --- |
| 啟用的 foreground `session_start` | 確認 canonical worktree、branch／detached、dirty；登記自身、掃描參與記錄並提示 |
| `/agents-guard`／`status` | 使用當前 cwd／session 重新檢查，只印一份合併回應 |
| `on`／`on writer-lock` | 僅有效停用→啟用時重新檢查；重複 on 不重查 |
| `turn_end` | 只更新已知自身記錄，取出一次待送診斷；不跑 Git、不掃 peer、不重建遺失記錄 |
| `off`／shutdown | 停止後續更新、使舊非同步結果失效，盡力清理自身記錄 |
| `tool_call` | writer 零介入：無檢查、提示或唯讀 gate |

停用或 `PI_SUBAGENT_CHILD=1` 在 writer Git／presence I/O 前跳過。未設 child flag 的同 PID／同 sessionId session 仍以不同 instance 區別。

Git 檢查用參數陣列及 `--no-optional-locks`，共享兩秒查詢預算並傳遞 timeout／signal；這不是完整程序兩秒內停止的保證。失敗保留已知資料並說明「資訊不完整」，不把缺 Git／一般非零退出冒充確認非 Git。dirty 包含 tracked 與非 ignored untracked，不列出檔名。

存在記錄在 `state/agents-guard/presence/<完整 SHA-256(canonical root)>/<instance UUID>.json`。只比較同 state namespace／host／root 的其他 instance；每次最多 256 個目錄項目、每筆 16 KiB。自身只在成功登記後更新／清理，身分變更或損壞時放棄該 handle，不碰他人記錄；新目錄 0700、檔案 0600，不跟隨 presence 目錄／leaf symlink。清理未完成會留下診斷，不以新位置登記成功冒充舊位置已清理。

`heartbeatTimeoutMs` 預設四小時，**只是記錄新鮮度**；過期／時間異常表示狀態不明，不是驅逐或接管依據。`blockedTools`／`blockedGitSubcommands` 已 deprecated，仍能載入與 save round-trip，但完全不參與工具決策。

自動提示依位置、分支、dirty、peer 與原因去重，不因 heartbeat／檢查時間改變洗版；status 每次回應且不重設自動去重。動態欄位轉義控制字元並限制 256 code points，最多顯示五個 peer。沒有 peer 時只說「本次未觀察到其他參與記錄」，**不是互斥鎖，也不是沒有其他 writer 的證明**。

### 舊版遷移與回退

只探測當前 canonical root 對應的 v1 `locks/<16 字元 hash>.json`，不讀為權威、不轉換、不覆寫、不刪除。混版不是安全協調：請先停止舊版 session，再另行核准 reload／安裝；不要用 takeover／unlock 修復舊鎖。回退舊版會恢復其阻擋行為與已知 ownership 缺陷。hard-deny 對自身 state 路徑的保護仍保留。

## `git-evidence` 附加規則

偵測 bash 工具**成功**（`isError===false`）執行的 `git commit`／`git push`（AST 解析，非字串比對——`echo "git push"` 不會誤判），自動在 `tool_result` 的 `content` 尾部附加一段驗證證據。**不擋任何操作**（`AGENTS.md:52`／`:53`）。

| 事件 | 驗證內容 |
| --- | --- |
| `commit` | `git log -1 --format=%H %d %s` 的 SHA、ref、標題 |
| `push` | `git rev-parse HEAD` 與 `git rev-parse @{u}` 的 HEAD／本地 upstream tracking SHA 是否一致（無 upstream 時明確標示略過比對，不宣稱一致或不一致） |
| CI（`checkCi:true` 時） | `gh run list -L 3`；`gh` 不可用時降級與登記「未檢查 CI」 |

`git commit -m x && git push` 這類複合命令會同時觸發 commit 與 push 兩組證據，依序連接附加。`maxAppendBytes` 預設 2048，但現行以 JavaScript UTF-16 `.length`／`.slice` 計量，不是實際 bytes；超過則截斷並另附原長度說明。

**保留的限制：** 查詢使用 Runtime 首次建立時的 cwd，不追隨後續 context cwd，也不解析 shell `cd`／`git -C`／多 repo 的實際位置。`@{u}` 是本地 upstream tracking ref，未 fetch／查詢遠端；`gh run list` 只列近期執行，未追到本次 push 的 CI 結論。開始時才檢查 enabled／inert；偵測事件後、第一個 await 前讀一次 options，已開始的流程不因中途 off 停止，下一次才受新開關約束。這些語意本次沒有改成 completion 的生命週期政策。

▸ **導入時的具體化**：design.md 原本假設能取得純數字 exit code，但 pi 的 bash tool 實測只提供 `isError: boolean`（非 0 exit code 會讓 tool 拋錯，框架轉成 `isError:true`）——判定函式因此改簽 `detectGitEvents(command, isError)`。完整 deviations 見 `docs/plans/2026-09-09-stage-4-git-evidence.md`。

## `completion-diff-recheck` 的行為

`AGENTS.md:111` 指出「formatter／autofix／IDE watcher 可能在最後一次編輯之後才改動檔案」。本模組在 `agent_settled` 重查 Git 狀態，**不擋任何操作**。該事件表示執行已穩定結束，沒有自動重試、compaction 或佇列中的待續跑；不是每一個 `turn_end`。

- 本 session 曾成功執行 `write`／`edit`／`ast_grep_replace` 即符合寫入條件，**不限最後一回合**；只有失敗寫入不算。
- 全域／模組停用、三次失敗後 inert、`PI_SUBAGENT_CHILD=1`、沒有成功寫入、shutdown 或 signal 已 aborted，皆在第一個查詢前跳過：**零 completion Git／card／follow-up**，不代表其他模組也零 I/O。
- 只追蹤 agent 成功執行的 porcelain status 原始 content 中第一個有效 text，不把附加的 Git-evidence 當 baseline；人類可讀 `git status` 不算。停用期間仍記錄寫入與觀察，重新啟用後可用。
- 以事件的 cwd 及同一 signal 依序查 `git status --porcelain`、`git diff --stat`。stat 僅附加顯示，不參與判斷。
- 無 baseline 且仍 dirty 時只提醒，永不 follow-up；無 baseline 且 clean、或快照相同時不出卡片。有 baseline 時保留 dirty→clean 提醒；空字串與 `(no output)` 視為相同的乾淨狀態。
- `followUp` **預設 false**；開啟後也必須有 baseline、有差異且未達 `maxFollowUpsPerSession`（預設 2）才請求跟進。新 Runtime 不共用其他 instance 的觀察或配額。

收集採 **async collect → 同步、單次 finish → 同步輸出**。每次 await 後及 finish 時重新確認有效性；off→on 不會復活舊結果，shutdown 對同一 Runtime 是終止狀態。收集不預扣配額、不改 baseline；finish 依當下設定／觀察組卡成功後才消耗 follow-up 請求配額，與舊同步 `checkCompletionDiff` 共用上限。重複 finish、失敗或失效不會再扣配額。

status 非零／killed 不採用 stdout，也不跑 stat；stat 正常非零只略去附加統計，stat killed 則放棄整次檢查。unexpected rejection／比較錯誤由 completion 隔離，每次最多記一次失敗；不把查詢失敗冒充乾淨。取消與失效不累計失敗，也不保證已啟動的程序立即停止。

顯示依序為 `pi.appendEntry`（記錄不進 LLM context）→ UI notify 或非互動 console → 必要時 `pi.sendMessage` 請求 follow-up。沒有新增自定義 TUI component。這不是交易式送達：部分 Pi 輸出失敗不回滾已消耗的請求配額、不重送；不保證模型已實際執行額外回合。

## `hard-deny` 的三層判定

**1. 命令層** — 以 `unbash` AST 逐一檢查每個 sub-command，涵蓋 `&&`／`;`／`|`／subshell／`$()`／`bash -c`／prefix wrapper（`sudo`／`env`／`xargs`／`timeout`／`nice`…）。

預設清單：`git add -A|--all|.`、`git commit -a*`、`git push --force*|-f|--delete`、`sudo`、`npm publish`、`gh release delete`、`crontab`、`at`、`chown`

> 語法錯誤**不會**中止檢查。已解析出的部分照常判定，因此 `git add -A ; echo 'unterminated` 仍被擋。

**2. 寫入目標層** — 從每個 sub-command 抽出寫入路徑：重導向目標（`>`／`>>`／`>|`／`&>`／`&>>`／`<>`，並排除 `2>&1` 這類 fd 複製）、`tee`／`cp`／`mv`／`ln` 的目的端、`sed -i` 的目標。同時比對字面絕對路徑與成功 **`realpath`** 的目標，因此寫入**呼叫前已存在**、且能解析到受保護檔案的 symlink 也會被擋。同一條尚未執行的命令才建立 symlink 再寫入，不具備此保證。

**3. 工具層** — `write`／`edit`／`ast_grep_replace` 的 `path`，同樣經 `realpath` 比對。這是列舉式防護；不存在的路徑無法完成 `realpath` 時僅比對字面絕對路徑，不保證所有 symlink／新目錄／解譯器情境。

受保護路徑預設涵蓋：pi 設定與程式碼（`settings.json`、`AGENTS.md`、`npm/**`、`extensions/**`、`auth.json`、`trust.json`）、agents-guard 自身 state、專案層 `.pi/`、shell 啟動檔、git hooks、`**/.env*`／`*.pem`／`id_rsa*`／`.netrc`／`.npmrc`。

## 失敗語意

Runtime 保有唯一的模組失敗計數器。completion 的 unexpected collection／比較錯誤使用固定安全診斷，不讀取原始 error／stderr／工具輸入；先計數，再 best-effort log，logger 拋錯也被隔離。累計三次後 inert，status 顯示 `auto-disabled`；成功檢查或 on 不重設失敗次數。

其他模組的 generic guards／logger 與 Git-evidence 失敗語意未改，不能把 completion 的診斷隔離推廣成所有模組的保證。writer 預期 Git／檔案錯誤仍轉為固定、可查詢的診斷，不經失敗計數器靜默停用。writer emitter 隔離 UI 與 fallback 輸出錯誤，不彈框、不追加 turn，也不阻擋工具。

## 已知限制

1. **只在 pi 內生效。** 其他 harness 不受保護，`AGENTS.md` 的對應條文不能刪除。
2. **防誤操作，不防對抗。** agent 可從 `PI_SESSION_ID` 得知自己的身分、可透過未列舉的解譯器或機制繞過。列舉式防護追不上對抗性攻擊，真正的邊界在 OS 檔案權限與 sandbox。
3. **writer 提醒不防止任何來源的寫入**，也不涵蓋所有 writer（編輯器、其他工具、不同 state namespace、未載入 extension 的 session）；單一 writer 紀律仍由操作者維持。
4. **completion 比對的是 porcelain 快照，不是內容雜湊或自然語言回報。** 同一個已標為 `M` 的檔案繼續被修改，快照可能相同而不提醒；status／stat 兩次查詢也不是原子快照。卡片的檔案數是目前全部 dirty 項目，不是精確新增差集；`git diff --stat` 不含 untracked。不得以沒有提醒取代最終人工驗證。
5. **無 UI child 的 ask 不轉送 parent。** pi-guard 1.4.0 的 allow 才會通過該權限層，ask／deny 拒絕是預期限制，不是必須加 broker 的產品缺陷。Parent 授權、child 真正載入與工具寫入成功須分別核對。
6. **失敗計數達三次會讓模組 inert。** 這不是安全模組永遠 fail-closed 的保證；見 status 的 `auto-disabled` 時應停止依賴該防線並排查。

完整清單見 [`docs/design.md`](docs/design.md) §9。

## 開發

```bash
npm ci --no-audit --no-fund --ignore-scripts
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # biome check
```

判定核心（`decide*`）全部是純函式，不做 I/O、不呼叫 pi API，因此可在不啟動 agent session 的情況下完整測試。

Runtime 協調驗證分開記錄 pure／direct-controller、注入 fault／deferred 競態、真實 default-export hook harness，以及自建 Git repo 的新增未追蹤檔案／dirty→clean。真實 Git 測試不 commit、不碰 remote，並以自身空白 wrong-repo 的負向控制驗證 cwd；它不是程序取消或完整 SDK session 驗收。後續已取得 Darwin arm64／Node 22.23.2 的 Pi CLI、具憑證模型工具、單一 native writing child 及選定權限載入順序證據；詳見[驗收索引](docs/README.md)。[main CI](https://github.com/chinlung/pi-agents-guard/actions/runs/34515942965) 的 Ubuntu／Node 22 tests、typecheck、lint 成功，不等於 Linux 完整 Pi 實機驗收。精確最低 Node 22.19.0、其他平台／組合與正式安裝不由這些結果替代；最新文件收尾檢查另記於[收尾報告](docs/reports/2026-09-11-project-closeout.md)。

依 `AGENTS.md:65`，每條 block 規則都有「刻意觸發 → 確認擋下」與「合法變體 → 確認放行」兩組測試；核心行為另有破壞驗證紀錄（見 commit `c356676`、`c5d0189`）。
