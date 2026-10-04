# Pi 安全方案比較：erichll、carderne 與 agents-guard＋pi-guard

日期：2026-09-11。方法：GitHub 搜尋定位後，讀取固定 commit 的 README、manifest、關鍵實作與 CI 定義；本地讀取目前 source、已安裝 pi-guard 及既有驗收報告。這是架構與來源碼比較，不是完整安全稽核、滲透測試或效能 benchmark。本輪沒有安裝、啟用、切換任何安全套件，也沒有修改產品程式或設定。

## 結論

- **以安全隔離與最小權限為優先，兩個外部方案選 erichll/pi-packages。** 它的 OS 沙箱、靜態檔案限制、逐連線授權、受信任設定與每命令獨立 broker，比 carderne 的互動便利取向更適合安全優先部署。
- **不建議現在用它整套替換本專案＋pi-guard。** 防護層次不同，而且其受保護 pi-subagents 模式會拒絕目前使用的 workflow scripts、named workflows、external CLI runners，並移除 child 的 write/edit 與其他 extension tools。
- 長期方向是保留 agents-guard 的流程政策與證據功能，再評估 OS 隔離及權限層遷移。erichll 可能取代 pi-guard 的部分角色，但不是現成、等價的替換；不得把尚未做過的共存驗收當作相容保證。

## 1. 比較基準與版本落差

| 對象 | 本次讀取來源 |
| --- | --- |
| erichll/pi-packages | commit `24f17992f638ea0f421bb39de1d339cf92ad96de`；sandbox 0.17.1、auto-review 0.17.0 |
| carderne/pi-sandbox | commit `31fa5060689624467c1aeace2664ce91784522ff`；pi-sandbox 0.6.8 |
| agents-guard | 本地 HEAD `3df8f9d4287591de85aa8c056ee77a74501f3054`；0.1.0；README 存在本輪以前的未提交修訂 |
| pi-guard | 本機已安裝 1.4.0；另核對既有隔離驗收文件 |
| 本地工作流程參考 | Pi 0.85.1、pi-subagents 0.67.0；Darwin arm64／Node 22.23.2 的既有選定案例 |

以上是 repo/source 快照，不宣稱 npm 上目前發布內容與其逐 byte 相同。

**重要文件落差：** erichll 的根目錄與 sandbox README 仍寫 pi-subagents 精確 0.65.0；現行 manifest 已是 `>=0.66.0`，實作接受 major 0、minor >=66，還查 export／capability ceiling／discovery internals。不能因 README 就斷言 0.67.0 一定被版本閘門拒絕，也不能因版本通過就宣稱可直接使用完整工作流程。[E2][E3]

依實際 manifests，erichll 的 Pi peer 是 `^0.85.0`，auto-review 的 permission-system peer 是 `>=29.3.0 <32.0.0`。carderne 的 Pi peer 是 `^0.80.0`；0.x caret 不等於涵蓋 0.85.1。本機 pi-guard 1.4.0 宣告精確 Pi 0.79.1，雖有 0.85.1 選定實測，peer 落差仍存在。[E2][E7][C4][L4]

## 2. 威脅模型

本比較區分四類問題：

1. **誤操作與流程違規：** 廣泛 staging、force push、未做派發前置檢查、漏附驗證證據。
2. **不可信命令及相依程式：** shell 內的 Python/Node、安裝腳本或建置子程序讀寫工作區外資源、連外。
3. **秘密與資料外洩：** 工作區內秘密、程序環境變數、合法網域內的攻擊者帳號／上傳位置。
4. **宿主／供應鏈信任：** Pi extension 在主程序內執行任意 Node.js；安全 extension 本身及其安裝位置必須可信。

OS 沙箱對第 2 類有本質優勢，但「可寫工作區」不等於「只能做正確的 Git 操作」；網域 allowlist 也不等於完整 DLP。所有方案都不能單憑工具攔截器宣稱惡意宿主 extension 已被隔離。Pi 官方 packages 文件明示 extensions 擁有完整系統權限。

## 3. erichll 與 carderne

