import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { accountProviders, selectedAccountProvider, companionAccountSnapshot, widgetAccountProviders, nextAccountLabel } from "../../src/account-model.js";
import { WIDGET_PROVIDERS, visibleProviders } from "../../src/widget-model.js";
import { providerKey, enabledProviders, applyClaudeLoginStatus, providerRequestFloor, providerRetryDelay } from "../../src/quota-polling.js";
import { dashboardStatistics } from "../../src/dashboard-model.js";

const providers = [{ id: "claude", name: "Claude", command: "claude_quota", pollMs: 360000 }, { id: "codex", name: "Codex", command: "codex_quota" }, { id: "grok", name: "Grok" }];
const registry = {
  profiles: [
    { provider: "claude", id: "default", label: "Current account" },
    { provider: "claude", id: "work", label: "Trabajo <script>" },
    { provider: "codex", id: "default", label: "Current account" },
    { provider: "codex", id: "personal", label: "Personal" },
  ],
  selected: { claude: "work", codex: "default" },
};
const reading = percent => ({ status: "ok", windows: [{ label: "Weekly", percent }] });
const results = { claude: reading(10), "claude:work": reading(95), codex: reading(20), "codex:personal": reading(40), grok: { status: "not_configured" } };

test("account keys isolate providers and hiding a source pauses every account", () => {
  const before = JSON.stringify(registry);
  const expanded = accountProviders(providers, registry);
  assert.deepEqual(expanded.map(providerKey), ["claude", "claude:work", "codex", "codex:personal", "grok"]);
  assert.deepEqual(enabledProviders(expanded, ["claude"]).map(providerKey), ["codex", "codex:personal", "grok"]);
  assert.equal(selectedAccountProvider(providers[0], registry).accountId, "work");
  assert.equal(selectedAccountProvider(providers[0], { ...registry, selected: { claude: "removed" } }).accountId, "default");
  assert.equal(JSON.stringify(registry), before);
  assert.equal(accountProviders(providers, {})[0].accountId, "default");
});

test("companion selection never mixes account quotas or cooldowns, statistics include all accounts", () => {
  const schedule = { claude: { backoffUntil: 100 }, "claude:work": { backoffUntil: 900 } };
  const snapshot = companionAccountSnapshot(providers, registry, results, schedule);
  assert.equal(snapshot.results.claude, results["claude:work"]);
  assert.equal(snapshot.results.codex, results.codex);
  assert.equal(snapshot.backoffUntil.claude, 900);
  assert.equal(snapshot.accountLabels.claude, registry.profiles[1].label);
  assert.deepEqual(Object.keys(snapshot.results), ["claude", "codex", "grok"]);
  const stats = dashboardStatistics(accountProviders(providers, registry), results, { hidden_providers: [] });
  assert.equal(stats.reporting, 4);
  assert.deepEqual(stats.rows.map(row => row.used), [10, 95, 20, 40]);
  assert.equal(stats.rows[1].provider, "Claude · Trabajo <script>");
  assert.equal(companionAccountSnapshot(providers, registry, { claude: results.claude }, {}).results.claude, undefined, "never substitute a different account when selected data is missing");
});

test("nextAccountLabel numbers new accounts from 2 per provider and skips taken numbers", () => {
  const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name]);
  const profile = (provider, label) => ({ provider, id: label, label });
  assert.equal(nextAccountLabel([], "claude", t), "Account 2");
  assert.equal(nextAccountLabel([profile("claude", "Account 2"), profile("claude", "Account 3")], "claude", t), "Account 4");
  assert.equal(nextAccountLabel([profile("claude", "Account 2"), profile("claude", "Account 4")], "claude", t), "Account 3");
  assert.equal(nextAccountLabel([profile("claude", "Account 2")], "codex", t), "Account 2");
});

