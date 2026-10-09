//! Thin Tauri IPC adapters. Domain logic and persistence remain in their owners.

use crate::{
    accounts,
    providers::{antigravity, claude, codex, grok, grok_bot},
    quota::ProviderQuota,
    show_dashboard, switch_display_mode, sync_widget_menu, update_display_mode, update_widget_lock,
    widget,
    windows::activity,
};
use tauri::{AppHandle, State, WebviewWindow};

#[tauri::command]
pub(crate) async fn claude_quota(
    state: State<'_, accounts::AccountState>,
    account_id: Option<String>,
) -> Result<ProviderQuota, String> {
    Ok(match state.resolve("claude", account_id.as_deref()) {
        Ok(context) => claude::fetch(&context).await,
        Err(error) => ProviderQuota::error("claude", error),
    })
}

#[tauri::command]
pub(crate) async fn codex_quota(
    state: State<'_, accounts::AccountState>,
    account_id: Option<String>,
) -> Result<ProviderQuota, String> {
    Ok(match state.resolve("codex", account_id.as_deref()) {
        Ok(context) => codex::fetch(&context).await,
        Err(error) => ProviderQuota::error("codex", error),
    })
}

#[tauri::command]
pub(crate) fn account_profiles(
    state: State<'_, accounts::AccountState>,
) -> Result<accounts::AccountRegistry, String> {
    state.snapshot()
}

#[tauri::command]
pub(crate) fn add_account_profile(
    state: State<'_, accounts::AccountState>,
    provider: String,
    label: String,
    config_dir: Option<String>,
) -> Result<accounts::AccountRegistry, String> {
    state.add(&provider, &label, config_dir.as_deref())
}

#[tauri::command]
pub(crate) fn select_account_profile(
    state: State<'_, accounts::AccountState>,
    provider: String,
    account_id: String,
) -> Result<accounts::AccountRegistry, String> {
    state.select(&provider, &account_id)
}

#[tauri::command]
pub(crate) fn remove_account_profile(
    state: State<'_, accounts::AccountState>,
    provider: String,
    account_id: String,
) -> Result<accounts::AccountRegistry, String> {
    state.remove(&provider, &account_id)
}

#[tauri::command]
pub(crate) fn account_cli(
    state: State<'_, accounts::AccountState>,
    provider: String,
    account_id: String,
    login: bool,
) -> Result<(), String> {
    let context = state.resolve(&provider, Some(&account_id))?;
    accounts::launch_cli(&context, &provider, login)
}

#[tauri::command]
pub(crate) async fn grok_quota() -> ProviderQuota {
    grok::fetch().await
}

#[tauri::command]
pub(crate) async fn grok_bot_quota() -> ProviderQuota {
    grok_bot::fetch().await
}

#[tauri::command]
pub(crate) async fn antigravity_quota() -> ProviderQuota {
    antigravity::fetch().await
}

#[tauri::command]
pub(crate) fn system_activity() -> activity::SystemActivity {
    activity::snapshot()
}

#[tauri::command]
pub(crate) fn widget_preferences(
    state: State<'_, widget::WidgetState>,
) -> Result<widget::WidgetPreferences, String> {
    state.snapshot()
}

#[tauri::command]
pub(crate) fn set_display_mode(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    mode: String,
) -> Result<widget::WidgetPreferences, String> {
    switch_display_mode(&app, &state, &mode)
}

#[tauri::command]
pub(crate) fn hide_companion(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
) -> Result<widget::WidgetPreferences, String> {
    update_display_mode(&app, &state, "dashboard")
}

#[tauri::command]
pub(crate) fn set_widget_locked(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    locked: bool,
) -> Result<widget::WidgetPreferences, String> {
    update_widget_lock(&app, &state, locked)
}

#[tauri::command]
pub(crate) fn set_widget_scale(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    percent: u16,
) -> Result<widget::WidgetPreferences, String> {
    widget::set_scale(&app, &state, percent)
}

#[tauri::command]
pub(crate) fn set_taskbar_overlay(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    enabled: bool,
) -> Result<widget::WidgetPreferences, String> {
    widget::set_taskbar_overlay(&app, &state, enabled)
}

#[tauri::command]
pub(crate) fn set_provider_hidden(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    id: String,
    hidden: bool,
) -> Result<widget::WidgetPreferences, String> {
    widget::set_provider_hidden(&app, &state, &id, hidden)
}

#[tauri::command]
pub(crate) fn set_antigravity_claude_gpt_hidden(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    hidden: bool,
) -> Result<widget::WidgetPreferences, String> {
    widget::set_antigravity_claude_gpt_hidden(&app, &state, hidden)
}

#[tauri::command]
pub(crate) fn set_language(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    language: String,
) -> Result<widget::WidgetPreferences, String> {
    let preferences = widget::set_language(&app, &state, &language)?;
    sync_widget_menu(&app, &preferences);
    Ok(preferences)
}

#[tauri::command]
pub(crate) fn set_usage_display(
    app: AppHandle,
    state: State<'_, widget::WidgetState>,
    mode: String,
) -> Result<widget::WidgetPreferences, String> {
    widget::set_usage_display(&app, &state, &mode)
}

#[tauri::command]
pub(crate) fn start_widget_drag(
    window: WebviewWindow,
    state: State<'_, widget::WidgetState>,
) -> Result<(), String> {
    widget::start_dragging(&window, &state)
}

#[tauri::command]
pub(crate) fn resize_widget(
    window: WebviewWindow,
    state: State<'_, widget::WidgetState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    widget::resize(&window, &state, width, height)
}

#[tauri::command]
pub(crate) fn open_dashboard(app: AppHandle) {
    // Opening details is not a mode change: keep the companion and its pin.
    show_dashboard(&app);
}

#[tauri::command]
pub(crate) fn claude_login_status(
    state: State<'_, accounts::AccountState>,
    account_id: Option<String>,
) -> Result<claude::LocalLoginStatus, String> {
    Ok(claude::local_login_status(
        &state.resolve("claude", account_id.as_deref())?,
    ))
}