| 面向 | erichll/pi-packages | carderne/pi-sandbox |
| --- | --- | --- |
| 組成 | sandbox＋模型審批 broker；完整 permission 接線需另裝 gotgenes permission-system | 一個 sandbox extension，Bash＋read/write/edit 攔截 |
| Bash OS 限制 | Anthropic runtime 0.0.75；Linux bubblewrap、macOS Seatbelt | carderne runtime fork；相同類型 OS 機制 |
| 檔案越界 | 靜態政策；執行時檔案拒絕不自動轉成動態 allow | 提示可授予 session、project、global 權限 |
| 授權語意 | deterministic hard deny 先行；模型審批；精確、到期、一次性 grant | denyWrite 硬擋；denyRead 可被 allowRead／allowWrite 蓋過 |
| 網路 | deny > allow > 對未匹配 public hostname:port 逐連線審批；拒絕 allow 的裸 `*` | 預設放行常見 GitHub/npm/PyPI domains；可加入 `*` |
| 設定信任 | sandbox 持久設定限 global；reviewer project overlay 只可收緊 | project scalars 覆蓋 global；path/domain arrays 合併，可增加權限 |
| 暫存 | 每命令私有可寫 temp 子目錄；共享 temp 根不開放寫入 | 預設 allowWrite 包含 `/tmp` |
| 併行 | 每 Bash／persistent worker 有自己的 broker/runtime | 每 extension session 一個 manager，供該 session 命令重用；父子 session 分離 |
| 子代理 | builtin 可包住完整 worker process tree；native pi-subagents 只有嚴格工具邊界 | session manager 隔離不等於完整 worker OS 隔離；需確保 child 實際載入 extension |
| 成本 | 組件、相依 API、模型認證與排錯成本較高 | 設定及人工使用較直接；不另外呼叫 reviewer LLM |
| 平台證據 | CI 明確安裝 Linux 原生依賴；原生 macOS smoke 仍列待補 | CI 是 Ubuntu 的 TS/lint/tests；不能據此宣稱 macOS OS 邊界已驗收 |

### 安全選擇的決定性理由

**carderne 初始化失敗會 fail-open。** `enableSandbox` 捕捉例外後設定 `sandboxEnabled=false`；Bash execute 在未 enabled/initialized 時呼叫 `localBash.execute`；tool_call 也在未 enabled 時直接返回。這不是只有少一個鎖頭圖示，而是實際繼續未沙箱化執行。此為來源碼可確認的控制流；本輪未故意破壞真實環境重現。[C1：130–136、172–175、283]

此外，macOS `allowUnauthenticatedSocksProxy` 預設 true；README 明示其他本地程序若找到 proxy port 也能使用。browser 範例開放 local binding／Unix sockets，不應整份套用到敏感環境。`src/sandbox-runtime.ts:90` 另固定設定 `enableWeakerNetworkIsolation: true`；本輪未審完 runtime fork，不把此旗標推導成未驗證的具體逃逸。[C2][C3][C5]

**erichll 較嚴格，但不是全面 fail-closed 的魔法保證。** Bash runner 不具同類的 init-error local fallback；但 extension 自身載入失敗時，仍須核對 Pi 最終 active tool owner，不能只依 package 已安裝就相信原生 Bash 已被替換。可選 hostIPC 模式經批准後會刻意在 OS 沙箱外執行，預設 off。[E4][E5][E6]

### 維護與使用性取捨

- erichll 安全契約更清楚，但多套件依賴、模型審批、pi-subagents private discovery/config internals 及過時 README，提高升級驗收成本。
- carderne 更適合操作者持續在場、重視快速授權、能容忍較寬權限的普通開發。但其 init fail-open 與較寬設定，不適合當敏感工作負載唯一防線。
- 不以 star 數、套件數或測試數直接推論安全成熟度；本輪未取得三方可比較的 production failure rate 或獨立安全稽核。

## 4. erichll 能否替換 agents-guard＋pi-guard？

| 能力 | erichll 完整接線 | agents-guard＋pi-guard |
| --- | --- | --- |
| interpreter／子程序越界檔案操作 | 受沙箱政策約束的 Bash process tree 有 OS 限制 | AST、路徑與工具列舉；非 OS 邊界 |
| 網路目的地限制 | 沙箱內的實際連線檢查 | 命令／工具授權，不是網路封鎖 |
| 主程序 read/write/edit | 依 permission-system 配置；不是主程序 OS 隔離 | pi-guard 路徑規則＋agents-guard 指定寫入路徑硬擋 |
| 禁用 `git add -A`／`git commit -a`／force push 等 | 可另外建權限規則；沒有本專案整套等價預設 | 本專案已有不提供單次放行的固定規則 |
| 派發前 capabilities list | 無本專案的等價 session 規則 | subagent-policy 觀察成功 list 後才接受指定執行型呼叫 |
| 高風險 review 模型／external runner 參數 | native protected mode 直接限制 runner/tools，不等價於原政策 | 對明確 model 與 agent/task pattern、external native-only 欄位檢查 |
| worktree／session writer 提醒 | 未見等價模組 | 有 advisory presence；不是互斥鎖 |
| commit／push 後補證據 | policy audit 是授權統計，不是 Git 結果驗證 | git-evidence；upstream 只是本地 tracking ref，CI 只列近期 runs |
| 完成後重查 Git dirty 狀態 | 未見等價功能 | completion-diff-recheck；porcelain 比較，不是內容 hash |
| 失敗與 headless | reviewer 預設失敗拒絕；也依 permission-system／adapter 流程 | pi-guard 無 UI ask/deny 拒絕；agents-guard 自己的模組例外會 fail-open |

