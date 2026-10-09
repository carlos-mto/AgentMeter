import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = file => fs.readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
test("Neon reference is Widget-scoped, uses real proportional gauges and leaves shared themes/Strip untouched", () => {
  const css = read("widget-neon.css");
  assert.match(css, /min-width: 39\.75rem/);
  assert.match(css, /--neon-cyan: #26d3f3/);
  assert.match(css, /conic-gradient\(var\(--neon-meter\) var\(--quota-angle\)/);
  assert.match(css, /width: var\(--quota-fill\)/);
  assert.match(css, /data-period="7d"[^}]*\.quota-bar\s*\{ display: none/);
  assert.doesNotMatch(css, /data-mode="strip"|--ok:|--title:|--widget-surface:/);
  const js = read("widget.js");
  assert.match(js, /percent \* 3\.6/);
  assert.match(js, /widget-open-accounts/);
  assert.match(read("dashboard.js"), /listen\("widget-open-accounts", \(\) => showDashboardView\("services"\)\)/);
  assert.match(read("widget.html"), /id="widget-accounts"[^>]*aria-label="Accounts"/);
});
