import { enabledProviders, providerKey } from "./quota-polling.js";
import { displayedPercent, visibleQuotaWindows } from "./widget-model.js";

// A presentation-only snapshot: no aggregate percentages across unrelated quotas,
// no invented history and no new provider requests.
export function dashboardStatistics(providers, results, preferences) {
  const active = enabledProviders(providers, preferences.hidden_providers);
  const rows = [];
  let reporting = 0;
  let attention = 0;
  for (const provider of active) {
    const quota = results[providerKey(provider)];
    if (!quota) continue;
    if (quota.status === "error" || quota.status === "action_required") attention++;
    if (quota.status !== "ok") continue;
    const windows = visibleQuotaWindows(provider.id, quota.windows ?? [], preferences);
    if (windows.length) reporting++;
    if (windows.some((window) => window.percent >= 90 || ["critical", "severe"].includes(window.severity))) attention++;
    for (const window of windows) {
      rows.push({ provider: provider.multipleAccounts ? `${provider.name} · ${provider.accountLabel}` : provider.name, window, used: displayedPercent(window.percent, "used"), remaining: displayedPercent(window.percent, "remaining"), cached: Boolean(quota.stale) });
    }
  }
  return { reporting, attention, rows };
}
