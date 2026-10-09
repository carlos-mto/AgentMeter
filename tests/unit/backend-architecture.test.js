import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const native = 'src-tauri/src/';
const publicCommands = [
  'account_profiles', 'add_account_profile', 'select_account_profile',
  'remove_account_profile', 'account_cli', 'claude_quota', 'claude_login_status',
  'codex_quota', 'grok_quota', 'grok_bot_quota', 'antigravity_quota',
  'system_activity', 'widget_preferences', 'set_display_mode', 'hide_companion',
  'set_widget_locked', 'set_widget_scale', 'start_widget_drag', 'resize_widget',
  'set_taskbar_overlay', 'set_provider_hidden', 'set_antigravity_claude_gpt_hidden',
  'set_usage_display', 'set_language', 'open_dashboard',
];

test('all existing IPC commands live outside the composition root and retain their registry names', () => {
  const lib = read(`${native}lib.rs`);
  const adapters = read(`${native}commands/mod.rs`);
  const registry = lib.match(/generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(value => value.trim()).filter(Boolean);
  assert.deepEqual(registry, publicCommands.map(name => `commands::${name}`));
  assert.doesNotMatch(lib, /#\[tauri::command\]/);
  const definitions = [...adapters.matchAll(/#\[tauri::command\]\s+pub\(crate\) (?:async )?fn ([a-z_]+)\(/g)].map(match => match[1]);
  assert.deepEqual(definitions.sort(), [...publicCommands].sort());
  assert.doesNotMatch(adapters, /std::fs::|reqwest::|windows_sys::|atomic_write|Builder::/);
  assert.ok(lib.includes('app.manage(widget::WidgetState::load())'));
  assert.ok(lib.includes('app.manage(accounts::AccountState::load())'));
});

test('provider and Windows modules retain domain ownership and implementation-level cfg gates', () => {
  const modules = {
    providers: ['antigravity', 'claude', 'claude_diagnostics', 'claude_rate_limit', 'codex', 'grok', 'grok_bot'],
    windows: ['activity', 'startup', 'taskbar_overlay'],
  };
  for (const [directory, names] of Object.entries(modules)) {
    const declarations = read(`${native}${directory}/mod.rs`);
    for (const name of names) {
      assert.ok(declarations.includes(`pub(crate) mod ${name};`));
      assert.ok(fs.existsSync(new URL(`${native}${directory}/${name}.rs`, root)));
      assert.equal(fs.existsSync(new URL(`${native}${name}.rs`, root)), false, `Obsolete module alias: ${name}`);
    }
  }
  assert.match(read(`${native}lib.rs`), /^mod windows;/m);
  assert.match(read(`${native}windows/mod.rs`), /#\[cfg\(target_os = "windows"\)\]\s+pub\(crate\) mod taskbar_overlay;/);
  for (const name of ['activity', 'startup']) assert.match(read(`${native}windows/${name}.rs`), /cfg\(not\((?:target_os = "windows"|windows)\)\)/);
  assert.ok(read(`${native}i18n.rs`).includes('include_str!("../../src/locales.json")'));
  for (const directory of ['services', 'repository', 'models', 'state', 'error', 'utils']) assert.equal(fs.existsSync(new URL(`${native}${directory}/`, root)), false);
});

test('the Tauri + Rust + Windows guide matches the native tree, command count, links and fences', () => {
  const file = 'docs/tauri-rust-windows-architecture.md';
  const text = read(file);
  const tree = text.match(/```text\nsrc-tauri\/src\/\n([\s\S]*?)```/)[1];
  let directory = '';
  const documented = [];
  for (const line of tree.split('\n').filter(Boolean)) {
    const [, indent, name] = line.match(/^((?:[│ ]  )*)[├└]─ (.+)$/);
    if (name.endsWith('/')) directory = name;
    else documented.push(`${indent ? directory : ''}${name}`);
  }
  const actual = fs.readdirSync(new URL(native, root), { recursive: true }).map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.rs'));
  assert.deepEqual(documented.sort(), actual.sort());
  assert.ok(text.includes(`The ${publicCommands.length} existing IPC adapters`));
  assert.ok(text.includes(`all ${publicCommands.length} Tauri commands`));
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) if (!/^(?:https?:|#)/.test(target)) assert.ok(fs.existsSync(new URL(target.split('#')[0], new URL(file, root))), target);
  for (const [name, link] of [['README.md', './docs/'], ['README.es.md', './docs/'], ['README.pt.md', './docs/'], ['README.it.md', './docs/'], ['README.de.md', './docs/'], ['README.zh-TW.md', './docs/'], ['docs/architecture.md', './']]) assert.ok(read(name).includes(`](${link}tauri-rust-windows-architecture.md)`), name);
  assert.equal(text.match(/^```/gm).length % 2, 0);
});
