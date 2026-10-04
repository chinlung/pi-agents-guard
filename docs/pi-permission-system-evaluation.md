# pi-permission-system 評估：能否取代 pi-guard 與 agents-guard？

- 日期：2026-09-09
- 評估對象：[`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) v31.1.3
- 對照：`pi-guard` 1.4.0（已安裝）、`agents-guard` 設計（`docs/design.md`）
- 方法：clone 原始碼直接讀 implementation 與 test，不以 README 敘述為唯一證據

---

## 1. 結論

| 問題 | 答案 |
|---|---|
| 能取代 pi-guard 嗎？ | **能，而且全面更好。** 它修正了我們實測到的 pi-guard 四個陷阱中的三個，並補上 pi-guard 完全沒有的能力 |
| 能取代 agents-guard 嗎？ | **不能。** 4 個模組沒有一個被覆蓋 —— 它們不是權限決策問題 |
| 對 agents-guard 設計有影響嗎？ | **有，正面的。** 它提供 `authorizerChain` seam，可讓 writer-lock 的阻擋動作接進統一的決策與 review log。但 `subagent-policy` **無法**用此 seam（拿不到 tool input） |
| 建議 | **pi-permission-system 取代 pi-guard；agents-guard 照原設計獨立實作，並在 writer-lock 上提供可選的 authorizer 整合** |

---

## 2. 它修正了 pi-guard 的哪些問題

### 2.1 陷阱 D（`deny` 在互動模式等同 `ask`）→ 已修正

pi-guard 的問題：`handlers.ts:findUnauthorizedCommands` 把 `deny` 與 `ask` 一起收進 `unauthorizedCommands`，互動模式下都走同一個含 `Allow` 的選單。

pi-permission-system 的行為，`src/handlers/gates/runner.ts:190` 註解：

```
// no human render wants it, because a deny never prompts
```

**測試碼佐證**（`test/handlers/gates/runner.test.ts:249`）：

```js
it("blocks an explicit deny under yolo without prompting", async () => {
  resolveResult: makeCheckResult({ state: "deny", matchedPattern: "rm *" }),
  const result = await runner.run(makeDescriptor(), null);
  expect(result).toMatchObject({ action: "block" });
  expect(deps.escalate).not.toHaveBeenCalled();     // ← 不 escalate = 不彈框
});
```

連 yolo 模式都不能放行 `deny`，且這個行為有測試保護。**`deny` 是真硬擋。**

### 2.2 未列出的工具 hardcoded `ask` → 已解決

pi-guard 的 `src/index.ts:handleToolCall` 用 `?? "ask"`，未列出的工具一律 `ask`，每裝一個新 extension 就要回頭補設定。

pi-permission-system 有明確的 universal fallback `permission["*"]`，可設 `allow`（文件：`Omitting "*" defaults to "ask" (least privilege)`）。**這個維護負擔消失了。**

### 2.3 project config 未檢查 project trust → 已修正

pi-guard `src/index.ts:129` 直接 `loadProjectConfig(process.cwd())`，project 層優先於 user 層 → 任何 repo 放個 `.pi/settings.json` 就能自我放寬權限。

pi-permission-system v22.0.0 起：project 設定**只在 Pi 報告 project 為 trusted 時載入**，未信任時只套 global config 並記錄 `project_trust.skipped`。**正是我們發現的 pi-guard bug，這裡已經修好。**

### 2.4 secrets 繞道 → 大幅改善（非完全解決）

pi-guard 是 command-level，要防 `.env` 被讀必須逐一列舉 viewer（`cat`／`grep`／`head`／`tail`／`sed`／`jq`／`less`／`bat`／`strings`／`xxd`／`od`…），而 `cp .env /tmp/x && cat /tmp/x` 仍可繞。

pi-permission-system 的 `path` 是**跨切面 surface**：一條 `*.env: deny` 同時作用於所有檔案工具與 bash，並且**匹配路徑的原樣與 symlink 解析後的形式**（`docs/cross-extension-api.md` §checkPermission），符號連結別名無法規避。另有 `src/handlers/gates/bash-path-extractor.ts` 專責從 bash 命令抽出路徑。

仍非完全解決（`cp` 到中性路徑後再讀、`env | grep TOKEN` 等仍需政策涵蓋），但攻擊面顯著縮小，且不需要維護 viewer 清單。

### 2.5 陷阱 A／B／C 的對應狀況

| pi-guard 陷阱 | pi-permission-system |
|---|---|
| A：寫 `matchers` 會清掉內建 7 個 | **不存在此概念**。改用 surface-based 政策模型，另有 strict config validation 與 cross-scope fail-closed clamp |
| B：用 `"*"` 收緊永遠無效（spread 保留 key 位置） | **有明確語意**：last-match-wins 有文件與測試，且有 `src/policy/restrictiveness.ts` 做 most-restrictive 合併；bash 複合命令按單元分解後取最嚴格（`deny > ask > allow`） |
| C：profile 需用工具層字串才有效 | **無 profile 概念**，改用 per-agent policy + session approvals，語意更清楚 |

---

## 3. pi-guard 完全沒有、而它有的能力

1. **在 agent 啟動前隱藏被禁工具**（`src/exposure/`）—— 不浪費 turn 去探測擋掉的工具。pi-guard 只能在呼叫時擋。
2. **fail-closed 語意**：內部 gate error → block（記 `gate_error`）；無法解析的 bash → `ask`（sentinel `<unparseable-bash-command>`）而非落到寬鬆的 `*`。
3. **indirection wrapper 偵測**：`bash -c`／`eval`／`sudo`／`env`／`xargs`／`find -exec` 等隱藏被 gate 命令的包裝一律 `ask`，除非包裝的是可證明的純讀取（`xargs grep -l foo`）。
4. **subagent ask forwarding**：`ask` 在非 UI 執行環境仍可運作（轉發到 parent UI）。這直接解決 pi-guard 「非互動 = 靜默 block」導致 subagent 卡死的問題。
5. **cross-extension API**：`getPermissionsService(sessionId)`、`permissions:decision`／`permissions:ui_prompt` event bus、`registerToolInputFormatter`／`registerToolAccessExtractor`／`registerAuthorizer`。
6. **read/write 作為政策軸**（ADR 0013）：可以允許讀某路徑但不允許寫。
7. **review log**：每個決策都有結構化紀錄（`gate_error`、`authorizer_chain_resolved`…），可審計。
8. **MCP／skill surface**：在 server／tool／skill-name 粒度上 gate。pi-guard 無此概念。

---

## 4. 為什麼它取代不了 agents-guard

它的 non-goals 寫得很清楚：**「這是決策層 —— 它決定並記錄；sandbox 才負責圍堵。」** agents-guard 的 4 個模組沒有一個是「單一動作是否被允許」的問題。

| agents-guard 模組 | 性質 | pi-permission-system 覆蓋？ | 原因 |
|---|---|---|---|
| `writer-lock` | 跨 session 並行控制（需要 lock 生命週期管理） | **否** | 它不持有跨 session 狀態、不管 `session_start`／`shutdown`／`turn_end` 的 lock 生命週期。non-goals 明說不做 isolation |
| `subagent-policy` | 工具**參數**的語意檢查 | **否**（且無法用 seam 實作，見 §5.2） | 它的 surface 是 command／path／MCP target／skill name，不是「`subagent` 呼叫的 `model` 欄位是否指向弱模型」 |
| `git-evidence` | 事後自動補驗證證據 | **否** | 這不是決策，是加值。它只在 tool_call 前決策，不改 tool_result |
| `completion-diff-recheck` | 收尾時比對工作樹狀態 | **否** | 同上，且需要 `agent_settled` hook 與跨 turn 狀態追蹤 |

---

## 5. 整合機會與其邊界

### 5.1 `authorizerChain`：可用於 writer-lock

`docs/configuration.md` §Authorizer chain：政策決定 `allow`／`deny`／`ask` 後，**當結果是 `ask` 時**，authorizer chain 決定誰來回答。下游 extension 可註冊 link，回傳 `allow`／`deny`（附教學用 reason）／`defer`。

`src/authority/authorizer.ts:23`：

```ts
export type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" };
```

**可行的 writer-lock 整合**：政策設 `write: ask`、`edit: ask`、`bash: {"git checkout *": "ask"}`，`authorizerChain: ["agents-guard"]`。link 查 lock 狀態 → 持有 → `allow`（自動放行，不打擾）；唯讀模式 → `deny` + 說明。好處是決策集中、有統一 review log、child 的 ask 會轉發上來由 parent 的 chain 判定（正好符合我們對 child 情境的設計）。

**三個必須知道的邊界**：

1. **link 只在 `ask` 時被諮詢**，不能把 `allow` 變 `deny`。要讓 link 有機會發言，政策就必須把該 surface 設為 `ask`。
2. **link 未註冊時 fail-safe 是「更多 prompt」**（chain 不變量 2）。所以若 agents-guard 沒載入，所有 `write` 都會退回人工確認 —— 安全但很吵。
3. **bounded-delegation checkpoint**：link 的 `allow` 在 `external_directory`／`path` family 會被降級為 `defer`。writer-lock 只發 `deny`，不受影響。

### 5.2 `subagent-policy` 無法用 authorizer link 實作 —— 決定性限制

link 收到的是 `PromptPermissionDetails`（`src/authority/permission-prompter.ts:48`），欄位有 `toolName`、`command`、`path`、`target`、`toolInputPreview`、`payload`。

我逐一檢查後確認：**沒有原始 tool input 物件**。`PromptPayload`／`PromptRequestFacts`（`src/presentation/prompt-payload.ts:49`）只有 `surface`、`toolName`、`value`（「the command, path, MCP target, or skill name」）、`matchedPattern` 等顯示層事實。

反證：gate 內部**確實有** input —— `src/handlers/gates/tool.ts:97,115` 的 `GateDescriptor` 帶 `input: tcc.input`，但它沒有被放進 `promptDetails`。

`subagent-policy` 要檢查的是 `input.agent`、`input.model`、`input.acceptance`、`input.workflowScript`、`input.action`、`input.capabilities` 這些欄位。`toolInputPreview` 是可截斷的字串預覽，不能作為政策判定依據。

**所以 `subagent-policy` 必須自己在 `tool_call` 攔截**（`event.input` 是完整且可變的）。這與原設計一致，無須修改。

### 5.3 `git-evidence` 與 `completion-diff-recheck` 完全在其範圍外

兩者都在 `tool_result` 與 `agent_settled` 運作，pi-permission-system 不涉及這些 hook。照原設計實作。

---

## 6. 相容性：一個文件過時之處與一個真實缺口

### 6.1 我們的 pi-subagents 已支援其 forwarding（文件未更新）

pi-permission-system `docs/subagent-integration.md:204` 的相容表把 `nicobailon/pi-subagents` 列為：

| nicobailon/pi-subagents | subprocess | ✗ Sets no parent-session variable |

**這已經過時。** 我們安裝的正是 `nicobailon/pi-subagents@0.66.0`，其 `src/extension/index.ts:963-971`：

```ts
// Set PI_SUBAGENT_PARENT_SESSION for permission-system forwarding.
// Only set in the root session (the interactive UI session), not in a child host…
if (!process.env[SUBAGENT_CHILD_ENV]) {
  const sessionId = ctx.sessionManager.getSessionId();
  if (sessionId) {
    process.env[SUBAGENT_PARENT_SESSION_ENV] = sessionId;
  }
}
```

並在 parent session shutdown 時清除（`index.ts:1068-1069`）。`src/runs/shared/child-runtime-config.ts:16` 的註解直接寫「for pi-permission-system ask forwarding」。`src/extension/doctor.ts:204-215` 也把它列入診斷輸出。

**所以 background（async）children 的 ask forwarding 可用。**

### 6.2 真實缺口：foreground（in-process）child 無確定性偵測

pi-permission-system 完整的 in-process 支援需要 `subagents:child:session-created` 事件。實測：

```
$ grep -rn "subagents:child" --include=*.ts pi-subagents/src
（零命中）
```

而 `PI_SUBAGENT_CHILD` 依其註解「Set in processes that host child sessions (**the async runner**)」—— 只在 async runner process 設定，**foreground child 與 parent 同 process、共用 env，因此沒有任何 marker**。

**後果**：foreground（同步）subagent 內若命中 `ask`，pi-permission-system 無法確定它是 child，也就無處轉發，該 ask 會以「approval unavailable」收場（等同 block）。

**因應**：對會觸發 `ask` 的寫入型 subagent 用 async（background）模式；或為 child 設計明確的 `allow` 政策避免 `ask`。這一點應在採用前實測確認。

---

## 7. 採用成本與風險

| 項目 | 評估 |
|---|---|
| **規模** | 23,469 行 TS（pi-guard 2,749 行，約 8.5 倍）。深度換來能力，也換來理解成本 |
| **迭代速度** | v31.1.3，CHANGELOG 245KB。README「Upgrading」列出多個 breaking：16.0.0（bash fail closed）、22.0.0（project trust）、0644／0745／0746／0794／0796／0810。**升級需要讀 migration note，不能盲升** |
| **設定遷移** | config 格式與 pi-guard 完全不同，位於 `~/.pi/agent/extensions/pi-permission-system/config.json`。我們今天做的 107 條 bash 規則需要重寫為 surface-based 政策 |
| **對 `~/.pi/agent` 的影響** | 會在 `~/.pi/agent/extensions/` 下建立套件目錄存放 config —— 需操作者確認（先前只同意了 `state/`） |
| **與 pi-guard 共存** | **不建議。** 兩者都掛 `tool_call`，會造成雙重確認與難以推理的疊加行為。應二選一 |
| **來源** | 是 `MasuRii/pi-permission-system` 的 fork，已大幅分歧。維護者 gotgenes 同時維護 `@gotgenes/pi-subagents` fork，其最佳整合對象是自家 fork |
| **依賴** | `tree-sitter-bash`、`web-tree-sitter`、`zod`。bash 解析用 tree-sitter（pi-guard 用 unbash），兩者都是 AST 級 |

---

## 8. 建議

### 8.1 權限層：以 pi-permission-system 取代 pi-guard

理由：修正了三個實測陷阱、補上工具隱藏與 fail-closed、修好 project trust 漏洞、`path` 跨切面規則消除 viewer 清單維護、`deny` 是真硬擋且有測試保護。

建議步驟（每步都要驗證，不要一次切換）：
1. 先在**不停用 pi-guard**的情況下安裝並以最小政策觀察行為（兩者共存期間會雙重確認，僅作為短期觀察）
2. 把目前 107 條 bash 規則翻譯為 surface-based 政策，特別利用 `path` 取代 11 條 viewer × secrets 的組合
3. 實測關鍵案例（與我們對 pi-guard 做的 148 項同等強度）：`git add -A` deny 不彈框、`.env` 跨工具 deny、symlink 別名、複合命令最嚴格取值、subagent 情境
4. 通過後才停用並移除 pi-guard 設定

### 8.2 agents-guard：照原設計實作，兩處調整

`docs/design.md` 的架構不需推翻，但要記錄兩項：

1. **§5.2 subagent-policy 確認必須自建 `tool_call` 攔截** —— 已驗證 authorizer link 拿不到 tool input，這不是選擇而是限制。
2. **§5.1 writer-lock 新增可選的 authorizer 整合模式**（預設仍為自建 `tool_call` 攔截）：
   - **模式 A（預設，獨立）**：自己在 `tool_call` 擋。不依賴任何外部套件，不需要操作者改政策。
   - **模式 B（可選，整合）**：註冊 `agents-guard` authorizer link。需要操作者把 `write`／`edit`／危險 git 命令設為 `ask` 並列入 `authorizerChain`。好處是決策集中、統一 review log、child 的 ask 自動轉發到 parent 由同一 chain 判定。
   - 兩模式共用同一份純函式決策核心（`decideLockAction`），只有 wrapper 不同 —— 這正是原設計「純函式與 pi API 解耦」的價值。

### 8.3 不建議的做法

- **不要**為了整合而把 `subagent-policy` 改成 authorizer link（資訊不足，會做出比自建更弱的判定）
- **不要**同時啟用 pi-guard 與 pi-permission-system 作為長期狀態
- **不要**在未實測 foreground subagent 的 ask 行為前，就把寫入型 surface 設為 `ask`

---

## 9. 事實／推論分界

**已由原始碼或測試碼證實**
- `deny` 不 prompt：`src/handlers/gates/runner.ts:190` 註解 + `test/handlers/gates/runner.test.ts:249` 測試（含 yolo 模式）
- `PromptPermissionDetails`／`PromptPayload` 不含原始 tool input：`src/authority/permission-prompter.ts:48`、`src/presentation/prompt-payload.ts:49`；而 gate 內部確實有（`src/handlers/gates/tool.ts:97,115`）
- authorizer link 只在 `ask` 時被諮詢、`allow` 在 path／external_directory family 被降級為 defer：`docs/configuration.md` §Authorizer chain
- project trust gating 自 v22.0.0 起：README §Upgrading
- 我們的 `pi-subagents@0.66.0` 是 `nicobailon` 版且已設 `PI_SUBAGENT_PARENT_SESSION`：`src/extension/index.ts:963-971`
- `pi-subagents` 不發 `subagents:child:*` 事件：對其 `src/` 的 grep 零命中
- pi-permission-system 相容表把 nicobailon 列為未設 parent-session 變數：`docs/subagent-integration.md:204`（與上一條矛盾 → 文件過時）

**推論（需採用前實測）**
- foreground（in-process）subagent 命中 `ask` 時的實際結果（推論為「approval unavailable」等同 block）
- 107 條 pi-guard bash 規則翻譯為 surface 政策後的等價性
- 兩套權限系統共存期間的疊加行為細節
- 升級到未來 major 版本的實際破壞面

**建議（判斷）**
- §8 的全部內容
