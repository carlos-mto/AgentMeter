import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { LANGUAGES, createI18n, resolveLanguage, translateDocument } from "../../src/i18n-core.js";
import { widgetWindows, compactWindowLabel } from "../../src/widget-model.js";

const catalogs = JSON.parse(fs.readFileSync(new URL("../../src/locales.json", import.meta.url), "utf8"));
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("all five catalogues contain exactly the same keys and interpolation fields", () => {
  assert.deepEqual(LANGUAGES.map(({ code }) => code), ["en", "es", "pt", "it", "de"]);
  assert.deepEqual(LANGUAGES.map(({ name }) => name), ["English", "Español", "Português", "Italiano", "Deutsch"]);
  assert.deepEqual(Object.keys(catalogs), LANGUAGES.map(({ code }) => code));
  for (const [language, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs.en).sort());
    for (const [key, text] of Object.entries(catalog)) {
      assert.equal(typeof text, "string", `${language}: ${key}`);
      assert.ok(text.trim(), `${language}: ${key}`);
      assert.deepEqual(placeholders(text), placeholders(key), `${language}: ${key}`);
    }
  }
});

test("regional locales resolve to the supported language, with English fallback", () => {
  for (const [locale, expected] of [["es-MX", "es"], ["pt-BR", "pt"], ["pt_PT", "pt"], ["it-IT", "it"], ["DE-ch", "de"], ["en-US", "en"], ["fr", "en"], [null, "en"]]) {
    assert.equal(resolveLanguage(locale), expected);
  }
  assert.equal(resolveLanguage(["fr-FR", "es-ES"]), "es");
});

test("translator changes live, interpolates safely and never exposes missing keys or object properties", () => {
  const i18n = createI18n(catalogs);
  assert.equal(i18n.t("Open dashboard"), "Open dashboard");
  i18n.setLanguage("es");
  assert.equal(i18n.t("Open dashboard"), "Abrir panel");
  assert.equal(i18n.t("Resets in {time}", { time: "2h" }), "Se restablece en 2h");
  assert.equal(i18n.t("Raw diagnostic: {raw}", { raw: "<script>$&{time}" }), "Raw diagnostic: <script>$&{time}");
  assert.equal(i18n.t("__proto__"), "__proto__");
  assert.equal(i18n.t("constructor"), "constructor");
  assert.equal(createI18n({ en: { Known: "Fallback" }, es: {} }, "es").t("Known"), "Fallback");
  assert.equal(i18n.t("unknown technical diagnostic"), "unknown technical diagnostic");
});

test("static content, tooltips, aria labels and document language update without injecting HTML", () => {
  const text = { dataset: { i18n: "Language" }, textContent: "Language" };
  const title = { dataset: { i18nTitle: "Switch theme" }, setAttribute: (key, value) => { title[key] = value; } };
  const aria = { dataset: { i18nAria: "Open dashboard" }, setAttribute: (key, value) => { aria[key] = value; } };
  const document = { documentElement: {}, querySelectorAll: (selector) => ({ "[data-i18n]": [text], "[data-i18n-title]": [title], "[data-i18n-aria]": [aria] })[selector] };
  const i18n = createI18n(catalogs);
  for (const { code } of LANGUAGES) {
    i18n.setLanguage(code);
    translateDocument(document, i18n);
    assert.equal(document.documentElement.lang, code);
    assert.equal(text.textContent, catalogs[code].Language);
    assert.equal(title.title, catalogs[code]["Switch theme"]);
    assert.equal(aria["aria-label"], catalogs[code]["Open dashboard"]);
  }
});

test("translating quota labels preserves pool selection, percentages, resets and compact periods", () => {
  const rows = Object.freeze([
    Object.freeze({ label: "Weekly · Gemini", window_seconds: 604800, percent: 12, resets_at: 123456789 }),
    Object.freeze({ label: "Session (5h) · Gemini", window_seconds: 18000, percent: 34 }),
    Object.freeze({ label: "Weekly · Claude+GPT", window_seconds: 604800, percent: 56 }),
  ]);
  for (const { code } of LANGUAGES) {
    const i18n = createI18n(catalogs, code);
    assert.equal(i18n.quotaLabel(rows[0].label), `${catalogs[code].Weekly} · Gemini`);
    assert.equal(i18n.quotaLabel("Unknown pool · Brand X"), "Unknown pool · Brand X");
    const prefs = { language: code, antigravity_claude_gpt_hidden: true };
    const compact = widgetWindows("antigravity", rows, prefs);
    assert.deepEqual(compact, [rows[1], rows[0]]);
    assert.deepEqual(compact.map((row) => i18n.t(compactWindowLabel(row, "antigravity", prefs))), ["5h", "7d"]);
    assert.equal(i18n.duration(0), "0s");
    assert.equal(i18n.duration(3660), "1h 1m");
  }
});

