import {
  compactProviderName,
  compactWindowLabel,
  displayedPercent,
  quotaTone,
  usageDisplayLabel,
  visibleProviders,
  WIDGET_PROVIDERS,
  widgetWindows,
  widgetScaleFactor,
  widgetScalePercent,
  WIDGET_SCALE_MIN,
  WIDGET_SCALE_MAX,
  WIDGET_SCALE_STEP,
} from "./widget-model.js";

import { i18n, t, applyLanguage } from "./i18n.js";
import { widgetAccountProviders } from "./account-model.js";

const { invoke } = window.__TAURI__.core;
const { emitTo, listen } = window.__TAURI__.event;

const providersEl = document.getElementById("widget-providers");
const statusEl = document.getElementById("widget-status");
const dragHandleEl = document.getElementById("widget-drag-handle");
const widgetEl = document.querySelector(".widget");
const openDashboardEl = document.getElementById("open-dashboard");
const accountsEl = document.getElementById("widget-accounts");
const taskbarOverlayEl = document.getElementById("taskbar-overlay");
const lockWidgetEl = document.getElementById("lock-widget");
const hideWidgetEl = document.getElementById("hide-widget");
const scaleControlsEl = document.getElementById("widget-scale-controls");
const scaleDownEl = document.getElementById("widget-scale-down");
const scaleUpEl = document.getElementById("widget-scale-up");
const scaleValueEl = document.getElementById("widget-scale-value");
const scaleErrorEl = document.getElementById("widget-scale-error");
let scalePending = false;

let snapshot = { results: {}, backoffUntil: {}, updatedAt: null };
let preferences = {
  language: i18n.language,
  visible: false,
  locked: false,
  strip: false,
  taskbar_overlay: false,
  hidden_providers: [],
  antigravity_claude_gpt_hidden: false,
  usage_display: "used",
  widget_scale: 100,
};
let resizeFrame = null;

const nowSec = () => Math.floor(Date.now() / 1000);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function widgetIcon(name, className = "widget-icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", ["clock", "user"].includes(name) ? "0 0 24 24" : "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#widget-icon-${name}`);
  svg.append(use);
  return svg;
}

const duration = (seconds) => i18n.duration(seconds);

function age(timestampMs) {
  if (!timestampMs) return t("Waiting for data");
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1_000));
  if (seconds < 60) return t("Updated just now");
  return t("Updated {time} ago", { time: duration(seconds) });
}

function staleDetails(providerId, quota, backoffUntil = snapshot.backoffUntil[providerId] ?? 0) {
  if (!quota?.stale) return null;
  const details = [t("Cached data")];
  if (quota.stale.observed_at) {
    details[0] = t("Cached · {time} old", { time: duration(Math.max(0, nowSec() - quota.stale.observed_at)) });
  }
  if (quota.stale.reason) details.push(t(quota.stale.reason));
  const waitMs = backoffUntil - Date.now();
  if (waitMs > 0) details.push(t("Retrying in {time}", { time: duration(Math.ceil(waitMs / 1_000)) }));
  return details.join(" · ");
}

