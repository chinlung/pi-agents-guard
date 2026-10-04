# 2026-09-11 自動載入與 child 權限轉送驗收

## 結論

接續[前一批整合驗收](2026-09-11-integration-acceptance-results.md)，沿用 Pi **0.85.1**、pi-subagents **0.67.0**、`@pi-lab/permissions` **1.0.3** 與 Luna，各執行一個新功能案例：

| 目標 | 判定 | 實際結果 |
| --- | --- | --- |
| 原生套件自動發現／指定順序 | **PASS** | 隔離 `pi install` 登錄後，不用 `-e` 即載入；guard 先擋 broad staging，另一個 harmless probe 確實觸發權限確認並被取消。 |
| child 權限提示回傳 parent | **FAIL_COMPATIBILITY** | child `hasUI:false`，套件在本機拒絕，沒有 parent 確認框。 |
| 同一 child 的安全拒絕 | **PASS** | 原生 session 保存 `ask rule requires UI` error result；`child.txt` 未建立。 |

**不能把「安全拒絕」或 native workflow complete 算成「提示轉送成功」。** 本輪沒有改產品／第三方程式、沒有換套件／模型、沒有重跑模型案例，也沒有正式安裝或 commit／push。

去敏[機器證據](2026-09-11-discovery-forwarding-evidence.json)保存實際輸入／結果、permission events、session 用量、終止證據與驗收器失敗紀錄；不是完整 transcript。

## 範圍與隔離

- 固定 source：`3df8f9d4287591de85aa8c056ee77a74501f3054`；Mac arm64、Node **22.23.2**、npm **10.9.8**。
- 所有模型回合均為 `openai-codex/gpt-5.6-luna`、low thinking；無模型 fallback、agent／provider retry 或 compaction。
- LAB：`<LAB>`。本次使用系統暫存根目錄，不是前一批已刪除的 `/tmp` LAB。
- HOME、agent dir、sessions、XDG、Git／npm 設定與 cache 均指向 LAB；不帶入 provider key、SSH agent、GitHub 憑證。HOME 白名單及 `--offline` 不構成 OS 安全沙箱。
- `pi install` 的 user scope 是 **LAB 的 HOME**。來源使用已檢視且鎖定版本的本機 package directories；npm 安裝使用 `--ignore-scripts`，權限 tarball integrity 與前一批相同。沒有在正式設定執行安裝。
- OAuth 僅複製指定 provider 的有效 access、正確 oauth 型別、空 refresh，檔案 `0600`；複製前有效期超過 30 分鐘，每個操作者模型 prompt 前超過 15 分鐘，`auth check --no-refresh` ready。沒有額外 D0。
- 本輪只建立驗收器與報告；Public API、data contract、schema、migration、相容性、產品權限語意、並行協定、跨模組行為均不修改。OpenSpec 無 active change，未新增 change。

## 自動發現／載入順序

使用原生 `pi install <local-package> --no-approve`，依序登錄：測試 observer、guard source、權限套件。原生 installer 將路徑正規化為 settings-relative paths：

```json
{
  "packages": [
    "../../../probe",
    "../../../source",
    "../../../tooling/node_modules/@pi-lab/permissions"
  ]
}
```

- 逐一以隔離 settings 目錄解析，確認指向唯一 LAB 的核准 package，而不是只比陣列長度。
- 先做 **無模型負向控制**：相同 settings 加 `--no-extensions --no-tools`，guard／probe commands 與 presence 均不存在，模型訊息／工具數為 0。
- 正向 RPC 程序不帶 `-e` 或 `--no-extensions`。`get_commands` 讀回 guard／probe 的 canonical path、`origin:package`、`scope:user`；guard status 顯示防線啟用。
- 模型依序各呼叫一次 `bash`：
  1. `git add .` → `[agents-guard/hard-deny]`；沒有為此呼叫產生 permission ask。
  2. `printf DISCOVERY` → 真實 permission ask／RPC select；控制器送 `cancelled:true`，對應套件事件為 `selection:null`、`decision:deny`、source `user`。
- 後者是權限套件確實載入的獨立正向對照；沒有以「guard 擋住，所以權限套件一定存在」推論。
- index 未建立，fixture 沒有模型造成的檔案修改。程序 EOF／exit 0，presence 清空。

**邊界：** 此案只證明這份 local-package user settings 的順序；不保證反向排序、npm／Git 安裝來源、混合 project scope 或所有自動載入配置均相同。

## child 權限提示轉送

- 後續只在隔離 settings 加入 pi-subagents。新 parent 以真實工具先執行 `list`＋`capabilities:true`、再執行 `models`，確認唯一 `permission-child` 為 executable、native `pi`、Luna、工具 `write`。
- 單一 async workflow 只派一個 fresh child；明確載入 observer、guard 與真正的權限 extension。未使用 external CLI、foreground fallback、輪詢或第二次派發。
- Workflow：`c6c2197f-f901-426f-930a-c111ee5765ef`；child：`029f74ef-f540-4069-b421-3c258195787d`；child PID **55852**。
- child 自身觀測到 `PI_SUBAGENT_CHILD=1`、`hasUI:false`、active tools 僅 `write`，並讀回 guard 的 command provenance。實際只請求一次 `write child.txt`，content 為 `PERMISSION_CHILD\n`；測試 envelope 放行，並非 envelope 代替產品拒絕。
- 真正權限套件匹配到 ask rule，但發出 `permissions:deny`，source **`no_ui`**、reason **`ask rule requires UI`**。child 沒有 `permissions:ask`／`permissions:user_select`，parent 沒有 permission select。
- 原生 child session 確有同 tool-call ID 的 `toolResult`，`isError:true`、上述錯誤文字；child 最後回覆 `BLOCKED — ask rule requires UI`，沒有重試或繞過。
- `child.txt` 與 Git index 皆不存在；獨立 `git status --porcelain` 為空，fixture 為 clean／unborn main。child 所有 presence 觀測皆只有原 parent，結束後完全清空。
- 原生 workflow／child 對話正常 complete；child 的 `process-terminal.json` 為 observed、exit 0、signal null，OS PID／group 亦已停止。這是執行完成證據，不是轉送功能成功。