test("Widget shows all accounts and credential names while Strip keeps the selected legacy row", () => {
  const named = { ...registry, profiles: registry.profiles.map((profile, index) => ({ ...profile, username: ["Alice", "Bob", null, "Dana"][index] })) };
  const before = JSON.stringify(named);
  const schedule = { claude: { backoffUntil: 100 }, "claude:work": { backoffUntil: 900 } };
  const snapshot = companionAccountSnapshot(providers, named, results, schedule);
  const widget = widgetAccountProviders(WIDGET_PROVIDERS, snapshot);
  assert.deepEqual(widget.map(providerKey), ["claude", "claude:work", "codex", "codex:personal", "grok"]);
  assert.deepEqual(widget.map(row => row.accountLabel), ["Alice", "Bob", null, "Dana", undefined]);
  assert.deepEqual(widget.map(row => row.quota), [results.claude, results["claude:work"], results.codex, results["codex:personal"], results.grok]);
  assert.equal(widget[0].backoffUntil, 100);
  assert.equal(widget[1].backoffUntil, 900);
  const visible = widget.filter(row => visibleProviders([row], { [row.id]: row.quota }, ["claude"]).length);
  assert.deepEqual(visible.map(providerKey), ["codex", "codex:personal"]);
  const strip = widgetAccountProviders(WIDGET_PROVIDERS, snapshot, true);
  assert.deepEqual(strip.map(row => row.id), WIDGET_PROVIDERS.map(row => row.id));
  assert.equal(strip.find(row => row.id === "claude").quota, results["claude:work"]);
  assert.equal(strip.find(row => row.id === "claude").accountLabel, "Bob", "Strip tooltip prefers the credential username over the stored alias");
  assert.equal(companionAccountSnapshot(providers, registry, results, schedule).accountLabels.claude, registry.profiles[1].label, "Strip tooltip falls back to the stored alias without credentials");
  assert.equal(strip.find(row => row.id === "codex").accountLabel, undefined);
  assert.equal(JSON.stringify(named), before, "display names never overwrite saved aliases");
  assert.equal(widgetAccountProviders(WIDGET_PROVIDERS, { results, backoffUntil: {} }).length, WIDGET_PROVIDERS.length, "legacy events still work");
});

test("real Widget renderer hides missing data, restores incoming quotas and applies the same rule to Strip", () => {
  const widget = fs.readFileSync(new URL("../../src/widget.js", import.meta.url), "utf8");
  const context = { snapshot: companionAccountSnapshot(WIDGET_PROVIDERS, registry, {}, {}),
    preferences: { strip: false, hidden_providers: [] }, widgetAccountProviders,
    visibleProviders, WIDGET_PROVIDERS, providersEl: { replaceChildren: (...nodes) => { context.rows = nodes; } },
    renderProvider: (provider, quota) => ({ key: providerKey(provider), quota }), el: (tag, className, text) => ({ empty: true, text }),
    t: key => key, statusEl: { dataset: {} }, age: () => "waiting", scheduleResize: () => {},
  };
  vm.createContext(context);
  vm.runInContext(widget.slice(widget.indexOf("function render()"), widget.indexOf("function applyPreferences(")), context);
  const keys = () => Array.from(context.rows, row => row.key);
  context.render();
  assert.equal(context.rows[0].empty, true, "no fake quota/placeholder rows before data arrives");
  const broken = { ...results, antigravity: { status: "action_required", windows: [] }, grok: { status: "error", windows: [] } };
  context.snapshot = companionAccountSnapshot(WIDGET_PROVIDERS, registry, broken, {});
  context.render();
  assert.deepEqual(keys(), ["claude", "claude:work", "codex", "codex:personal"]);
  const arriving = { ...broken, grok: reading(0), antigravity: { status: "ok", stale: { observed_at: 1 }, windows: [{ label: "Weekly · Claude+GPT", percent: 25 }] } };
  context.snapshot = companionAccountSnapshot(WIDGET_PROVIDERS, registry, arriving, {});
  context.render();
  assert.deepEqual(keys(), ["claude", "claude:work", "codex", "codex:personal", "antigravity", "grok"], "zero usage and real cached quotas are data");
  context.preferences.hidden_providers = ["claude", "grok"];
  context.render();
  assert.deepEqual(keys(), ["codex", "codex:personal", "antigravity"]);
  context.preferences.antigravity_claude_gpt_hidden = true;
  context.render();
  assert.deepEqual(keys(), ["codex", "codex:personal"], "no visible model pools means no usable data");
  context.preferences.strip = true;
  context.preferences.hidden_providers = [];
  context.snapshot = companionAccountSnapshot(WIDGET_PROVIDERS, registry, broken, {});
  context.render();
  assert.deepEqual(keys(), ["claude", "codex"], "Strip hides error/action_required rows like Widget");
  assert.equal(context.rows[0].quota, results["claude:work"]);
  context.snapshot = companionAccountSnapshot(WIDGET_PROVIDERS, registry, {}, {});
  context.render();
  assert.equal(context.rows[0].text, "Waiting for data", "Strip empty state is not \"No providers detected\"");
});

