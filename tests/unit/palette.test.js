import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = file => fs.readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
const palette = read("palette.css");
const dashboard = read("dashboard.css");
const widget = read("widget.css");
const tokens = [...palette.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]);

test("both webviews load the same palette before their view-specific styles", () => {
  for (const [html, css] of [["index.html", "dashboard.css"], ["widget.html", "widget.css"]]) {
    const links = [...read(html).matchAll(/<link[^>]*href="([^"]+\.css)"/g)].map(match => match[1]);
    assert.deepEqual(links, ["palette.css", css, ...(html === "widget.html" ? ["widget-neon.css"] : [])]);
  }
});

test("shared theme tokens keep Dashboard colors and cannot drift in companion styles", () => {
  const blocks = [...palette.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)];
  assert.equal(blocks.length, 2);
  const light = Object.fromEntries([...blocks[0][1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  const dark = { ...light, ...Object.fromEntries([...blocks[1][1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()])) };
  assert.deepEqual([light["--ok"], light["--warn"], light["--crit"], light["--accent"]], ["#148448", "#a66b00", "#d23842", "#1678d6"]);
  assert.deepEqual([dark["--ok"], dark["--warn"], dark["--crit"], dark["--accent"]], ["#30eb83", "#ffce24", "#ff6371", "#38a5ff"]);
  for (const css of [dashboard, widget]) {
    for (const token of new Set(tokens)) assert.doesNotMatch(css, new RegExp(`${token}\\s*:`), `Local override of ${token}`);
  }
  for (const variable of widget.matchAll(/var\((--[\w-]+)\)/g)) {
    assert.ok(tokens.includes(variable[1]) || variable[1] === "--widget-scale", `Undefined ${variable[1]}`);
  }
});

test("Widget restores its original 94% surface opacity without fading text or Strip", () => {
  const surfaces = [...palette.matchAll(/--widget-surface: ([^;]+);/g)].map(match => match[1]);
  assert.equal(surfaces.length, 2);
  for (const surface of surfaces) {
    assert.equal([...surface.matchAll(/rgba\([^)]*, 0\.94\)/g)].length, 2);
  }
  const baseWidget = widget.match(/\.widget\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(baseWidget, /(?:^|;)\s*opacity:/);
  assert.match(baseWidget, /backdrop-filter: blur/);
  assert.match(widget, /:root\[data-mode="strip"\] \.widget\s*\{[^}]*background: var\(--surface\)/);
  assert.match(widget, /:root\[data-mode="strip"\] \.widget-head\s*\{[^}]*background: var\(--sidebar\)/);
});

test("Widget and Strip use shared surfaces, quota states and focus color, retaining transparent window corners", () => {
  assert.match(widget, /\.widget\s*\{[^}]*background: var\(--widget-surface\)/);
  assert.match(widget, /\.widget-head\s*\{[^}]*background: var\(--widget-header\)/);
  assert.match(widget, /\.metric-value\s*\{[^}]*color: var\(--ok\)/);
  assert.match(widget, /\.widget-metric\.warning \.metric-value\s*\{[^}]*color: var\(--warn\)/);
  assert.match(widget, /button:focus-visible\s*\{[^}]*solid var\(--accent\)/);
  assert.match(widget, /html,\s*body\s*\{[^}]*background: transparent/);
  assert.match(widget, /font-size: calc\(16px \* var\(--widget-scale\)\)/);
});
