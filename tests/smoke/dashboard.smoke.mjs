// Opt-in probe for an already-running Tauri WebView with temporary loopback CDP.
// Node 22+. Never enables debugging itself; restores every preference it changes.
// QUOTA_CDP_URL defaults to http://127.0.0.1:19336. Screenshots go to OS temp.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const endpoint = process.env.QUOTA_CDP_URL ?? "http://127.0.0.1:19336";
const targets = await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const mainTarget = targets.find(target => /\/\/?$|\/index.html$/.test(target.url) && target.url.includes("tauri.localhost"));
assert.ok(mainTarget, "Open the Dashboard WebView with temporary local CDP first");
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
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, 12000);
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
const waitFor = (condition, timeout = 7000, client = main) => client.eval(`new Promise((resolve, reject) => {
  const ready = () => (${condition});
  if (ready()) return resolve(true);
  const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error('DOM condition timed out')); }, ${timeout});
})`);
const click = selector => main.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
const navigate = view => click(`[data-view="${view}"]`);
const prefs = () => main.eval(`window.__TAURI__.core.invoke('widget_preferences')`);
const language = async code => {
  await main.eval(`(() => { const select=document.querySelector('#language-select'); select.value=${JSON.stringify(code)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor(`document.documentElement.lang === ${JSON.stringify(code)} && !document.querySelector('#language-select').disabled`);
};
const original = await prefs();
const originalTheme = await main.eval(`document.documentElement.dataset.theme`);
const originalStoredTheme = await main.eval(`localStorage.getItem('agent-meter-theme')`);
const screenshots = [];
const receipts = [];
const shot = async name => {
  const { data } = await main.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(os.tmpdir(), `agentmeter-dashboard-${name}.png`);
  await fs.writeFile(file, Buffer.from(data, "base64"));
  screenshots.push(file);
};
const resize = async (width, height) => {
  await main.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await main.eval(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
};
const assertLayout = async context => {
  const layout = await main.eval(`(() => {
    const deck=document.querySelector('.deck');
    const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
    return {width:innerWidth, sidebarWidth:document.querySelector('.sidebar').getBoundingClientRect().width, sidebarLabels:[...document.querySelectorAll('.sidebar .nav-item > span,.companion-controls .tool span')].map(e=>e.getBoundingClientRect().width), missingTooltips:[...document.querySelectorAll('.sidebar button,.sidebar a')].filter(visible).filter(e=>!e.title.trim()).map(e=>e.id), overflow:document.documentElement.scrollWidth>innerWidth || deck.scrollWidth>deck.clientWidth,
      clipped:[...document.querySelectorAll('.provider,.sources-trigger,.header-tools,.settings-card,.stat-card')].filter(visible).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.className),
      unnamed:[...document.querySelectorAll('button')].filter(visible).filter(e=>!(e.getAttribute('aria-label')||e.innerText.trim()||e.title)).map(e=>e.id),
      columns:[...document.querySelectorAll('.quota-grid')].filter(visible).map(e=>getComputedStyle(e).gridTemplateColumns),
      progress:[...document.querySelectorAll('[role="progressbar"]')].filter(visible).map(e=>({value:Number(e.getAttribute('aria-valuenow')),width:e.getBoundingClientRect().width}))};
  })()`);
  assert.equal(layout.overflow, false, `${context}: horizontal overflow`);
  assert.deepEqual(layout.clipped, [], `${context}: clipped cards`);
  assert.deepEqual(layout.unnamed, [], `${context}: unnamed controls`);
  assert.equal(layout.sidebarWidth, 68, `${context}: icon rail width`);
  assert.ok(layout.sidebarLabels.every(width => width <= 1), `${context}: sidebar text is not visible`);
  assert.deepEqual(layout.missingTooltips, [], `${context}: sidebar tooltips`);
  for (const bar of layout.progress) { assert.ok(bar.value >= 0 && bar.value <= 100); assert.ok(bar.width > 10); }
  return layout;
};
try {
  await waitFor(`!document.querySelector('#language-select').disabled && document.querySelector('#providers').children.length`);
  await language("en");
  assert.equal(await main.eval(`document.title`),'AgentMeter');
  assert.equal(await main.eval(`window.__TAURI__.window.getCurrentWindow().title()`),'AgentMeter');
  assert.equal(await main.eval(`window.__TAURI__.app.getVersion()`),'0.0.1');
  assert.equal(await main.eval(`document.querySelector('.brand').title`),'AgentMeter · v0.0.1');
  assert.equal(await main.eval(`document.querySelector('.deck-foot a').href`),'https://github.com/carlos-mto/AgentMeter');
  assert.equal(await main.eval(`document.querySelector('.brand use').getAttribute('href')`),'#icon-agentmeter');
  const nativeWidth=await main.eval(`(async()=>{const w=window.__TAURI__.window.getCurrentWindow();return (await w.innerSize()).width/await w.scaleFactor();})()`);
  assert.equal(nativeWidth, 644, 'Native default Dashboard width is 644 logical pixels');
  await waitFor(`!['Refreshing…','Checking providers…'].includes(document.querySelector('#countdown').textContent)`, 60000);
  await resize(644, 840);
  const catalogs = JSON.parse(await fs.readFile(new URL("../../src/locales.json", import.meta.url), "utf8"));
  for (const code of ["en", "es", "pt", "it", "de"]) {
    await language(code);
    for (const view of ["home", "services", "statistics", "settings"]) {
      await navigate(view);
      const state = await main.eval(`({active:document.querySelector('[aria-current="page"]').dataset.view,title:document.querySelector('h1').textContent,providers:!document.querySelector('#providers').hidden,stats:!document.querySelector('#statistics-panel').hidden,settings:!document.querySelector('#settings-panel').hidden,sourceOptions:document.querySelectorAll('.source-option').length})`);
      assert.equal(state.active, view);
      const key = { home: "Home", services: "Services", statistics: "Statistics", settings: "Settings" }[view];
      assert.equal(state.title, catalogs[code][key]);
      assert.equal(state.providers, view === "home");
      assert.equal(state.stats, view === "statistics");
      assert.equal(state.settings, view === "settings");
      if (view === "services") assert.equal(state.sourceOptions, 6);
      await assertLayout(`${code}/${view}`);
    }
    assert.equal(await main.eval(`document.title`),'AgentMeter');
    const tooltipLabels=await main.eval(`([...document.querySelectorAll('[data-view]')].map(e=>({key:e.dataset.i18nTitle,title:e.title,label:e.getAttribute('aria-label')})))`);
    for(const item of tooltipLabels){assert.equal(item.title,catalogs[code][item.key]);assert.equal(item.label,item.title);}
    receipts.push(`${code}: all four views and localized icon tooltips`);
  }
  await language('en');
  await navigate('services');
  const accountState=await main.eval(`(async()=>{
    const registry=await window.__TAURI__.core.invoke('account_profiles');
    return {profiles:registry.profiles.length,rows:document.querySelectorAll('#services-panel .account-row').length,groups:document.querySelectorAll('#services-panel .account-group').length,expectedGroups:new Set(registry.profiles.map(p=>p.provider)).size,valid:registry.profiles.every(p=>{
      const row=document.querySelector('#services-panel .account-row[data-provider="'+p.provider+'"][data-account="'+p.id+'"]');
      return row?.parentElement.dataset.provider===p.provider && Boolean(document.getElementById('account-login-'+p.provider+'-'+p.id)) && Boolean(document.getElementById('account-launch-'+p.provider+'-'+p.id)) && Boolean(document.getElementById('account-select-'+p.provider+'-'+p.id)) && Boolean(document.getElementById('account-remove-'+p.provider+'-'+p.id))===(p.id!=='default');
    }),inSettings:document.querySelectorAll('#settings-panel .account-row,#settings-panel #account-add-form').length};
  })()`);
  assert.equal(accountState.rows,accountState.profiles);assert.equal(accountState.groups,accountState.expectedGroups);assert.ok(accountState.valid);assert.equal(accountState.inSettings,0);
  await shot('services-accounts');
  await navigate('settings');
  assert.equal(await main.eval(`document.querySelector('#services-panel').hidden`),true);
  const widgetTarget=targets.find(t=>t.url.includes('widget.html'));
  if(widgetTarget){const widget=await connect(widgetTarget);try{assert.equal(await widget.eval(`document.title`),'AgentMeter Widget');assert.equal(await widget.eval(`document.querySelector('.widget-title').textContent`),'AgentMeter');assert.equal(await widget.eval(`document.querySelector('.widget-brand-mark use').getAttribute('href')`),'#widget-icon-agentmeter');await widget.eval(`document.querySelector('#widget-accounts').click()`);await waitFor(`document.querySelector('[aria-current="page"]').dataset.view==='services'`);assert.equal(await main.eval(`document.querySelector('#services-panel').hidden`),false);}finally{widget.close();}}
  receipts.push('Services owns grouped profiles and every account action; Widget Accounts opens Services');
  // Test genuine user input through CDP hit-testing, not only synthetic clicks.
  const point = await main.eval(`(() => {const r=document.querySelector('[data-view="home"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await main.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await main.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  assert.equal(await main.eval(`document.querySelector('[aria-current="page"]').dataset.view`), "home");
  const statisticsExpected = await main.eval(`document.querySelectorAll('#providers .row').length`);
  await navigate("statistics");
  assert.equal(await main.eval(`document.querySelectorAll('.quota-table tbody tr').length`), statisticsExpected);
  await shot("statistics");
  await navigate("settings");
  const nextMode = original.usage_display === "remaining" ? "used" : "remaining";
  await click(`[data-usage-display="${nextMode}"]`);
  await waitFor(`document.querySelector('#settings-usage [data-usage-display="${nextMode}"]')?.checked`);
  assert.equal((await prefs()).usage_display, nextMode);
  await click(`[data-usage-display="${original.usage_display}"]`);
  await waitFor(`document.querySelector('#settings-usage [data-usage-display="${original.usage_display}"]')?.checked`);
  await click("#settings-language");
  assert.equal(await main.eval(`document.activeElement.id`), "language-select");
  await navigate("home");
  if (await main.eval(`Boolean(document.querySelector('#antigravity-visibility-toggle'))`)) {
    await click("#antigravity-visibility-toggle");
    await waitFor(`!document.querySelector('#antigravity-visibility-toggle').disabled`);
    assert.equal((await prefs()).antigravity_claude_gpt_hidden, !original.antigravity_claude_gpt_hidden);
    await click("#antigravity-visibility-toggle");
    await waitFor(`!document.querySelector('#antigravity-visibility-toggle').disabled`);
  }
  for (const theme of ["dark", "light"]) {
    if (await main.eval(`document.documentElement.dataset.theme`) !== theme) await click("#theme");
    await language("es");
    await resize(644, 840);
    await navigate("home");
    await assertLayout(`${theme}/644`);
    await shot(`${theme}-wide`);
    await language("de");
    for (const width of [1400, 820, 620, 440, 380]) {
      await resize(width, width === 380 ? 520 : 790);
      for (const view of ["home", "services", "statistics", "settings"]) {
        await navigate(view);
        await assertLayout(`${theme}/${width}/${view}`);
      }
      if (width === 440) { await navigate("home"); await shot(`${theme}-narrow-de`); }
    }
    receipts.push(`${theme}: 644, 1400, 820, 620, 440 and 380px without overflow`);
  }
  await language('en');
  if(await main.eval(`document.documentElement.dataset.theme`)!=='dark') await click('#theme');
  const companionTarget=targets.find(target=>target.url.includes('widget.html'));
  if(companionTarget){
    const companion=await connect(companionTarget);
    try{
      for(const mode of ['widget','strip']){
        await main.eval(`window.__TAURI__.core.invoke('set_display_mode',{mode:${JSON.stringify(mode)}})`);
        await waitFor(`document.documentElement.dataset.mode===${JSON.stringify(mode)} && document.querySelectorAll('.widget-provider').length>0`,7000,companion);
        await companion.eval(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const marks=await companion.eval(`([...document.querySelectorAll('use')].filter(e=>!document.getElementById(e.getAttribute('href').slice(1))).map(e=>e.getAttribute('href')))`);
        assert.deepEqual(marks,[],'Every companion icon resolves after the rebrand');
        assert.equal(await companion.eval(`document.querySelector('.widget').getAttribute('aria-label')`),mode==='widget'?'AgentMeter Widget':'AgentMeter Strip');
        const {data}=await companion.send('Page.captureScreenshot',{format:'png'});
        const file=path.join(os.tmpdir(),`agentmeter-${mode}.png`);
        await fs.writeFile(file,Buffer.from(data,'base64'));screenshots.push(file);
      }
      assert.deepEqual(companion.errors,[],'No companion exceptions');
      receipts.push('AgentMeter Widget/Strip names, all provider marks and real quota screenshots');
    }finally{companion.close();}
  }
  assert.deepEqual(main.errors, [], "No unhandled WebView exceptions");
} finally {
  try {
    // Restore settings even if a UI assertion fails.
    for (const [command, args] of [["set_display_mode", { mode: original.visible ? (original.strip ? "strip" : "widget") : "dashboard" }], ["set_language", { language: original.language }], ["set_usage_display", { mode: original.usage_display }], ["set_antigravity_claude_gpt_hidden", { hidden: original.antigravity_claude_gpt_hidden }]]) {
      await main.eval(`window.__TAURI__.core.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
    }
    if (await main.eval(`document.documentElement.dataset.theme`) !== originalTheme) await click("#theme");
    await main.eval(originalStoredTheme === null ? `localStorage.removeItem('agent-meter-theme')` : `localStorage.setItem('agent-meter-theme',${JSON.stringify(originalStoredTheme)})`);
    await navigate("home");
    await main.send("Emulation.clearDeviceMetricsOverride");
    assert.deepEqual(await prefs(), original, "All original preferences preserved");
  } finally { main.close(); }
}
console.log(JSON.stringify({ passed: receipts, preferencesPreserved: true, screenshots }, null, 2));
