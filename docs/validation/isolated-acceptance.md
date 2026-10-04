# 隔離實機驗收手冊

> **狀態：手冊已建立，實機驗收尚未執行。** 本次授權僅建立文件；以下安裝、啟動程序、模型呼叫與測試 Git 操作均是待核准步驟，不是已完成紀錄。

## 1. 目的、基準與授權

驗證目前 extension 在真實 Pi 宿主中的載入、工具事件、命令、寫入型 child 及權限層整合。既有 pure tests／hook harness／真實 Git fixture 不等於完整 CLI／SDK／模型驗收。

- 程式基準：`90e055ebf25f65261f52b9901cf4356be10e6b39`；Pi：`0.85.1`，由專案 lockfile 安裝的 devDependency 提供。
- Node 宣告下限為 `22.19.0`；已知主線 CI 用 `22.23.2`。每次記錄精確 Node／npm／OS／架構，不以浮動 `22` 冒充最低版本驗收。
- 本手冊只操作自己建立的暫存副本、repo、state、程序；不在目前 coding session 直接載入、不改真實 settings／auth、不自行 commit 或發布本專案。
- 需求真相仍是 [writer spec](../../openspec/specs/writer-lock-safety/spec.md)、[completion spec](../../openspec/specs/completion-recheck/spec.md) 與現行實作；本手冊不新增強鎖、sandbox 或 CI 證據保證。
- 工作排序及既有驗證見 [2026-09-10 盤點報告](../reports/2026-09-10-work-status.md)。

執行順序：準備 → A → D（憑證／模型 gate）→ B → C → E。執行前逐項確認，未核准的階段維持 `NOT_RUN`：

| 範圍 | 需明確核准的操作 | 本文件建立時 |
| --- | --- | --- |
| 準備與 A | 暫存檔、lockfile 安裝及其 lifecycle scripts、套件測試、啟動隔離 Pi；不送模型請求 | 未核准執行 |
| B／D | 指定 provider／model、測試專用憑證、費用與停止上限；只在暫存 repo 呼叫工具 | 未核准執行 |
| B 的 Git 案例 | 暫存 repo 的具名 staging、測試 commit、只推到本機 bare repo；不授權本專案 Git 寫入 | 未核准執行 |
| C | 固定版本的 subagent／權限 extension、其安裝方式、child 模型與費用、可寫路徑 | 未核准執行 |
| 正式安裝 | 真實 Pi 設定修改、reload、部署或發布 | 不在本驗收授權內 |

## 2. 隔離邊界

建議配置：

```text
<LAB>/
├── source/                 # 固定 commit 的獨立副本；不共用本專案 .git
├── home/.pi/agent/         # 測試用 settings／auth／trust
│   └── state/agents-guard/ # 本 extension 唯一 state 寫入範圍
├── sessions/               # 各程序獨立的 session JSONL
├── repo/                   # 可拋棄 Git 工作樹
├── remote.git/             # 只在獲准的 push 案例建立
├── evidence/               # 日誌、退出碼、前後差異與案例結果
└── tmp/、cache/…           # 工具的暫存與快取
```

- 同時指定 `HOME`、`PI_CODING_AGENT_DIR`、`--session-dir`。刻意保留測試 agent 路徑的 `.pi/agent` 尾端，沿用目前 hard-deny 路徑 patterns；不要假設任意自訂 agent 路徑都會自動加入保護清單（`src/config.ts:26–49`）。
- 用 `env -i` 建立白名單環境，不繼承真實 `AGENTS_GUARD`、`PI_SUBAGENT_CHILD`、`PI_SESSION_*`、`NODE_OPTIONS`、provider key、SSH agent、GitHub token 或代理設定。需要 proxy／provider 時只另外加入獲准項目，不複製整份環境。
- 停用自動 extension／skill／prompt／theme／context discovery，以明確 `-e` 載入；基線不載入真實個人規則與套件。這是新測試實例，不是繞過現行 session 的規則。
- Git 使用空白 global config 與 template；不讀真實 credential helper、signing 或 hooks。測試用未簽名 commit 是空白 fixture 的設定，不是把本專案簽名關掉。
- Extension 新建 state 目錄應為 `0700`、檔案 `0600`；Pi 本身的 auth／session 等檔案屬宿主寫入，不混算成 extension 越界。

