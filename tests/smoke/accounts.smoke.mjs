// Opt-in native WebView probe. Temporary loopback CDP only; no real authentication.
// Node 22+. Uses synthetic local Codex sessions and restores profile selections.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const endpoint = process.env.QUOTA_CDP_URL ?? "http://127.0.0.1:19336";
const targets = await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const mainTarget = targets.find(target => target.url.includes("tauri.localhost") && !target.url.includes("widget.html"));
const widgetTarget = targets.find(target => target.url.includes("tauri.localhost") && target.url.includes("widget.html"));
assert.ok(mainTarget && widgetTarget, "Start the test app with temporary loopback CDP first");
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  await send("Runtime.enable");
  return { send, errors, close: () => ws.close(), eval: async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } };
}
const main = await connect(mainTarget);
const widget = await connect(widgetTarget);
const invoke = (command, args = {}) => main.eval(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
const waitFor = (condition, page = main) => page.eval(`new Promise((resolve, reject) => {
  const ready = () => (${condition});
  if (ready()) return resolve(true);
  const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error('DOM condition timed out')); }, 9000);
})`);
const click = selector => main.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
const navigate = view => click(`[data-view="${view}"]`);
const original = await invoke("account_profiles");
const preferences = await invoke("widget_preferences");
const originalTheme = await main.eval("document.documentElement.dataset.theme");
const storedTheme = await main.eval("localStorage.getItem('agent-meter-theme')");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "quota-accounts-smoke-"));
const screenshots = [];
const receipts = [];
const profiles = [];
async function add(provider, label, directory) {
  await navigate("services");
  await waitFor("document.querySelector('#account-add-form') && !document.querySelector('#account-provider').disabled");
  const known = new Set((await invoke("account_profiles")).profiles.map(profile => profile.id));
  await main.eval(`document.querySelector('#account-provider').value=${JSON.stringify(provider)};
    document.querySelector('#account-directory').value=${JSON.stringify(directory)};
    document.querySelector('#account-add-form button[type=submit]').click();`);
  await waitFor(`!document.querySelector('#account-provider').disabled && document.querySelectorAll('.account-row').length > ${known.size}`);
  const added = (await invoke("account_profiles")).profiles.find(profile => !known.has(profile.id));
  assert.ok(added, "profile added through the real form");
  assert.match(added.label, /^\S+ \d+$/u, "label is generated automatically");
  // `label` is the expected display name (the credential username), not the stored placeholder.
  const profile = { ...added, label };
  profiles.push(profile);
  return profile;
}
async function fixture(name, percent, username, withSession = false) {
  const directory = path.join(root, name);
  await fs.mkdir(path.join(directory, "sessions"), { recursive: true });
  const line = { type: "event_msg", timestamp: new Date().toISOString(), payload: { type: "token_count", rate_limits: {
    primary: { used_percent: percent, window_minutes: withSession ? 300 : 10080, resets_at: Math.floor(Date.now() / 1000) + (withSession ? 3600 : 86400) },
    ...(withSession ? { secondary: { used_percent: percent, window_minutes: 10080, resets_at: Math.floor(Date.now() / 1000) + 86400 } } : {}), plan_type: "plus",
  } } };
  await fs.writeFile(path.join(directory, "sessions", "rollout-fixture.jsonl"), JSON.stringify(line) + "\n");
  // Identity-only claims: deliberately no access token, so no fixture can send
  // a real HTTP request; quota remains the synthetic local-session fallback.
  const payload = Buffer.from(JSON.stringify({ name: username })).toString("base64url");
  await fs.writeFile(path.join(directory, "auth.json"), JSON.stringify({ tokens: { id_token: `header.${payload}.signature` } }));
  return directory;
}
async function select(profile) {
  await navigate("services");
  await click(`#account-select-${profile.provider}-${profile.id}`);
  await waitFor(`document.querySelector('#account-select-${profile.provider}-${profile.id}').checked && !document.querySelector('#account-select-${profile.provider}-${profile.id}').disabled`);
}
try {
  const first = await add("codex", "Fixture <b>A</b> & QA", await fixture("Account A", 17, "Fixture <b>A</b> & QA", true));
  const second = await add("codex", "Fixture B", await fixture("Account B", 83, "Fixture B"));
  const claudeDirectory = path.join(root, "Claude account");
  await fs.mkdir(claudeDirectory);
  await fs.writeFile(path.join(claudeDirectory, ".credentials.json"), '{"claudeAiOauth":"fixture-secret-marker"}');
  const claude = await add("claude", "Fixture Claude", claudeDirectory);
  for (const [profile, percent] of [[first, 17], [second, 83]]) {
    const quota = await invoke("codex_quota", { accountId: profile.id });
    assert.equal(quota.status, "ok");
    assert.equal(quota.windows[0].percent, percent);
    assert.ok(quota.stale.source.includes("session log"));
  }
  const rejected = await invoke("claude_quota", { accountId: claude.id });
  assert.ok(["error", "action_required"].includes(rejected.status));
  assert.ok(!JSON.stringify(rejected).includes("fixture-secret-marker"));
  await navigate("home");
  for (const [profile, percent] of [[first, 17], [second, 83]]) {
    const selector = `[data-provider="codex"][data-account="${profile.id}"]`;
    const expected = preferences.usage_display === "remaining" ? 100 - percent : percent;
    assert.ok((await main.eval(`document.querySelector(${JSON.stringify(selector)}).textContent`)).includes(`${expected}%`));
  }
  assert.equal(await main.eval(`document.querySelector('[data-account="${first.id}"] .account-label').textContent`), first.label);
  assert.equal(await main.eval(`document.querySelector('[data-account="${first.id}"] .account-label b')`), null, "labels are text, never HTML");
  receipts.push("Native form/IPC: separate 17% and 83% Codex readings, secret-safe Claude errors");

  await widget.eval(`(async () => { window.__accountReceipt = null; window.__stopAccountProbe = await window.__TAURI__.event.listen('quota-snapshot', ({payload}) => { window.__accountReceipt = payload; }); })()`);
  for (const [profile, percent] of [[first, 17], [second, 83]]) {
    await select(profile);
    // Receipt changes trigger normal widget rendering and DOM mutations.
    await waitFor(`window.__accountReceipt?.results.codex?.windows[0].percent === ${percent}`, widget);
    assert.equal(await widget.eval("window.__accountReceipt.accountLabels.codex"), profile.label);
  }
  await invoke("set_display_mode", { mode: "widget" });
  await waitFor(`document.documentElement.dataset.mode === 'widget' && document.querySelector('[data-provider=codex][data-account="${first.id}"] .account-name')`, widget);
  for (const [profile, percent] of [[first, 17], [second, 83]]) {
    const selector = `[data-provider=codex][data-account="${profile.id}"]`;
    const expected = preferences.usage_display === "remaining" ? 100 - percent : percent;
    assert.ok((await widget.eval(`document.querySelector(${JSON.stringify(selector)}).textContent`)).includes(`${expected}%`));
    assert.equal(await widget.eval(`document.querySelector(${JSON.stringify(selector + " .account-name")}).textContent`), profile.username.toLocaleLowerCase());
    assert.equal(await widget.eval(`document.querySelector(${JSON.stringify(selector + " .account-name b")})`), null);
    const sizes = await widget.eval(`({ name: parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(selector + " .account-name")})).fontSize), provider: parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(selector + " .provider-name")})).fontSize) })`);
    assert.ok(sizes.name < sizes.provider);
    const reset = await widget.eval(`(() => { const metric = document.querySelector(${JSON.stringify(selector + " .widget-metric")}); const reading = metric.querySelector('.metric-reading'); const caption = metric.querySelector('.metric-reset'); return { text: caption?.textContent, title: metric.title, below: caption?.getBoundingClientRect().top >= reading.getBoundingClientRect().bottom - 1, smaller: caption && parseFloat(getComputedStyle(caption).fontSize) < parseFloat(getComputedStyle(reading.querySelector('.metric-period')).fontSize) }; })()`);
    assert.ok(reset.text && reset.title.includes(reset.text));
    assert.ok(reset.below && reset.smaller, "Reset caption is smaller than its quota label");
    const gauges = await widget.eval(`Array.from(document.querySelectorAll(${JSON.stringify(selector + " .widget-metric")}), metric => ({ fill: metric.style.getPropertyValue('--quota-fill'), ring: Boolean(metric.querySelector('.quota-ring')), bar: getComputedStyle(metric.querySelector('.quota-bar')).display, period: metric.dataset.period }))`);
    assert.ok(gauges.every(gauge => gauge.ring && gauge.fill === `${expected}%`));
    assert.ok(gauges.every(gauge => (gauge.period === '7d') === (gauge.bar === 'none')), "Only 5h carries the reference's bar");
  }
  const noData = await widget.eval(`['antigravity','grok'].filter(id => window.__accountReceipt.results[id]?.status !== 'ok').map(id => ({id, shown: Boolean(document.querySelector('[data-provider="'+id+'"]'))}))`);
  assert.ok(noData.every(provider => !provider.shown), "Absent/error Antigravity and Grok are automatically hidden");
  for (const scale of [100, 200, 300]) {
    await invoke("set_widget_scale", { percent: scale });
    await waitFor(`document.querySelector('#widget-scale-value').textContent === '${scale}%'`, widget);
    await widget.eval("new Promise(resolve => setTimeout(resolve, 150))");
    const columns = await widget.eval(`['5h','7d'].map(period => ({period, cells: [...document.querySelectorAll('.widget-metric[data-period="'+period+'"]')].map(metric => ({left: metric.getBoundingClientRect().left, right: metric.querySelector('.metric-value').getBoundingClientRect().right, reset: metric.querySelector('.metric-reset')?.getBoundingClientRect().left, font: metric.querySelector('.metric-reset') ? parseFloat(getComputedStyle(metric.querySelector('.metric-reset')).fontSize) : null, scale: parseFloat(getComputedStyle(document.documentElement).fontSize)/16, column: getComputedStyle(metric).gridColumnStart}))}))`);
    for (const {period, cells} of columns) {
      assert.ok(cells.length);
      assert.ok(cells.every(cell => cell.column === (period === '5h' ? '1' : '2')), "Weekly-only keeps the second column");
      assert.ok(Math.max(...cells.map(cell => cell.left)) - Math.min(...cells.map(cell => cell.left)) < 1, `Aligned ${period} starts at ${scale}%`);
      assert.ok(Math.max(...cells.map(cell => cell.right)) - Math.min(...cells.map(cell => cell.right)) < 1, `Aligned ${period} percentages at ${scale}%`);
      const captions = cells.filter(cell => cell.reset !== undefined);
      assert.ok(!captions.length || Math.max(...captions.map(cell => cell.reset)) - Math.min(...captions.map(cell => cell.reset)) < 1, "Reset captions share the reference alignment");
      assert.ok(cells.every(cell => cell.font === null || cell.font/cell.scale === 10), "Reference reset text is 10px base, smaller than quota labels");
    }
    assert.ok(await widget.eval("document.documentElement.scrollWidth <= innerWidth + 1"), `No clipping at ${scale}%`);
  }
  await invoke("set_widget_scale", { percent: preferences.widget_scale });
  await widget.eval("new Promise(resolve => setTimeout(resolve, 150))");
  const metrics = await widget.eval(`({ window: innerWidth, content: document.documentElement.scrollWidth, shell: document.querySelector('.widget').getBoundingClientRect().bottom, height: innerHeight, scroll: getComputedStyle(document.querySelector('.widget-providers')).overflowY })`);
  assert.ok(metrics.content <= metrics.window + 1 && metrics.shell <= metrics.height + 1, "Widget stays inside its native bounds");
  assert.equal(metrics.scroll, "auto");
  await widget.eval("document.querySelector('#widget-accounts').click()");
  await waitFor("document.querySelector('[data-view=settings]').getAttribute('aria-current') === 'page'");
  assert.equal(await widget.eval("document.querySelector('.widget-brand-mark use').getAttribute('href')"), "#widget-icon-cube");
  const widgetCapture = await widget.send("Page.captureScreenshot", { format: "png" });
  const widgetFile = path.join(os.tmpdir(), "quota-accounts-widget.png");
  await fs.writeFile(widgetFile, Buffer.from(widgetCapture.data, "base64"));
  screenshots.push(widgetFile);
  await invoke("set_display_mode", { mode: "strip" });
  await waitFor(`document.documentElement.dataset.mode === 'strip' && document.querySelectorAll('.widget-provider[data-provider=codex]').length === 1`, widget);
  assert.equal(await widget.eval("document.querySelectorAll('.account-name, .metric-reset, .metric-reading').length"), 0);
  assert.equal(await widget.eval("getComputedStyle(document.querySelector('.provider-identity')).flexDirection"), "row");
  assert.ok((await widget.eval("document.querySelector('.widget-provider[data-provider=codex]').textContent")).includes(`${preferences.usage_display === 'remaining' ? 17 : 83}%`));
  assert.ok((await widget.eval("document.querySelector('.provider-name[title^=Codex]').title")).includes(second.label));
  const stripCapture = await widget.send("Page.captureScreenshot", { format: "png" });
  const stripFile = path.join(os.tmpdir(), "quota-accounts-strip.png");
  await fs.writeFile(stripFile, Buffer.from(stripCapture.data, "base64"));
  screenshots.push(stripFile);
  await invoke("set_display_mode", { mode: preferences.visible ? (preferences.strip ? "strip" : "widget") : "dashboard" });
  receipts.push("Neon cards, proportional rings/5h bars, accounts control and aligned quotas pass at 100/200/300%; weekly-only and Strip remain intact");

  // Native CLI spawning is tested in Rust with a dummy executable. Tauri's
  // immutable invoke surface is not monkeypatched; never authenticate in this probe.
  await navigate("services");
  assert.ok(await main.eval(`Boolean(document.querySelector('#account-login-claude-${claude.id}'))`));
  assert.ok(await main.eval(`Boolean(document.querySelector('#account-launch-codex-${first.id}'))`));
  await navigate("statistics");
  const rows = await main.eval("document.querySelector('.quota-table tbody').textContent");
  assert.ok(rows.includes(first.label) && rows.includes(second.label));

  for (const [theme, language] of [["dark", "es"], ["light", "de"]]) {
    if (await main.eval("document.documentElement.dataset.theme") !== theme) await click("#theme");
    await invoke("set_language", { language });
    for (const width of [1180, 380]) {
      await main.send("Emulation.setDeviceMetricsOverride", { width, height: 840, deviceScaleFactor: 1, mobile: false });
      for (const view of ["home", "statistics", "settings"]) {
        await navigate(view);
        const dimensions = await main.eval(`({ window: innerWidth, document: document.documentElement.scrollWidth, content: document.querySelector('.deck').clientWidth, scroll: document.querySelector('.deck').scrollWidth })`);
        assert.ok(dimensions.document <= dimensions.window + 1, `${theme}/${width}/${view}: document overflow`);
        assert.ok(dimensions.scroll <= dimensions.content + 1, `${theme}/${width}/${view}: content overflow`);
      }
      if (width === 1180) {
        const capture = await main.send("Page.captureScreenshot", { format: "png" });
        const file = path.join(os.tmpdir(), `quota-accounts-${theme}.png`);
        await fs.writeFile(file, Buffer.from(capture.data, "base64"));
        screenshots.push(file);
      }
    }
  }
  await navigate("services");
  assert.equal(await main.eval("Object.getOwnPropertyDescriptor(window, 'confirm').writable"), true);
  await main.eval("window.__accountOriginalConfirm = window.confirm; window.__accountConfirmMessages = []; window.confirm = message => { window.__accountConfirmMessages.push(message); return true; };");
  await click(`#account-remove-codex-${first.id}`);
  await waitFor(`!document.querySelector('#account-remove-codex-${first.id}') && !document.querySelector('#account-provider').disabled`);
  assert.ok((await main.eval("window.__accountConfirmMessages"))[0].includes(first.label));
  assert.ok(!(await invoke("account_profiles")).profiles.some(profile => profile.id === first.id));
  await fs.access(path.join(root, "Account A", "sessions", "rollout-fixture.jsonl"));
  await main.eval("window.confirm = window.__accountOriginalConfirm; delete window.__accountOriginalConfirm;");
  receipts.push("Remove through the real UI preserves account files and other selections");
  assert.deepEqual(main.errors, [], "No unhandled dashboard exceptions");
  assert.deepEqual(widget.errors, [], "No unhandled companion exceptions");
  receipts.push("Statistics, login/launch controls and settings layouts pass in both themes at 1180/380px");
} finally {
  try {
    await main.eval("if (window.__accountOriginalConfirm) { window.confirm = window.__accountOriginalConfirm; delete window.__accountOriginalConfirm; }");
    for (const provider of ["claude", "codex"]) {
      await invoke("select_account_profile", { provider, accountId: original.selected[provider] ?? "default" });
    }
    const current = await invoke("account_profiles");
    for (const profile of current.profiles.filter(profile => profile.config_dir.includes(path.basename(root)))) {
      await invoke("remove_account_profile", { provider: profile.provider, accountId: profile.id });
    }
    await invoke("set_widget_scale", { percent: preferences.widget_scale });
    await invoke("set_display_mode", { mode: preferences.visible ? (preferences.strip ? "strip" : "widget") : "dashboard" });
    await invoke("set_language", { language: preferences.language });
    await main.eval(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)};
      ${storedTheme === null ? "localStorage.removeItem('agent-meter-theme')" : `localStorage.setItem('agent-meter-theme',${JSON.stringify(storedTheme)})`};`);
    await main.send("Emulation.clearDeviceMetricsOverride");
    await widget.eval("window.__stopAccountProbe?.(); delete window.__accountReceipt;");
    await main.send("Page.reload");
    await waitFor("document.querySelector('[data-view=home]').getAttribute('aria-current') === 'page' && document.querySelector('#providers').children.length");
    assert.deepEqual((await invoke("account_profiles")).profiles, original.profiles, "All original profiles preserved");
    assert.deepEqual(await invoke("widget_preferences"), preferences, "All companion preferences preserved");
  } finally {
    main.close(); widget.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ passed: receipts, originalProfilesPreserved: true, preferencesPreserved: true, screenshots }, null, 2));
