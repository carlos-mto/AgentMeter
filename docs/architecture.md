# AgentMeter — Current Architecture

This document describes the **implemented AgentMeter 0.0.1 application**, not a
release history or a collection of past experiments. Source files and the Tauri
configuration are the authority when behavior changes. Provider APIs are
undocumented; the implementation is not a guarantee of future vendor behavior.

User guides: [English](../README.md) · [Español](../README.es.md) ·
[Português](../README.pt.md) · [Italiano](../README.it.md) ·
[Deutsch](../README.de.md) · [繁體中文](../README.zh-TW.md).

Backend organization and refactoring boundaries:
[Tauri + Rust + Windows architecture](./tauri-rust-windows-architecture.md).
Open behavior differences: [Functional gaps](./functional-gaps.md).

## 1. Runtime, identity and source layout

AgentMeter is a **Windows 10/11 tray application** built with Tauri 2, Rust and
Microsoft Edge WebView2. The frontend is plain HTML/CSS/JavaScript ES modules:
there is no UI framework, frontend bundler or application server. Tauri serves
`src/` directly through `build.frontendDist: "../src"`.

There are two persistent WebViews:

| Window | Role | Native configuration |
|---|---|---|
| `main` | Dashboard and the only frontend quota scheduler | **644 × 840 logical pixels**, minimum **380 × 520**, resizable, initially hidden |
| `widget` | One shared desktop companion, rendered as Widget or Strip | Borderless, transparent, always on top, skipped in taskbar; initially hidden |

The `widget` entry's **244 × 164** configuration is a bootstrap size, not the
current visible Widget size. `widget.rs` applies mode/scale dimensions and the
WebView reports its measured content. Widget starts from **648 × 464** logical
pixels; Strip starts at **560 × 40** and keeps its 40 px logical height. Runtime
bounds are validated and clamped before resize.

### Source ownership

| Area | Responsibility |
|---|---|
| [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) | Product/version, WebViews, frontend directory and bundled icons |
| [src-tauri/src/main.rs](../src-tauri/src/main.rs) | Desktop entrypoint; reject retired browser launch arguments |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | Tauri setup, command registry, managed states, tray and window lifecycle |
| [src-tauri/src/commands/mod.rs](../src-tauri/src/commands/mod.rs) | Thin IPC adapters; the public command names and return schemas are unchanged |
| [src-tauri/src/providers/](../src-tauri/src/providers/) | Five provider adapters and their provider-specific cache, authentication and retry helpers |
| [src-tauri/src/windows/](../src-tauri/src/windows/) | OS integration with implementation-level cfg gates and existing activity/startup fallbacks |
| [src-tauri/src/quota.rs](../src-tauri/src/quota.rs) | Shared quota model, errors and atomic-write helper |
| [src-tauri/src/accounts.rs](../src-tauri/src/accounts.rs) | Claude/Codex profile registry, display identities and CLI launch isolation |
| [src-tauri/src/widget.rs](../src-tauri/src/widget.rs) | Companion preferences, mode, size, movement and restoration |
| [src-tauri/src/windows/activity.rs](../src-tauri/src/windows/activity.rs) | Windows idle/lock state, active refresh events and restoration retries |
| [src-tauri/src/windows/taskbar_overlay.rs](../src-tauri/src/windows/taskbar_overlay.rs) | Windows primary/secondary taskbar discovery, alignment and visibility |
| [src-tauri/src/windows/startup.rs](../src-tauri/src/windows/startup.rs) | Per-user Windows autostart and executable-path migration |
| [src/dashboard.js](../src/dashboard.js) | Dashboard pages, forms, provider scheduling and companion publication |
| [src/quota-polling.js](../src/quota-polling.js) | Pure scheduling, retry, activity and observation-time rules |
| [src/account-model.js](../src/account-model.js) | Account expansion, provider keys, selected Strip and all-account Widget snapshots |
| [src/dashboard-model.js](../src/dashboard-model.js) | Statistics projection and visible quota windows |
| [src/widget.js](../src/widget.js), [src/widget-model.js](../src/widget-model.js) | Companion rendering, usable rows, window selection, percentages and scale |
| [src/palette.css](../src/palette.css), [src/dashboard.css](../src/dashboard.css) | Shared palette and responsive Dashboard |
| [src/widget.css](../src/widget.css), [src/widget-neon.css](../src/widget-neon.css) | Companion layout and Widget-only Neon override |
| [src/locales.json](../src/locales.json), [src/i18n-core.js](../src/i18n-core.js), [src/i18n.js](../src/i18n.js), [src-tauri/src/i18n.rs](../src-tauri/src/i18n.rs) | One catalog shared by WebViews and native tray |
| [tests/unit/](../tests/unit/) | Automated JS regressions and repository contracts (`npm test`) |
| [tests/smoke/](../tests/smoke/) | Opt-in native WebView probes (`npm run test:smoke:dashboard`, `npm run test:smoke:accounts`) |
| [src-tauri/tests/fixtures/](../src-tauri/tests/fixtures/) | Synthetic native provider inputs |
| [assets/screenshots/](../assets/screenshots/) | Current README captures and the retained legacy Dashboard image |

