# 專案收尾：文件與分支／worktree 核對

日期：2026-09-11（臺北時間）。範圍為使用者要求的已合併資源清理與功能／安裝／使用文件整理；後續另獲逐名確認，刪除兩條已合併遠端分支。不含產品修改、正式安裝、設定變更、新 commit／文件內容推送或新模型驗收。

## 結論與剩餘事項

- 本機只剩 `main` 與主 worktree `<REPO>`；沒有可刪的本機 feature branch 或額外 worktree，`git worktree prune --dry-run --verbose` 也沒有候選。
- 遠端兩條 feature branches 經操作者逐名確認後，**已刪除並向遠端讀回驗證**；目前只剩 `main`，SHA 未變、無 open PR。本機對應 tracking refs 也已移除；未提交或推送新文件內容。
- 更新 [README](../../README.md)，新增[操作手冊](../user-guide.md)與[文件索引](../README.md)，保留原十四份報告／去敏證據的 bytes 與當時結果。
- source archive 的 fresh tests／typecheck／lint、原工作目錄唯讀 lint、文件 render 與範例檢查均通過。Codex review 的一項 P2 已由主 agent 查證並修正文案；另一個安裝 reviewer 因憑證失敗，**雙 review 未全數完成**，未自行重跑或改模型。

## 1. Git 核對證據

Repository：`https://github.com/chinlung/pi-agents-guard.git`，private，default branch `main`。

刪除前實際 `git ls-remote --heads origin` 讀回（保留原 tip 作為 merge 證據）：

| Ref | SHA | 判讀 |
| --- | --- | --- |
| `main` | `3df8f9d4287591de85aa8c056ee77a74501f3054` | 與本機 HEAD 一致 |
| `refactor/progressive-b` | `2cc6b875ef9e0273037e7980763055f95509a339` | main 的祖先；已確認刪除 |
| `refactor/runtime-coordination` | `fe4f564a6d3522758526fa422fc74c70d280ac92` | main 的祖先；已確認刪除 |

兩次 `git merge-base --is-ancestor <完整 tip SHA> HEAD` 均 exit 0。另讀 merge parents：

- `bc114950e9ebf8967642007cc99f04522e44fc63` 的第二個 parent 是 progressive-b tip。
- `90e055ebf25f65261f52b9901cf4356be10e6b39` 的第二個 parent 是 runtime-coordination tip。

因此是實際 ancestry 證據，不用分支名稱、`[gone]` 或 `--no-merged` 猜測；不需要虛構 squash PR。依兩個 head 查 closed PR API 都回空陣列，`gh pr list --state open` 也回 `[]`。

操作者在逐名詢問後回覆「是」。執行前重新核對唯一 fetch／push URL、main／兩個 tip SHA、ancestry、open PR 與 pre-push hook（不存在）。使用 `git push --atomic --delete`，另對兩條 ref 各帶精確 `--force-with-lease=<ref>:<原 tip SHA>`，只在 tip 未變時刪除；`--no-follow-tags` 與 `--recurse-submodules=no` 限定副作用範圍。這不是一般 force 更新，沒有推送任何新 commit。

Git 命令 exit 0，兩條分支均回 `[deleted]`；沒有 guard 拒絕、停用或改工具繞過。**15:25:20 +08:00** 的獨立讀回確認：遠端 heads 只剩 `refs/heads/main`，SHA 仍為 `3df8f9d4287591de85aa8c056ee77a74501f3054`；open PR 為 `[]`；本機 refs 僅 `main`、`origin/main`、`origin/HEAD`，兩條 tracking refs 已隨 push 移除，不需額外廣泛 prune。沒有切分支、移動 HEAD、移除主 worktree 或改 staged diff。

此後續步驟僅遠端 ref 清理與本報告狀態更新，不改八項產品契約，不新增 OpenSpec change，也未重跑產品 tests 或模型驗收；下方 411 tests 屬同日文件收尾階段的實際結果。CI 僅監聽 main push／PR，此次刪除 feature refs 不觸發新程式 CI；不以舊 CI 冒充新的執行結果。

## 2. 文件範圍與正確性

