# 三方權限系統比較：pi-guard vs MasuRii vs gotgenes

- 日期：2026-09-09
- 比較對象：
  - `pi-guard@1.4.0`（jdiamond，已安裝）
  - `pi-permission-system@0.8.0`（MasuRii，**上游原版**）
  - `@gotgenes/pi-permission-system@31.1.3`（gotgenes，MasuRii 的 fork）
- 方法：clone 三者原始碼，以 jiti 直接執行其比對函式做實測，不以 README 敘述為唯一證據

---

## 1. 結論

**MasuRii 不建議採用。** 它功能比 pi-guard 多，但**在最核心的 bash 命令防護上比 pi-guard 弱**，而且弱在一個會被日常命令觸發的地方。

| 排序 | 系統 | 一句話 |
|---|---|---|
| 1 | **gotgenes fork** | 唯一能擋 shell 重導向與複合命令、且有 project trust 檢查 |
| 2 | **pi-guard** | bash AST 分解正確，但 `deny` 語意弱、無重導向分析、無 trust 檢查 |
| 3 | **MasuRii** | 功能面板豐富，但 bash 比對是整串正則，複合命令全部漏掉 |

---

## 2. 規模與維護

| | pi-guard | MasuRii | gotgenes |
|---|---|---|---|
| src | 2,749 行 / 12 檔 | **7,155 行 / 25 檔** | 23,469 行 / 152 檔 |
| test | GitHub 有 7 檔（npm 發布不含） | 9,728 行 / 15 檔 | 54,374 行 / 173 檔 |
| test/src 比 | — | 1.36 | **2.32** |
| 版本 | 1.4.0 | 0.8.0 | 31.1.3 |
| 最近 commit | — | **2026-07-03**（2 個月前） | **2026-09-08**（前一日） |
| 依賴 | `minimatch`, `unbash` | **`jsonc-parser`（無 bash parser）** | `tree-sitter-bash`, `web-tree-sitter`, `zod` |

MasuRii 的規模落在中間（7,155 行），若只看行數會誤以為它是「pi-guard 與 gotgenes 之間的折衷」。實測顯示不是。

---

## 3. 決定性差異：bash 複合命令

### 3.1 MasuRii 的比對機制

`src/wildcard-matcher.ts:28-41`：把 wildcard pattern 轉成**對整個命令字串做 anchored 正則**：

```ts
let escaped = pattern
  .replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*/g, ".*")
  .replace(/\?/g, ".");
regex: new RegExp(`^${escaped}$`, ...)
```

`src/bash-filter.ts` 全檔 **49 行**，沒有任何 `&&`／`;`／`|`／subshell／wrapper 的分解邏輯。

### 3.2 實測後果

政策：`{"*": "ask", "git add -A": "deny", "sudo *": "deny", "rm -rf *": "deny", "git status": "allow"}`

| 命令 | MasuRii 判定 | 命中的 pattern |
|---|---|---|
| `git add -A` | `deny` | `git add -A` ✓ |
| `git status && git add -A` | **`ask`** | `*` ⚠️ |
| `ls; sudo rm -rf /` | **`ask`** | `*` ⚠️ |
| `echo ok \| sudo tee /etc/hosts` | **`ask`** | `*` ⚠️ |
| `$(git add -A)` | **`ask`** | `*` ⚠️ |
| `bash -c 'git add -A'` | **`ask`** | `*` ⚠️ |

**同樣這六個命令，pi-guard 全部擋下**（我在 2026-09-09 對 pi-guard 的實測：`echo ok && git add -A`、`bash -c 'git add -A'`、`$(cat .env)`、`find . -exec rm {} \;` 皆 BLOCK），因為它用 unbash AST 分解出每個 sub-command 並逐一判定。

### 3.3 為什麼這很嚴重

- 若 catch-all 是 `ask` → 退化為「彈框顯示整串命令讓人判斷」。使用者看到的是 `git status && git add -A`，前半段無害，很容易誤按 Allow。
- 若 catch-all 是 `allow`（很多人為了減少干擾會這樣設）→ **完全繞過**，`deny` 規則形同虛設。
- 這不是罕見的攻擊構造，而是 agent 每天都在產生的一般命令形式（`cd X && npm test`）。

---

## 4. 完整能力對照

| 能力 | pi-guard | MasuRii | gotgenes |
|---|---|---|---|
| **bash 複合命令分解** | ✓ unbash AST | **✗ 整串正則** | ✓ tree-sitter AST |
| **bash wrapper 展開**（`sudo`／`xargs`／`bash -c`／`find -exec`） | ✓ | ✗ | ✓ |
| **複合命令取最嚴格**（`deny > ask > allow`） | ✓ | ✗ | ✓ |
| **shell 重導向當寫入**（`echo x > f`） | ✗ | ✗ | **✓** `access-intent/bash/redirect-analysis.ts`，含 fd/檔案區分與 fail-closed |
| **`deny` 是否真硬擋** | **✗ 互動模式退化為 ask** | ✓ 直接 `block: true` | ✓ 且有測試保護（連 yolo 也不放行） |
| **project trust 檢查** | ✗（安全漏洞） | **✗**（同樣漏洞） | ✓ `ctx.isProjectTrusted()` |
| **symlink 解析防別名繞過** | ✗ | ✗ | ✓ |
| 啟動前隱藏被禁工具 | ✗ | ✓ | ✓ |
| system prompt 消毒（移除被禁工具說明） | ✗ | ✓ | ✓ |
| subagent ask forwarding | ✗ | ✓（檔案式 IPC） | ✓ |
| MCP gate | ✗ | ✓ | ✓ |
| skill gate | ✗ | ✓ | ✓ |
| per-agent 政策（frontmatter） | ✗ | ✓ | ✓ |
| OpenCode 政策移植 | ✗ | ✓（設計目標） | ✓（有相容文件） |
| yolo mode | ✗ | ✓ | ✓ |
| session approvals | ✓ | ✓ | ✓ |
| review log | ✗ | ✓ | ✓ |
| cross-extension API（authorizer chain 等） | ✗ | ✗ | ✓ |
| 設定位置 | `settings.json` 的 `guard` | `~/.pi/agent/pi-permissions.jsonc` | `~/.pi/agent/extensions/pi-permission-system/config.json` |

