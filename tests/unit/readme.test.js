import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const root = new URL('../../', import.meta.url);
const files = ['README.md', 'README.es.md', 'README.pt.md', 'README.it.md', 'README.de.md', 'README.zh-TW.md'];
const sections = ['features','screenshots','providers','installation','dashboard','accounts','widget-strip','tray','appearance','privacy','troubleshooting','limitations','development','project'];
const config = JSON.parse(fs.readFileSync(new URL('src-tauri/tauri.conf.json', root), 'utf8'));

for (const file of files) test(`${file}: current features, language parity and working local links`, () => {
  const text = fs.readFileSync(new URL(file, root), 'utf8');
  assert.ok(text.startsWith('# AgentMeter\n'));
  assert.ok(text.includes(config.version));
  const anchors = [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]);
  assert.deepEqual(anchors, sections);
  for (const translation of files) assert.ok(text.includes(`](./${translation})`));
  for (const token of ['Claude', 'Codex', 'Antigravity', 'Grok', 'Grok Bot', 'Services', 'Statistics', 'Settings', '100%', '300%', '25%', `${config.app.windows[0].width} × ${config.app.windows[0].height}`, '380 × 520', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'accounts.json', 'widget.json', 'stackly-agent-manager', 'agentmeter.exe', '--hidden', 'agy', 'Windows', 'DPAPI', 'npm ci', 'npm run tauri -- dev', 'npm run tauri -- build --bundles nsis -- --locked', 'cargo test --locked']) assert.ok(text.includes(token), `${file}: ${token}`);
  const links = [...text.matchAll(/\]\(([^\s)]+)\)/g), ...text.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1]);
  const images = [...text.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(images, ['./assets/screenshots/dashboard.png', './assets/screenshots/widget.png', './assets/screenshots/strip.png']);
  for (const image of images) {
    const png = fs.readFileSync(new URL(image, root));
    assert.deepEqual(png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'), `${file}: valid PNG ${image}`);
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, `${file}: nonempty capture ${image}`);
  }
  for (const target of links) {
    if (/^https?:\/\//.test(target)) {
      const url = new URL(target);
      if (url.hostname === 'github.com') assert.ok(url.pathname === '/carlos-mto/AgentMeter' || url.pathname.startsWith('/carlos-mto/AgentMeter/'), `${file}: current repository ${target}`);
      continue;
    }
    if (target.startsWith('#')) { assert.ok(anchors.includes(target.slice(1)), `${file}: ${target}`); continue; }
    assert.ok(fs.existsSync(new URL(target, root)), `${file}: ${target}`);
  }
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, `${file}: balanced code fences`);
  assert.doesNotMatch(text, /Settings → Accounts|1180 × 840|Browser Bridge|browser-bridge|gemini\.google\.com/);
});