function renderMetric(quotaWindow, providerId) {
  const metric = el("span", `widget-metric ${quotaTone(quotaWindow.percent, quotaWindow.severity)}`);
  const period = compactWindowLabel(quotaWindow, providerId, preferences);
  if (!preferences.strip) metric.dataset.period = period;
  const percent = displayedPercent(quotaWindow.percent, preferences.usage_display);
  const displayLabel = t(usageDisplayLabel(preferences.usage_display));
  const reset = quotaWindow.resets_at
    ? quotaWindow.resets_at > nowSec()
      ? t("Resets in {time}", { time: duration(quotaWindow.resets_at - nowSec()) })
      : t("Resetting now")
    : "";
  metric.title = `${i18n.quotaLabel(quotaWindow.label)}: ${Math.round(percent)}% ${displayLabel}${reset ? ` · ${reset}` : ""}`;
  const reading = preferences.strip ? metric : el("span", "metric-reading");
  reading.append(
    el("span", "metric-period", t(period)),
    el("span", "metric-value", `${Math.round(percent)}%`),
  );
  if (!preferences.strip) {
    metric.style.setProperty("--quota-angle", `${percent * 3.6}deg`);
    metric.style.setProperty("--quota-fill", `${percent}%`);
    reading.children[0].prepend(widgetIcon("clock"));
    const ring = el("span", "quota-ring");
    ring.setAttribute("aria-hidden", "true");
    reading.append(ring);
    const bar = el("span", "quota-bar");
    bar.setAttribute("aria-hidden", "true");
    bar.append(el("span", "quota-bar-fill"));
    reading.append(bar);
    metric.append(reading);
    if (reset) {
      const caption = el("span", "metric-reset", reset);
      caption.prepend(widgetIcon("clock"));
      metric.append(caption);
    }
  }
  return metric;
}

function renderProvider(provider, quota) {
  const row = el("section", `widget-provider${quota?.stale ? " cached" : ""}`);
  row.dataset.provider = provider.id;
  if (provider.accountId) row.dataset.account = provider.accountId;
  const identity = el("div", "provider-identity");
  // Preserve Strip's original DOM/layout; only Widget gets a second name line.
  const heading = preferences.strip ? identity : el("div", "provider-heading");
  const name = el("span", "provider-name", compactProviderName(provider, preferences.strip));
  const accountLabel = provider.accountLabel || (provider.multipleAccounts ? t("Current account") : null);
  name.title = [provider.name, accountLabel, quota?.plan].filter(Boolean).join(" · ");
  heading.append(name);
  if (!preferences.strip) {
    const mark = el("span", "provider-mark");
    mark.append(widgetIcon(provider.id));
    const details = el("div", "identity-details");
    details.append(heading);
    identity.append(mark, details);
    if (accountLabel) {
      const account = el("span", "account-name", accountLabel.toLocaleLowerCase());
      account.title = accountLabel;
      const accountLine = el("div", "account-line");
      accountLine.append(widgetIcon("user"), account);
      details.append(accountLine);
    }
  }

  const stale = staleDetails(provider.id, quota, provider.backoffUntil);
  if (stale) {
    const cached = el("span", "cached-label", t("cached"));
    cached.title = stale;
    heading.append(cached);
    row.title = stale;
  }
  row.append(identity);

  const metrics = el("div", "widget-metrics");
  metrics.append(...widgetWindows(provider.id, quota.windows, preferences)
    .map((quotaWindow) => renderMetric(quotaWindow, provider.id)));
  row.append(metrics);
  return row;
}

function scheduleResize() {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    const width = preferences.strip ? stripContentWidth() : widgetContentWidth();
    const height = preferences.strip
      ? 40
      : Math.ceil(widgetEl.getBoundingClientRect().height + verticalExtras(document.body));
    void invoke("resize_widget", { width, height }).catch(() => {});
  });
}

function number(value) {
  return Number.parseFloat(value) || 0;
}

function horizontalExtras(node) {
  const style = getComputedStyle(node);
  return (
    number(style.paddingLeft) +
    number(style.paddingRight) +
    number(style.borderLeftWidth) +
    number(style.borderRightWidth)
  );
}

function verticalExtras(node) {
  const style = getComputedStyle(node);
  return number(style.paddingTop) + number(style.paddingBottom) +
    number(style.borderTopWidth) + number(style.borderBottomWidth);
}

function visibleChildrenWidth(node) {
  const children = [...node.children].filter(
    (child) => getComputedStyle(child).display !== "none",
  );
  const style = getComputedStyle(node);
  const gap = number(style.columnGap || style.gap);
  return children.reduce((total, child) => {
    const childStyle = getComputedStyle(child);
    return (
      total +
      Math.max(child.scrollWidth, child.getBoundingClientRect().width) +
      number(childStyle.marginLeft) +
      number(childStyle.marginRight)
    );
  }, Math.max(0, children.length - 1) * gap);
}

