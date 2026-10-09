import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const root = new URL('../../', import.meta.url);
const file = new URL('docs/architecture.md', root);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

test('architecture describes current configuration, registered commands and real source paths', () => {
  const text = fs.readFileSync(file, 'utf8');
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const main = config.app.windows.find(window => window.label === 'main');
  assert.ok(text.includes(`AgentMeter ${config.version}`));
  assert.ok(text.includes(`${main.width} × ${main.height}`));
  assert.ok(text.includes(`${main.minWidth} × ${main.minHeight}`));
  assert.ok(text.includes(config.identifier));
  const handlers = read('src-tauri/src/lib.rs').match(/generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(name => name.trim().split('::').at(-1)).filter(Boolean);
  for (const name of handlers) assert.ok(text.includes(`\`${name}\``), `Missing registered command: ${name}`);
  for (const target of [...text.matchAll(/\]\(([^\s)]+)\)/g)].map(match => match[1])) {
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    assert.ok(fs.existsSync(new URL(target, file)), `Missing architecture link: ${target}`);
  }
  for (const event of ['quota-snapshot', 'widget-ready', 'widget-open-accounts', 'widget-preferences-changed', 'widget-theme-changed', 'system-activity-resumed', 'active-refresh-tick']) assert.ok(text.includes(`\`${event}\``));
  for (const token of ['100%', '300%', '25%', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'accounts.json', 'widget.json', 'agent-meter-theme', 'agy', '--hidden', 'security.csp: null']) assert.ok(text.includes(token), token);
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0);
  assert.doesNotMatch(text, /CHANGELOG\.md|verified against live accounts|shortcut to Settings|opens existing settings|944 × 840|1180 × 840/i);
});
