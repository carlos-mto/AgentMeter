import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { providerKey } from "../../src/quota-polling.js";
import { dashboardStatistics } from "../../src/dashboard-model.js";
import { createI18n } from "../../src/i18n-core.js";
import { displayedPercent, usageDisplayLabel, visibleQuotaWindows } from "../../src/widget-model.js";

const providers = [{ id: "claude", name: "Claude" }, { id: "antigravity", name: "Antigravity" }, { id: "codex", name: "Codex" }, { id: "grok", name: "Grok" }];
const prefs = { hidden_providers: [], antigravity_claude_gpt_hidden: false };
const quota = (windows, extra = {}) => ({ status: "ok", windows, ...extra });
const window = (label, percent) => Object.freeze({ label, percent, window_seconds: 604800, resets_at: 2000000000 });
const results = Object.freeze({
  claude: quota([window("Session", 10), window("Weekly", 95)], { stale: { observed_at: 1900000000 } }),
  antigravity: quota([window("Weekly · Gemini", 5), window("Weekly · Claude+GPT", 98)]),
  codex: { status: "action_required" },
  grok: { status: "not_configured" },
});

test("statistics use real windows, preserve cached/reset information and never average unrelated quotas", () => {
  const snapshot = dashboardStatistics(providers, results, prefs);
  assert.equal(snapshot.reporting, 2);
  assert.equal(snapshot.attention, 3);
  assert.equal(snapshot.rows.length, 4);
  assert.equal(snapshot.rows[0].window, results.claude.windows[0]);
  assert.equal(snapshot.rows[0].cached, true);
  assert.equal(snapshot.rows[0].used, 10);
  assert.equal(snapshot.rows[0].remaining, 90);
  assert.deepEqual(Object.keys(snapshot).sort(), ["attention", "reporting", "rows"]);
});

test("statistics honor hidden providers and the Antigravity eye without mutating cache", () => {
  const before = JSON.stringify(results);
  const snapshot = dashboardStatistics(providers, results, { ...prefs, hidden_providers: ["claude", "codex"], antigravity_claude_gpt_hidden: true });
  assert.equal(snapshot.reporting, 1);
  assert.equal(snapshot.attention, 0);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].window.label, "Weekly · Gemini");
  assert.equal(JSON.stringify(results), before);
});

test("missing, unavailable and error results never invent quota values", () => {
  assert.deepEqual(dashboardStatistics(providers, {}, prefs), { reporting: 0, attention: 0, rows: [] });
  const snapshot = dashboardStatistics(providers, { claude: { status: "unavailable" }, codex: { status: "error" }, grok: quota([]) }, prefs);
  assert.deepEqual(snapshot, { reporting: 0, attention: 1, rows: [] });
});

const main = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../src/index.html", import.meta.url), "utf8");
const catalogs = JSON.parse(fs.readFileSync(new URL("../../src/locales.json", import.meta.url), "utf8"));
const chromeSource = main.slice(main.indexOf("function renderDashboardChrome()"), main.indexOf("function renderStatistics()"));
function navigationHarness() {
  const node = (dataset = {}) => ({ dataset, hidden: false, textContent: "", attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() { this.focused = true; } });
  const nodes = { "page-title": node(), "page-description": node() };
  const nav = ["home", "services", "statistics", "settings"].map(view => node({ view }));
  const deck = { scrollTop: 100 };
  const context = { dashboardView: "home", sourcesExpanded: false, providersEl: node(), providerControlsEl: node(), statisticsEl: node(), settingsEl: node(), servicesEl: node(),
    t: key => catalogs.es[key] ?? key,
    document: { getElementById: id => nodes[id], querySelectorAll: () => nav, querySelector: () => deck },
    render: () => context.renderDashboardChrome(),
  };
  vm.createContext(context);
  vm.runInContext(chromeSource, context);
  return { context, nodes, nav, deck };
}

