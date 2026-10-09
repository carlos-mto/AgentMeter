import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createI18n } from "../../src/i18n-core.js";
import { compactWindowLabel, visibleQuotaWindows, widgetWindows } from "../../src/widget-model.js";

const windows = Object.freeze([
  Object.freeze({ label: "Weekly · Gemini", window_seconds: 604800, percent: 13, resets_at: 2000000000 }),
  Object.freeze({ label: "Session (5h) · Gemini", window_seconds: 18000, percent: 27, resets_at: 1999900000 }),
  Object.freeze({ label: "Weekly · Claude+GPT", window_seconds: 604800, percent: 41 }),
  Object.freeze({ label: "Session (5h) · Claude+GPT", window_seconds: 18000, percent: 55 }),
]);
const hidden = { antigravity_claude_gpt_hidden: true };

const labels = (rows, preferences = {}) => rows.map((row) => compactWindowLabel(row, "antigravity", preferences));

test("old/default preferences keep all dashboard quotas and both weekly companion pools", () => {
  assert.equal(visibleQuotaWindows("antigravity", windows), windows);
  assert.deepEqual(widgetWindows("antigravity", windows), [windows[0], windows[2]]);
  assert.deepEqual(labels(widgetWindows("antigravity", windows)), ["Gemini", "Claude+GPT"]);
});

test("hiding Claude+GPT filters only that pool on Dashboard and shows Gemini 5h then 7d in companions", () => {
  assert.deepEqual(visibleQuotaWindows("antigravity", windows, hidden), [windows[0], windows[1]]);
  const compact = widgetWindows("antigravity", windows, hidden);
  assert.deepEqual(compact, [windows[1], windows[0]]);
  assert.deepEqual(labels(compact, hidden), ["5h", "7d"]);
  assert.equal(compact[0], windows[1]); // Percentages, resets and full tooltip labels are untouched.
  assert.equal(compact[1], windows[0]);
});

test("showing Claude+GPT again restores the original presentation without changing cached data", () => {
  widgetWindows("antigravity", windows, hidden);
  const shown = { antigravity_claude_gpt_hidden: false };
  assert.equal(visibleQuotaWindows("antigravity", windows, shown), windows);
  assert.deepEqual(widgetWindows("antigravity", windows, shown), [windows[0], windows[2]]);
  assert.equal(windows.length, 4);
  assert.equal(windows[1].label, "Session (5h) · Gemini");
});

test("missing Gemini quotas are never replaced with invented numbers or Claude+GPT values", () => {
  assert.deepEqual(widgetWindows("antigravity", [windows[0]], hidden), [windows[0]]);
  assert.deepEqual(labels(widgetWindows("antigravity", [windows[1]], hidden), hidden), ["5h"]);
  assert.deepEqual(widgetWindows("antigravity", windows.slice(2), hidden), []);
  assert.deepEqual(widgetWindows("antigravity", undefined, hidden), []);
});

test("the Antigravity eye never changes other providers or removes unknown dashboard pools", () => {
  for (const id of ["claude", "codex", "grok", "grok_bot"]) {
    assert.equal(visibleQuotaWindows(id, windows, hidden), windows);
    assert.deepEqual(widgetWindows(id, windows, hidden), widgetWindows(id, windows));
    assert.equal(compactWindowLabel(windows[0], id, hidden), "Gemini");
  }
  const unknown = { label: "Weekly · Imagen", window_seconds: 604800, percent: 20 };
  const spaced = { label: "Weekly · Claude + GPT", window_seconds: 604800 };
  assert.deepEqual(visibleQuotaWindows("antigravity", [unknown, spaced], hidden), [unknown]);
  assert.deepEqual(widgetWindows("antigravity", [unknown], hidden), []);
});

const main = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8");
const handler = main.slice(main.indexOf("async function setAntigravityClaudeGptHidden("), main.indexOf("function renderProvider(provider, quota)"));

// Run the actual async UI handler with an IPC/DOM boundary stub. Native UI probes
// cover the DOM rendering; these cover rejected persistence and rapid clicks.
function toggleHarness(invoke) {
  const calls = [];
  const original = { visible: true, strip: true, taskbar_overlay: true, strip_x: 500, widget_scale: 200, antigravity_claude_gpt_hidden: false };
  const context = {
    t: createI18n({ en: {} }).t,
    widgetPreferences: original,
    antigravityVisibilityPending: false,
    antigravityVisibilityError: "",
    focused: false,
    document: { body: {}, activeElement: { id: "antigravity-visibility-toggle" }, getElementById: () => ({ focus: () => { context.focused = true; } }) },
    invoke: async (command, args) => { calls.push({ command, hidden: args.hidden }); return invoke(args, original); },
    applyWidgetPreferences: (prefs) => { context.widgetPreferences = prefs; },
    renderProviderResults: () => { context.document.activeElement = context.document.body; },
  };
  vm.createContext(context);
  vm.runInContext(`${handler}\nthis.toggle = setAntigravityClaudeGptHidden;`, context);
  return { context, calls, original };
}

test("the eye saves once, blocks rapid duplicate clicks, preserves companion settings and restores focus", async () => {
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  const { context, calls, original } = toggleHarness(() => pending);
  const first = context.toggle(true);
  await context.toggle(false);
  assert.equal(context.antigravityVisibilityPending, true);
  assert.equal(calls.length, 1);
  resolve({ ...original, antigravity_claude_gpt_hidden: true });
  await first;
  assert.deepEqual(calls, [{ command: "set_antigravity_claude_gpt_hidden", hidden: true }]);
  assert.deepEqual(context.widgetPreferences, { ...original, antigravity_claude_gpt_hidden: true });
  assert.equal(context.antigravityVisibilityPending, false);
  assert.equal(context.focused, true);
});

test("a failed save leaves visibility unchanged, exposes an error and enables retry", async () => {
  const { context, calls, original } = toggleHarness(async () => { throw new Error("disk denied"); });
  await context.toggle(true);
  assert.equal(context.widgetPreferences, original);
  assert.equal(context.antigravityVisibilityPending, false);
  assert.match(context.antigravityVisibilityError, /disk denied/);
  assert.equal(calls.length, 1);
});

test("the native command is registered and emits preferences without applying a mode or fetching quota", () => {
  const lib = fs.readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const widget = fs.readFileSync(new URL("../../src-tauri/src/widget.rs", import.meta.url), "utf8");
  const setter = widget.slice(widget.indexOf("pub fn set_antigravity_claude_gpt_hidden("), widget.indexOf("pub fn set_usage_display("));
  assert.match(lib, /generate_handler!\[[\s\S]*\bset_antigravity_claude_gpt_hidden\b/);
  assert.match(setter, /state.replace\(preferences\)/);
  assert.match(setter, /emit_preferences\(app, &preferences\)/);
  assert.doesNotMatch(setter, /set_mode|apply\(app|::fetch/);
});