**上述是設定／資料隔離，不是安全沙箱。** Pi extensions 仍有程序使用者的系統權限。若要求「即使測試失敗也不能讀寫主機檔案」，使用容器／VM：只提供程式副本與測試磁碟，不掛載真實 HOME、SSH／Docker socket、工作 repo 或憑證；網路由外層限制。容器內成功亦不等於原生 macOS 宿主已驗。

`--offline`／`PI_OFFLINE=1` 只停用 Pi 的啟動網路操作；不阻止 npm 安裝、模型請求或任意工具連網。需要真正封網時在 OS／容器層落實，模型階段只開放核准服務。

## 3. 待核准的準備命令

以下是 **Bash 操作範例，不是已執行腳本**；按階段執行，不整份無條件貼上。先從本專案根目錄開啟專用 Bash shell；若使用容器／VM，改從其中的唯讀程式來源開始。CLI 或 runtime 缺失時停止，不自行安裝全域套件。範例以 POSIX 環境為目標，不代表 Windows 支援承諾。

### 3.1 固定來源、空白環境與記錄工具

```bash
set -euo pipefail
umask 077

REPO=$(git rev-parse --show-toplevel)
SOURCE_SHA=90e055ebf25f65261f52b9901cf4356be10e6b39
git -C "$REPO" status --short --branch
git -C "$REPO" diff --stat
git -C "$REPO" cat-file -e "${SOURCE_SHA}^{commit}"

NODE_BIN=$(command -v node)
NPM_BIN=$(command -v npm)
GIT_BIN=$(command -v git)
BASH_BIN=$(command -v bash)
TEST_PATH="$(dirname "$NODE_BIN"):$(dirname "$NPM_BIN"):$(dirname "$GIT_BIN"):$(dirname "$BASH_BIN"):/usr/bin:/bin"
LAB=$(mktemp -d "${TMPDIR:-/tmp}/agents-guard-acceptance.XXXXXX")
AGENT_DIR="$LAB/home/.pi/agent"
mkdir -p "$AGENT_DIR" "$LAB"/{source,repo,sessions,evidence,tmp,cache,config,data,gh,npm-cache,empty-template}
: > "$LAB/empty.gitconfig"
: > "$LAB/user.npmrc"
: > "$LAB/global.npmrc"
printf 'LAB=%s\nsource=%s\n' "$LAB" "$SOURCE_SHA" > "$LAB/evidence/manifest.txt"

git -C "$REPO" archive --format=tar -o "$LAB/source.tar" "$SOURCE_SHA"
tar -xf "$LAB/source.tar" -C "$LAB/source"

clean_env() {
  env -i PATH="$TEST_PATH" HOME="$LAB/home" SHELL="$BASH_BIN" \
    LANG=C LC_ALL=C TERM="${TERM:-dumb}" TMPDIR="$LAB/tmp" \
    XDG_CONFIG_HOME="$LAB/config" XDG_CACHE_HOME="$LAB/cache" XDG_DATA_HOME="$LAB/data" \
    PI_CODING_AGENT_DIR="$AGENT_DIR" PI_OFFLINE=1 PI_TELEMETRY=0 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$LAB/empty.gitconfig" GIT_TERMINAL_PROMPT=0 \
    GH_CONFIG_DIR="$LAB/gh" NPM_CONFIG_CACHE="$LAB/npm-cache" \
    NPM_CONFIG_USERCONFIG="$LAB/user.npmrc" NPM_CONFIG_GLOBALCONFIG="$LAB/global.npmrc" \
    "$@"
}

run_evidence() {
  local label="$1"
  shift
  local rc=0
  "$@" > "$LAB/evidence/$label.log" 2>&1 || rc=$?
  printf '%s\n' "$rc" > "$LAB/evidence/$label.exit"
  return "$rc"
}

run_evidence node-version clean_env "$NODE_BIN" --version
run_evidence npm-version clean_env "$NPM_BIN" --version
run_evidence git-version clean_env "$GIT_BIN" --version
```