test("all four sidebar views work without native commands, mode changes or provider fetches", () => {
  const { context, nodes, nav, deck } = navigationHarness();
  for (const [view, title] of [["services", "Servicios"], ["statistics", "Estadísticas"], ["settings", "Configuración"], ["home", "Inicio"]]) {
    context.showDashboardView(view);
    assert.equal(nodes["page-title"].textContent, title);
    assert.equal(nodes["page-title"].focused, true);
    assert.equal(context.providersEl.hidden, view !== "home");
    assert.equal(context.statisticsEl.hidden, view !== "statistics");
    assert.equal(context.settingsEl.hidden, view !== "settings");
    assert.equal(context.servicesEl.hidden, view !== "services");
    assert.equal(context.sourcesExpanded, view === "services");
    assert.equal(nav.filter(n => n.attributes["aria-current"] === "page").length, 1);
    assert.equal(deck.scrollTop, 0);
  }
  context.showDashboardView("invalid");
  assert.equal(context.dashboardView, "home");
});

test("navigation labels/descriptions exist in every language, including icon-only accessibility names", () => {
  const { context, nodes } = navigationHarness();
  for (const catalog of Object.values(catalogs)) {
    context.t = key => { assert.ok(Object.hasOwn(catalog, key), key); return catalog[key]; };
    for (const view of ["home", "services", "statistics", "settings"]) {
      context.showDashboardView(view);
      assert.equal(nodes["page-title"].textContent, catalog[nodes["page-title"].dataset.i18n]);
    }
  }
  assert.equal([...html.matchAll(/data-view="[^"]+"[^>]+data-i18n-aria=/g)].length, 4);
});

test("Accounts lives only in Services and is rendered only there", () => {
  const services = html.slice(html.indexOf('id="services-panel"'), html.indexOf('id="provider-controls"'));
  const settings = html.slice(html.indexOf('id="settings-panel"'));
  assert.ok(services.includes('id="account-settings"'));
  assert.ok(!settings.includes('id="account-settings"'));
  assert.equal(html.split('id="account-settings"').length - 1, 1);
  let renders = 0;
  const context = {
    dashboardView: "services", quotaResults: {}, renderDashboardChrome() {}, renderProviderResults() {},
    document: { getElementById: () => ({ replaceChildren() {} }) },
    renderUsageDisplay: () => ({}), activeAccountProviders: () => [], allProvidersChecked: () => false,
    renderProviderControls() {}, renderAccounts() { renders++; },
  };
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf("function render()"), main.indexOf("function renderProviderResults()")), context);
  context.render();
  assert.equal(renders, 1);
  for (const view of ["home", "statistics", "settings"]) { context.dashboardView = view; context.render(); }
  assert.equal(renders, 1);
  assert.ok(main.includes('group.dataset.provider = provider.id'));
});