### Naming conventions

Custom frontend, documentation and asset filenames use lowercase `kebab-case`;
Rust modules use `snake_case`. Automated JS tests live in `tests/unit/` and
opt-in native probes in `tests/smoke/`. Standard tooling and runtime names
remain unchanged.

### Stable identities

Visible names, executable, installer, inline meter marks and tray icon are
**AgentMeter**; npm/Cargo packages are `agentmeter`. The app icon source is
[assets/app-icon.svg](../assets/app-icon.svg), with bundled raster/Windows icons.

- Tauri identifier: `me.mto.agentmeter`.
- WebView theme key: `agent-meter-theme`.

They define single-instance identity and theme storage. The MIT copyright notice
is retained.

The local data root is now `%LOCALAPPDATA%\stackly-agent-manager`, shared through
`accounts::data_dir()`.

`ignore/` contains local design references, agent state and archived Git metadata,
not runtime assets. It and regenerated `.pi/` state are excluded by
[.gitignore](../.gitignore). Installed dependencies, Cargo output and generated
Tauri schemas remain in their normal, ignored working locations.

## 2. Shared invariants and polling

### Ownership and request flow

```text
main WebView (scheduler, results and account-keyed retry state)
  -> Tauri quota commands
     -> Rust account context / provider adapter
        -> local credentials, local server or provider HTTPS
     <- ProviderQuota
  -> Home / Services / Statistics
  -> quota-snapshot event -> widget WebView (Widget or Strip)
```

Only `main` schedules quota checks. Hiding Dashboard does not destroy its WebView.
Widget/Strip never call quota commands, and changing pages, theme, language or
Strip selection does not independently fetch provider quotas.

The normal refresh cycle is **180 seconds**. A **20-second** frontend gap guards
duplicate lifecycle requests, with ordinary error backoff of **60 / 120 / 300
seconds**. One timer wakes at the earliest regular-cycle or eligible account-retry
deadline; retries do not postpone healthy providers or reset the regular cycle.
Idle/locked Claude retries remain paused until activity resumes and its grace
period expires. Scheduling/results are keyed per account. Providers settle
independently and each completed result is immediately rendered and published;
one slow provider does not hold all cards hostage.

Hidden provider IDs leave the schedule entirely, including all their profiles.
Existing results/retry state remain available when re-enabled. Antigravity's
Claude+GPT eye toggle is different: it only filters presentation, not polling.

### Claude's additional gates

- A native **six-minute request floor**, single-flight serialization and persisted
  cooldown remain authoritative even after app reload/restart or with no snapshot.
- Idle for **five minutes**, or a locked workstation, pauses Claude checks. Windows
  activity is probed every five seconds; no input contents/history are collected.
- Resume applies a **two-minute grace period**. A native active-only tick every
  minute emits `active-refresh-tick`, so throttled hidden WebView timers do not
  indefinitely strand the cycle or any due account retry.
