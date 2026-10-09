export const WIDGET_PROVIDERS = [
  { id: "claude", name: "Claude", stripName: "CL" },
  { id: "codex", name: "Codex", stripName: "CO" },
  { id: "antigravity", name: "Antigravity", stripName: "AG" },
  { id: "grok", name: "Grok", stripName: "GR" },
  { id: "grok_bot", name: "Grok Bot", stripName: "GB" },
];

export const WIDGET_SCALE_MIN = 100;
export const WIDGET_SCALE_MAX = 300;
export const WIDGET_SCALE_STEP = 25;

export function widgetScalePercent(value) {
  return Number.isInteger(value) && value >= WIDGET_SCALE_MIN &&
    value <= WIDGET_SCALE_MAX && value % WIDGET_SCALE_STEP === 0
    ? value : WIDGET_SCALE_MIN;
}

export function widgetScaleFactor(percent, strip = false) {
  return strip ? 1 : widgetScalePercent(percent) / 100;
}

export function compactProviderName(provider, strip) {
  return strip ? provider.stripName : provider.name;
}

// The snapshot still carries results for hidden providers (their schedule and
// cached rows survive a hide), so the companion filters by preference itself.
export function visibleProviders(providers, results, hiddenProviders = [], preferences = null) {
  return providers.filter(({ id }) => {
    const quota = results[id];
    if (hiddenProviders.includes(id) || !quota) return false;
    // Widget and Strip only show usable readings.
    if (preferences) {
      return quota.status === "ok" && widgetWindows(id, quota.windows ?? [], preferences)
        .some(quotaWindow => Number.isFinite(quotaWindow.percent));
    }
    return quota.status !== "not_configured";
  });
}

export function isSevenDayWindow(quotaWindow) {
  return quotaWindow.quotaWindowseconds === 7 * 24 * 60 * 60 || /^weekly\b/i.test(quotaWindow.label);
}

function quotaScope(quotaWindow) {
  return quotaWindow.label.split("·")[1]?.trim() ?? "";
}

export function visibleQuotaWindows(providerId, windows = [], preferences = {}) {
  if (providerId !== "antigravity" || !preferences.antigravity_claude_gpt_hidden) return windows;
  return windows.filter((quotaWindow) => !/^claude\s*\+\s*gpt$/i.test(quotaScope(quotaWindow)));
}

export function compactWindowLabel(quotaWindow, providerId, preferences = {}) {
  const scopedLabel = quotaScope(quotaWindow);
  const periodOnly = providerId === "antigravity" &&
    preferences.antigravity_claude_gpt_hidden && /^gemini$/i.test(scopedLabel);
  if (scopedLabel && !periodOnly) return scopedLabel;

  const seconds = quotaWindow.quotaWindowseconds;
  if (seconds === 5 * 60 * 60 || /^session\b/i.test(quotaWindow.label)) return "5h";
  if (seconds === 24 * 60 * 60 || /^daily\b/i.test(quotaWindow.label)) return "1d";
  if (isSevenDayWindow(quotaWindow)) return "7d";
  if (seconds === 30 * 24 * 60 * 60 || /^monthly\b/i.test(quotaWindow.label)) return "30d";
  return quotaWindow.label.length > 8 ? `${quotaWindow.label.slice(0, 7)}…` : quotaWindow.label;
}

// Grok shows its single seven-day pool; Grok Bot already reports one weekly
// pool. Antigravity normally shows each pool's weekly bucket. Hiding its
// Claude+GPT pool instead shows Gemini's session then weekly quota (5h / 7d).
export function widgetWindows(providerId, windows = [], preferences = {}) {
  if (providerId === "grok") {
    const weekly = windows.filter(isSevenDayWindow);
    return weekly.length ? weekly.slice(0, 1) : windows;
  }
  if (providerId === "grok_bot") {
    const weekly = windows.filter(isSevenDayWindow);
    return weekly.length ? weekly.slice(0, 1) : windows.slice(0, 1);
  }
  if (providerId === "antigravity") {
    if (!preferences.antigravity_claude_gpt_hidden) return windows.filter(isSevenDayWindow);
    const gemini = visibleQuotaWindows(providerId, windows, preferences)
      .filter((quotaWindow) => /^gemini$/i.test(quotaScope(quotaWindow)));
    const session = gemini.filter((quotaWindow) =>
      quotaWindow.quotaWindowseconds === 5 * 60 * 60 || /^session\b/i.test(quotaWindow.label));
    return [...session, ...gemini.filter(isSevenDayWindow)];
  }
  return windows;
}

export function quotaTone(percent, severity) {
  if (severity === "critical" || severity === "severe") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "normal") return percent >= 90 ? "critical" : "ok";
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warning";
  return "ok";
}

export function displayedPercent(usedPercent, mode = "used") {
  const used = Math.min(100, Math.max(0, usedPercent));
  return mode === "remaining" ? 100 - used : used;
}

export function usageDisplayLabel(mode = "used") {
  return mode === "remaining" ? "left" : "used";
}