test("real scheduler sends explicit account ids and preserves independent retry/credential gates", async () => {
  const main = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8");
  const calls = [];
  const context = {
    quotaResults: {}, providerSchedule: {}, providerKey, applyClaudeLoginStatus, providerRequestFloor, providerRetryDelay,
    MIN_REQUEST_INTERVAL_MS: 20000, ERROR_RETRY_DELAYS_MS: [60000, 120000, 300000],
    invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === "claude_login_status") return { generation: args.accountId === "work" ? 22 : 11 };
      return args.accountId === "work" ? { status: "error", retry_after_seconds: 365 } : reading(12);
    },
  };
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf("function getProviderSchedule("), main.indexOf("function renderRefreshStatus(")), context);
  const accounts = accountProviders([providers[0]], registry);
  await Promise.all(accounts.map(provider => context.checkProviderQuota(provider)));
  assert.equal(context.quotaResults.claude.status, "ok");
  assert.equal(context.quotaResults["claude:work"].status, "error");
  assert.equal(context.providerSchedule.claude.credentialGeneration, 11);
  assert.equal(context.providerSchedule["claude:work"].credentialGeneration, 22);
  assert.equal(context.providerSchedule.claude.backoffUntil, 0);
  assert.ok(context.providerSchedule["claude:work"].backoffUntil > Date.now());
  assert.deepEqual(calls.filter(([command]) => command === "claude_quota").map(([, args]) => args.accountId), ["default", "work"]);
  const before = calls.filter(([command]) => command === "claude_quota").length;
  await context.checkProviderQuota(accounts[1]);
  assert.equal(calls.filter(([command]) => command === "claude_quota").length, before);
});

test("Home keeps every registered account visible while login or idle checks are pending", () => {
  const main = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8");
  const context = { quotaResults: {}, providerKey, activeAccountProviders: () => accountProviders(providers, registry) };
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf("function configuredProviders()"), main.indexOf("function render()")), context);
  const visible = () => Array.from(context.configuredProviders(), providerKey);
  assert.deepEqual(visible(), ["claude", "claude:work", "codex", "codex:personal"], "initial pending checks must not hide the default account");
  context.quotaResults.claude = { status: "not_configured" };
  context.quotaResults["claude:work"] = reading(23);
  assert.deepEqual(visible(), ["claude", "claude:work", "codex", "codex:personal"]);
  context.activeAccountProviders = () => enabledProviders(accountProviders(providers, registry), ["claude"]);
  assert.deepEqual(visible(), ["codex", "codex:personal"], "hiding a source still hides all of its accounts");
  context.activeAccountProviders = () => accountProviders(providers, { profiles: registry.profiles.filter(profile => profile.id === "default"), selected: {} });
  assert.deepEqual(visible(), [], "unused single-account sources retain the normal setup flow");
});

test("first sign-in releases a new Claude profile's not-configured polling floor", async () => {
  const main = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8");
  let generation = 0;
  let checks = 0;
  const context = {
    quotaResults: {}, providerSchedule: {}, providerKey, applyClaudeLoginStatus, providerRequestFloor, providerRetryDelay,
    MIN_REQUEST_INTERVAL_MS: 20000, ERROR_RETRY_DELAYS_MS: [60000, 120000, 300000],
    invoke: async (command, args) => {
      assert.equal(args.accountId, "work");
      if (command === "claude_login_status") return { generation, issue: null };
      checks++;
      return generation === 0 ? { status: "not_configured" } : reading(23);
    },
  };
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf("function getProviderSchedule("), main.indexOf("function renderRefreshStatus(")), context);
  const account = accountProviders([providers[0]], registry).find(profile => profile.accountId === "work");
  await context.checkProviderQuota(account);
  assert.equal(context.quotaResults["claude:work"].status, "not_configured");
  assert.equal(checks, 1);
  generation = 123;
  await context.checkProviderQuota(account);
  assert.equal(checks, 2, "new credentials should not wait six minutes after the unsigned check");
  assert.equal(context.quotaResults["claude:work"].status, "ok");
  assert.equal(context.quotaResults["claude:work"].windows[0].percent, 23);
  await context.checkProviderQuota(account);
  assert.equal(checks, 2, "unchanged credentials still respect the healthy polling floor");
});

test("public profile commands and native state are registered; production never changes global account env", () => {
  const lib = fs.readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const commands = fs.readFileSync(new URL("../../src-tauri/src/commands/mod.rs", import.meta.url), "utf8");
  const handlers = lib.slice(lib.indexOf(".invoke_handler("));
  for (const command of ["account_profiles", "add_account_profile", "select_account_profile", "remove_account_profile", "account_cli"]) {
    assert.ok(commands.includes(`fn ${command}(`));
    assert.ok(handlers.includes(`${command},`));
  }
  assert.ok(lib.includes(".manage(accounts::AccountState::load())"));
  for (const file of ["accounts.rs", "providers/claude.rs", "providers/codex.rs"]) {
    const source = fs.readFileSync(new URL(`../../src-tauri/src/${file}`, import.meta.url), "utf8").split("#[cfg(test)]")[0];
    assert.ok(!source.includes("std::env::set_var("), file);
  }
});