逐一讀回三個版本日誌及退出碼，補記 OS／架構、操作者、時間與核准範圍。若 Node 低於下限，停止；最低版本案例須精確為 `v22.19.0`。`env -i` 只限制繼承環境，PATH 中的工具本身仍須可信，不能把它當可執行檔 allowlist 沙箱。

來源採 `git archive` 而非共用 worktree 或 symlink，避免 fixture Git 操作影響原始 repo。若要驗其他 SHA，先更新驗收基準並重新核對手冊與 source；不要悄悄改測浮動 HEAD。

### 3.2 安裝與套件基線

**只有取得暫存依賴安裝／測試授權後才執行。** 不改來源 repo 的 lockfile；不使用 `npm update`、全域安裝或 `npx` 自動下載替代工具。

```bash
(
  cd "$LAB/source" || exit 1
  run_evidence install clean_env "$NPM_BIN" ci --no-audit --no-fund
)
PI_BIN="$LAB/source/node_modules/.bin/pi"
run_evidence pi-version clean_env "$PI_BIN" --version
run_evidence pi-help clean_env "$PI_BIN" --help
```

先完整讀回 help／版本、確認 Pi 為 `0.85.1` 及所需旗標存在；失敗就停止並保存原始退出碼。先做可用的 LSP 型別／語法診斷，再執行專案既有入口：

```bash
(
  cd "$LAB/source" || exit 1
  run_evidence typecheck clean_env "$NPM_BIN" run typecheck
  run_evidence lint clean_env "$NPM_BIN" run lint
  run_evidence tests clean_env "$NPM_BIN" test
)
```

沒有 build script。`run_evidence` 保留原命令 exit code，不讓 `tee`／`grep` 掩蓋失敗；每一個案例使用不同 label，避免覆寫前次證據。失敗時先讀該 log，不靠重試或換 runtime 掩蓋問題。

### 3.3 空白 fixture 與啟動入口

```bash
clean_env "$GIT_BIN" init --template="$LAB/empty-template" -b main "$LAB/repo"
clean_env "$GIT_BIN" -C "$LAB/repo" config --local user.name 'Acceptance Fixture'
clean_env "$GIT_BIN" -C "$LAB/repo" config --local user.email 'fixture@example.invalid'
printf 'fixture-only\n' > "$LAB/repo/.env.acceptance"

run_pi() (
  cd "$LAB/repo" || exit 1
  clean_env "$PI_BIN" \
    --offline --no-approve \
    --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files \
    --session-dir "$LAB/sessions" \
    -e "$LAB/source/src/index.ts" "$@"
)
```

所有 fixture 都是假資料；**不以真實 `.env`、auth、crontab、sudo、release 或遠端刪除作反例**。新 Git repo 尚無 commit，必要時在 B 的明確 Git 授權下建立第一個 commit；不要把 unborn branch 狀態誤判為一般已提交分支失敗。

## 4. A：載入、命令與開關（不送模型請求）

先嘗試 CLI 命令 smoke：

```bash
run_evidence a1-status run_pi -p '/agents-guard status'
```

只送已註冊 slash command，不送自然語言提示。若宿主在命令分派前就要求 model／憑證，記錄 `BLOCKED_ENV`，不要讀取真實 auth 讓它變綠。互動命令用 `run_pi` 另開 TUI；記錄畫面或轉錄，不自動送模型訊息。