- Valid server `Retry-After` values are preserved up to the 24-hour safety guard,
  with a five-second edge buffer. Without a usable header, repeated 429s back off
  **6 / 12 / 24 / 48 / 60 minutes**.
- `retry_after_seconds` also accompanies cached `ok` results. The frontend honors
  it instead of maintaining a competing server-rate-limit policy.
- Local login metadata is checked before HTTP scheduling. A changed valid
  credential generation releases old frontend gates; the Rust gate still decides
  whether an HTTP request is allowed. Empty access tokens require sign-in;
  `expiresAt` alone, including zero/past values, is not authentication proof.

Rules live in [claude_rate_limit.rs](../src-tauri/src/providers/claude_rate_limit.rs),
[claude.rs](../src-tauri/src/providers/claude.rs), `quota-polling.js` and `activity.rs`.
Manual refresh and **Check accounts** do not bypass native cooldowns.

### Credential and quota safety

AgentMeter uses access credentials for quota requests, but never spends vendor
refresh tokens. Renewal belongs to the official CLI/desktop app. No credentials
are copied between profiles, no raw auth data is broadcast to WebViews, and no
network failure becomes a fabricated 0% reading.

“Last updated” means a successful or explicitly unavailable provider observation,
not the wall-clock time of an error. Cached rows preserve their original
`stale.observed_at`; providers retain separate observation/retry state.

## 3. Claude

[claude.rs](../src-tauri/src/providers/claude.rs) reads the account-scoped
`.credentials.json` from `CLAUDE_CONFIG_DIR` or the default `~/.claude` directory.
It calls `https://api.anthropic.com/api/oauth/usage`; plan metadata uses
`https://api.anthropic.com/api/oauth/profile` with its own account-local cache.

The adapter normalizes reported session, weekly and model-specific windows.
Zero usage without a reset deadline is valid. Network requests are bounded to
10 seconds; unavailable credentials, authentication failures and rate limits
remain distinct states. Known credential-generation changes prevent associating
an old snapshot/response with a different login.

After an access-token `401`, recovery is attempted through official
**`claude update`**, then credentials are reread and a changed access token may
be retried. The updater can update Claude Code itself; AgentMeter does not call
a refresh-token endpoint or inspect terminal output for secrets. Recovery is
serialized per CLI installation; failed recovery has its own retry guard.

Usage snapshots, plans, retry gates and recovery state are account-local. The
implicit default preserves its legacy cache paths; named profiles use their own
subdirectories. Claude fetch serialization across profiles does not mean they
share quota/cache state.

[claude_diagnostics.rs](../src-tauri/src/providers/claude_diagnostics.rs) retains at most
**64** allowlisted HTTP/retry events. Error classification reads at most **16 KiB**;
raw bodies, arbitrary headers, tokens and account data are not saved. Cached
reads do not create new transport observations.

## 4. Codex

[codex.rs](../src-tauri/src/providers/codex.rs) reads `auth.json` under the selected
`CODEX_HOME` or `~/.codex`. The current account can be established by Codex
Desktop; managed additional profiles sign in through the official Codex CLI.

Live quota comes from `https://chatgpt.com/backend-api/wham/usage`, with a
10-second timeout and the optional `ChatGPT-Account-Id` header for that profile.
Window labels derive from reported durations: a first slot is not necessarily
5 hours, and free/paid plans can differ.

If live quota cannot be used, the adapter can scan **that profile's session
logs** for rate-limit records. The scan runs on a blocking worker and is memoized
for five minutes per session directory/generation. Missing records mean
unavailable data, not invented values. Cache/fallback sources are explicitly
marked stale.

## 5. Grok

[grok.rs](../src-tauri/src/providers/grok.rs) reads Grok Build's `~/.grok/auth.json` and
queries `https://cli-chat-proxy.grok.com/v1/billing?format=credits`, with a
10-second request timeout. There is no browser-extension path or browser cache
fallback.

