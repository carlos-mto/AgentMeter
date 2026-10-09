mod accounts;
mod commands;
mod i18n;
mod providers;
mod quota;
mod widget;
mod windows;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
#[cfg(target_os = "windows")]
use windows::taskbar_overlay;
use windows::{activity, startup};

const MAIN_WINDOW: &str = "main";

#[cfg(desktop)]
struct WidgetMenuState {
    open: MenuItem<tauri::Wry>,
    startup: CheckMenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    widget: CheckMenuItem<tauri::Wry>,
    strip: CheckMenuItem<tauri::Wry>,
    locked: CheckMenuItem<tauri::Wry>,
}

#[cfg(desktop)]
fn sync_widget_menu(app: &AppHandle, preferences: &widget::WidgetPreferences) {
    if let Some(menu) = app.try_state::<WidgetMenuState>() {
        let _ = menu
            .widget
            .set_checked(preferences.mode() == widget::DisplayMode::Widget);
        let _ = menu
            .strip
            .set_checked(preferences.mode() == widget::DisplayMode::Strip);
        let _ = menu.locked.set_checked(preferences.locked);
        let tr = |key| i18n::text(preferences.language, key);
        let _ = menu.open.set_text(tr("Open dashboard"));
        let _ = menu.widget.set_text(tr("Show widget"));
        let _ = menu.strip.set_text(tr("Show strip"));
        let _ = menu.locked.set_text(tr("Lock widget position"));
        let _ = menu.startup.set_text(tr("Launch at startup"));
        let _ = menu.quit.set_text(tr("Quit"));
    }
}

#[cfg(not(desktop))]
fn sync_widget_menu(_app: &AppHandle, _preferences: &widget::WidgetPreferences) {}

fn update_display_mode(
    app: &AppHandle,
    state: &widget::WidgetState,
    mode: &str,
) -> Result<widget::WidgetPreferences, String> {
    let preferences = widget::set_mode(app, state, mode)?;
    sync_widget_menu(app, &preferences);
    Ok(preferences)
}

fn switch_display_mode(
    app: &AppHandle,
    state: &widget::WidgetState,
    mode: &str,
) -> Result<widget::WidgetPreferences, String> {
    let preferences = update_display_mode(app, state, mode)?;
    if mode == "dashboard" {
        show_dashboard(app);
    } else if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
    Ok(preferences)
}

fn update_widget_lock(
    app: &AppHandle,
    state: &widget::WidgetState,
    locked: bool,
) -> Result<widget::WidgetPreferences, String> {
    let preferences = widget::set_locked(app, state, locked)?;
    sync_widget_menu(app, &preferences);
    Ok(preferences)
}