| ID | 操作與預期 | 必要證據 |
| --- | --- | --- |
| A1 | `status` 能顯示五個 kebab-case 模組、有效開關與來源；非互動模式也有可見輸出，無載入錯誤 | stdout／stderr、退出碼、實際 Pi 版本 |
| A2 | 在同一 session 執行 `off writer-lock`、`status`、`on writer-lock`、`status`；立即生效，不需 reload | 命令回應；on／off 本身不建立 config.json。presence 的變化另計 |
| A3 | 再 `off writer-lock`、`save`，退出並開新 session；status 應讀到 file 層停用。最後 `on writer-lock`、`save` 恢復 | 只在 `$AGENT_DIR/state/agents-guard/config.json` 寫明確值；讀回內容、權限與重啟結果 |
| A4 | 在無其他 override 的新 session，以 `--agents-guard=off` 確認 flag 來源；同一 session 執行 `/agents-guard on` 可立即覆寫 | flag／command precedence。save 不宣稱已刪除下次啟動的 flag |
| A5 | 全域 `off` 後查 status，再 `on`；`takeover`／`unlock` 只顯示 deprecated 提示 | 不以接管、kill 或刪他人記錄作為成功；自身 state 生命週期與對照快照 |

命令表中的動作都帶 `/agents-guard` 前綴，例如 `/agents-guard off writer-lock`。設定預設不會全部序列化；不要把省略的預設鍵當資料遺失。A3 保存的設定不可悄悄污染 B／C：結束舊程序，恢復已知設定後開新 session。

## 5. B：真實宿主工具流程

B 必須經真實 Pi 工具事件執行，通常需要模型；先完成第 7 節 D 的憑證與費用核准，再回來逐案執行。若另用可控測試 provider 固定 tool calls，要記錄其 fixture／版本並另准實作，不冒充真實遠端模型驗收。

**不能用 `!command`／`!!command` 或外部 shell 代替模型的 bash 工具呼叫。** 它們走不同路徑；本 extension 註冊的是 `tool_call`／`tool_result`（`src/extension.ts:156–193`）。外部 shell 只用於 fixture 準備、事後讀回或明確的外部變更。

為使基線不觸發 GitHub CI 查詢，在沒有測試程序存活時，由操作者將下列 JSON 寫入測試區的 `$AGENT_DIR/state/agents-guard/config.json`；以 0700 建目錄、0600 建檔。這是刻意設定 `checkCi:false`，不是產品預設（預設為 true）。

```json
{
  "version": 1,
  "modules": {
    "git-evidence": { "checkCi": false },
    "completion-diff-recheck": { "followUp": false }
  }
}
```

啟動後先查 status，確認全域及五個模組啟用，無未知鍵警告；不要沿用 `docs/design.md` 舊 camelCase 模組鍵。每案記錄實際 tool input／result 與檔案結果；提示文字只是測試意圖，模型沒有真的呼叫工具就是 `NOT_EXERCISED`，不是成功阻擋。

| ID | 操作 | 通過條件與證據 |
| --- | --- | --- |
| B1 | 模型使用 `write` 建立 `allowed.txt`，再 `edit` 修改 | 實際工具成功、讀回內容正確；合法操作未被誤擋 |
| B2 | 模型分別嘗試用 `write` 與 bash 重導向改寫假的 `.env.acceptance` | 每種工具都出現 `[agents-guard/hard-deny]` block reason；檔案內容保持 `fixture-only`。不能只看模型說「已拒絕」 |
| B3 | 在已核准的 fixture 測試 `git add .`；合法對照為 `git add allowed.txt` | 前者被 hard-deny 阻擋且 index 不變；後者可執行，讀回 `git diff --cached --name-only` 只含具名檔案。即使防線失敗也只能影響 fixture |
| B4 | 模型在 fixture cwd 執行 `git commit -m 'acceptance fixture'` | 原工具結果保留並附 commit card；用外部唯讀 `git log -1 --format=%H` 核對同一 repo 的實際 commit。不得以本專案 commit 代測 |
| B5 | 再執行沒有 staged changes 的 commit；另執行只輸出字串的 `printf 'git push\n'` | 前者工具失敗，後者不是 Git push；兩者都不應附成功事件證據 |
| B6 | 執行下一節的 completion 序列 | 證明成功寫入、baseline、狀態差異及 settled 事件都真的存在，而不是靠時間競速猜測 |
| B7 | 可選：推到自己建立的本機 bare repo | 使用絕對本機路徑作唯一 origin，先讀回 remote URL；模型以 `git push -u origin main` 執行。card 只證明附加行為；外部 `git ls-remote origin refs/heads/main` 才是對測試 remote 的獨立讀回 |

