# AgentMeter

用來查看 **Claude Code、Codex、Antigravity、Grok 與 Grok Bot** 訂閱使用額度的 Windows 系統匣應用程式。可在 Dashboard、桌面 Widget 或精簡 Strip 中查看帳號，不必把憑證交給另一個雲端服務管理。

**目前程式碼版本：0.0.1** · Windows 10/11 · Tauri + WebView2 · MIT

[English](./README.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [Italiano](./README.it.md) · [Deutsch](./README.de.md) · [繁體中文](./README.zh-TW.md)

[功能](#features) · [設定](#installation) · [帳號](#accounts) · [Widget / Strip](#widget-strip) · [建置與測試](#development)

<a id="features"></a>
## 功能

- **五種服務**：各自更新，提供設定／狀態訊息、快取與重試退避；單一服務暫時無法使用不會阻擋其他服務。
- **四個 Dashboard 頁面**：Home、Services、Statistics、Settings；側邊欄僅顯示圖示，支援翻譯提示、鍵盤操作與無障礙名稱。
- **Claude／Codex 多帳號**：隔離設定檔、官方 CLI 登入、帳號專屬終端機、獨立額度／快取／重試，以及每個服務一個 Strip 選定帳號。
- **額度資訊**：服務實際回報的時段、已用／剩餘百分比、方案、重置倒數、使用速度指標及可用的產品用量細目。
- **Neon 桌面 Widget**：透明且置頂的視窗、帳號名稱、百分比圓環、工作階段進度條、對齊的 5h／7d 欄位與小型重置倒數；額外帳號可在內部捲動。
- **Widget 縮放**：預設 **100%**，可調至 **300%**，每次 **25%**；疊加 Windows DPI 縮放。已儲存的 Widget 倍率不會放大 Strip。
- **精簡 Strip**：選定帳號、服務縮寫，可自由拖曳或釘在工作列上方，不占用桌面工作區。
- **顯示控制**：隱藏服務會暫停其查詢；可隱藏 Antigravity 的 Claude+GPT 池而不修改原始資料。
- **記住偏好**：語言、已用／剩餘方向、顯示模式、縮放、鎖定、Widget／Strip 各自的位置與工作列釘選。
- **系統匣與開機啟動**：開啟 Dashboard、顯示／隱藏小工具、鎖定位置、登入 Windows 時啟動及結束程式；桌面／螢幕初始化期間會重試恢復已選的小工具。
- **淺色／深色與五種介面語言**：套用至 Dashboard、Widget、Strip 與系統匣；未明確選擇主題時跟隨系統外觀。
- **保守的 Claude 查詢策略**：Windows 閒置／鎖定時暫停，重新啟動後仍遵守伺服器冷卻，access token 被拒絕時透過官方 CLI 嘗試恢復。
- **本機整合**：讀取既有桌面程式／CLI 登入。Antigravity 使用 IDE 或 `agy` 的本機伺服器；不需要瀏覽器擴充功能、AgentMeter 帳號或遙測。

<a id="screenshots"></a>
## 畫面預覽

### Dashboard
<p align="center"><img src="./assets/screenshots/dashboard.png" alt="AgentMeter 深色 Dashboard 真實截圖" width="644"></p>

### Widget
<p align="center"><img src="./assets/screenshots/widget.png" alt="AgentMeter 多帳號 Neon Widget" width="640"></p>

### Strip
<p align="center"><img src="./assets/screenshots/strip.png" alt="AgentMeter 精簡 Strip" width="500"></p>

以下為 **AgentMeter 的真實截圖**，不是設計示意圖：Dashboard 使用預設 644 px 寬度，Widget 使用 100% 縮放。讀值與可用時段依登入帳號及方案而定；截圖不代表固定的範例額度。

<a id="providers"></a>
## 支援的服務

| 服務 | 服務有回報時顯示的資料 | 所需來源 |
|---|---|---|
| **Claude** | 工作階段／5 小時、每週、模型專屬上限、方案與重置時間 | 已登入的 Claude Code 設定檔 |
| **Codex** | 工作階段／5 小時，以及依方案／帳號提供的每週或每月時段 | Codex Desktop 或已登入的 Codex CLI 設定檔 |
| **Antigravity** | Gemini 與 Claude+GPT 池及其 5 小時／每週時段 | 已登入並持續執行的 Antigravity IDE **或獨立 `agy` CLI** |
| **Grok** | 供應商回報的訂閱額度與產品細目 | 已登入的 Grok Build CLI 設定檔 |
| **Grok Bot** | 獨立計算的每週額度 | 已登入的 Grok Bot 桌面 App |

AgentMeter 只呈現可用資料，不會虛構缺少的時段。Codex 僅回報每週額度時會使用整個額度區。Widget 隱藏沒有可用讀值的帳號／服務；Home 可保留設定／錯誤卡片。明確隱藏的服務完全不會被查詢。

<a id="installation"></a>
## 安裝與服務設定

1. 從 [GitHub Releases](https://github.com/carlos-mto/AgentMeter/releases) 下載可用安裝檔，或[建置目前程式碼](#development)。若尚無可用安裝檔，請從原始碼建置。
2. 執行安裝檔並開啟 **AgentMeter**。目前程式碼會產生 `AgentMeter_0.0.1_x64-setup.exe` 與 `agentmeter.exe`。
3. 完成所用服務的登入／設定。關閉 Dashboard 會留在系統匣；**Quit** 才會結束程式。

**需要 Windows 10/11 與 Microsoft Edge WebView2 Runtime。** 從原始碼建置另需下列開發工具。目前建置未加入程式碼簽章，請使用可信任的發布／來源檔案。

- **Claude**：必要時安裝 Claude Code，執行 `claude` 並登入。一般額度查詢不要求 CLI 持續開啟。
- **Codex**：在 Codex Desktop 登入目前帳號，或透過 **Services → Accounts → Sign in** 設定獨立 CLI 帳號。此按鈕與 **Open CLI** 需要官方 `codex` CLI。
- **Antigravity**：保持已登入的 IDE 或 `agy` 終端機工作階段執行中。AgentMeter 自動偵測 `127.0.0.1` 本機伺服器，不需手動設定連接埠／token。使用 `agy` 不需要 IDE；兩者同時執行時優先採用 IDE。兩者都關閉時，尚未失效的快取時段可能保留最多 24 小時。
- **Grok Bot**：安裝[桌面 App](https://docs.x.ai/grok-bot/get-started) 並登入。額度與 Grok／SuperGrok 分開計算；AgentMeter 要求更新登入資料時，請重新開啟 Grok Bot。
- **Grok**：安裝 Grok Build 並登入一次；AgentMeter 要求更新登入資料時，請重新開啟。

Gemini 模型仍透過 **Antigravity 的額度池**提供，不再是獨立服務。

<a id="dashboard"></a>
## Dashboard 導覽

預設視窗為 **644 × 840 邏輯像素**。可縮至 **380 × 520**，使用響應式卡片與 **68 px 圖示側邊欄**。滑鼠停留時顯示翻譯名稱；主題與語言捷徑位於下方。

| 頁面 | 功能 |
|---|---|
| **Home** | 各服務／帳號卡片、真實時段、方案／狀態、重置、使用速度與細目；手動更新及來源顯示控制。 |
| **Services** | 統一管理帳號、選擇 Strip 帳號、顯示／隱藏服務、查看連線狀態與設定說明。 |
| **Statistics** | 目前額度快照表，包含已用／剩餘與快取狀態，尊重服務／池的顯示偏好；不增加查詢、不提供歷史圖表、不平均無關額度。 |
| **Settings** | 全域外觀、語言捷徑與已用／剩餘顯示；帳號放在 Services，不在此重複。 |

**Antigravity 的 Claude+GPT 眼睛按鈕**可在所有畫面隱藏／恢復該池。隱藏時 Widget／Strip 使用 Gemini **5h / 7d** 時段；不修改查詢或原始資料。

<a id="accounts"></a>
## Claude 與 Codex 多帳號

1. 開啟 **Services → Accounts**；帳號依服務分組。
2. 選擇 Claude 或 Codex，再按 **Add account**；登入後帳號會顯示其憑證中的使用者名稱（在此之前以編號顯示，例如「Account 2」）。
3. 目錄留空會建立隔離設定檔；也可填入既有的**絕對設定目錄路徑**，不是憑證檔案。
4. 使用 **Sign in** 透過官方 CLI 登入；AgentMeter 不會在設定檔間複製憑證。

| 操作／行為 | 說明 |
|---|---|
| **Open CLI** | 開啟新終端機，只為該設定檔指定 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME`；不改變既有終端機或全域環境。 |
| **Check accounts** | 檢查啟用帳號並遵守冷卻與排程保護；Claude 保留至少六分鐘查詢間隔及閒置／鎖定暫停。 |
| **Selected for Strip** | 每個服務選一個 Strip 帳號，不隱藏 Home／Statistics／Widget 中其他帳號。 |
| **Remove** | 忘記設定檔，但保留檔案及執行中的工作階段。 |
| **Current account** | 隱含的預設帳號，尊重既有環境變數或 `~/.claude` / `~/.codex`；不能移除。 |

各設定檔有獨立額度、快取與重試狀態。優先使用本機可取得的使用者名稱，再回退至別名；Widget 使用較小的小寫名稱。帳號登錄不顯示或儲存電子郵件網域／token。隱藏服務會暫停該服務所有帳號。Widget 的 **Accounts** 按鈕直接開啟 Services。

多帳號管理目前**僅支援 Claude 與 Codex**。其他服務維持單帳號行為，沒有自動帳號輪替。

<a id="widget-strip"></a>
## Widget 與 Strip

透過側邊欄按鈕或系統匣選擇桌面顯示模式。

### Widget

- 無邊框、透明且置頂，使用 AgentMeter 儀表圖示與 Neon 版面。
- 顯示所有有可用讀值的 Claude／Codex 帳號、百分比圓環、工作階段進度條與對齊的 **5h / 7d** 欄位；只有每週額度的帳號會留空 5h，下方有小型重置倒數。
- 未設定或無可用讀值的項目會隱藏，資料可用時重新顯示；額外列可在內部捲動。
- 拖曳標題列移動，鎖定控制可防止意外移位。
- **− / +** 調整 **100–300%**，每次 **25%**；記住倍率並疊加 Windows DPI 縮放。
- **Accounts** 開啟 Services；**Open dashboard** 顯示詳情而不隱藏 Widget。

### Strip

- 精簡水平列，每個服務顯示一個選定的 Claude／Codex 帳號、服務縮寫、百分比及重置提示。
- 與 Widget 相同，會隱藏選定帳號尚無可用讀數的服務（未設定、無法使用、發生錯誤或需要登入）；這些狀態請在 Dashboard 查看。
- 保持原本精簡倍率，不受 Widget 放大設定影響。
- 控制按鈕以外皆可拖曳；點擊圖釘控制後，可放到工作列上方的空白區。
- 不保留桌面工作區；工作列自動隱藏或其他 App 全螢幕時，疊加視窗會讓位。

Widget 與 Strip 記住**各自的位置**。**Open dashboard** 保留小工具顯示與工作列釘選；**Hide** 或取消系統匣勾選才隱藏。兩者共用 Dashboard 資料，不增加額度查詢。

<a id="tray"></a>
## 系統匣與開機啟動

左鍵點擊系統匣圖示切換 Dashboard 顯示；右鍵提供 **Open dashboard、Show widget、Show strip、Lock widget position、Launch at startup、Quit**。

想在登入 Windows 後使用小工具時，啟用 **Launch at startup**，並在結束前選擇 Widget 或 Strip。啟動使用 `--hidden`：Dashboard 不會開啟，並在桌面／螢幕初始化期間重試恢復已儲存模式、縮放與位置。未啟用小工具時，只有系統匣圖示屬於正常行為。

<a id="appearance"></a>
## 外觀與語言

- **主題**：淺色／深色；明確選擇前跟隨系統。Widget 保留 Neon 外觀與透明視窗，不淡化文字或控制項。
- **額度方向**：選擇 **Used（已用）**或 **Remaining（剩餘）**，套用至 Dashboard、Statistics、Widget、Strip。
- **介面語言**：**English、Español、Português、Italiano、Deutsch**。透過右上方 **Language** 或側邊欄／Settings 捷徑更改，記住設定並更新系統匣。
- 首次使用會偵測支援的 Windows 介面語言，否則使用英文。服務名稱及原始技術診斷維持來源文字。

文件提供英文、西班牙文、葡萄牙文、義大利文、德文與繁體中文；有中文 README **不代表目前已實作中文介面**。

<a id="privacy"></a>
## 隱私、本機資料與品牌相容性

沒有遙測、分析或 AgentMeter 雲端帳號。額度查詢使用支援的本機登入與供應商通訊；沒有 AgentMeter 上傳／同步服務。

- 視查詢需求讀取本機桌面程式／CLI 的 access 憑證，但不使用供應商 refresh token。Claude 回傳 `401` 時，透過官方 `claude update` 嘗試恢復後重讀 access token；該命令可能更新 Claude Code。
- Antigravity 透過 IDE／`agy` 的本機 loopback 伺服器查詢，不管理 Google 登入。
- Grok Bot 短效 access token 只在本機透過 Windows DPAPI 解開並用於額度請求；AgentMeter 不解密、使用、快取或傳送其 refresh token。
- 新增設定檔不複製憑證，移除設定檔不刪除帳號檔案。

資料目錄為 **`%LOCALAPPDATA%\stackly-agent-manager`**。外部 CLI 目錄保持不變：


| 位置／識別 | 用途 |
|---|---|
| `accounts.json` | 別名、設定路徑與 Strip 選定帳號，不存憑證。 |
| `accounts/<provider>/<id>` | 新隔離設定檔的預設目錄；官方 CLI 管理登入。 |
| `widget.json` | 顯示／語言偏好與儲存位置。 |
| `provider-cache` | 額度／重試快照與受限診斷。 |

<a id="troubleshooting"></a>
## 疑難排解

| 問題 | 檢查方式 |
|---|---|
| Widget 缺少服務／帳號 | 在 Services 啟用服務並完成登入；Widget 需要可用讀值，Home 可顯示設定／錯誤。 |
| 登入 Windows 後 Widget／Strip 未恢復 | 啟用 **Launch at startup** 並儲存所需小工具模式，而非只用 Dashboard。等待桌面／螢幕恢復，必要時從系統匣開啟。 |
| Grok 消失或要求登入 | 安裝／開啟 Grok Build、登入後更新卡片；AgentMeter 不會自行更新 CLI token。 |
| Claude 被限流 | 遵守重試倒數；手動更新與 **Check accounts** 不繞過伺服器冷卻，重啟也不清除。 |
| Windows 閒置／鎖定時 Claude 不更新 | 預期的暫停；恢復活動後會延遲查詢，避免喚醒時大量請求；既有冷卻仍有效。 |
| Claude 拒絕 access token | 會透過官方 CLI 嘗試恢復；失敗時開啟 Claude Code 並檢查／完成登入。 |
| Antigravity 要求啟動客戶端 | 維持已登入 IDE 或 `agy` 工作階段執行；只有安裝或執行 `agy --help` 不足以讀取資料。 |
| Grok Bot 要求登入 | 重新開啟 Grok Bot；後續查詢會讀取更新的短效 access token。 |
| Windows 顯示未知發行者 | 建置未簽章，請使用可信任發布或自行建置。 |

<a id="limitations"></a>
## 已知限制

- **僅 Windows**；本專案目前不提供受支援的 macOS／Linux 建置。
- 供應商端點未公開，格式、方案與可用性可各自變更。
- Statistics 是目前快照，不是儲存的使用歷史、token 帳單報告或預測。
- 多帳號設定檔僅支援 Claude／Codex，尚未提供自動輪替。
- 只有一個小工具視窗，可移至其他螢幕，但 Widget／Strip **不會自動複製到每個螢幕／工作列**。
- 快取會明確標示，不保證即時額度。

<a id="development"></a>
## 從原始碼建置與測試

### 開發需求

- Windows 10/11 與 WebView2 Runtime。
- **Node.js 22+** 與 npm，亦供選用的原生 WebView 測試使用。
- **Rust stable**，使用 Windows MSVC toolchain。
- Visual Studio／Build Tools 的 **Desktop development with C++** 工作負載與 Windows 10/11 SDK。

在專案根目錄執行：

```powershell
npm ci
npm run tauri -- dev
```

產生 Windows 安裝檔：

```powershell
npm run tauri -- build --bundles nsis -- --locked
```

0.0.1 的輸出：

```text
src-tauri/target/release/agentmeter.exe
src-tauri/target/release/bundle/nsis/AgentMeter_0.0.1_x64-setup.exe
```

發佈：`npm run release`（或以 `pwsh scripts/release.ps1 -DryRun` 預演）會執行測試、建置 NSIS 安裝檔、建立 `v<版本>` 標籤，並發佈附有安裝檔及其 SHA-256 的 GitHub Release。需要先執行 `gh auth login`。
執行自動測試：

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

選用的 [Dashboard](./tests/smoke/dashboard.smoke.mjs) 與[帳號](./tests/smoke/accounts.smoke.mjs)原生測試需暫時啟用**僅限 loopback 的 CDP**；一般使用不需要，也不應持續開啟。實作、查詢策略與原生整合細節請參閱[架構說明](./docs/architecture.md)。

<a id="project"></a>
## 專案與授權

- [架構說明](./docs/architecture.md)
- [Tauri + Rust + Windows 架構](./docs/tauri-rust-windows-architecture.md)
- [回報問題](https://github.com/carlos-mto/AgentMeter/issues)
- 靈感來自多個社群專案與工具。

採用 [MIT License](./LICENSE)。