Credential selection is deterministic: usable entries outrank expired ones and
the furthest expiry wins. Missing credentials are `not_configured`; an expired
or rejected token requires opening Grok Build rather than retrying indefinitely.
AgentMeter never refreshes the CLI token itself.

The subscription period and product breakdowns come from the billing response.
An account without a subscription quota is explicitly unavailable; daily free
queries are not reported by this endpoint. Product breakdowns are portions of a
pool, not independent quota windows.

## 6. Antigravity and Grok Bot

### Antigravity

[antigravity.rs](../src-tauri/src/providers/antigravity.rs) discovers a running local
language server from **Antigravity IDE or standalone `agy` CLI**, with IDE-first
ordering when both are available. Installing `agy` or invoking `agy --help` is
not enough: the signed-in session must remain running.

Requests go to the process-owned loopback listener under
`exa.language_server_pb.LanguageServerService`. IDE requests require that
process's `X-Codeium-Csrf-Token`; only the verified CLI path omits the header.
Plan metadata is scoped to the process/listener. AgentMeter does not read,
refresh or manage Google access/refresh tokens.

The adapter exposes Gemini and Claude+GPT pools with the reported five-hour and
weekly windows. It uses bounded per-request/overall discovery deadlines. A
quota-only snapshot can remain for up to 24 hours while no client runs; reset
windows are not carried past their deadlines. An authoritative response with no
usable windows replaces the old snapshot with an empty record, preserving
configured-client history without reviving obsolete quotas. In-process invalidation
also blocks stale fallback if that write fails; a successfully persisted fresh
reading re-enables the cache.

### Grok Bot

[grok_bot.rs](../src-tauri/src/providers/grok_bot.rs) is an independent provider, not a
second label for Grok/SuperGrok. It reads the desktop app's active profile and
locally unlocks its short-lived Chromium-encrypted access token with Windows
DPAPI/AES-GCM.

Usage is queried through
`https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus` using a
10-second timeout and normalized into the Bot's weekly allowance. The refresh
token is not deserialized/decrypted/used/cached/sent by AgentMeter. Expired access
credentials ask the user to reopen Grok Bot. A quota-only fallback is bounded to
24 hours and valid reset deadlines.

## 7. Quota contract and presentation

`quota.rs` defines `ProviderQuota`, serialized with a `status` discriminator:

| Status | Meaning |
|---|---|
| `ok` | Live or explicitly stale readings; may still carry `retry_after_seconds` |
| `unavailable` | The account/source does not expose this quota; not a transport error |
| `not_configured` | No usable local integration has been discovered |
| `action_required` | Sign-in/open-client action is needed |
| `error` | A failed check, optionally carrying a retry deadline |

An `ok` result contains provider, optional plan, `windows`, fetch time, optional
`stale` metadata and optional product `breakdown`. Each `QuotaWindow` contains:

- `label`: provider/duration-derived period and optional pool, never slot position.
- `percent`: allowance **consumed**, 0–100.
- `resets_at`: optional Unix seconds; absence is not filled with an invented date.
- `window_seconds`: optional full period duration, used for labels/pace.
- `severity`: optional provider hint.

Adapters normalize percentages as used. `usage_display` is presentation-only:
**Used = percent**, **Remaining = 100 − percent**. Fill/pace markers follow that
choice, but urgency and ahead-of-pace detection remain based on consumed usage.
Product breakdowns remain consumed portions and are labeled accordingly.

Statistics is a projection of the current filtered results, not a separate
poller, historical database, averaged allowance, billing ledger or forecast.
Home may show pending/login/error account cards; Widget requires `ok` with usable
finite readings. Zero usage and usable cached readings still qualify.

`widget-model.js` handles compact window selection:

- Claude/Codex retain their available windows; weekly-only accounts leave the
  session slot empty rather than moving weekly data into a fictitious 5h slot.
- Grok prefers the real seven-day pool, falling back to reported free/daily/monthly
  windows. Grok Bot uses one weekly pool.
- Antigravity normally shows each pool's weekly bucket. Hiding Claude+GPT instead
  shows **Gemini 5h / 7d** without modifying the raw result.

## 8. Dashboard, accounts and companion windows