B7 的 `remote.git` 由操作者在 `$LAB` 內以空白 config／template 建立，與 fixture repo 無共享 object store；推送前確認沒有其他 remote、URL rewrite 或 hooks。**不建立 GitHub repo、不推真實 origin。** `checkCi:false` 下未測 CI；即使另測 `checkCi:true` 的降級輸出，也不等於本次 push SHA 的 CI 已驗證。

### 可重現的 completion 序列

使用全新 session，避免前案的寫入、baseline 或 follow-up 計數影響結果：

1. 請模型先用 `write` 建立 `completion-a.txt`，然後用 bash 執行單獨的 `git status --porcelain`，不再修改就回覆。確認兩個工具都成功；這次 settled 的快照相同，應不出差異卡片。
2. 等 Pi 完全閒置，由操作者在同一 fixture 新增 `completion-b.txt`，然後停止手動寫入。維持單一 writer 交接，不與模型同時改檔。
3. 在**同一 session** 發新訊息，要求直接回覆、不呼叫工具。成功寫入事實與舊 baseline 仍在；這次 `agent_settled` 應出現差異卡片，且 followUp 預設關閉，不自行增加模型回合。
4. 若模型自行重新跑 porcelain，baseline 已更新，本案記 `NOT_EXERCISED` 並在新 session 重做；不要把沒有 card 當成 bug。
5. 另開全新 session，只 `write` 並直接回覆、不觀察 porcelain：dirty 且無 baseline 應只提醒、不 follow-up。純讀取的新 session 則不應出 completion card。

刻意**新增檔名**，不要只改已標為 `M` 的檔案內容：目前比對 porcelain，不比對內容雜湊。需要驗 dirty→clean 時，另案在明確暫存 Git 授權下操作，不能用 restore／clean 清掉真實修改。

follow-up 上限另案：關閉舊 session，由操作者在同一測試 config 的 `completion-diff-recheck` 加入 `followUp:true` 與 `maxFollowUpsPerSession:1`；新 session 內重複製造可核對的 baseline 差異。最多應出現一次 `agents-guard-diff-followup` 請求；分別記錄請求與實際模型回合，不把成功送出請求當模型一定完成。案例後恢復 `followUp:false`。

## 6. C：雙程序、subagent 與權限載入順序

### C1：writer presence 與生命週期

- 兩個獨立前景 Pi 程序使用**同一** `$AGENT_DIR` 與 fixture cwd；session JSONL 必須各自獨立，不能讓兩程序 resume 同一 session 檔案。第二個終端使用既有 LAB 路徑，不重跑 `mktemp` 另建 namespace。
- 程序一完成啟動登記後才啟動程序二；在兩邊主動查 `status`，核對 canonical root、不同 instanceId 與 peer。這是可重現的順序啟動案例；同時啟動尚未互見不等於強鎖失敗。
- 只讓其中一個程序寫 `peer-allowed.txt`，另一個閒置觀察。writer 模組應提醒但不擋合法寫入；仍以 B2 證明其他模組能阻擋。
- 關閉其中一個，核對只清理自身 presence：以 instanceId、host、root、sessionId 等屬性比對，不只計數。另一個仍存活的記錄可正常更新 heartbeat，不要求整個檔案 byte-for-byte 不變。
- 可加做 detached／非 Git cwd／不同 repo 同名分支，分開記錄；未做不冒充已覆蓋。過期記錄是資訊不完整，不授權刪除、kill、takeover 或宣稱無其他 writer。

### C2：真實寫入型 subagent

