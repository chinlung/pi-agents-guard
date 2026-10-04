# 安全組合選擇：原生主機與 container／VM

日期：2026-09-11。延續[前輪比較](2026-09-11-sandbox-comparison.md)的固定版本：agents-guard 0.1.0／HEAD `3df8f9d4287591de85aa8c056ee77a74501f3054`、pi-guard 1.4.0、carderne 0.6.8／commit `31fa5060689624467c1aeace2664ce91784522ff`、erichll sandbox 0.17.1＋auto-review 0.17.0／commit `24f17992f638ea0f421bb39de1d339cf92ad96de`。

本輪只有文件與唯讀政策 probe；沒有安裝、啟用、移除或修改安全套件，沒有啟動 child、container 或 VM。下述為來源碼查證與設計建議，不是三方整合／安全／效能實測認證。

## 決策摘要

1. **不使用 container／VM，且安全優先、可接受工作流程調整：選本專案＋erichll 完整權限／沙箱組合，先完成整合驗收。** 不是直接疊裝就可宣稱安全。
2. **既有工作流程完全不改：本專案＋pi-guard 是目前已有選定驗收證據的選項，但不是最強隔離。** 在已查三種組合中，尚無證據支持「原樣保留所有 workflow／external tools，且獲得 erichll 完整 worker 隔離」。
3. **本專案＋carderne 不等於前者的嚴格安全升級。** 它增加 Bash OS 隔離，卻移除了 pi-guard 的一般操作批准；且初始化 fail-open、自身設定保護都有缺口。
4. **外層已正確隔離整個 Pi 時，日常建議 container／VM＋本專案＋pi-guard。** 此時 permission guard 用於工作區及遠端操作的誤操作防護；不是宿主隔離必要元件。內層 erichll／carderne sandbox 不必預設重複安裝。

## 1. 三種組合的公平定義

- **A：本專案＋pi-guard。** 保留既有本地政策、一般工具／命令 ask 與結果證據；沒有 OS sandbox。
- **B：本專案＋carderne。** 沒有 pi-guard；carderne 負責 Bash 沙箱與 read/write/edit 檔案邊界提示，不自動取得一般命令批准系統。
- **C：本專案＋erichll。** 指 agents-guard＋`@erichll/pi-sandbox`＋`@erichll/pi-auto-review`＋已安裝並接線的 `@gotgenes/pi-permission-system`。只安裝 sandbox 不足以等價比較完整權限系統。

共同前提：保留本專案的 hard-deny、Git evidence、completion recheck、writer advisory；但 API 契約改變時，subagent-policy 不自動等價。評估順序為宿主／秘密暴露、越權與持久放寬、授權品質、workflow 可用性、成本，不以未實測的數字打分。

## 2. 優劣配比

| 面向 | A：＋pi-guard | B：＋carderne | C：＋erichll 完整組合 |
| --- | --- | --- | --- |
| 本專案列舉的固定硬擋 | 有 | 有 | 有 |
| 工作區一般 write/edit | pi-guard 預設 ask；可窄範圍 allow | 位於 allowWrite 的一般檔案直接允許，不必問 | 依 permission-system 規則，可建立窄範圍 allow＋其他 ask/deny |
| 一般 Bash 狀態變更／遠端操作批准 | pi-guard 命令規則 | 沙箱只判斷資源權限，沒有等價的一般命令批准層 | permission-system＋reviewer，依配置與上下文判斷 |
| Bash 的 interpreter／子程序越界 | 非 OS 邊界，可能超出列舉覆蓋 | OS 邊界較強，但前提是初始化成功及政策足夠窄 | OS 邊界較強，靜態檔案限制、逐連線網路審批 |
| 網路隔離 | 無真正的 egress enforcement | 有，但預設放行常用服務 | deny > allow > 對未匹配 public 目的地動態審批 |
| 自身設定防修改 | 本專案保護列舉的 Pi 設定；任意 source checkout 不保證 | `.pi/sandbox.json` 未被本專案預設保護，且 carderne 預設允許寫入 | global trusted config／installed package 保護較嚴格；仍須確認實際載入與工具所有權 |
| 初始化或模組錯誤 | agents-guard 模組錯誤 fail-open；pi-guard 不因此必然停用 | carderne init 失敗改跑 local Bash；agents-guard 不接管 OS 隔離 | Bash runner 沒有同類自動 local fallback；整個 extension 載入失敗仍要另外驗證 |
| 主程序任意 extension 的 fs/fetch | 沒有全面 OS 隔離 | 沒有全面 OS 隔離 | 沒有全面 OS 隔離；builtin worker 外層隔離不等於主 Pi 被隔離 |
| 保留現有 workflows／external runners | 有選定既有驗收及現有介面 | 不主動替換 subagent，但不代表所有 child 已載入保護 | native protected mode 禁 workflow scripts／external runners；builtin 換成不同 API |
| 自動允許路徑成本 | 本地解析為主，通常較低 | session manager 重用＋每命令 sandbox | 每命令 broker/runtime、policy scan；動態審批另加 LLM |
| 操作者與維護成本 | 人工 ask 可能多；維護較輕 | 授權便利，但須修補安全缺口／驗證覆蓋 | 組件最多、模型與授權設定較複雜、升級驗收成本較高 |

