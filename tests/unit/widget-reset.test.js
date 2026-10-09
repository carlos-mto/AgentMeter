import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { compactWindowLabel, displayedPercent, quotaTone, usageDisplayLabel } from "../../src/widget-model.js";

const source = fs.readFileSync(new URL("../../src/widget.js", import.meta.url), "utf8");
function node(tag) {
  return { tag, dataset: {}, children: [], attrs: {},
    style: { values: {}, setProperty(key, value) { this.values[key] = value; } },
    append(...nodes) { this.children.push(...nodes); }, prepend(...nodes) { this.children.unshift(...nodes); },
    setAttribute(key, value) { this.attrs[key] = value; },
  };
}
function renderer(strip = false) {
  let now = 1700000000;
  const context = { preferences: { strip, usage_display: "remaining" }, compactWindowLabel, displayedPercent, quotaTone, usageDisplayLabel,
    nowSec: () => now, i18n: { quotaLabel: label => label, duration: seconds => `${seconds}s` },
    t: (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => params[name]),
    document: { createElement: tag => node(tag), createElementNS: (_, tag) => node(tag) },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function el("), source.indexOf("function scheduleResize(")), context);
  return { context, advance: seconds => { now += seconds; } };
}

test("Widget renders localized reset subtitles below each real quota, with live countdown and safe missing-time handling", () => {
  const { context, advance } = renderer();
  for (const [label, window_seconds, period] of [["Session", 18000, "5h"], ["Weekly", 604800, "7d"]]) {
    const window = { label, window_seconds, percent: 0, resets_at: 1700003600 };
    const metric = context.renderMetric(window, "codex");
    assert.equal(metric.dataset.period, period, "weekly-only rows retain the 7d column identity");
    assert.equal(metric.children[0].className, "metric-reading");
    assert.equal(metric.children[0].children[0].textContent, period);
    assert.equal(metric.children[0].children[1].textContent, "100%");
    assert.equal(metric.children[1].className, "metric-reset");
    assert.equal(metric.children[1].textContent, "Resets in 3600s");
    assert.ok(metric.title.endsWith(" · Resets in 3600s"));
    assert.equal(metric.style.values["--quota-angle"], "360deg");
    assert.equal(metric.style.values["--quota-fill"], "100%");
    assert.deepEqual(Array.from(metric.children[0].children, child => child.className), ["metric-period", "metric-value", "quota-ring", "quota-bar"]);
  }
  const window = { label: "Weekly", percent: 83, resets_at: 1700003600 };
  advance(60);
  const remaining = context.renderMetric(window, "codex");
  assert.equal(remaining.children[1].textContent, "Resets in 3540s");
  assert.equal(remaining.style.values["--quota-fill"], "17%");
  context.preferences.usage_display = "used";
  assert.equal(context.renderMetric(window, "codex").style.values["--quota-fill"], "83%");
  context.preferences.usage_display = "remaining";
  advance(3540);
  assert.equal(context.renderMetric(window, "codex").children[1].textContent, "Resetting now");
  assert.equal(context.renderMetric({ ...window, resets_at: null }, "codex").children.length, 1);
});

test("Strip keeps original inline metric DOM and reset tooltip only", () => {
  const { context } = renderer(true);
  const metric = context.renderMetric({ label: "Weekly", percent: 83, resets_at: 1700003600 }, "codex");
  assert.equal(metric.dataset.period, undefined, "Strip never uses Widget's column placement");
  assert.deepEqual(Array.from(metric.children, node => node.className), ["metric-period", "metric-value"]);
  assert.ok(metric.title.includes("Resets in 3600s"));
});
