import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));

test("AgentMeter branding and 0.0.1 are consistent across product surfaces", () => {
  assert.equal(config.productName, "AgentMeter");
  assert.equal(config.version, "0.0.1");
  assert.deepEqual(config.app.windows.map(window => window.title), ["AgentMeter", "AgentMeter Widget"]);
  for (const file of ["package.json", "package-lock.json"]) {
    const value = JSON.parse(read(file));
    assert.equal(value.name, "agentmeter"); assert.equal(value.version, config.version);
  }
  assert.equal(JSON.parse(read("package-lock.json")).packages[""].version, config.version);
  assert.match(read("src-tauri/Cargo.toml"), /name = "agentmeter"/);
  assert.match(read("src-tauri/Cargo.toml"), /name = "agentmeter_lib"/);
  assert.ok(read("src-tauri/Cargo.toml").includes(`version = "${config.version}"`));
  assert.ok(read("src-tauri/Cargo.lock").replace(/\r\n/g, "\n").includes(`name = "agentmeter"\nversion = "${config.version}"`));
  assert.ok(read("src-tauri/Cargo.toml").includes('repository = "https://github.com/carlos-mto/AgentMeter"'));
  assert.match(read("src-tauri/src/main.rs"), /agentmeter_lib::run\(\)/);
  assert.match(read("src-tauri/src/lib.rs"), /\.tooltip\("AgentMeter"\)/);
  for (const file of ["src/index.html", "src/widget.html", "assets/app-icon.svg", "README.md", "README.es.md", "README.zh-TW.md"]) {
    const content = read(file);
    assert.ok(content.includes("AgentMeter"), file);
  }
  assert.ok(read("src/index.html").includes(`title="AgentMeter · v${config.version}"`));
  assert.ok(read("src/index.html").includes('href="https://github.com/carlos-mto/AgentMeter"'));
  assert.match(read("src/widget.html"), /class="widget-title">AgentMeter</);
  for (const catalog of Object.values(JSON.parse(read("src/locales.json")))) {
    assert.ok(catalog["AgentMeter Widget"].includes("AgentMeter"));
    assert.ok(catalog["AgentMeter Strip"].includes("AgentMeter"));
  }
});

test("the meter mark replaces all old brand glyphs without remote assets", () => {
  assert.match(read("assets/app-icon.svg"), /<title>AgentMeter<\/title>/);
  assert.match(read("src/index.html"), /id="icon-agentmeter"/);
  assert.match(read("src/widget.html"), /id="widget-icon-agentmeter"/);
  assert.doesNotMatch(read("src/index.html"), /id="icon-deck"/);
  assert.doesNotMatch(read("src/widget.html"), /widget-icon-cube/);
  for (const id of ['claude','codex','antigravity','grok','grok_bot']) assert.ok(read('src/widget.html').includes(`id="widget-icon-${id}"`), `Preserve ${id} provider mark`);
  assert.ok(read('src/widget.js').includes('mark.append(widgetIcon(provider.id))'));
});

test("app identifier, data root, theme key and autostart name are consistent", () => {
  assert.equal(config.identifier, "me.mto.agentmeter");
  const accounts = read("src-tauri/src/accounts.rs");
  assert.ok(accounts.includes('join("stackly-agent-manager")'));
  for (const file of ["src-tauri/src/widget.rs", "src-tauri/src/providers/claude.rs"]) assert.ok(read(file).includes('crate::accounts::data_dir()'), file);
  const setup = read("src-tauri/src/lib.rs").split('.setup(|app| {')[1];
  for (const file of ["src/index.html", "src/widget.html", "src/dashboard.js"]) assert.ok(read(file).includes('"agent-meter-theme"'), file);
  const startup = read("src-tauri/src/windows/startup.rs");
  assert.match(startup, /const VALUE_NAME: &str = "AgentMeter"/);
});
