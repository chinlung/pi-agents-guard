# 文件索引

[專案首頁](../README.md) · [安裝與使用手冊](user-guide.md)

## 第一次使用

| 需要 | 閱讀順序 |
| --- | --- |
| 功能與五模組邊界 | [專案 README](../README.md)，再看 [使用手冊](user-guide.md) |
| 安裝、依賴、載入順序、備份／卸載 | [使用手冊](user-guide.md) 第 2–4、8 節 |
| 安裝來源、實際載入與 source 保護限制 | [安裝後核對報告](reports/2026-09-11-post-install-check.md)：無模型載入與唯讀政策核對，不是完整安全驗收 |
| 命令、設定、native child 最小權限、日常 SOP | [使用手冊](user-guide.md) 第 5–7 節 |
| 可重現的隔離驗收流程 | [隔離驗收手冊](validation/isolated-acceptance.md)；它是當時制定的流程，不是全部案例已執行的聲明 |
| 本次文件與分支／worktree 收尾 | [2026-09-11 收尾報告](reports/2026-09-11-project-closeout.md) |

## 現行版本與準備度

- agents-guard **0.1.0**，未發布 npm；正式權限套件固定 **pi-guard 1.4.0**，不是歷史 `@pi-lab/permissions`。
- 選定的 **Pi 0.85.1＋pi-guard 1.4.0＋pi-subagents 0.67.0**，在 Darwin arm64／Node 22.23.2 上的計畫內驗收已補齊：父程序在正式組合第一輪通過，child 在另行核准的補測通過。
- **無 UI child 的 ask／deny 拒絕、不轉送為預期限制**；必要寫入先定窄範圍 allow，不要求改產品或加 broker。
- 驗收通過不等於正式安裝、正式規則已核定或新正式 session 已驗證；選定 smoke 不消除 pi-guard 的精確 peer 宣告落差。
- 精確最低 Node、其他 OS／TUI、所有第三方組合與更多 race／crash 尚未完整驗證。這些不是自動新增的本機安裝必要條件。

## 驗收證據：先看最新結論，再追歷史

所有 2026-09-11 驗收 source 均固定於 `3df8f9d4287591de85aa8c056ee77a74501f3054`。表格中的 PASS 只適用各報告明列範圍；JSON 是去敏選錄，不是完整 transcripts。驗收 LAB 與 raw sessions／helpers 已清理。

**公開副本說明：** 文件與 JSON 已去識別本機路徑／主機名並省略不必要的正式認證檔案 metadata。歷史 hashes 與 `file:line` 仍指去識別前的原件，不是目前副本；驗收結果、失敗與 checkbox 未改。`<USER_HOME>`、`<HOST>`、`<LAB>` 等占位符須先換成自己的環境值，不可直接執行。