本專案的重要邊界：`src/index.ts:79–128` 明確採 fail-open，例外當次回 pass，累積三次後模組 inert；不是「前三次仍然硬擋」。`src/modules/hard-deny.ts:9–13,68–130` 是列舉式控制，不能把未辨識 interpreter 的間接寫入當已保護。pi-guard 1.4.0 的 Bash pattern deny／ask 同進互動 Allow 選單，但 glob/exact 工具的 deny 仍硬擋；不可概括成所有 deny 都失效。[L1][L2][L3]

### 不能直接替換的工作流程衝突

現行 erichll native protected mode 的實作仍然：

- 僅允許 direct agent launch 且 `async:true`。
- 拒絕 `workflowScript`、`workflowScriptPath`、named workflows 及 resume；限制其他管理操作。
- whitelist agent 必須是 native Pi runner，不能是 codex-exec／Claude／Cursor external runner。
- child tool ceiling 僅 `bash/read/grep/find/ls`，不含 write/edit、MCP、其他 extension tools。

因此，即使本機 pi-subagents 0.67.0 通過版本檢查，仍與目前 `runs.all`／workflowScriptPath 等工作流程不等價。其 builtin provider 換成自有 start/follow_up/handoff API，可換得完整 worker OS 隔離，但會更換既有 orchestration，不是 drop-in。[E3][E4]

若把 provider 設為 `off` 保留原 orchestration，只能主張這個 adapter 保護所接管的 Bash；不能繼續宣稱所有 child/extension 路徑具同等隔離。兩個 sandbox 都接管 Bash，也不應同時安裝以期待「雙倍保護」。

## 5. 效能與資源成本

**沒有三方同機、同版本、同工作負載的測量，不能報告快幾倍或固定毫秒。** 以下是實作導出的成本構成，而不是 benchmark 排名：

| 路徑 | 主要額外成本 |
| --- | --- |
| agents-guard＋pi-guard 自動允許 | 本地 AST、規則／路徑解析；沒有審批 LLM。特定事件才額外跑 Git/gh、presence I/O |
| carderne 自動允許 | session manager 重用；每命令 wrapper／OS sandbox／proxy；hook 中有 config 檔案讀取 |
| erichll 自動允許 | 每 Bash 建立 broker/runtime、private temp、建立 policy；policy 含最多深度 4 的同步秘密檔案掃描 |
| erichll 動態批准 | 再加模型請求、網路等待、token 費用及審批紀錄；不匹配 static allow 的 eligible public 連線逐次 review |
| 人工 ask | carderne／pi-guard 都可能把操作者等待時間帶入 end-to-end；CPU 快不等於工作完成快 |

純本地、無審批的短命令，現有 stack 通常有較低架構開銷；carderne 重用 manager，預期比 erichll 每命令冷建 broker 較省初始化成本，但整體耗時仍需量測。大型 build 時，這些固定成本可能被 build 時間稀釋；大量短 Bash 或多個未 allowlisted 連線則可能放大差異。[E5][E8][C1][C5]

Auto-review defaults 是 reviewer input 預算 8192（UTF-8 byte 保守估 token）、max output 256、共享 deadline 90000 ms、grant TTL 60000 ms。**這些是限制，不是平均 token 數、平均延遲或每次 90 秒。** 合法靜態允許不必經 LLM；頻繁人工審批場景，模型自動允許也可能改善總完成時間。[E7][E8]

既有本專案驗收的 parent 35.905 秒與 child 補測 parent 34.672 秒包含模型、工具、派發與驗收操作，沒有無 guard 對照，不拿來當 guard overhead。[L4]