### 根因與相容性判定

[`@pi-lab/permissions@1.0.3` 的固定版本產物](https://cdn.jsdelivr.net/npm/@pi-lab/permissions@1.0.3/dist/index.mjs)在 **273–280 行**明確於 `!ctx.hasUI` 時直接 block，不進入 `askUser`。其 events 是觀測用途，不是跨程序的決策覆寫通道。因此本案是所選組合的轉送能力缺口，不是 guard regression，也沒有繞過權限的證據。

pi-subagents `src/runs/shared/child-tool-plan.ts:288–337` 的 resolver 明列另一個套件 **`@gotgenes/pi-permission-system`**。它可作下一個候選，但本輪沒有選定其版本、安裝或驗證；不能只依 resolver 名稱宣稱它在目前環境一定可用。

## 保留的驗收器問題

1. 準備階段首次 readback 斷言誤以為 installer 會保存絕對路徑；實際是合法的相對路徑。改以 settings 目錄解析後確認正確，**沒有重新 install、沒有因此發出模型請求**。
2. child driver 在 `forwarding.py:31` 誤要求 extension `tool_result` hook 一定出現，因而 **exit 1**。實際 observer 沒收到該 hook，但原生 session 有完整 blocked `toolResult`。Pi 的 before-tool-call immediate-result 路徑會略過 after-tool-call hook；不能混同兩種事件。

第二個問題發生時 workflow／child 已 complete；driver 發出一次 stop 清理命令，之後 parent 正常 EOF／exit 0。保留原始 assertion／exit code／run identity，不把 driver 改寫成成功；後續只有既有 JSONL、permission event、native status 與 filesystem 的離線交叉核對，**未重跑或修產品迎合測試**。

## 用量與驗證

| Session | 模型回合 | 工具 | Tokens（含 cache） | SDK 估算 USD |
| --- | ---: | ---: | ---: | ---: |
| discovery-disabled 負向控制 | 0 | 0 | 0 | 0 |
| discovery-auto | 3 | 2 | 2,708 | 0.00067060 |
| forward-parent | 7 | 3 | 31,375 | 0.00339108 |
| permission-child | 2 | 1 | 961 | 0.00025820 |
| **合計** | **12** | **6** | **35,044** | **0.00431988** |

- 3 個操作者模型 prompts＋1 個原生 child task；parent 的 2 個原生通知後續回合亦已計入。6 次工具中，3 次管理／派發成功、3 次為拒絕結果。
- Tokens＝15,379 input＋721 output＋18,944 cache-read，cache-write 0。SDK 估算不是帳單／實際扣款。
- 三個模型 session 的 assistant provider／model、stop reason、工具結果及用量與 RPC／原生狀態交叉核對；零模型負向控制僅分配 session 路徑，未保存 JSONL。
- 25 筆受控程序紀錄中，24 筆 exit 0、child driver 1 筆 exit 1；均無存活 group。native child 的 observed／exit 0 證據另外保存，未重複計入上述 25 筆紀錄。
- 87 個 tracked files／lockfile、原有 7 份報告／證據 bytes hash 均未變。guard state 目錄／檔案維持 `0700`／`0600`，presence 為空。
- 掃描 2,636 個證據／session／暫存 artifacts，未見 access token；OAuth 副本已刪，真實 auth inode／size／mtime 未變。
- 測試 envelope 的正向、duplicate／unsafe-input 阻擋，以及刻意放寬 matcher 的 mutant 負向控制通過。離線聚合器亦拒絕故意改錯的 tool 總數。
- 本輪沒有改 source，**未重跑 unit tests／typecheck／lint／source LSP**；前一批 411 tests 等結果僅為歷史基準，不升格成本輪新證據。
- 文件已實際 render，Markdown AST 的 2 個表格、2 個相對連結、JSON fence、證據聚合與 `git diff --check` 通過。
- **2026-09-11 10:25:27 +08:00**：再次確認記錄 PID／PGID、LAB command／使用者程序 cwd references 均不存在，presence 空、憑證已移除後，定點刪除完整 LAB，約 **589 MiB**。canonical／別名均不存在，正式 repo 無 `node_modules`；沒有清除其他共用 cache。
- 只保留本報告及去敏 JSON；原始 logs／sessions／驗收器／fixtures／dependencies 均已刪除。既有 7 份報告未變，新增 2 份文件皆未提交。

## 後續

若需要 child 的互動式權限確認，應另選定轉送方案／套件版本再測；不要將 ask 改成 allow 來掩蓋缺口。正式安裝、產品修改、commit／push 仍須另外授權。TUI、其他 OS、精確 Node 22.19.0、永久權限快取、crash／取消／race 等仍未覆蓋。