| 檔案 | 本次整理 |
| --- | --- |
| `README.md` | 文件入口、最新準備度、完整依賴、local package 與順序、五層設定、CI／實機邊界、pi-guard Bash deny 精確範圍、completion 與 inert 限制 |
| `docs/user-guide.md` | 五模組、前置需求、試用／持續載入、備份、正式讀回、命令與完整選項、child 最小權限、日常 SOP、卸載／回退、排錯與開發 |
| `docs/README.md` | 目前入口、各批驗收與去敏 JSON、canonical specs、歸檔／歷史文件的權威界線 |
| 本報告 | 清理候選、merge 證據、驗證範圍、原報告完整性與待批准事項 |

不改 source、package／lockfile、tests、正式 settings 或歷史 OpenSpec artifacts。Public API、data contract、schema、migration、backward compatibility、security／permissions、concurrency／consistency、cross-module behavior 八面均不變；`openspec list --json` 為空 changes，因此不新開行為變更。

本次是文件整理，沒有新增產品測試行為，不做形式化的產品 RED→GREEN；範例改以 parser／現行函式核對及負控制驗證。文件中的安裝、移除與權限片段是操作者執行指南，**本輪沒有實際執行正式安裝／卸載或套用規則**。

來源核對包含 `src/config.ts`、`src/types.ts`、`src/extension.ts`、各模組與 runtime；第三方入口依已安裝 Pi 0.85.1 的完整 packages／settings／quickstart 文件、install／remove help，以及 pi-guard 1.4.0 的 README／source。chub 搜尋沒有適用 Pi API 文件，不套用不相關套件結果。

## 3. Fresh 驗證

為避免在原 repo 安裝 dependencies，建立唯一暫存目錄 `<LAB>`，以 HEAD 的 Git archive 展開；87 個 tracked files 初始 SHA256 逐檔一致。Node `22.23.2`／npm `10.9.8`，此暫存測試沒有驗收用模型 prompt、OAuth snapshot、正式 Pi extension 載入或新的整合案例；文件 reviewer 的模型工作另列，不混入產品驗收。

| 命令／檢查 | 本輪結果 | 範圍 |
| --- | --- | --- |
| `npm ci --no-audit --no-fund --ignore-scripts`（temp cache） | exit 0，179 packages | 只在暫存 source 安裝；原 repo 無 node_modules |
| LSP primary | 2 files，0 diagnostics | 暫存 source 的 `src/index.ts`／`src/extension.ts`，先於型別／測試檢查 |
| `npm test` | exit 0，**411 tests／18 files PASS**，Vitest 1.68 秒 | HEAD source；不是重跑模型驗收 |
| `npm run typecheck` | exit 0 | `tsc --noEmit` |
| `npm run lint` | exit 0，41 files | HEAD source，無 autofix |
| 暫存安裝的 `biome check .`（cwd 原 repo） | exit 0，46 files | 含現有五份 evidence JSON；無 autofix |
| GitHub run `34515942965` 新讀回 | completed／success，headSha 符合 HEAD | 既有 main CI，不是此次文件的新 CI |