1. 只安裝／載入核准的固定版本套件與測試專用 agent 定義；不複製真實 agent settings、auth 或整個全域套件目錄。Pi core 本身沒有標準 `subagent` 工具。
2. 在真實父 session 先成功執行 `{action:"list", capabilities:true}`，核對 agent 可執行、未停用；external runner 還要通過其 preflight，PATH 找到 binary 不算可用證據。
3. 使用該版本的正式工具契約派發一個最小 child，只准在 fixture 寫 `child.txt`。父程序停止寫入；需要平行 writer 時另建隔離 repo／worktree，不把 advisory 當鎖。
4. 記錄 parent／child run 身分、實際載入的 guard 路徑與版本、child 標記及寫入結果。**父程序用 `-e` 載入不保證 child 繼承**；須依套件支援的設定讓 child 明確載入同一副本。只驗證環境變數存在也不足以證明 guard 已載入。
5. 親自讀回 `child.txt`，並確認 parent-governed child 不新增自身 writer presence。無提醒不是零 I/O 證據；沒有可歸因的 trace 時，只報已觀察的檔案與提示行為，零 writer／completion I/O 仍引用既有自動測試，不冒充實機已證實。

未 list、高風險弱模型、external native-only 選項等政策反例已有 [純決策](../../src/modules/subagent-policy.ts)／[hook 測試](../../test/extension.test.ts)；若要在宿主中定向驗證，先另外核准不會意外啟動外部 runner 的受控 fixture。不能自造同名假工具後把它報成真實 subagent 整合，也不能要求正常工作流程違反 preflight。

child launch／preflight／tooling 失敗時，停止該案例、保存精確 run／status、cwd／repo／branch／ref 及 partial diff，記 `BLOCKED_ENV` 或 `FAIL`。不得改用另一個 CLI、互動 shell 或未受管制流程偷偷補成成功。

### C3：權限 extension 載入順序

- 在乾淨的 A 基線上，一次只加一個固定版本的真實權限 extension；設定與 package 快取只在 LAB。記錄版本、entry、載入方式、順序及測試專用規則。
- 將權限層對 fixture 的 `git add .` 設為需確認，guard 保持 hard-deny；先以明確 `-e guard-entry -e permission-entry` 測試 guard 在前。應先出 guard block、無權限詢問，index 不變。使用 B3 的合法具名 staging 做不誤擋對照。
- 另開實例顛倒順序作負向控制；若權限提示先出現即取消，不以按 Allow 作必要驗收。記錄可見順序，不能只從 flags 順序推定 handler 已如預期執行。
- 若正式預計用 `settings.json` 的 `extensions`／`packages`，還要在 LAB 重現該方式。該案需有意移除對應的 discovery 禁用／`-e`，只信任自己建立的測試設定；不要重複載入同一 extension。
- 只通過 CLI `-e` 組合，不宣稱 packages／正式安裝路徑也通過；缺真實權限套件時記 `BLOCKED_ENV`，不能用假 permission fixture 替代此結論。

## 7. D：真實模型與費用控制

D 是 B 及需要模型的 C 案例之前的授權／連線 gate，不是要求先無憑證跑完 B／C。

- 操作者指定 provider、完整 model ID、憑證來源、最多回合／費用與停止條件；child 的額外費用也計入。若宿主沒有硬預算機制，採人工逐案放行並監看，不宣稱文字限制是技術保證。
- 使用測試專用憑證；可在隔離 TUI 登入，使 auth 僅落在測試 agent 目錄。不要複製真實 `auth.json`，不要將 key 放命令列、prompt、截圖或 repo 文件。
- 若改用 provider 環境變數，只在 `clean_env` 內增加該一項，依 provider 的正式文件設定；不開啟 shell tracing、不輸出環境值。驗收工具不讀 auth；清理前只核對所在路徑與權限。
- 第一回合只要求固定簡短回覆且不呼叫工具，確認真實 provider 成功、session 與 usage 可保存後才逐案進 B／C。遇認證／費用問題停止，結果為 `BLOCKED_ENV`，不是 guard 功能失敗。

## 8. E：結果紀錄、清理與完成判準

每個案例保存下列欄位；初始結果一律 `NOT_RUN`，實際執行後才填：