### Dashboard

Home, Services, Statistics and Settings share one `main` document. The **68 px
icon-only rail** is present at all sizes; tooltips/ARIA labels are translated.
Responsive cards scroll inside content, with stacked quota windows below the
small-width breakpoint. Codex's single available quota fills its card area.

- **Home:** cards, plan/status, resets, pace, breakdowns, refresh and display controls.
- **Services:** source visibility/setup and the only account-management section,
  grouped by provider, with sign-in/CLI/removal/Strip selection actions.
- **Statistics:** the current quota table with per-account and stale state.
- **Settings:** global appearance, language shortcut and Used/Remaining controls;
  account forms are not duplicated here.

### Claude/Codex profiles

`accounts.rs` maintains a mutex-protected, atomically written `accounts.json`.
Only **Claude and Codex** have managed profiles. The registry stores aliases,
configuration directories and selected Strip IDs, not credentials.

- The implicit `default` resolves current `CLAUDE_CONFIG_DIR` / `CODEX_HOME` or
  home defaults at runtime; it cannot be removed. When no override is set, the
  default account's CLI is launched without overriding `CLAUDE_CONFIG_DIR` /
  `CODEX_HOME` (an override would make the CLI create a divergent config file),
  and its Claude identity is read from `~/.claude.json`. Named profiles use
  their own directory only and never borrow the global identity.
- New profiles use `accounts/<provider>/<id>` unless an existing absolute
  configuration directory is explicitly registered. Invalid/duplicate paths and
  corrupt registry data are rejected rather than silently overwritten.
- `AccountContext` carries separate configuration/cache paths. Frontend provider
  IDs control visibility/colors; `providerKey` uses `provider:id` for named
  accounts and the provider ID for its default.
- **Sign in / Open CLI** starts a new Windows console using the official CLI and
  child-local environment. Existing terminals/global defaults are unchanged;
  user-provided labels/paths are not interpolated into shell source.
- **Remove** forgets the registry entry but does not delete files or kill sessions.
- Optional usernames are derived locally for display, preferring the part before
  `@`, with alias fallback. Domains/tokens are not published or persisted in the
  registry; decoded JWT claims never authorize requests.
- The Add account form has no name field: the dashboard generates the stored
  alias automatically (`Account N`, smallest free N >= 2 per provider, via
  `nextAccountLabel`; the default account is account 1). It is only a placeholder
  until sign-in, after which the credential username is shown everywhere,
  including the Strip tooltip.

`companionAccountSnapshot` retains selected `results`, `backoffUntil` and
display names (credential username, falling back to the alias) for Strip, plus an `accounts` array for every Widget row. Home/Statistics/Widget
can show all profiles; Strip uses one selected account per provider. Selection
does not rotate accounts, change CLI defaults or make extra quota requests.

### Widget and Strip

One `widget` WebView renders both modes. Widget uses the scoped Neon design,
account labels, percentage rings, bars, aligned periods and small reset
countdowns; extra rows scroll internally. Its `Accounts` control opens **Services**.
Both modes hide unconfigured/empty/unusable account readings (errors, sign-in
required, missing windows) until usable data arrives, without changing preferences
or stopping the main poller. Strip applies the rule to its selected account only
and never substitutes another account.

`widget_scale` defaults to **100%**, accepts **100–300% in 25% steps**, and applies
on top of Windows DPI. Malformed scale falls back to 100 without discarding
other settings. Strip always uses its own unscaled compact layout, abbreviated
provider marks and inline metrics/reset tooltips.

Mode is persisted as `visible` + `strip`. Widget and Strip have independent
physical coordinates (`x/y` and `strip_x/strip_y`). Only native user drags replace
saved coordinates; resize/DPI/overlay/recovery moves must not overwrite them.

Opening Dashboard from a companion, tray or explicit launch preserves the
companion and its pin. Closing Dashboard hides it instead of exiting. Explicit
Hide or choosing Dashboard mode disables the companion; the tray's **Quit**
exits the application. A position lock blocks Widget drag but leaves controls
usable. Strip remains draggable.