fn show_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hide the dashboard only when it is the window the user is actually looking
/// at. Testing visibility alone would hide a window sitting behind the browser,
/// so a click meant to reveal the deck would appear to do nothing.
fn toggle_dashboard(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let in_front = window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
    if in_front {
        let _ = window.hide();
    } else {
        show_dashboard(app);
    }
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let widget_preferences = app
        .state::<widget::WidgetState>()
        .snapshot()
        .unwrap_or_default();
    let tr = |key| i18n::text(widget_preferences.language, key);
    let open = MenuItem::with_id(app, "open", tr("Open dashboard"), true, None::<&str>)?;
    let widget_visible = widget_preferences.mode() == widget::DisplayMode::Widget;
    let strip_visible = widget_preferences.mode() == widget::DisplayMode::Strip;
    let show_widget = CheckMenuItem::with_id(
        app,
        "show-widget",
        tr("Show widget"),
        true,
        widget_visible,
        None::<&str>,
    )?;
    let show_strip = CheckMenuItem::with_id(
        app,
        "show-strip",
        tr("Show strip"),
        true,
        strip_visible,
        None::<&str>,
    )?;
    let widget_locked = CheckMenuItem::with_id(
        app,
        "widget-locked",
        tr("Lock widget position"),
        true,
        widget_preferences.locked,
        None::<&str>,
    )?;
    let launch_at_startup = CheckMenuItem::with_id(
        app,
        "launch-at-startup",
        tr("Launch at startup"),
        true,
        startup::enabled(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", tr("Quit"), true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &show_widget,
            &show_strip,
            &widget_locked,
            &PredefinedMenuItem::separator(app)?,
            &launch_at_startup,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let startup_toggle = launch_at_startup.clone();
    let _ = app.manage(WidgetMenuState {
        open: open.clone(),
        startup: launch_at_startup.clone(),
        quit: quit.clone(),
        widget: show_widget.clone(),
        strip: show_strip.clone(),
        locked: widget_locked.clone(),
    });

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("AgentMeter")
        .menu(&menu)
        // Left click toggles the dashboard, so the menu belongs on right click only.
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_dashboard(app),
            "show-widget" => {
                let state = app.state::<widget::WidgetState>();
                if let Ok(preferences) = state.snapshot() {
                    let result = if preferences.mode() == widget::DisplayMode::Widget {
                        update_display_mode(app, &state, "dashboard")
                    } else {
                        switch_display_mode(app, &state, "widget")
                    };
                    if let Err(error) = result {
                        eprintln!("widget mode update failed: {error}");
                    }
                }
            }
            "show-strip" => {
                let state = app.state::<widget::WidgetState>();
                if let Ok(preferences) = state.snapshot() {
                    let result = if preferences.mode() == widget::DisplayMode::Strip {
                        update_display_mode(app, &state, "dashboard")
                    } else {
                        switch_display_mode(app, &state, "strip")
                    };
                    if let Err(error) = result {
                        eprintln!("strip mode update failed: {error}");
                    }
                }
            }
            "widget-locked" => {
                let state = app.state::<widget::WidgetState>();
                if let Ok(preferences) = state.snapshot() {
                    if let Err(error) = update_widget_lock(app, &state, !preferences.locked) {
                        eprintln!("widget lock update failed: {error}");
                    }
                }
            }
            "launch-at-startup" => {
                let enable = !startup::enabled();
                match startup::set_enabled(enable) {
                    Ok(()) => {
                        let _ = startup_toggle.set_checked(enable);
                    }
                    Err(error) => {
                        eprintln!("launch at startup update failed: {error}");
                        let _ = startup_toggle.set_checked(startup::enabled());
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_dashboard(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // This must be the first plugin. A shortcut click while the tray app is
        // already running should reveal that window, not start a second poller.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !startup::background_requested(&args) {
                show_dashboard(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(widget::WidgetState::load());
            app.manage(accounts::AccountState::load());
            #[cfg(desktop)]
            {
                if let Err(error) = startup::refresh_enabled_path() {
                    eprintln!("launch at startup path refresh failed: {error}");
                }
                build_tray(app.handle())?;
                let widget_state = app.state::<widget::WidgetState>();
                if let Err(error) = widget::apply(app.handle(), &widget_state) {
                    eprintln!("widget initialization failed: {error}");
                }
                activity::watch(app.handle().clone());
                // Windows can launch us before monitors/the desktop are ready.
                // Retry restoration without changing the saved display mode.
                activity::restore_companion_when_ready(app.handle().clone());

                #[cfg(target_os = "windows")]
                taskbar_overlay::watch(app.handle().clone());
                // Installer finish-page launches and shortcut launches are
                // explicit user actions, so show the dashboard. Only the Run
                // key passes --hidden and starts quietly in the tray.
                if !startup::is_background_launch() {
                    show_dashboard(app.handle());
                }
            }

            // The dashboard fetches for itself on load and on every reveal, so
            // there is no startup fetch here — one would just double the
            // requests made against five undocumented endpoints.

            Ok(())
        })
        // Closing the window returns the deck to the tray instead of exiting —
        // it has to keep polling to be worth having.
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if window.label() == widget::WINDOW_LABEL {
                    let state = window.state::<widget::WidgetState>();
                    if let Err(error) =
                        update_display_mode(window.app_handle(), &state, "dashboard")
                    {
                        eprintln!("widget close failed: {error}");
                    }
                } else {
                    let _ = window.hide();
                }
            }
            WindowEvent::Moved(position) if window.label() == widget::WINDOW_LABEL => {
                if let Some(state) = window.try_state::<widget::WidgetState>() {
                    if let Err(error) = state.remember_position(*position) {
                        eprintln!("widget position save failed: {error}");
                    }
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::account_profiles,
            commands::add_account_profile,
            commands::select_account_profile,
            commands::remove_account_profile,
            commands::account_cli,
            commands::claude_quota,
            commands::claude_login_status,
            commands::codex_quota,
            commands::grok_quota,
            commands::grok_bot_quota,
            commands::antigravity_quota,
            commands::system_activity,
            commands::widget_preferences,
            commands::set_display_mode,
            commands::hide_companion,
            commands::set_widget_locked,
            commands::set_widget_scale,
            commands::start_widget_drag,
            commands::resize_widget,
            commands::set_taskbar_overlay,
            commands::set_provider_hidden,
            commands::set_antigravity_claude_gpt_hidden,
            commands::set_usage_display,
            commands::set_language,
            commands::open_dashboard,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