function metricsWidth(metrics) {
  const metricsStyle = getComputedStyle(metrics);
  const metricsNodes = [...metrics.children];
  const gap = number(metricsStyle.columnGap || metricsStyle.gap);
  if (!preferences.strip) {
    // Reserve both shared tracks, even when a row only reports its 7d quota.
    return 2 * Math.max(0, ...metricsNodes.map(metric =>
      Math.max(metric.scrollWidth, metric.getBoundingClientRect().width))) + gap;
  }
  return metricsNodes.reduce(
    (total, metric) =>
      total +
      (preferences.strip && metric.children.length
        ? visibleChildrenWidth(metric)
        : Math.max(metric.scrollWidth, metric.getBoundingClientRect().width)),
    Math.max(0, metricsNodes.length - 1) * gap,
  );
}

function widgetContentWidth() {
  // The approved reference canvas scales with the existing 100–300% controls.
  return Math.ceil(number(getComputedStyle(widgetEl).minWidth) + horizontalExtras(document.body));
}

function stripContentWidth() {
  const providerWidth = [...providersEl.querySelectorAll(".widget-provider")].reduce(
    (total, row) => {
      const style = getComputedStyle(row);
      return (
        total +
        horizontalExtras(row) +
        visibleChildrenWidth(row.querySelector(".provider-identity")) +
        number(style.columnGap) +
        metricsWidth(row.querySelector(".widget-metrics"))
      );
    },
    0,
  );
  const controlsWidth = horizontalExtras(dragHandleEl) + visibleChildrenWidth(dragHandleEl);
  return Math.ceil(
    providerWidth +
      controlsWidth +
      horizontalExtras(widgetEl) +
      horizontalExtras(document.body),
  );
}

function render() {
  const rows = widgetAccountProviders(WIDGET_PROVIDERS, snapshot, preferences.strip);
  const configured = rows.filter(provider => visibleProviders(
    [provider], { [provider.id]: provider.quota }, preferences.hidden_providers, preferences,
  ).length);
  const allHidden = WIDGET_PROVIDERS.every(({ id }) => preferences.hidden_providers.includes(id));
  providersEl.replaceChildren(
    ...(configured.length
      ? configured.map((provider) => renderProvider(provider, provider.quota))
      : [el("p", "widget-empty", t(allHidden ? "All providers hidden" : "Waiting for data"))]),
  );
  statusEl.textContent = age(snapshot.updatedAt);
  statusEl.title = statusEl.textContent;
  statusEl.dataset.ready = Boolean(snapshot.updatedAt).toString();
  scheduleResize();
}

function applyPreferences(next) {
  preferences = { ...preferences, ...next };
  applyLanguage(preferences.language);
  preferences.widget_scale = widgetScalePercent(preferences.widget_scale);
  document.documentElement.style.setProperty(
    "--widget-scale", widgetScaleFactor(preferences.widget_scale, preferences.strip).toString(),
  );
  updateScaleControls();
  document.documentElement.dataset.locked = preferences.locked.toString();
  document.documentElement.dataset.mode = preferences.strip ? "strip" : "widget";
  document.documentElement.dataset.taskbarOverlay = preferences.taskbar_overlay.toString();
  widgetEl.setAttribute(
    "aria-label",
    t(preferences.strip ? "AgentMeter Strip" : "AgentMeter Widget"),
  );
  lockWidgetEl.title = t(preferences.locked ? "Unlock widget position" : "Lock widget position");
  lockWidgetEl.setAttribute(
    "aria-label",
    t(preferences.locked ? "Unlock widget position" : "Lock widget position"),
  );
  taskbarOverlayEl.title = t(preferences.taskbar_overlay
    ? "Stop keeping the strip above the taskbar"
    : "Keep strip above the taskbar");
  taskbarOverlayEl.setAttribute("aria-label", taskbarOverlayEl.title);
  taskbarOverlayEl.setAttribute("aria-pressed", preferences.taskbar_overlay.toString());
  hideWidgetEl.title = t(preferences.strip ? "Hide strip" : "Hide widget");
  hideWidgetEl.setAttribute("aria-label", hideWidgetEl.title);
  render();
}

