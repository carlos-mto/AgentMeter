import assert from "node:assert/strict";
import test from "node:test";
import {
  widgetScalePercent,
  widgetScaleFactor,
  WIDGET_SCALE_MIN,
  WIDGET_SCALE_MAX,
  WIDGET_SCALE_STEP,
} from "../../src/widget-model.js";

test("widget scale accepts 100–300% in 25% steps", () => {
  assert.equal(WIDGET_SCALE_MIN, 100);
  assert.equal(WIDGET_SCALE_MAX, 300);
  assert.equal(WIDGET_SCALE_STEP, 25);
  for (let percent = WIDGET_SCALE_MIN; percent <= WIDGET_SCALE_MAX; percent += WIDGET_SCALE_STEP) {
    assert.equal(widgetScalePercent(percent), percent);
    assert.equal(widgetScaleFactor(percent), percent / 100);
  }
});

test("missing or invalid widget scales fall back to 100%", () => {
  for (const value of [undefined, null, "200", NaN, Infinity, -100, 0, 75, 99, 101, 125.5, 301, 325, 65536]) {
    assert.equal(widgetScalePercent(value), 100);
    assert.equal(widgetScaleFactor(value), 1);
  }
});

test("Strip always stays at its original scale without changing the saved Widget scale", () => {
  for (const percent of [100, 125, 200, 300]) {
    assert.equal(widgetScaleFactor(percent, true), 1);
    assert.equal(widgetScaleFactor(percent, false), percent / 100);
  }
});
