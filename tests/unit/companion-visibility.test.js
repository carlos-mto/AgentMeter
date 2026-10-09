import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const backend = fs.readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const commands = fs.readFileSync(new URL("../../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");
const frontend = fs.readFileSync(new URL("../../src/widget.js", import.meta.url), "utf8");
const overlay = fs.readFileSync(new URL("../../src-tauri/src/windows/taskbar_overlay.rs", import.meta.url), "utf8");
const activity = fs.readFileSync(new URL("../../src-tauri/src/windows/activity.rs", import.meta.url), "utf8");

// Wiring guards supplement native UI probes: opening details must never run
// the explicit mode-change path, which persists visible=false and hides Strip.
test("Open dashboard reveals details without touching companion preferences", () => {
  const command = commands.match(/fn open_dashboard\([^)]*\) \{([\s\S]*?)\n\}/)[1];
  assert.match(command, /show_dashboard\(&app\)/);
  assert.doesNotMatch(command, /switch_display_mode|update_display_mode|widget::set_mode|\.hide\(/);
  assert.match(frontend, /openDashboardEl\.addEventListener\("click", \(\) => void invoke\("open_dashboard"\)\)/);
  assert.match(backend, /generate_handler!\[[\s\S]*\bopen_dashboard\b/);
});

test("shortcut and initial launches also preserve the saved companion", () => {
  const launch = backend.slice(backend.indexOf(".plugin(tauri_plugin_single_instance"), backend.indexOf(".on_window_event("));
  assert.doesNotMatch(launch, /switch_display_mode|update_display_mode/);
  assert.match(launch, /if !startup::background_requested\(&args\) \{\s*show_dashboard\(app\)/);
  assert.match(launch, /if !startup::is_background_launch\(\) \{\s*show_dashboard\(app.handle\(\)\)/);
});

test("startup retries saved companion restoration independently of --hidden", () => {
  const setup = backend.slice(backend.indexOf(".setup(|app| {"), backend.indexOf(".on_window_event("));
  assert.ok(setup.includes("activity::restore_companion_when_ready(app.handle().clone());"));
  assert.ok(setup.indexOf("activity::restore_companion_when_ready") < setup.indexOf("if !startup::is_background_launch()"));
  const restore = activity.slice(activity.indexOf("pub(crate) fn restore_companion_when_ready("), activity.indexOf('#[cfg(target_os = "windows")]'));
  assert.ok(restore.includes("for delay in [2, 6, 12]"));
  assert.ok(restore.includes("crate::widget::restore_after_resume(&app, &state)"));
  assert.doesNotMatch(restore, /set_mode|update_display_mode|show_dashboard/);
});

test("companion recovery reasserts real Windows visibility after an external hide", () => {
  const widget = fs.readFileSync(new URL("../../src-tauri/src/widget.rs", import.meta.url), "utf8");
  const restore = widget.slice(widget.indexOf("pub fn restore_after_resume("), widget.indexOf("#[cfg(test)]"));
  assert.ok(restore.includes("!preferences.visible || state.user_drag_active()"));
  assert.ok(restore.includes("crate::windows::taskbar_overlay::restore_companion_visibility(&window)?;"));
  const native = overlay.slice(overlay.indexOf("pub(crate) fn restore_companion_visibility("), overlay.indexOf("fn raise_without_activation("));
  assert.ok(native.includes("IsWindowVisible(hwnd)"));
  assert.ok(native.includes("set_visible_without_activation(hwnd, true)"));
});

test("hiding a companion remains explicit and syncs its menu selection", () => {
  const hide = commands.slice(commands.indexOf("fn hide_companion("), commands.indexOf("fn set_widget_locked("));
  assert.match(hide, /update_display_mode\(&app, &state, "dashboard"\)/);
  assert.match(frontend, /hideWidgetEl\.addEventListener\("click", \(\) => void invoke\("hide_companion"\)\)/);
  const update = backend.slice(backend.indexOf("fn update_display_mode("), backend.indexOf("fn switch_display_mode("));
  assert.match(update, /sync_widget_menu\(app, &preferences\)/);
});

test("native visibility recovery applies only to an enabled pinned Strip", () => {
  const watch = overlay.slice(overlay.indexOf("pub fn watch("), overlay.indexOf("#[cfg(test)]"));
  assert.match(watch, /preferences.mode\(\) == DisplayMode::Strip && preferences.taskbar_overlay/);
  const inactive = watch.slice(watch.indexOf("if !active {"), watch.indexOf("let Some(bounds)"));
  assert.match(inactive, /hidden_by_overlay && preferences.visible/);
  assert.match(inactive, /continue;/);
  assert.match(watch, /overlay_visibility_change\(unsafe \{ IsWindowVisible\(hwnd\) \} != 0, should_hide\)/);
});