這不是 C 在所有維度都勝出。C 的優勢是可建立較強的隔離＋批准組合；A 的優勢是既有流程與低成本；B 的優勢是便利的 Bash 沙箱，不是全面權限控制。

### 2.1 為何 B 不等於 A 加強版

例如 `git push`：本專案預設硬擋的是 force／delete 等指定形式，而不是所有 push。A 通常由 pi-guard ask；B 若網路與認證都可用、相關目的地已允許，單純 sandbox 不知道這次 push 是否得到使用者同意。工作區內的刪檔與一般寫入也有同類差異。沙箱只允許工作區寫入，仍可能允許破壞整個工作區。

**本輪新查證：** carderne 的 `decideWritePolicy` 對 `.pi/sandbox.json` 回 allow，本專案 `DEFAULT_PROTECTED_PATHS` 無匹配；對 `.pi/settings.json` 則本專案有匹配，作為對照。這是兩個政策的唯讀檢查，不是實際寫入或整個 hook／OS 測試。

根據 `src/extension.ts:283–285`，carderne 每次 tool_call 讀 config，`enabled:false` 會略過該層攔截；根據 `:349–360`，下次 session_start 也會依設定停用 sandbox。**不應誇大成寫完設定後正在執行的 Bash 立刻脫離沙箱**：Bash execute 另依記憶體 enabled/initialized 狀態。

因此，B 若要成為嚴肅部署候選，至少需處理自己的 config/source 不可寫、init failure 不可退回裸 Bash、一般危險操作的批准層、窄化 domain/read/write 規則及 child 覆蓋。這些是後續變更／驗收需求，本輪未實作；本專案的 AST deny 不能替代 OS 層自我保護。

### 2.2 C 的完整 worker 隔離與本專案契約

erichll builtin worker 有 outer sandbox，但它的 `subagent` API 是 start/follow_up/handoff，不是 pi-subagents 的 agent/workflow 模式。本專案 `src/modules/subagent-policy.ts:8–22` 只以 agent/workflow 等 key 辨識執行，且 action 存在時排除 list 前置檢查。

本輪直接呼叫純函式確認：未做 capabilities list 時，`{action:'start',task:'read project'}` 得 pass，而 `{agent:'scout',task:'read project'}` 得 block。此差異針對 list 前置規則；使用顯式弱模型的 review 仍得 block，不能概括成三條政策全失效。

如果選 C 的 native pi-subagents protected mode，則限制 direct async native launch、五個 child tools、禁止 workflow scripts／external runners；它不是完整 worker OS 隔離。若改 provider off 以保留 workflows，必須明示只取得所接管 Bash 的保護，不宣稱所有 child 等價受保護。

## 3. 無 container／VM 時的最佳安全選擇

### 建議：C，但有必要前提