若後續決定導入，才在 disposable 環境比較：冷啟動、100 次小型 read/Bash、一般 build、domain allow／review、同等 child task；分別報 p50/p95、CPU/RSS、模型 usage、人工等待及拒絕率。不得用測試套件總耗時比較產品效能。

## 6. 仍然不能忽略的共同風險

- **秘密 write deny 不等於 read deny。** erichll 預設 allowRead 包含 workspace，秘密掃描主要建 denyWrite；兩個 OS sandbox 都不能只因有 `.env` 寫入規則就被稱為秘密隔離。主程序讀檔規則也不自動延伸到任意 shell interpreter。[E6][C2]
- Bash runner 傳遞環境；沒有證據支持自動清除所有 API key。使用低權限憑證、必要的 env allowlist，且不要把 secrets 放在可讀 workspace。
- 允許 github.com 等多租戶目的地，仍可能允許向攻擊者控制的位置傳送資料；網域限制不是 DLP。[E1]
- 任意主程序 extension 的 Node fs/fetch/child_process 不會因接管 Bash 就全部進沙箱。要應對惡意 extension／高敵意 repo，考慮把整個 Pi 放在最小 mount、受控網路的 container／VM；不要掛載 Docker socket 或不必要的 host secrets。
- 安全控制的可修改 source 必須受保護。現有 agents-guard 的 local-path 安裝直接指向 checkout，沒有搬移成不可寫副本；其預設 protectedPaths 不是自動保護任意 checkout。erichll 對正式安裝位置的設計較嚴格，但仍依賴正確載入與宿主信任。

## 7. 建議採用順序

1. **現在保留已驗收的現有 stack；不要為了比較直接卸載。** 已知它是防誤操作／流程補強，不是敵意執行環境。
2. 外部兩者安全優先選 erichll；需接受多組件、模型審批與 workflow 能力縮減。carderne 僅在便利性優先、人工在場且有其他隔離時考慮。
3. 保留 agents-guard 的政策／證據功能；若選 erichll，另做 permission-system 規則遷移與載入順序、active tool owner、錯誤 fail-closed、child tools／認證及 macOS 實測。不是直接疊加所有 permission extensions。
4. 若不能放棄目前 native workflows、external reviewers 與 extension tools，優先研究**整個 Pi 的外層隔離**，而不是把 erichll provider 關成 off 後宣稱已取得完整子程序隔離。

## 來源

- [E1 erichll sandbox README](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/README.md)
- [E2 erichll sandbox manifest](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/package.json)
- [E3 native compatibility／launch policy](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/src/pi-subagents-native.ts#L14-L225)
- [E4 sandbox registration／tool surfaces](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/src/index.ts)
- [E5 per-command broker](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/src/runner.ts#L164-L283)
- [E6 filesystem policy](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/src/policy.ts#L225-L308)
- [E7 auto-review README](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-auto-review/README.md)；[manifest](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-auto-review/package.json)
- [E8 reviewer defaults](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-auto-review/src/config.json)
- [C1 carderne extension lifecycle／fallback](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/src/extension.ts#L101-L180)
- [C2 carderne defaults／merge](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/src/config.ts)
- [C3 carderne README](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/README.md)
- [C4 carderne manifest](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/package.json)
- [C5 carderne runtime adapter](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/src/sandbox-runtime.ts)
- L1 本專案 `src/index.ts:79–128`、`src/modules/hard-deny.ts:9–13,68–130`、`src/config.ts:10–51`。
- L2 本機 `<USER_HOME>/.pi/agent/npm/node_modules/pi-guard/src/handlers.ts:107–178`，另比對一般工具的 `handleToolApproval`。
- L3 本機 `<USER_HOME>/.pi/agent/npm/node_modules/pi-guard/src/extract.ts:290–304`；本專案 README 已補述 shell redirect 與 symlink 的覆蓋限制。
- [L4 父程序既有驗收](2026-09-11-final-stack-results.md)＋[child 補測既有驗收](2026-09-11-child-permission-retry-results.md)。本輪只有重讀，沒有重跑。

## 驗證限制

本輪未安裝兩個外部專案的 dependencies、未執行原生沙箱／模型審批／相容性 gate、未跑效能量測；因此安全控制流的結論是來源碼查證，平台能力部分是官方文件及 CI 定義，不是本輪 OS 實測。沒有更改 source，未重跑產品 tests/typecheck。既有未提交 README 與其他文件全部保留。