| 批次 | 結果與判讀 | 詳細資料 |
| --- | --- | --- |
| 正式組合 child 補測 | **PASS**：單一 native child allow 落盤、ask／deny 預期拒絕；與前輪父程序合併判讀，計畫內缺口補齊 | [結果](reports/2026-09-11-child-permission-retry-results.md) · [JSON](reports/2026-09-11-child-permission-retry-evidence.json) |
| 正式組合第一輪 | **PARTIAL_PASS_CHILD_NOT_EXERCISED**：父程序 hard-deny／allow／取消 ask 通過；模型 inline script 跳脫錯誤被驗收 envelope 拒絕，driver exit 1，未派 child | [結果](reports/2026-09-11-final-stack-results.md) · [JSON](reports/2026-09-11-final-stack-evidence.json) |
| 正式權限選型與 forwarding 判讀 | pi-guard 1.4.0 無 UI ask 拒絕是**預期限制、非必要修正**；歷史 pi-lab 結果不改名成正式套件證據 | [影響說明](reports/2026-09-11-permission-forwarding-impact.md) |
| 歷史 pi-lab 自動發現／轉送 | Discovery PASS；forwarding **FAIL_COMPATIBILITY**、fail-closed PASS，driver exit 1 保留；不是 pi-guard 測試 | [結果](reports/2026-09-11-discovery-forwarding-results.md) · [JSON](reports/2026-09-11-discovery-forwarding-evidence.json) |
| 歷史 C2／C3 整合 | PASS：單一 native writing child 與選定載入順序；權限套件是 `@pi-lab/permissions@1.0.3`，不當正式選型替身 | [結果](reports/2026-09-11-integration-acceptance-results.md) · [JSON](reports/2026-09-11-integration-acceptance-evidence.json) |
| 核心模型功能 | PASS：legal／writer advisory、hard-deny、fixture Git-evidence、completion delta；Git push 僅 LAB 本機 bare remote | [結果](reports/2026-09-11-functional-acceptance-results.md) · [JSON](reports/2026-09-11-functional-acceptance-evidence.json) |
| OAuth 連線補測 | PASS：正確 OAuth storage 型別後，單一 no-tools prompt 成功；只證連線 | [結果](reports/2026-09-11-oauth-connection-retry.md) |
| OAuth 原始阻塞 | **BLOCKED_ENV／NOT_EXERCISED**：snapshot 錯標 api_key；prompt 未被接受、零模型用量，失敗原樣保存 | [結果](reports/2026-09-11-model-acceptance-blocked.md) |
| 無模型隔離驗收 | PASS：狀態、開關、save、presence、非 Git 降級等；模型與 token 都為零 | [結果](reports/2026-09-11-isolated-acceptance-results.md) |
| main CI | Ubuntu／Node 22：411 tests、typecheck、lint 成功；不是完整 Linux Pi 實機或精確最低 Node 證據 | [GitHub Actions 34515942965](https://github.com/chinlung/pi-agents-guard/actions/runs/34515942965) |

**閱讀原則：** 不把前輪 partial 改成 PASS、不覆寫當時的 NOT_RUN／FAIL、不抹除 driver exit 1。最新狀態由後續明列的新證據補充；「預期拒絕」也必須由真實 toolResult／檔案讀回證明，不由 workflow complete 推論。

## 規格、架構與歷史

| 類型 | 文件 | 如何使用 |
| --- | --- | --- |
| 現行程式 | [src/index.ts](../src/index.ts)、[src/extension.ts](../src/extension.ts)、[src/config.ts](../src/config.ts)、[test/](../test/) | 核對入口、hooks、命令、實際 kebab-case 設定與測試 |
| Canonical writer 需求 | [writer-lock-safety](../openspec/specs/writer-lock-safety/spec.md) | 現行 advisory；名稱不代表強制鎖 |
| Canonical completion 需求 | [completion-recheck](../openspec/specs/completion-recheck/spec.md) | settled lifecycle、取消與跟進邊界 |
| Writer 決策歸檔 | [design](../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/design.md) · [tasks](../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/tasks.md) · [review](../openspec/changes/archive/2026-09-10-fix-writer-lock-ownership/review-notes.md) | 包含從舊 ownership 需求改為 advisory 的歷史；不以凍結 checkbox 重開已完成工作 |
| Runtime 決策歸檔 | [design](../openspec/changes/archive/2026-09-10-refactor-runtime-coordination/design.md) · [tasks](../openspec/changes/archive/2026-09-10-refactor-runtime-coordination/tasks.md) · [review](../openspec/changes/archive/2026-09-10-refactor-runtime-coordination/review-notes.md) | Runtime／hooks 分離、completion lifecycle 與驗證記錄 |
| 初始設計與實作計畫 | [design.md](design.md) · [plans/](plans/) | 保留歷史；舊 camelCase 設定、強鎖／widget 敘述不凌駕現行程式與 canonical spec |
| 早期套件比較 | [permission-systems-comparison](permission-systems-comparison.md) · [pi-permission-system-evaluation](pi-permission-system-evaluation.md) | 當時來源分析；其中 gotgenes 遷移建議不凌駕最新固定選型 |
| 早期盤點 | [2026-09-10 work-status](reports/2026-09-10-work-status.md) | 當時 snapshot，不把當時未測當作今日仍未測 |

新行為改動另走 OpenSpec approval gates；一般文件收尾不改 archived tasks、產品權限、並行語意或公開 API。本次公開前整理僅去識別 archived tasks 中的環境路徑，保留原需求與 checkbox。
