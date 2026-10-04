# child 權限提示轉送：影響與修正必要性判讀

- 日期：2026-09-11
- 性質：原始驗收的補充判讀，不是重跑結果、產品修正或新功能規格。
- 正式權限層目標：操作者指定的 **[pi-guard 1.4.0](https://github.com/jdiamond/pi-guard/tree/1704b20c27e6e1c2628582b409d529999e0608e4)**（jdiamond）。
- 原始測試組合：Pi 0.85.1、pi-subagents 0.67.0、`@pi-lab/permissions` 1.0.3、Luna；不是 pi-guard。

## 1. 結論與操作者決定

操作者核准：**「保留原始失敗證據，補充『預期限制、非必要修正』的判讀，而不是修改產品迎合額外案例。」**

本次結果應解讀為：所選套件不提供 child 提示轉送，沒有 UI 時安全拒絕，屬於**預期能力限制，而非 agents-guard 功能回歸**。以 pi-guard 1.4.0 為正式權限層，不因這個額外案例未達成就要求新增轉送功能。

這不是把失敗改成成功：**原始 `FAIL_COMPATIBILITY`、安全拒絕 `PASS`、驗收器 exit 1 均保留。** 本文件的「預期限制／非必要修正」是需求與影響判讀，不替換原始 JSON 的 status，也不是 pi-guard 實機驗收通過的宣稱。

## 2. 原始證據保持不變

| 原始紀錄 | 保留內容 | 補充判讀 |
| --- | --- | --- |
| [驗收報告](2026-09-11-discovery-forwarding-results.md):10、52–61 | child 轉送 `FAIL_COMPATIBILITY`；沒有 parent select | 額外的轉送目標未達成，不等於既有功能壞掉 |
| [機器證據](2026-09-11-discovery-forwarding-evidence.json) `forwarding` | `hasUI:false`、`permissions:deny` source `no_ui`、`ask rule requires UI`、檔案未建立 | 安全拒絕正常；沒有因缺少確認框而放行 |
| [驗收報告](2026-09-11-discovery-forwarding-results.md):70–74 | `forwarding.py:31` assertion、driver exit 1 | 驗收器誤把 extension `tool_result` hook 當成 blocked core `toolResult` 的必要證據；不是 child launch/runtime failure |

原生 workflow／child complete 僅證明對話與生命週期結束，**不代表寫入任務成功**。原有 LAB／原始 logs／sessions 已在前一批清理；此處保留的是當時保存的報告與去敏選錄 JSON，不宣稱仍持有完整原始 transcript。

建立本補充文件前的 SHA-256：

- `2026-09-11-discovery-forwarding-results.md`：`bd2f63a5b20eecc9cd078e57eedfd25b78bf5f20b0b2b9d23b3f924d22c38eae`
- `2026-09-11-discovery-forwarding-evidence.json`：`ea39d9449a3fade4b762437a7e3ef4449fcbf8722a92a9707ad3e62b55b216cd`

其餘 7 份既有驗收文件的 baseline 位於原始 JSON 的 `audit.priorReports`。本輪只新增本文件，不改上述 9 份文件、產品、第三方套件或正式設定。

## 3. 先前文件已有說明

- [docs/permission-systems-comparison.md:91](../permission-systems-comparison.md)：2026-09-09 能力表明列 pi-guard 的 **subagent ask forwarding＝✗**。
- [docs/pi-permission-system-evaluation.md:81](../pi-permission-system-evaluation.md)：說明 pi-guard 非互動時 block，而 gotgenes 權限系統另有 forwarding 能力。舊文的「卡死」應理解為工作可能受阻，不能據此斷言程序 deadlock；本次 child 實際正常退出。
- [docs/design.md:602](../design.md)：決策 #15 採選項 A，維持 pi-guard 作確認層，MUST 級硬擋由 agents-guard 承擔。

歷史評估中的 gotgenes 遷移建議、特定 pi-subagents 版本的 forwarding 分析，不能外推成 pi-guard 或所有權限套件的通用能力。`docs/design.md:601` 仍有舊遷移評估文字；本文件依 #15 與操作者最新指定，以 pi-guard 1.4.0 為正式目標，不覆寫那些歷史文件。

先前選測 `@pi-lab/permissions` 沒有先對齊這個既定目標。因此其自動載入／順序成功與轉送失敗都只屬原測試組合，**不能拿來宣稱 pi-guard 的正式整合已通過或失敗**。

## 4. pi-guard 1.4.0 的預期行為

查證來源固定為 v1.4.0 對應 commit `1704b20c27e6e1c2628582b409d529999e0608e4`。前一輪唯讀查證已比對本機與上游的 `package.json`、`README.md`、`src/handlers.ts`、`src/index.ts`、`src/defaults.ts`，五檔 bytes 相同；不以目前 main 分支替代版本證據。

- [README.md:255](https://github.com/jdiamond/pi-guard/blob/1704b20c27e6e1c2628582b409d529999e0608e4/README.md#L255)：`ask` 明定為互動時詢問、非互動時 block。
- [src/handlers.ts:183–200](https://github.com/jdiamond/pi-guard/blob/1704b20c27e6e1c2628582b409d529999e0608e4/src/handlers.ts#L183-L200)：檔案／一般 approval 路徑先處理 allow／deny，再於 `!ctx.hasUI` 回傳 `No interactive session available`，不進 UI 詢問。
- [src/handlers.ts:121–138](https://github.com/jdiamond/pi-guard/blob/1704b20c27e6e1c2628582b409d529999e0608e4/src/handlers.ts#L121-L138)：非互動 bash 的未授權命令亦直接 block。

在 guard 確實載入、啟用且規則正常匹配的無 UI child 中：

| 有效規則 | 預期結果 | 影響 |
| --- | --- | --- |
| `allow` | 通過 pi-guard 這一層 | 仍可能被 agents-guard 等其他防線拒絕 |
| `ask` | 拒絕，不轉送 | 該操作不能完成，需回報操作者 |
| `deny` | 拒絕 | 正常執行禁止政策 |

這是固定版本程式碼支持的預期，不是本輪新的 pi-guard 模型／child 實測結果。

## 5. 影響與必要性

**安全面：** 本案沒有因缺少 UI 而越權放行；安全拒絕不需要改成放行。這不等於 pi-guard 其他已知安全限制都已解決，也不構成 OS sandbox 保證。

**工作可完成性：** [src/defaults.ts:85–90](https://github.com/jdiamond/pi-guard/blob/1704b20c27e6e1c2628582b409d529999e0608e4/src/defaults.ts#L85-L90) 將 write／edit 預設為 ask。若 child 沿用這些有效規則，正常寫入也會受阻。本輪未讀取正式權限設定，因此不假設實際 writer 已具備需要的 allow 規則，也不假設 parent 的 session approval 自動傳給 child。

**修正裁決：**

1. **非必要修正：** 不為轉送案例修改 agents-guard、pi-guard、Pi 的 `hasUI`，也不新增 broker／改換正式權限套件。
2. **必要對齊：** 後續正式組合驗收應使用 pi-guard 1.4.0，將無 UI 的 ask 拒絕列為預期結果；另驗合法 allow 操作與 deny 防線。不得把原測試換名後當成已完成。
3. **條件式調整：** 若必要工作受阻，由操作者核准最小範圍規則或調整工作流程；child 停下回報，不自動重試、改用其他工具繞過或自行全域 allow／停用 guard。
4. **保留既有防線：** 依 [docs/design.md:279](../design.md) 驗證 agents-guard 先於 pi-guard 攔截。pi-guard 的互動 bash pattern 路徑會把 ask／deny 一起送入含 Allow 的選單，不能因此移除 agents-guard 的 hard-deny；這個限制不概括為所有檔案／整工具 deny 都可放行。
5. **新需求才另案：** 只有操作者要求「child 執行途中必須透過 parent 動態取得人工批准」時，才需要另行設計、核准及驗證轉送能力；它不是目前必修項目。

另有獨立的版本驗證項：[package.json:47–50](https://github.com/jdiamond/pi-guard/blob/1704b20c27e6e1c2628582b409d529999e0608e4/package.json#L47-L50) 的 Pi peer dependency 精確指定 **0.79.1**，本專案驗收基準為 **0.85.1**。這不證明一定無法執行，但也不能宣稱已符合上游 peer 相容範圍；需在正式組合驗收時確認，不能用其他權限套件的結果代替。

## 6. 本輪變更與驗證邊界

本輪只新增補充文件，保留既有 status／證據／版本與失敗歷史。Public API、data contract、schema、migration、相容行為、權限語意、並行／一致性及跨模組行為皆未修改；OpenSpec 無 active change，未新增產品 change。

文件驗證範圍為 Markdown render／AST、相對連結、原證據 JSON 解析與判定／exit code、既有 9 份文件 SHA-256 及 Git diff。沒有重跑模型案例、unit tests、typecheck、lint 或 source LSP，也沒有正式安裝、commit／push 或替尚未執行的 pi-guard 整合驗收宣稱成功。
