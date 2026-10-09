import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { WIDGET_PROVIDERS } from '../../src/widget-model.js';
const root = new URL('../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');

test('five native providers are consistent across Dashboard, Widget and Strip', () => {
  const main = read('src/dashboard.js');
  const providers = vm.runInNewContext(main.match(/const QUOTA_PROVIDERS = (\[[\s\S]*?\n\]);/)[1]);
  const expected = ['claude', 'codex', 'antigravity', 'grok', 'grok_bot'];
  assert.deepEqual(Array.from(providers, provider => provider.id), expected);
  assert.deepEqual(WIDGET_PROVIDERS.map(provider => provider.id), expected);
  const handlers = read('src-tauri/src/lib.rs').match(/generate_handler!\[([\s\S]*?)\]/)[1];
  for (const provider of providers) assert.ok(handlers.includes(provider.command), provider.id);
  assert.equal(providers.find(provider => provider.id === 'grok').setup, 'Sign in with Grok Build to add Grok.');
});

test('standalone Gemini and Browser Bridge have no UI, commands, modules or bundled resources', () => {
  for (const file of ['browser-bridge', 'src-tauri/src/gemini.rs', 'src-tauri/src/bridge.rs', 'src-tauri/src/native_host.rs']) assert.equal(fs.existsSync(new URL(file, root)), false, file);
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(config.bundle.resources, undefined);
  for (const file of ['src/dashboard.js', 'src/locales.json', 'src-tauri/src/lib.rs', 'src-tauri/src/providers/grok.rs']) assert.doesNotMatch(read(file), /Browser Bridge|gemini_quota|bridge_dir|native_host|browser_quota|BrowserCache/);
  assert.doesNotMatch(read('src/index.html'), /mark-gemini/);
  assert.doesNotMatch(read('src/widget.html'), /widget-icon-gemini/);
  assert.ok(read('src-tauri/src/providers/antigravity.rs').includes('gemini-weekly'), 'Keep Gemini quotas provided by Antigravity');
});
