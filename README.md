# AgentMeter

A Windows tray app for monitoring the subscription usage limits of **Claude Code, Codex, Antigravity, Grok and Grok Bot**. See your accounts in a Dashboard, a desktop Widget or a compact Strip without managing credentials in a separate cloud service.

**Current code version: 0.0.1** · Windows 10/11 · Tauri + WebView2 · MIT

[English](./README.md) · [Español](./README.es.md) · [Português](./README.pt.md) · [Italiano](./README.it.md) · [Deutsch](./README.de.md) · [繁體中文](./README.zh-TW.md)

[Features](#features) · [Setup](#installation) · [Accounts](#accounts) · [Widget / Strip](#widget-strip) · [Build and test](#development)

<a id="features"></a>
## Features

- **Five providers**, with independent refreshes, setup/status messages, cached readings and retry/backoff handling. One unavailable provider does not block the others.
- **Four Dashboard pages:** Home, Services, Statistics and Settings; an icon-only sidebar with localized tooltips, keyboard navigation and accessible control names.
- **Claude/Codex multi-account support:** isolated profiles, official CLI sign-in, new account-specific terminals, per-account quotas/cache/retries and one selected account per provider for Strip.
- **Quota details:** reported usage windows, Used/Remaining percentages, plan badges, reset countdowns, pace indicators and provider/product breakdowns when available.
- **Neon desktop Widget:** transparent window, always on top, account names, percentage rings, session bars, aligned 5h/7d columns and small reset countdowns. Extra accounts scroll inside the view.
- **Widget scaling:** starts at **100%**, adjustable to **300%** in **25% steps**, on top of Windows DPI scaling. The saved scale does not enlarge Strip.
- **Compact Strip:** selected accounts, abbreviated provider names, freely draggable or pinned above a taskbar without reserving desktop work area.
- **Visibility controls:** hide providers and pause their polling; hide/show Antigravity's Claude+GPT pool without changing its underlying readings.
- **Persistent preferences:** language, quota direction, companion mode, Widget scale, lock, separate Widget/Strip positions and taskbar pin.
- **Tray and startup:** open Dashboard, show/hide companions, lock position, launch at Windows sign-in and quit. Saved companions are retried while the desktop/monitors initialize.
- **Light/dark appearance and five UI languages**, updated across Dashboard, Widget, Strip and tray. System appearance is followed until a theme is explicitly selected.
- **Conservative Claude polling:** pauses while Windows is idle/locked, respects server cooldowns across restarts and attempts recovery through the official CLI after rejected access tokens.
- **Local integration:** reads existing desktop/CLI sign-ins. Antigravity uses its IDE or `agy` local server; no browser extension, AgentMeter account or telemetry is required.

<a id="screenshots"></a>
## Screenshots

### Dashboard
<p align="center"><img src="./assets/screenshots/dashboard.png" alt="Real AgentMeter Dashboard in dark mode" width="644"></p>

### Widget
<p align="center"><img src="./assets/screenshots/widget.png" alt="AgentMeter Neon Widget with multiple accounts" width="640"></p>

### Strip
<p align="center"><img src="./assets/screenshots/strip.png" alt="AgentMeter compact Strip" width="500"></p>

Real captures of **AgentMeter**, not mockups: Dashboard at its 644 px default width and Widget at 100%. Readings and available windows depend on the signed-in accounts and their plans; screenshots are not fixed example quotas.

<a id="providers"></a>
## Supported providers

| Provider | What is shown when reported | Required source |
|---|---|---|
| **Claude** | Session/5-hour, weekly and model-specific limits; plan and resets | A signed-in Claude Code profile |
| **Codex** | Session/5-hour plus weekly or monthly windows, depending on plan/account | Codex Desktop or a signed-in Codex CLI profile |
| **Antigravity** | Gemini and Claude+GPT quota pools, their 5-hour/weekly windows | A signed-in Antigravity IDE **or standalone `agy` CLI**, kept running |
| **Grok** | Subscription allowance and product breakdowns when reported | A signed-in Grok Build CLI profile |
| **Grok Bot** | A separate weekly allowance | A signed-in Grok Bot desktop app |

AgentMeter displays available provider data rather than inventing missing windows. A weekly-only Codex card uses the full quota area. Widget hides accounts/providers without usable readings; Home can retain account setup/error cards. Explicitly hidden providers are not polled.

<a id="installation"></a>
## Installation and provider setup

1. Download an available installer from [GitHub Releases](https://github.com/carlos-mto/AgentMeter/releases), or [build the current source](#development). If no installer is available yet, build from source.
2. Run the installer and open **AgentMeter**. The current source builds `AgentMeter_0.0.1_x64-setup.exe` and `agentmeter.exe`.
3. Complete the sign-in/setup for the providers you use. Close the Dashboard to leave the app in the tray; **Quit** exits it.

**Windows 10/11 and Microsoft Edge WebView2 Runtime are required.** Building from source additionally requires the tools below. Current builds are not code-signed; use trusted release/source files.

- **Claude:** install Claude Code if needed, run `claude` and sign in. The CLI does not need to remain running for normal checks.
- **Codex:** sign in to Codex Desktop for the current account, or use **Services → Accounts → Sign in** for a separate CLI profile. The official `codex` CLI is required for that button and **Open CLI**.
- **Antigravity:** keep a signed-in IDE or `agy` terminal session running. AgentMeter discovers its local server on `127.0.0.1`; no manual port/token setup is needed. With `agy`, the IDE is not required. If both run, the IDE is preferred. When neither runs, unexpired cached windows may remain for up to 24 hours.
- **Grok Bot:** install the [desktop app](https://docs.x.ai/grok-bot/get-started) and sign in. Its allowance is independent of Grok/SuperGrok. Reopen it when AgentMeter asks for renewed sign-in data.
- **Grok:** install Grok Build and sign in once. Reopen it if AgentMeter asks for renewed sign-in data.

Gemini models remain available through **Antigravity's quota pools**, not as a standalone provider.

<a id="dashboard"></a>
## Dashboard navigation

The default window is **644 × 840 logical pixels**. It is resizable down to **380 × 520**, with responsive cards and a **68 px icon rail**. Hover over an icon to see its translated label; theme and language shortcuts stay near the bottom.

| Page | Purpose |
|---|---|
| **Home** | Per-provider/account cards, real quota windows, plan/status, resets, pace and breakdowns. Manual refresh and source visibility controls. |
| **Services** | The single place for account management, Strip account selection, provider visibility, connection status and setup guidance. |
| **Statistics** | A table of the current quota snapshot, including Used/Remaining values and cached status, respecting provider/pool visibility. No extra provider requests, historical charts or averages across unrelated pools. |
| **Settings** | Global appearance, language shortcuts and Used/Remaining display; account controls are in Services, not duplicated here. |

The **Antigravity Claude+GPT eye button** hides/restores that pool in all views. With it hidden, Widget/Strip use Gemini's **5h / 7d** windows. The preference does not change polling or raw provider data.

<a id="accounts"></a>
## Multiple Claude and Codex accounts

1. Open **Services → Accounts**. Accounts are grouped by provider.
2. Choose Claude or Codex and click **Add account**; the account shows the username from its credentials after sign-in (until then it is numbered, e.g. "Account 2").
3. Leave the directory empty to create an isolated profile, or supply an existing **absolute configuration directory**, not a credential file.
4. Use **Sign in** to authenticate through the official CLI. AgentMeter does not copy credentials between profiles.

| Action / behavior | What it does |
|---|---|
| **Open CLI** | Opens a new terminal with only that profile's `CLAUDE_CONFIG_DIR` or `CODEX_HOME`; existing terminals and your global environment are unchanged. |
| **Check accounts** | Checks enabled profiles while respecting cooldowns and scheduling guards. Claude retains its six-minute polling floor and idle/lock pause. |
| **Selected for Strip** | Selects one account per provider for Strip, without hiding the other accounts from Home/Statistics/Widget. |
| **Remove** | Forgets the profile but leaves its files and running sessions intact. |
| **Current account** | The implicit default profile, honoring existing environment overrides or `~/.claude` / `~/.codex`; it cannot be removed. |

Each profile has independent quota/cache/retry state. Available local usernames are preferred over aliases; Widget renders them smaller and lowercase. Email domains and tokens are not shown or stored in the profile registry. Hiding a provider pauses all of its accounts. The Widget **Accounts** button opens Services directly.

Multi-account management currently covers **Claude and Codex only**. Other providers keep their existing single-account behavior; there is no automatic account rotation.

<a id="widget-strip"></a>
## Widget and Strip

Use the sidebar buttons or tray menu to choose a companion view.

### Widget

- Borderless, transparent, always on top, with the AgentMeter meter mark and Neon layout.
- Shows every usable Claude/Codex account, percentage rings, session bars and aligned **5h / 7d** columns. A weekly-only account leaves the 5h slot empty; small reset countdowns sit below the readings.
- Unconfigured accounts/providers or entries without usable data are hidden; usable readings make them reappear. Extra rows scroll inside the bounded view.
- Drag its header to move it; use the lock control to prevent movement.
- **− / +** adjusts **100–300%**, in **25% steps**. The value is saved; Windows DPI scaling also applies.
- **Accounts** opens Services; **Open dashboard** opens details without hiding the Widget.

### Strip

- A compact horizontal bar with one selected Claude/Codex account per provider, abbreviated labels and inline percentages/reset tooltips.
- Like Widget, hides providers whose selected account has no usable reading yet (not configured, unavailable, errors or sign-in required); check the Dashboard for those states.
- Keeps its original compact scale, independent of Widget magnification.
- Drag outside its controls to move it. Use the pin-shaped control to keep it above a taskbar, then drag it to a free section of that taskbar.
- Pinning does not reserve work area. The overlay yields when the taskbar is auto-hidden or another app is full-screen.

Widget and Strip remember **separate positions**. **Open dashboard** preserves companion visibility and taskbar pin; **Hide** or unchecking the tray option hides the companion. Both reuse Dashboard data without making additional quota requests.

<a id="tray"></a>
## Tray and launch at startup

Left-click the tray icon to toggle Dashboard visibility. Right-click for **Open dashboard**, **Show widget**, **Show strip**, **Lock widget position**, **Launch at startup** and **Quit**.

Enable **Launch at startup** if wanted, and select Widget or Strip before exiting if that view should return after Windows sign-in. Startup launches with `--hidden`: Dashboard stays closed, and the saved companion mode, scale and position are restored with retries while the desktop/monitors initialize. If no companion is enabled, a tray-only startup is intentional.

<a id="appearance"></a>
## Appearance and language

- **Theme:** light and dark across the app; follows system appearance until you explicitly select a theme. The Widget retains its Neon treatment and transparent window; text and controls are not faded.
- **Quota direction:** choose **Used** or **Remaining**, consistently across Dashboard, Statistics, Widget and Strip.
- **UI languages:** **English, Español, Português, Italiano and Deutsch**. Change **Language** at the top right or through the sidebar/Settings shortcut. The choice persists and applies to the tray too.
- On first use, a supported Windows UI language is detected, otherwise English is used. Provider names and raw technical diagnostics retain their source text.

Documentation is available in English, Spanish, Portuguese, Italian, German and Traditional Chinese; a Chinese README does **not** mean a Chinese UI is currently implemented.

<a id="privacy"></a>
## Privacy, local data and rebrand compatibility

No telemetry, analytics or AgentMeter cloud account. Quota checks contact the providers using supported local sign-ins; there is no AgentMeter upload/sync service.

- AgentMeter reads existing desktop/CLI access credentials as needed for quota requests, but does not use provider refresh tokens. After a Claude `401`, it asks the official `claude update` command to recover, then rereads the access token; that command may update Claude Code itself.
- Antigravity is queried through the IDE/`agy` local loopback server, not by managing a Google sign-in.
- Grok Bot's short-lived access token is unlocked locally with Windows DPAPI for the quota request; its refresh token is not decrypted, used, cached or sent by AgentMeter.
- Adding a profile does not copy credentials, and removing it does not delete account files.

The local data root is **`%LOCALAPPDATA%\stackly-agent-manager`**. External CLI directories are unchanged:


| Location / identity | Purpose |
|---|---|
| `accounts.json` | Profile aliases, configuration paths and selected Strip accounts, not credentials. |
| `accounts/<provider>/<id>` | Default directories for new isolated profiles; official CLIs manage their sign-ins. |
| `widget.json` | Companion/display/language preferences and saved positions. |
| `provider-cache` | Quota/retry snapshots and bounded diagnostics. |

<a id="troubleshooting"></a>
## Troubleshooting

| Symptom | What to check |
|---|---|
| Provider/account missing from Widget | Enable the provider in Services and complete its sign-in. Widget requires usable readings; Home can show setup/error state. |
| Widget/Strip does not return at login | Enable tray **Launch at startup** and save the desired companion mode, not Dashboard-only mode. Wait for desktop/monitor recovery; open the view from the tray if needed. |
| Grok missing or asking for sign-in | Install/open Grok Build, sign in and refresh the card. AgentMeter does not renew the CLI token itself. |
| Claude rate limit | Respect the displayed retry countdown. Manual refresh and **Check accounts** do not bypass server cooldowns; restarting does not clear them. |
| Claude not updating while idle/locked | Intentional pause; after activity resumes, checks are delayed to avoid a wake-up burst. Existing cooldowns still apply. |
| Claude rejects its access token | Recovery is attempted through the official CLI; if it fails, open Claude Code and sign in/check it. |
| Antigravity asks for a client | Keep the signed-in IDE or `agy` session running. Installing `agy` or running `agy --help` alone is insufficient. |
| Grok Bot asks for sign-in | Reopen Grok Bot; its renewed short-lived access token is read on a later check. |
| Unknown Windows publisher | Builds are not code-signed; use trusted project releases or build from source. |

<a id="limitations"></a>
## Limitations

- **Windows only**; no macOS/Linux build is supported by this project today.
- Provider endpoints are undocumented; availability, plans and window formats can change independently.
- Statistics are a current snapshot, not a stored usage history, token-billing report or forecast.
- Multi-account profiles are supported only for Claude/Codex; automatic rotation is not implemented.
- There is one companion window: it can move between monitors, but Widget/Strip is **not duplicated automatically on every monitor/taskbar**.
- Cached data is explicitly marked and is not a guarantee of live quota.

<a id="development"></a>
## Build and test from source

### Requirements

- Windows 10/11 and WebView2 Runtime.
- **Node.js 22+** with npm (also needed by the optional native WebView probes).
- **Rust stable**, with the Windows MSVC toolchain.
- Visual Studio / Build Tools with **Desktop development with C++** and a Windows 10/11 SDK.

From the repository root:

```powershell
npm ci
npm run tauri -- dev
```

Build the Windows installer:

```powershell
npm run tauri -- build --bundles nsis -- --locked
```

Outputs for 0.0.1:

```text
src-tauri/target/release/agentmeter.exe
src-tauri/target/release/bundle/nsis/AgentMeter_0.0.1_x64-setup.exe
```

Release: `npm run release` (or `pwsh scripts/release.ps1 -DryRun` to rehearse) runs the tests, builds the NSIS installer, tags `v<version>` and publishes the GitHub Release with the installer and its SHA-256. It requires `gh auth login`.

Run automated tests:

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

The opt-in [Dashboard](./tests/smoke/dashboard.smoke.mjs) and [accounts](./tests/smoke/accounts.smoke.mjs) native probes require temporary **loopback-only CDP**; it is not needed for normal use and should not be left enabled. See [architecture notes](./docs/architecture.md) for implementation details, quota policies and native integration.

<a id="project"></a>
## Project and license

- [Architecture](./docs/architecture.md)
- [Tauri + Rust + Windows architecture](./docs/tauri-rust-windows-architecture.md)
- [Report an issue](https://github.com/carlos-mto/AgentMeter/issues)
- Inspired by several community projects and tools.

Licensed under the [MIT License](./LICENSE).