---

## 5. MasuRii 的其他觀察

**優點**
- 單檔 `index.ts` 2,236 行 + 24 個模組，架構比 gotgenes 好理解得多
- OpenCode 政策移植是明確設計目標，README 有完整對照表
- 有工具隱藏與 system prompt 消毒（pi-guard 完全沒有）
- `deny` 語意正確（直接 `block: true`，不 prompt）
- 測試 9,728 行、含多個 `-red.test.ts`（TDD 風格的 red-phase 測試）與 `wildcard-redos.test.ts`（ReDoS 防護測試）

**缺點**
- **bash 複合命令不分解**（§3，決定性）
- **無 project trust 檢查**（與 pi-guard 同樣的漏洞）
- **無 shell 重導向分析**（`grep -il redirect` 唯一命中是 `ensureDirectoryExists` 的變數名，與重導向無關）
- **無 symlink 解析**（唯一 `canonical` 命中是 `tool-registry.ts` 的工具別名，與路徑無關）
- 2026-07-03 後無 commit，2 個多月未動；gotgenes fork 則持續高速迭代
- forwarding 用檔案式 IPC（`requestsDir`／`responsesDir`）—— 可行，但這些目錄若在 agent 可寫範圍內，需自行確認是否構成新的攻擊面（本次未深入驗證）

---

## 6. 三個選項的取捨

| 選項 | 得到 | 失去／風險 |
|---|---|---|
| **維持 pi-guard + 自我保護規則**（已於今日套用） | bash AST 分解正確；設定已驗證 148+40 項；零遷移成本 | `deny` 只有確認強度（陷阱 D）；重導向可繞（`echo x > settings.json`）；無 trust 檢查 |
| **換 MasuRii** | 工具隱藏、MCP/skill gate、forwarding、OpenCode 相容、`deny` 真硬擋 | **bash 複合命令防護退步**；仍無 trust 檢查與重導向分析；上游停更 2 個月 |
| **換 gotgenes fork** | 全部能力，含唯一的重導向分析與 trust 檢查 | 23K 行、v31、7 個 breaking migration；高速迭代帶來持續升級成本；bus factor |

---

## 7. 建議

**不要換 MasuRii。** 它會用「更多功能」換掉「bash 複合命令防護」—— 而後者是每天都會遇到的路徑，前者多半是我們目前用不到的（沒有 MCP server、skill 由 pi 自己管、subagent 大多走 allow 政策）。

現階段兩個合理選擇：

**(A) 維持現狀（pi-guard + 今日的自我保護規則）+ agents-guard 補洞**
- 已完成：`write`/`edit` 的 24 條自我保護規則、bash 的持久化繞過向量（`crontab`／`at`／`launchctl`／`ln`）
- 剩下的缺口：`deny` 語意弱、重導向可繞
- 由 agents-guard 的 `hard-deny` 模組補上（自己在 `tool_call` 硬擋，並自行解析重導向目標）
- 成本：約 300–500 行自有程式碼，但完全自主可控

**(B) 換 gotgenes fork**
- 唯一能一次關閉「重導向繞過 + `deny` 語意 + trust 漏洞」三個缺口的選項
- 代價是持續的升級維護與 23K 行的審計負擔

**我的建議是 (A)**，理由：
1. 今日已把 pi-guard 的設定驗證到 188 項通過，這份投資不必浪費
2. 缺口明確且可列舉（兩項），適合用小量自有程式碼精準補上
3. `hard-deny` 的判定邏輯在我們自己手上，不受任何 upstream breaking change 影響
4. 未來若要換 gotgenes，`hard-deny` 可直接移除（它的 `deny` 是真硬擋、且有 redirect 分析），agents-guard 其他 4 個模組完全不動

---

## 8. 事實／推論分界

**已由原始碼或實測證實**
- MasuRii 的 wildcard 是對整串命令的 anchored 正則（`src/wildcard-matcher.ts:28-41`），`bash-filter.ts` 全檔 49 行無分解邏輯
- 實測 6 種複合命令形式在 MasuRii 下全部只命中 catch-all（見 §3.2）
- MasuRii 的 `deny` 直接 `block: true` 不 prompt（`src/index.ts` tool_call handler）
- MasuRii 無 `isProjectTrusted`、無 `realpath`／symlink 解析、無重導向分析（grep 命中皆為同名但無關的變數）
- MasuRii 依賴只有 `jsonc-parser`，無 bash AST parser
- 規模與最近 commit 日期（§2）
- gotgenes 有 `redirect-analysis.ts`、`ctx.isProjectTrusted()`、deny 不 prompt 的測試

**推論（未實測）**
- MasuRii 檔案式 forwarding 的 `requestsDir`／`responsesDir` 是否構成新攻擊面
- MasuRii 在 catch-all 為 `allow` 時的實際繞過程度（推論為完全繞過）
- 三者在真實 session 中的效能差異

**建議（判斷）**
- §7 的全部內容