### Taskbar overlay and recovery

The Windows watcher can align Strip with the nearest primary or secondary
Explorer taskbar, maintain topmost order without focus and preserve its saved
long-axis coordinate. It is not an AppBar and reserves no work area. It yields
to taskbar auto-hide and true fullscreen on the same monitor; Explorer overflow
hosts or fullscreen elsewhere do not disable it.

Recovery reconciles actual HWND visibility, not only Tauri's cached visibility.
Startup/resume retries occur at **2 / 8 / 20 seconds** cumulative time, keeping
saved mode/scale/position and respecting explicit hide/user movement. A missing
monitor can use a fallback without erasing saved coordinates. There is only one
companion: it is **not cloned across every monitor/taskbar**.

## 9. Preferences, appearance and startup

`widget.json` stores `language`, `visible`, `strip`, `locked`, `x/y`,
`strip_x/strip_y`, `taskbar_overlay`, `hidden_providers`,
`antigravity_claude_gpt_hidden`, `usage_display` and `widget_scale`. Updates use
an atomic write and broadcast `widget-preferences-changed`; the tray reflects
the saved mode rather than temporary OS hiding.

`locales.json` is shared by JS and embedded Rust tray translation. Supported UI
languages are **en, es, pt, it, de**. English strings are keys; catalogs must have
identical keys/interpolation fields. First use detects a supported Windows UI
language, otherwise English. Labels/tooltips/ARIA/DOM language update together;
raw provider diagnostics/period labels remain available. A Chinese README does
not imply a Chinese UI.

Theme uses `agent-meter-theme` in WebView local storage and follows system
appearance until selected. Dashboard publishes `widget-theme-changed` and also
includes theme in snapshots. `palette.css` owns shared theme/severity tokens;
`widget-neon.css` deliberately scopes its Neon override to Widget, not Strip or
Dashboard. Transparency belongs to surfaces/windows, not faded text/controls.

Autostart is a per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
entry named **AgentMeter**, containing the current quoted `agentmeter.exe` path
and `--hidden`. Hidden
startup leaves Dashboard closed while restoring the selected companion; no
selected companion means intentional tray-only startup.

The single-instance plugin is registered first: subsequent visible launches
reveal the existing Dashboard rather than create another poller. Retired Chromium
launch arguments are ignored instead of opening a Dashboard. Tray setup,
preference restoration and activity/overlay watchers occur in `lib.rs`; quota
fetching starts in `dashboard.js`, not as a duplicate Rust startup fetch.

## 10. Registered commands and events

The public command list is the `generate_handler!` registry in `lib.rs`.
Implementations live in [commands/mod.rs](../src-tauri/src/commands/mod.rs), and
module-qualified registry paths (`commands::...`) preserve the following IPC
names and their existing argument/response shapes:

| Group | Commands |
|---|---|
| Quotas/login | `claude_quota`, `claude_login_status`, `codex_quota`, `grok_quota`, `grok_bot_quota`, `antigravity_quota` |
| Profiles | `account_profiles`, `add_account_profile`, `select_account_profile`, `remove_account_profile`, `account_cli` |
| Preferences | `widget_preferences`, `set_provider_hidden`, `set_antigravity_claude_gpt_hidden`, `set_usage_display`, `set_language`, `set_widget_locked`, `set_widget_scale`, `set_taskbar_overlay` |
| Windows | `set_display_mode`, `hide_companion`, `start_widget_drag`, `resize_widget`, `open_dashboard` |
| Activity | `system_activity` |

Claude/Codex quota/login calls accept optional `accountId`; Dashboard supplies
explicit profile IDs. Invalid identifiers resolve to safe errors rather than
silently falling back to another user's profile.