- erichll 與本專案 source、設定放在可信且不由 agent 任意修改的位置；不能只靠位於可寫 checkout 的同一個 guard 自保。
- 接線 permission-system，對一般 writes、刪除、commit/push、deploy、未知工具明訂 ask/deny。對不可接受的高風險操作設 deterministic deny 或移出 agent 執行範圍，不只依賴模型審批；可信 source 不是所有操作均預先授權。
- 不提供長效、高權限、非任務必要的 GitHub/cloud/package publish 憑證；不要將秘密放在可讀 workspace 或整批繼承的 env。
- 網路使用窄 allowlist，hostIPC 維持 off。網域允許不是資料不會外洩的證明。
- 以安全優先可選 builtin worker outer isolation，但須接受 orchestration API 更換及本專案政策適配；不要假設現有 subagent-policy 原樣完整覆蓋。
- 完成 macOS 實機、active tool owner、初始化／載入失敗、檔案越界、未知網域、秘密、child 與現有政策的驗收，才能視為正式配置。

**若使用者同時要求工作流程完全不改，則沒有足夠證據把 C 說成可直接採用。** 可維持 A 的已驗收範圍，承認沒有 OS 隔離，再另規劃兼容的保護。若考慮 A＋carderne 作折衷，也需要修補上述 carderne 缺口與共存驗收；多裝一層不是已證實安全的捷徑。

**共同上限：** 這三種裸機 extension 組合，都不能保證主 Pi 的惡意 extension 或未經工具通道的宿主程式已被隔離。本建議是三者中的安全優先方向，不是可安全執行任何敵意程式的保證。

## 4. 有 container／VM 後，還需要哪些層？

先確認外層隔離的對象是**整個 Pi、它的 extensions 與全部 child／external CLI**。如果只把 bash 放在 container，主 Pi 與其他 extension 仍在宿主，不能套用「完整外層隔離已涵蓋」的結論。

| 層 | 外層已正確隔離時是否保留 | 理由 |
| --- | --- | --- |
| 本專案 agents-guard | 建議保留，但不是宿主隔離必要條件 | 工作流程、固定命令硬擋、Git evidence／completion 與 writer advisory 不由 container 提供 |
| pi-guard | 一般有價值 repo 或遠端寫入能力時建議保留 | 防止已授權能力內的誤操作；若無 UI，ask 拒絕，需事前窄範圍 allow |
| erichll sandbox | 通常可省略；有明確內部分區需求才加 | 外層已限制 host filesystem/network 時可能重複；需要工作／子程序更細的隔離才有增益 |
| erichll auto-review＋permission-system | 選配，可替代 pi-guard 的授權角色 | 需要模型輔助批准／授權 audit 時仍有價值，與是否有 OS sandbox 是不同需求 |
| carderne sandbox | 通常不必再加 | 便利層的增益常不足以抵銷巢狀 sandbox、proxy 與故障排錯成本；不是唯一 egress 邊界的首選 |

不建議同時堆兩個 Bash sandbox；也不建議無必要地並行兩套獨立 permission prompt 系統。若需要雙層 sandbox，必須明確說明內層增加的是哪個不同邊界，而不是只因工具越多看似越安全。

### 外層隔離沒有解決的問題

1. **可寫 bind mount：** 仍可以改壞宿主 repo；Docker 官方明示 bind mount 預設可修改／刪除宿主檔案。[D1]
2. **秘密：** 已掛入／注入的 token 仍可能被讀取與使用；ro 只保護完整性，不保證機密性。
3. **網路與遠端寫入：** 預設可連網的 container／VM 不會阻止 push、publish、deploy 或向已允許服務外洩。
4. **共享 socket：** Docker socket、SSH agent 或其他 host IPC 可能把高權限能力重新交給 agent。[D2]
5. **既有 repo 與 Git 規範：** 不會因 container 自動禁止廣泛 staging、錯 branch、錯誤 merge。
6. **snapshot：** 可以回復本地磁碟，不會撤回已完成的遠端 push、付款、部署或外洩。

### 有效外層隔離的最低設計方向