function updateScaleControls() {
  const percent = preferences.widget_scale;
  scaleValueEl.textContent = `${percent}%`;
  scaleDownEl.disabled = scalePending || percent <= WIDGET_SCALE_MIN;
  scaleUpEl.disabled = scalePending || percent >= WIDGET_SCALE_MAX;
}

async function changeWidgetScale(delta) {
  if (scalePending || preferences.strip) return;
  const percent = Math.min(WIDGET_SCALE_MAX, Math.max(WIDGET_SCALE_MIN, preferences.widget_scale + delta));
  if (percent === preferences.widget_scale) return;
  scalePending = true;
  scaleErrorEl.hidden = true;
  updateScaleControls();
  try {
    applyPreferences(await invoke("set_widget_scale", { percent }));
  } catch (error) {
    scaleErrorEl.textContent = t("Could not save widget size: {error}", { error });
    scaleErrorEl.hidden = false;
    scheduleResize();
  } finally {
    scalePending = false;
    updateScaleControls();
  }
}

scaleDownEl.addEventListener("click", () => void changeWidgetScale(-WIDGET_SCALE_STEP));
scaleUpEl.addEventListener("click", () => void changeWidgetScale(WIDGET_SCALE_STEP));

widgetEl.addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    (!preferences.strip && preferences.locked) ||
    (!preferences.strip && !event.target.closest(".widget-head")) ||
    event.target.closest("button")
  )
    return;
  event.preventDefault();
  void invoke("start_widget_drag").catch(() => {});
});

widgetEl.addEventListener("dblclick", (event) => {
  if (event.target.closest("button")) return;
  // Strip uses its explicit dashboard button. Treating a quick drag/click as a
  // double-click could otherwise switch modes and make the strip appear to
  // vanish. Widget keeps the convenient header shortcut.
  if (preferences.strip || !event.target.closest(".widget-head")) return;
  void invoke("open_dashboard");
});

openDashboardEl.addEventListener("click", () => void invoke("open_dashboard"));
accountsEl.addEventListener("click", () => {
  void invoke("open_dashboard").then(() => emitTo("main", "widget-open-accounts", {}));
});
hideWidgetEl.addEventListener("click", () => void invoke("hide_companion"));
lockWidgetEl.addEventListener("click", () => {
  void invoke("set_widget_locked", { locked: !preferences.locked });
});

taskbarOverlayEl.addEventListener("click", () => {
  void invoke("set_taskbar_overlay", { enabled: !preferences.taskbar_overlay })
    .then(applyPreferences)
    .catch((error) => {
      taskbarOverlayEl.title = t("Could not change taskbar overlay: {error}", { error });
    });
});

await listen("quota-snapshot", ({ payload }) => {
  snapshot = payload;
  if (payload.theme) document.documentElement.dataset.theme = payload.theme;
  render();
});
await listen("widget-theme-changed", ({ payload }) => {
  document.documentElement.dataset.theme = payload;
});
await listen("widget-preferences-changed", ({ payload }) => applyPreferences(payload));

applyPreferences(await invoke("widget_preferences").catch(() => preferences));
render();
await emitTo("main", "widget-ready").catch(() => {});
setInterval(() => {
  statusEl.textContent = age(snapshot.updatedAt);
  statusEl.title = statusEl.textContent;
  if (Object.keys(snapshot.results).length) render();
}, 30_000);