既有 CI 連結：[34515942965](https://github.com/chinlung/pi-agents-guard/actions/runs/34515942965)。文件整理沒有推送新 commit，因此沒有為新文件觸發新的 CI；後續僅刪除兩條 feature refs。精確最低 Node、其他 OS／TUI 與新的 parent／child 模型功能驗收皆未重跑；前述 411 tests 是此次新跑，不冒充那些實機項目的新證據。

文件首輪檢查：四份 Markdown 實際 render／AST 共 16 表格、69 條相對連結通過；6 個 JSON／JSONC blocks（本輪均可用 strict JSON parse）、12 個 Bash blocks 的 `bash -n` 通過，安裝／移除範例沒有執行。另從 env 範例取出 JSON；四份 agents-guard config 以現行 `resolveConfig` 驗證，未移除預設 hard-deny。暫存 Vitest 另跑 4 個文件檢查通過（不合併進產品 411 tests）；錯誤 camelCase module 與 broken-link mutant 均被檢查器拒絕。pi-guard 範例僅核對 JSON 形狀與窄路徑，不冒稱新權限實機測試。

修後再驗：16 表格、70 條相對連結、5 個 JSON blocks、12 個 Bash blocks 通過；移除縮短的 subagent-policy 範例後，現行 resolver 核對 3 份 config。暫存文件檢查增為 **5 tests／1 file PASS**（141ms），新增直接呼叫 `resolveStateDir`／`matchesProtected`，確認自訂 state 路徑不會動態加入預設 protected patterns；這是 pure-function 核對，不是新的模型安全測試。原十四份報告及 child retry 中原十二份 hash 鏈逐項符合，除 README 外的 86 個 tracked files 不變。

### 獨立 review 與主 agent 判讀

單一 async workflow `00a271e7-7b7a-4ede-bd4a-9d99c7aa3cb3`，fanout 2/2；兩個唯讀 child、沒有第二派發或修正 writer。

- **installation-review／reviewer：失敗。** Child `ea204ffb-df34-4b51-9372-980f07145d18`；設定解析為 `amazon-bedrock/global.anthropic.claude-opus-5`，回報 `Could not load credentials from any providers`。當時 `main`／HEAD 仍為上述 SHA，worktree 為原 repo，只有本次文件 diff 與原證據；已捕捉 partial diff，不擅自重試、改正式憑證或換執行協定。
- **evidence-review／codex-exec：完成，OK with notes。** Child `3f507d2e-ef23-419e-b797-081383ec9544`，無 P0／P1，1 項 P2。核對十四份 hash、歷史分類、69 條當時連結、五模組限制；沒有冒稱 reviewer 重跑產品測試／遠端查詢。結果曾從實際保存檔讀回：`~/.pi/agent/sessions/<REPO_SESSION_NAMESPACE>/subagent-artifacts/outputs/00a271e7-7b7a-4ede-bd4a-9d99c7aa3cb3/closeout-evidence-review.md`。
- **P2 已採納：** `src/state.ts:260–266` 只搬移 state；`src/config.ts:26–49` 與 `src/lib/paths.ts` 沒有動態擴張保護。已在 README／使用手冊明示自訂目錄限制，只修文案，不修改產品或正式規則。
- **可選小修已採納：** README「三個」清單改為四個；刪除會降低檢查覆蓋的局部清單示例，改連到完整預設並明示整份替換。主 agent 另修正原有 symlink 範例，限定為呼叫前已存在且可解析的連結，不保證同一尚未執行的 shell 才建立的 alias。
- 修後主 agent 重讀文件差異、重跑相關文件／設定檢查；沒有第二個獨立 reviewer 重審修後版本。Workflow complete 只表示兩個 child 已收束，**不把失敗 lane 記為 PASS**。安裝角度缺少獨立審查仍是覆蓋缺口，不能用單一 reviewer 或主 agent 自審冒充雙審。

## 4. 原十四份證據保全

以下均位於 `docs/reports/`，收尾前建立 SHA256 baseline，最終逐項讀回比對；不因新成功覆寫原始 failure／partial。最新 child retry 的 `audit.priorReports` 亦保留原十二份 baseline。

| 檔名 | SHA256 |
| --- | --- |
| `2026-09-11-child-permission-retry-evidence.json` | `1640d264e81ce3060a4dcb6471aa9e7ec56a51136f3804e3f4e022d56f8c2aa4` |
| `2026-09-11-child-permission-retry-results.md` | `5fb23c8da8db792f07ef52a0f973ae5e81c8b5fab61aeaca79eb9643a4c315af` |
| `2026-09-11-discovery-forwarding-evidence.json` | `ea39d9449a3fade4b762437a7e3ef4449fcbf8722a92a9707ad3e62b55b216cd` |
| `2026-09-11-discovery-forwarding-results.md` | `bd2f63a5b20eecc9cd078e57eedfd25b78bf5f20b0b2b9d23b3f924d22c38eae` |
| `2026-09-11-final-stack-evidence.json` | `c620c8462705bcc2c6da1168f1204458c45d5b809104078666049d087c9502c3` |
| `2026-09-11-final-stack-results.md` | `e5363b1bec5fa29a33b3f3272927d42b80863369d78b13aa1e228a326a83e91b` |
| `2026-09-11-functional-acceptance-evidence.json` | `8b50e3bb5d82a3d20b00dfc0a073f994df7f65b946ec03176dc51f9ce9c63c80` |
| `2026-09-11-functional-acceptance-results.md` | `3ba0d2cdc97774a1cd1d80420da6b8905d1b94a232e2bc1a4bfdc9129bef1673` |
| `2026-09-11-integration-acceptance-evidence.json` | `4f7df82bacefab028517b655d47220a024c1775735773115f13c9a1ebd597aa5` |
| `2026-09-11-integration-acceptance-results.md` | `4087c75183791bb26b72b2179b7c9e595c872113eec779eb234bf6cb093c3729` |
| `2026-09-11-isolated-acceptance-results.md` | `351ee9efa7ff53ef71330d71d611530ff2602fbf1c6ab4160d5e3ca8e83865a7` |
| `2026-09-11-model-acceptance-blocked.md` | `963b9e1bd6752134ed44d6ccd369cd67cb75d06460c89dc13e67ac78b7cb2015` |
| `2026-09-11-oauth-connection-retry.md` | `062e42d215183f1237a14a539fbd9fc6401f736d65933d4c29ee2b28460b91a3` |
| `2026-09-11-permission-forwarding-impact.md` | `5b54e36003cfdf69fb489d7bbf7322a2b99252c84a66f28894ef1b19a2f65ec8` |

明確保留：歷史 discovery forwarding `FAIL_COMPATIBILITY`／driver exit 1／fail-closed PASS、正式組合第一輪 `PARTIAL_PASS_CHILD_NOT_EXERCISED`／driver exit 1，以及另行核准 child retry `PASS`。新的總結不反改舊檔的當時結論。

## 5. 剩餘動作與清理

- [x] 核對本機 worktree／branch：沒有多餘項目，不移除主 worktree。
- [x] 核對遠端 tips 完整包含於 main、沒有 open PR。
- [x] 取得兩條遠端分支逐名確認後刪除，再向遠端讀回：只剩 main，SHA 不變。
- [x] 更新功能／安裝／使用文件；原十四份報告保持原樣。
- [x] 完成文件驗證及可用 review 意見的主 agent 收斂；雙 review 為一完成／一認證失敗，不宣稱雙審全過。
- [x] 定點清理暫存驗證目錄，並讀回確認路徑與程序不存在。
- [ ] 若要提交／推送本次文件與原證據，另行明確授權。
- [ ] 若要正式安裝／設定／新 session 讀回，另行核准操作範圍。

初次廣域 `find ..` 盤點在 60 秒逾時；未產生修改，後續改為 repo 範圍與明列父目錄檢查，未找到專案 AGENTS.md／CLAUDE.md，另確認沒有遺留 find 程序。這是盤點命令逾時，不是產品測試失敗。

**15:13:18 +08:00 已定點刪除 `<LAB>`，310,305,661 bytes（約 295.93 MiB）**，`/tmp` 別名亦不存在；source、dependencies、temp npm cache、測試／renderer helpers、輸出與暫存 partial diff 均已清理。保留本報告、原證據與 pi-subagents 管理的 review artifacts，不清共用 cache、正式 state 或其他 session 資料。

LSP 是宿主 Node 24.19.0，使用本輪 source 的 TypeScript，並曾存取共用 `<USER_HOME>/Library/Caches/typescript/5.9`；不混算產品驗收的 Node 22.23.2。原專屬 PGID 36610（PID 36610／36611／36612／36613）在清理前已自行消失。第一個清理 helper 因仍要求四個 live members 而 assertion 退出，發生在任何 signal／刪除之前；改以 fresh OS 查詢核對四個 PID／PGID 均不存在、程序 command／cwd 無本目錄 references 後才刪除。**未送 signal，也不虛構 LSP exit code／kernel exit event。**

結尾維持 HEAD／staged diff 不變，原 repo 無 node_modules；本次只有 README 修改與三份新文件，外加原十四份 untracked 報告。兩條遠端分支已依後續確認刪除並讀回；沒有正式安裝、提交或推送新的文件內容。