- 優先一次性 clone／獨立 volume，完成後由宿主審閱 diff 或選取產物；避免整個 HOME 或真實敏感 repo 可寫共享。
- 必須共享來源時，盡量 read-only；輸出限指定目錄。可寫 worktree 仍需誤操作保護與備份。
- 非特權程序、最少 capabilities，避免 host network/PID、不掛 Docker socket；可行時採 rootless daemon/container。[D2][D3]
- 限制網路與憑證範圍，搭配 CPU／memory／process／disk 等資源界限。
- VM 關閉不必要的 shared folders／clipboard／agent forwarding。VM 隔離 guest kernel，container 通常共享其所運行 Linux host 的 kernel；兩者不是同等邊界。macOS Docker Desktop 自帶 Linux VM，但分享進去的 host files 仍是可達資產。[D1][D2]
- 不為了讓內層 bubblewrap 能運作，就廣泛開 privileged／放寬外層安全政策；先確定內層的必要增益與最小相容需求。

## 5. 按場景選擇

| 場景 | 建議配比 |
| --- | --- |
| 裸機、安全優先、可調整 subagent 流程 | C，完成適配與驗收後採用 |
| 裸機、目前工作流程必須完全保留 | A 作為已知範圍；明示不具敵意程式隔離，不能宣稱已取得最佳完整安全 |
| 正確隔離、repo／遠端仍有價值、人工監督 | 外層＋agents-guard＋pi-guard |
| 正確隔離、希望自主審批而非反覆人工批准 | 外層＋agents-guard＋permission-system＋auto-review；通常不必再加 inner sandbox |
| 一次性環境、無敏感憑證／可寫宿主資產、產物人工審閱 | 外層為主；agents-guard 可保留，permission prompt 層可以精簡 |
| 只隔離 Bash，其他 Pi tools／extensions 留在宿主 | 仍按裸機混合邊界評估，不能省略宿主側權限保護 |

## 6. 本輪驗證與來源

### 唯讀 probe

以 Node `--experimental-strip-types --input-type=module` 直接 import carderne 的 `decideWritePolicy` 與本專案的 `decideSubagentCall`。路徑匹配使用讀自實際 `DEFAULT_PROTECTED_PATHS` 的陣列及本專案相同的 `minimatch(...,{dot:true})` 語意。沒有執行任何被表示的寫入或 child 任務。

| Probe | 結果 |
| --- | --- |
| 普通 `src/example.ts`，carderne 預設寫入政策 | allow |
| `.pi/sandbox.json`，carderne 預設寫入政策 | allow |
| `.pi/sandbox.json`，agents-guard 預設 protected match | null |
| `.pi/settings.json`，agents-guard 對照 match | `**/.pi/settings.json` |
| 未 list 的 builtin `action:start` | pass |
| 未 list 的 native `agent:scout` | block |
| builtin review＋顯式弱模型，隔離驗證第二條規則 | block |

兩個 Node probe 都 exit 0。它們不是三套 extension 的整合測試、OS denial 實測或性能比較；沒有以 source／pure probe 代替 runtime owner 與全呼叫鏈驗收。

### 來源

- [前輪完整比較與固定 commit 引用](2026-09-11-sandbox-comparison.md)。
- 本專案 `src/config.ts:26–51`、`src/lib/paths.ts:42–57`、`src/modules/subagent-policy.ts:8–22,43–110`、`src/index.ts:79–128`。
- 本機 `pi-guard/src/defaults.ts`、`handlers.ts`；預設不等於使用者正式設定，未讀取／改寫正式 secrets 或 rules。
- [carderne policy](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/src/policy.ts#L5-L9)、[config](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/src/config.ts#L27-L55)、[extension](https://github.com/carderne/pi-sandbox/blob/31fa5060689624467c1aeace2664ce91784522ff/src/extension.ts#L283-L360)。
- [erichll native policy](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/src/pi-subagents-native.ts)、[builtin tool definition](https://github.com/erichll/pi-packages/blob/24f17992f638ea0f421bb39de1d339cf92ad96de/packages/pi-sandbox/src/index.ts)。
- [D1 Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)：已取得官方來源並核對 write access／readonly 段落。
- [D2 Docker security](https://docs.docker.com/engine/security/)：已核對 daemon、namespace、capabilities、共享資源與網路段落。
- [D3 Docker rootless](https://docs.docker.com/engine/security/rootless/)：已讀全文擷取，確認 daemon 與 container 均以非 root 運行的定義。

本輪不改 API、schema、權限規則或部署，無新 OpenSpec change。效能維持架構推估；沒有可比較的延遲／RSS／token benchmark。既有未提交文件保留。