test("technical diagnostics keep their raw details while their summary is localized", () => {
  const quota = Object.freeze({ status: "error", message: "HTTP 503 from upstream /rpc" });
  assert.equal(createI18n(catalogs, "en").providerMessage(quota), quota.message);
  assert.equal(createI18n(catalogs, "es").providerMessage(quota), "No se pudo consultar la cuota");
  assert.equal(quota.message, "HTTP 503 from upstream /rpc");
  assert.equal(createI18n(catalogs, "de").providerMessage({ status: "action_required", message: "Open Claude Code and sign in again." }), catalogs.de["Open Claude Code and sign in again."]);
});

test("literal frontend, static HTML and native tray translation keys exist", () => {
  for (const file of ["src/dashboard.js", "src/widget.js", "src/index.html", "src/widget.html", "src-tauri/src/lib.rs"]) {
    const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const keys = [...source.matchAll(/\b(?:t|tr)\("([^"\n]+)"|data-i18n(?:-title|-aria)?="([^"]+)"/g)];
    for (const match of keys) assert.ok(Object.hasOwn(catalogs.en, match[1] ?? match[2]), `${file}: ${match[1] ?? match[2]}`);
  }
});

const main = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8");
const handler = main.slice(main.indexOf('languageEl.addEventListener("change"'), main.indexOf("let widgetPreferences ="));
function languageHarness(invoke) {
  const original = { language: "en", visible: true, strip: true, widget_scale: 200, taskbar_overlay: true, strip_x: 88, antigravity_claude_gpt_hidden: true };
  const calls = [];
  let change;
  const context = {
    widgetPreferences: original,
    t: createI18n(catalogs).t,
    languageEl: { disabled: false, value: "de", addEventListener: (_type, callback) => { change = callback; }, focus() {} },
    languageErrorEl: { hidden: true, textContent: "" },
    invoke: async (command, args) => { calls.push(command); return invoke(args, original); },
    applyWidgetPreferences: (prefs) => { context.widgetPreferences = prefs; },
    render() {},
  };
  vm.createContext(context);
  vm.runInContext(handler, context);
  return { context, calls, original, change: () => change() };
}

test("changing language saves only the language and leaves quotas, mode, scale, pin and positions alone", async () => {
  const { context, calls, original, change } = languageHarness(async ({ language }, preferences) => ({ ...preferences, language }));
  await change();
  assert.deepEqual(context.widgetPreferences, { ...original, language: "de" });
  assert.deepEqual(calls, ["set_language"]);
  assert.equal(context.languageEl.disabled, false);
});

test("failed language persistence restores the selector and shows an error", async () => {
  const { context, original, change } = languageHarness(async () => { throw new Error("disk denied"); });
  await change();
  assert.equal(context.widgetPreferences, original);
  assert.equal(context.languageEl.value, "en");
  assert.equal(context.languageEl.disabled, false);
  assert.equal(context.languageErrorEl.hidden, false);
  assert.match(context.languageErrorEl.textContent, /disk denied/);
});

test("set_language is registered, persists and broadcasts, and updates native menu text", () => {
  const lib = fs.readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const widget = fs.readFileSync(new URL("../../src-tauri/src/widget.rs", import.meta.url), "utf8");
  const setter = widget.slice(widget.indexOf("pub fn set_language("), widget.indexOf("pub fn set_usage_display("));
  assert.match(lib, /generate_handler!\[[\s\S]*\bset_language\b/);
  assert.match(setter, /Language::parse/);
  assert.match(setter, /state.replace/);
  assert.match(setter, /emit_preferences/);
  assert.doesNotMatch(setter, /set_mode|apply\(app|::fetch/);
  assert.match(lib, /menu.open.set_text/);
  assert.match(lib, /menu.startup.set_text/);
  assert.match(lib, /menu.quit.set_text/);
});