| 欄位 | 內容 |
| --- | --- |
| 身分 | 案例 ID、時間、操作者、核准範圍、source SHA、Pi／Node／npm／OS／架構 |
| 隔離 | LAB／cwd／agent dir／session 檔案路徑、載入的 extension 版本及順序 |
| 輸入 | 去敏後的實際 prompt、tool name／input、有效模組設定及來源 |
| 原始結果 | tool result／block reason、CLI exit code、session custom entry、follow-up 請求與實際模型回合 |
| 讀回 | 檔案內容或雜湊、Git index／HEAD／本機 remote、presence 身分與權限 |
| 判定 | `PASS`、`FAIL`、`BLOCKED_ENV`、`NOT_EXERCISED` 或 `NOT_RUN`，附理由及證據路徑 |

非互動 extension 可能直接 console 輸出；不要假設 `--mode json` 的整個 stdout 都是純 JSON。保留 stdout／stderr 與 session JSONL，分別解析；TUI 通知則保存去敏畫面／轉錄。日誌沒有訊息不代表工具已被擋、沒有 I/O 或程序已停止。

清理順序：

1. 正常關閉本次所有 Pi／child 程序，核對啟動紀錄中的精確程序身分及結束狀態；不用廣泛 `pkill` 或 PID 猜測。未確認停止就保留 LAB 並記 blocker。
2. 在刪除前核對自身 presence 清理結果及其他記錄未被誤刪。把清整個 LAB 當成 presence cleanup 通過是錯誤驗收。
3. 去敏後將結果報告與必要證據保存到核准位置；不得打包 auth、token、cookie 或整個 agent 目錄。後續可另存 `docs/reports/<驗收日期>-isolated-acceptance-results.md`，與本手冊分開。
4. 由操作者確認 manifest 記載的唯一 LAB 路徑及無存活程序後，才刪除本次暫存根目錄；不使用 `/tmp/agents-*` 等廣泛清理，也不刪原始 repo 或原始暫存盤點報告。
5. 最後確認原始 repo 的 `git status`、`git diff --stat` 與開始時一致，且核准邊界外沒有已知副作用。不靠讀取真實 agent secrets 來證明隔離。

**完成判準：** 只對已核准且有完整證據的案例宣稱通過；實際模型、真實 subagent 或指定權限載入方式若未驗，整體只能報「部分驗收」。不得把 fixture remote 成功、既有 CI 或 hook tests 升格成真實遠端 CI／完整宿主驗收。最低 Node、取消／故障注入與其他 OS 另列範圍，不以本輪成功推論；已接受的 report-only 測試債不自動成為 blocker。

若發現 bug，保存重現與預期差異後另行取得修正授權；需要改行為時走新的 OpenSpec change，不邊驗收邊重寫既有契約。驗收通過也不授權正式安裝、reload、commit、push 或發布。

## 9. 核對來源

- [專案工具鏈與入口](../../package.json)、[設定與預設](../../src/config.ts)、[state 路徑](../../src/state.ts)（`resolveStateDir`，`:260–266`）。
- [Extension 接線與命令](../../src/extension.ts)：`session_start`／shutdown、`agent_settled`、工具事件與 `agents-guard` command。
- [Completion controller](../../src/runtime/completion-diff-recheck.ts)、[Git-evidence controller](../../src/runtime/git-evidence.ts)、[公開說明與已知限制](../../README.md)。
- [Writer 歸檔驗證](../../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/review-notes.md)、[Runtime 歸檔驗證](../../openspec/changes/archive/2026-09-10-refactor-runtime-coordination/review-notes.md)。
- Pi 旗標與環境語意依 `0.85.1` 隨附文件核對：安裝副本的 `node_modules/@earendil-works/pi-coding-agent/README.md`、`docs/environment-variables.md`、`docs/extensions.md`、`docs/settings.md`、`docs/packages.md`、`docs/providers.md`、`docs/session-format.md`。執行時以同一副本的完整 help 與文件再核對，不用其他版本的成功代替。
