# AgentMeter Tauri + Rust + Windows Architecture

This is the streamlined architecture implemented in AgentMeter. It organizes the
backend by responsibility without turning a file reorganization into changes to
the frontend framework, public contracts or user storage.

## Current stack

- Tauri 2 and Rust; a desktop application targeting Windows 10/11.
- An HTML/CSS/JavaScript frontend using ES modules, served from `src/`.
- No React, Vue, Svelte, TypeScript, Vite or frontend server is introduced.
- The Dashboard remains the sole quota scheduler. Widget/Strip consume its
  snapshot; no additional native poller is introduced.

## Implemented layout

```text
src-tauri/src/
├─ main.rs
├─ lib.rs
├─ commands/
│  └─ mod.rs
├─ providers/
│  ├─ mod.rs
│  ├─ antigravity.rs
│  ├─ claude.rs
│  ├─ claude_diagnostics.rs
│  ├─ claude_rate_limit.rs
│  ├─ codex.rs
│  ├─ grok.rs
│  └─ grok_bot.rs
├─ windows/
│  ├─ mod.rs
│  ├─ activity.rs
│  ├─ startup.rs
│  └─ taskbar_overlay.rs
├─ accounts.rs
├─ widget.rs
├─ quota.rs
└─ i18n.rs
```

The existing Tauri `capabilities/`, `icons/`, `Cargo.toml`, `Cargo.lock`,
`build.rs` and `tauri.conf.json` remain unchanged. JavaScript tests stay in
`tests/unit/` and opt-in native probes in `tests/smoke/`; Rust fixtures remain
in `src-tauri/tests/fixtures/`.

## Responsibilities

| Location | Responsibility |
|---|---|
| `main.rs` | Executable entry point and rejection of retired launch arguments. |
| `lib.rs` | Tauri composition: plugins, state loading, IPC registration, tray, shared lifecycle helpers and window events. |
| `commands/mod.rs` | The 25 existing IPC adapters: parameter validation/resolution and delegation, without taking over parsing, HTTP, persistence or Win32 logic. |
| `providers/` | Adapters for the five providers and their authentication, cache, diagnostics and retry rules. These own the domain logic; they are not wrapped in empty services. |
| `windows/` | Activity/lock detection, autostart and taskbar integration. Existing `cfg` gates and fallbacks are preserved. |
| `accounts.rs` | Profile registry, per-account contexts, display identities and CLI isolation. |
| `widget.rs` | Companion preferences, state and behavior, delegating Windows calls where appropriate. |
| `quota.rs` | Shared quota model, serialized statuses, errors and atomic-write helper. |
| `i18n.rs` | Shared catalog and native translations. |

Commands stay together because they are small and delegate their work. There is
no file per command and no empty command modules for hypothetical future
categories. Helpers used by both IPC and the tray retain a single implementation
in `lib.rs`.

## Request flow

```text
Dashboard -> invoke(existing name) -> commands
                                  -> providers (quotas)
                                  -> accounts (profiles/CLI)
                                  -> widget / lifecycle helpers
                                  -> windows (activity and system APIs)
```

`lib.rs` registers functions through `commands::...` paths. This does not rename
the commands invoked from JavaScript or their arguments. For example:

```rust
#[tauri::command]
pub(crate) async fn claude_quota(
    state: tauri::State<'_, crate::accounts::AccountState>,
    account_id: Option<String>,
) -> Result<crate::quota::ProviderQuota, String> {
    Ok(match state.resolve("claude", account_id.as_deref()) {
        Ok(context) => crate::providers::claude::fetch(&context).await,
        Err(error) => crate::quota::ProviderQuota::error("claude", error),
    })
}
```

## Windows and conditional compilation

Do not wrap all of `windows/mod.rs` in `#[cfg(windows)]`: the activity and startup
contracts have fallback implementations used by shared code. The specific gate
for `taskbar_overlay` and the internal gates in each Win32 implementation are
preserved.

Moving a file does not authorize changes to its behavior, timeouts, task
coordination, retry limits or credential access.

## Layers intentionally omitted

No generic `services/`, `repository/`, `models/`, `state/`, `error/` or `utils/`
directories are introduced. Their responsibilities already have concrete owners.
There is also no single global `AppState`: `AccountState` and `WidgetState`
remain separate.

If duplication or a new responsibility appears, extract the specific unit that
justifies it; do not introduce a chain of pass-through wrappers for aesthetics.

## Invariants and validation

- Preserve the names, arguments and responses of all 25 Tauri commands.
- Preserve events, `main`/`widget` labels, quota serialization, AppData,
  profiles, persisted keys and initialization order.
- Keep the `src/locales.json` catalog and fixtures at their actual locations;
  review Rust paths, registrations, links and tests after any move.
- Do not change capabilities, the application identifier or dependencies, or
  install another framework.
- Verify architecture contracts, JavaScript/Rust tests and NSIS packaging.
- Test startup, navigation and the companion snapshot in the actual app; any
  temporary CDP access must use loopback and be disabled afterward.

See [Current Architecture](./architecture.md) for detailed runtime documentation.