| Event | Direction / purpose |
|---|---|
| `quota-snapshot` | Main → Widget: selected provider results, all-account rows, retry deadlines, observation time and theme |
| `widget-ready` | Widget → Main: request the current snapshot after initialization |
| `widget-open-accounts` | Widget → Main: open Services account management |
| `widget-preferences-changed` | Native → WebViews: persisted display/language settings |
| `widget-theme-changed` | Main → Widget: live theme change |
| `system-activity-resumed` | Native → Main: resume grace and companion recovery |
| `active-refresh-tick` | Native → Main: recover overdue cycles/account retries; check Claude login metadata |

## 11. Persistence, security boundaries and limitations

All app-managed data stays under `%LOCALAPPDATA%\stackly-agent-manager`; official
CLI credentials remain in their own selected configuration directories:

| Location | Contents |
|---|---|
| `accounts.json` | Aliases, configuration paths and selected Strip IDs |
| `accounts/<provider>/<id>` | Default isolated CLI profile directories |
| `widget.json` | Companion/display/language preferences and saved coordinates |
| `provider-cache` | Quota-only snapshots, retry state and bounded diagnostics; default paths remain compatible |
| `provider-cache/<provider>/<id>` | Named account-specific provider state |

There is no AgentMeter telemetry, analytics, cloud account or upload/sync service.
This does **not** mean no network: supported access credentials are sent to the
appropriate provider HTTPS endpoint for quota checks. Antigravity is loopback and does not require a browser extension. TLS uses Windows native
trust through reqwest/native-tls.

Raw tokens, refresh credentials and unredacted provider bodies must never enter
logs, errors, fixtures or bug reports. Profile registry inputs are validated and
sensitive credential parse failures do not echo file contents. Atomic writes
avoid exposing half-written preference/cache files.

Current security configuration uses `core:default` and `opener:default` for
`main`/`widget`, with **`security.csp: null`**. No restrictive CSP is implemented;
this must not be described as a hardened CSP policy. Frontend assets are local,
not remote-loaded scripts/fonts. Debugging ports are never enabled for normal
operation or persisted configuration.

Current product limits: Windows only; undocumented upstream APIs; managed
multi-account only for Claude/Codex; no automatic account rotation; one companion window; no historical statistics, billing database or
forecast. Unavailable clients/sign-ins can leave stale data rather than live quota.

## 12. Development, packaging and verification

Requirements: Windows 10/11, WebView2 Runtime, Node.js 22+ with npm, Rust stable
MSVC, Visual Studio/Build Tools **Desktop development with C++** and Windows SDK.
See [Cargo.toml](../src-tauri/Cargo.toml) for native dependencies.

```powershell
npm ci
npm run tauri -- dev
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --bundles nsis -- --locked
```

Tauri bundles the icons and
[installer-hooks.nsh](../src-tauri/installer-hooks.nsh). The NSIS hooks remove the
AgentMeter shortcuts on uninstall and preserve them during updates. Outputs are
`src-tauri/target/release/agentmeter.exe` and
`src-tauri/target/release/bundle/nsis/AgentMeter_0.0.1_x64-setup.exe`. Builds are
currently unsigned.

JS tests cover pure projections, rendering/navigation, account isolation,
polling, Widget scale/reset/Neon scope, branding/installer rules, translations,
native-provider/removal guards and documentation consistency. Rust tests cover
provider parsing, native request gates, persistence, profiles, discovery and
Windows-specific integration with dummy inputs.

[smoke/dashboard.smoke.mjs](../tests/smoke/dashboard.smoke.mjs) is an opt-in native probe for
all pages/languages/themes, **644 px** default width and responsive 380–1400 px
layouts. [smoke/accounts.smoke.mjs](../tests/smoke/accounts.smoke.mjs) uses synthetic profile
directories without real login. Both restore preferences they change.

With the temporary test process already running, use
`npm run test:smoke:dashboard` or `npm run test:smoke:accounts`. The regular
`npm test` command runs only `tests/unit/*.test.js` and never launches native
smoke probes.

For these probes only, start a test process with temporary loopback CDP:

```text
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=19336 --remote-debugging-address=127.0.0.1
QUOTA_CDP_URL=http://127.0.0.1:19336
```

Close that process afterward and relaunch without the environment override.
Do not ship/persist remote debugging or put real credentials in test fixtures.
