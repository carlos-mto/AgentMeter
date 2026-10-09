import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const kebabStem = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';

function assertExactCase(target) {
  const relative = path.relative(rootPath, fileURLToPath(target));
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `Outside repository: ${target}`);
  let directory = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    assert.ok(fs.readdirSync(directory).includes(segment), `Missing path or incorrect case: ${relative}`);
    directory = path.join(directory, segment);
  }
}

test('custom filenames use ecosystem casing and tests have explicit execution roles', () => {
  const groups = [
    ['src', new RegExp(`^${kebabStem}\\.(js|css|html|json)$`)],
    ['docs', new RegExp(`^${kebabStem}\\.md$`)],
    ['assets', new RegExp(`^${kebabStem}\\.svg$`)],
    ['assets/screenshots', new RegExp(`^${kebabStem}\\.png$`)],
    ['tests/unit', new RegExp(`^${kebabStem}\\.test\\.js$`)],
    ['tests/smoke', new RegExp(`^${kebabStem}\\.smoke\\.mjs$`)],
    ['src-tauri/src', /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.rs$/],
    ['src-tauri/src/commands', /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.rs$/],
    ['src-tauri/src/providers', /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.rs$/],
    ['src-tauri/src/windows', /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.rs$/],
    ['src-tauri/tests/fixtures', new RegExp(`^${kebabStem}\\.jsonl?$`)],
  ];
  for (const [directory, filePattern] of groups) {
    for (const entry of fs.readdirSync(new URL(`${directory}/`, root), { withFileTypes: true })) {
      assert.match(entry.name, entry.isDirectory() ? new RegExp(`^${kebabStem}$`) : filePattern, `${directory}/${entry.name}`);
    }
  }
  assert.deepEqual(fs.readdirSync(new URL('tests/', root)).sort(), ['smoke', 'unit']);
});

test('frontend and documentation dependencies resolve with exact case on every platform', () => {
  for (const file of fs.readdirSync(new URL('src/', root))) {
    if (!/\.(js|html)$/.test(file)) continue;
    const source = read(`src/${file}`);
    const targets = file.endsWith('.js')
      ? [...source.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)].map(match => match[1])
      : [...source.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
    for (const target of targets) assertExactCase(new URL(target, new URL(`src/${file}`, root)));
  }
  const docs = [
    ...fs.readdirSync(root).filter(file => /^README.*\.md$/.test(file)),
    ...fs.readdirSync(new URL('docs/', root)).map(file => `docs/${file}`),
  ];
  for (const file of docs) {
    const links = [...read(file).matchAll(/\]\(([^\s)]+)\)|<img[^>]+src="([^"]+)"/g)].map(match => match[1] ?? match[2]);
    for (const target of links) {
      if (/^(https?:|#)/.test(target)) continue;
      assertExactCase(new URL(target, new URL(file, root)));
    }
  }
});

test('Dashboard and test commands point at normalized entrypoints', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts.test, 'node --test tests/unit/*.test.js');
  for (const name of ['accounts', 'dashboard']) {
    const script = `tests/smoke/${name}.smoke.mjs`;
    assert.equal(scripts[`test:smoke:${name}`], `node ${script}`);
    assertExactCase(new URL(script, root));
  }
  assert.match(read('src/index.html'), /<script type="module" src="dashboard\.js"><\/script>/);
  assert.match(read('src/index.html'), /href="dashboard\.css"/);
});