test("sidebar stays icon-only with localized native tooltips at every width", () => {
  const css = fs.readFileSync(new URL("../../src/dashboard.css", import.meta.url), "utf8");
  assert.equal((css.match(/grid-template-columns: 68px minmax\(0, 1fr\)/g) ?? []).length, 1);
  assert.doesNotMatch(css, /grid-template-columns: (212|240|184)px/);
  assert.ok(css.includes('.nav-item > span, .sidebar-caption, .companion-controls .tool span'));
  assert.ok(css.includes('clip-path: inset(50%)'));
  assert.equal([...html.matchAll(/data-view="[^"]+"[^>]+data-i18n-title=/g)].length, 4);
  assert.ok(html.includes('data-i18n-title="GitHub Repo"'));
});

test("provider cards retain every provider, status, raw diagnostic, progress value and breakdown", () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.properties = {}; this.style = { setProperty: (key, value) => { this.properties[key] = value; } }; this.classList = { add: name => { this.className += ` ${name}`; } }; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text ?? "") + this.children.map(child => child.textContent).join(""); }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener() {}
  }
  const document = { createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag), createTextNode: text => { const node = new Node("text"); node.textContent = text; return node; } };
  const i18n = createI18n(catalogs, "es");
  const context = { document, i18n, t: i18n.t, providerKey, widgetPreferences: { ...prefs, usage_display: "remaining" }, displayedPercent, usageDisplayLabel, visibleQuotaWindows,
    meterVar: () => "var(--ok)", pacePercent: () => null, untilReset: value => value ? `reset ${value}` : null, ago: () => "1m", getProviderSchedule: () => ({ backoffUntil: 0 }), PACE_TOLERANCE: 4,
    antigravityVisibilityPending: false, antigravityVisibilityError: "",
  };
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf("function el("), main.indexOf("function renderEmptyState(")), context);
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  for (const provider of [...providers, { id: "grok_bot", name: "Grok Bot" }]) {
    const card = context.renderProvider(provider, quota([window("Weekly", 24)], { plan: "Plan", breakdown: [{ label: "Feature", percent: 27 }] }));
    const nodes = descendants(card);
    assert.ok(nodes.some(node => node.className === "provider-logo"));
    assert.ok(nodes.some(node => node.className === "provider-name" && node.textContent === provider.name));
    assert.ok(nodes.some(node => node.className === "quota-grid" && node.dataset.count === "1"));
    assert.ok(nodes.some(node => node.attributes["role"] === "progressbar" && node.attributes["aria-valuenow"] === "76"));
    assert.ok(nodes.some(node => node.className === "slice-value" && node.textContent === "27% usado"));
    assert.match(card.textContent, /reset 2000000000/);
  }
  for (const id of ["claude", "codex"]) {
    const base = providers.find(provider => provider.id === id);
    const named = context.renderProvider({ ...base, accountId: "default", accountLabel: "User <b> & Name" }, quota([window("Weekly", 24)]));
    assert.equal(descendants(named).find(node => node.className === "plan account-label").textContent, "User <b> & Name");
    assert.equal(descendants(named).some(node => node.tag === "b"), false, "credential names are plain text");
    const pending = context.renderProvider({ ...base, accountId: "default", multipleAccounts: true }, null);
    assert.equal(descendants(pending).find(node => node.className === "plan account-label").textContent, "Cuenta actual");
  }
  const codex = providers.find(provider => provider.id === "codex");
  for (const windows of [[window("Weekly", 68)], [{ ...window("Session", 24), window_seconds: 18000 }, window("Weekly", 68)]]) {
    const nodes = descendants(context.renderProvider(codex, quota(windows)));
    assert.equal(nodes.find(node => node.className === "quota-grid").dataset.count, String(windows.length));
    assert.deepEqual(nodes.filter(node => node.attributes["role"] === "progressbar").map(node => node.attributes["aria-valuenow"]), windows.map(row => String(100 - row.percent)));
  }
  for (const status of ["error", "unavailable", "action_required"]) {
    const card = context.renderProvider(providers[0], { status, message: "Raw diagnostic <untrusted>" });
    assert.match(card.textContent, /Raw diagnostic <untrusted>/);
    assert.equal(descendants(card).some(node => node.attributes["role"] === "progressbar"), false);
  }
  assert.match(context.renderProvider(providers[0], null).textContent, /Leyendo/);
});

test("Codex alone expands a single quota to full width and uses black artwork on white", () => {
  const css = fs.readFileSync(new URL("../../src/dashboard.css", import.meta.url), "utf8");
  assert.ok(css.includes('.provider[data-provider="codex"] .quota-grid[data-count="1"] { max-width: none; }'));
  assert.ok(css.includes('.provider-logo[data-source="codex"] { background: #fff; color: #000; }'));
  assert.ok(css.includes('.provider-logo[data-source="grok"] { background: #030608; }'));
  assert.ok(css.includes('.quota-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'));
});

test("dashboard icons are local and default sizing changes only the main window", () => {
  for (const provider of [...providers, { id: "grok_bot" }]) assert.ok(html.includes(`id="mark-${provider.id}"`));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const use of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(use[1]), use[1]);
  const config = JSON.parse(fs.readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.app.windows[0].width, 644);
  assert.equal(config.app.windows[0].height, 840);
  assert.equal(config.app.windows[0].minWidth, 380);
  assert.equal(config.app.windows[0].minHeight, 520);
  assert.equal(config.app.windows[1].width, 244);
  assert.equal(config.app.windows[1].height, 164);
});
