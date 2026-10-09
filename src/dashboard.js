import {
  applyClaudeLoginStatus,
  enabledProviders,
  isUserAway,
  missedRefreshCycle,
  providerObservationMs,
  providerKey,
  providerRequestFloor,
  providerRetryDeadlineMs,
  providerRetryDelay,
  resumeGraceDeadline,
  settleProviders,
} from "./quota-polling.js";
import { displayedPercent, usageDisplayLabel, visibleQuotaWindows } from "./widget-model.js";
import { i18n, t, applyLanguage, LANGUAGES } from "./i18n.js";
import { dashboardStatistics } from "./dashboard-model.js";
import { accountProviders, selectedAccountProvider, companionAccountSnapshot, nextAccountLabel } from "./account-model.js";
const { invoke } = window.__TAURI__.core;
const { emitTo, listen } = window.__TAURI__.event;

const QUOTA_PROVIDERS = [
  {
    id: "claude",
    name: "Claude",
    command: "claude_quota",
    setup: "Run Claude Code and sign in once.",
    // Claude's undocumented endpoint is more sensitive than the other sources.
    // Poll conservatively while active; the 429 cooldown itself is owned by the
    // Rust side (claude-rate-limit.json) and arrives as retry_after_seconds.
    pollMs: 360_000,
    pauseWhileAway: true,
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex_quota",
    setup: "Open the Codex app and sign in once.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    command: "antigravity_quota",
    setup: "Sign in to Antigravity IDE or run agy in a terminal, and keep either open while the deck reads its quota.",
  },
  {
    id: "grok",
    name: "Grok",
    command: "grok_quota",
    setup: "Sign in with Grok Build to add Grok.",
  },
  {
    id: "grok_bot",
    name: "Grok Bot",
    mark: "GB",
    command: "grok_bot_quota",
    setup: "Install the Grok Bot desktop app and sign in once.",
  },
];

// Three minutes, matching the sibling Claude tray tool's default. Reading a
// quota costs no quota, so the only cost is request volume against five
// undocumented endpoints — and one of them answers 429 if pushed.
const REFRESH_INTERVAL_MS = 180_000;

// Defensive floor for duplicate lifecycle events or future scheduler changes.
// Regular refreshes and retries share one timer, scheduled at the earliest deadline.
const MIN_REQUEST_INTERVAL_MS = 20_000;

// Per provider, and escalating: a failure that repeats usually needs time, not
// another attempt. One rate-limited provider must never slow the others.
const ERROR_RETRY_DELAYS_MS = [60_000, 120_000, 300_000];

// The reference Claude monitor stops all network traffic after five minutes
// without keyboard/mouse input, and immediately on workstation lock.
const USER_IDLE_THRESHOLD_SECONDS = 5 * 60;

// Let Windows networking and provider apps settle before Claude checks resume.
// This avoids racing Claude Desktop/Code immediately after a long sleep.
const CLAUDE_RESUME_DELAY_MS = 120_000;

// "This account has no such quota" only changes if someone subscribes, so there
// is nothing to gain from asking every three minutes.
const UNAVAILABLE_REFRESH_INTERVAL_MS = 1_800_000;

// A few points of slack before calling a window t("ahead of pace"), so a row does
// not flicker in and out of the warning as the clock ticks.
const PACE_TOLERANCE = 4;

const THEME_KEY = "agent-meter-theme";

const providersEl = document.getElementById("providers");
const providerControlsEl = document.getElementById("provider-controls");
const updatedEl = document.getElementById("updated");
const countdownEl = document.getElementById("countdown");
const widgetModeEl = document.getElementById("widget-mode");
const stripModeEl = document.getElementById("strip-mode");
const themeEl = document.getElementById("theme");
const languageEl = document.getElementById("language-select");
const languageErrorEl = document.getElementById("language-error");
const statisticsEl = document.getElementById("statistics-panel");
const settingsEl = document.getElementById("settings-panel");
const servicesEl = document.getElementById("services-panel");
let dashboardView = "home";
let accountRegistry = { profiles: [], selected: {} };
let accountBusy = false;
let accountError = "";
let accountNotice = "";
for (const { code, name } of LANGUAGES) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = name;
  languageEl.append(option);
}
languageEl.addEventListener("change", async () => {
  if (languageEl.disabled) return;
  languageEl.disabled = true;
  languageErrorEl.hidden = true;
  try {
    applyWidgetPreferences(await invoke("set_language", { language: languageEl.value }));
    render();
  } catch (error) {
    languageEl.value = widgetPreferences.language;
    languageErrorEl.textContent = t("Could not save language: {error}", { error });
    languageErrorEl.hidden = false;
  } finally {
    languageEl.disabled = false;
    languageEl.focus();
  }
});

let widgetPreferences = {
  language: i18n.language,
  visible: false,
  locked: false,
  strip: false,
  hidden_providers: [],
  antigravity_claude_gpt_hidden: false,
  usage_display: "used",
};
let antigravityVisibilityPending = false;
let antigravityVisibilityError = "";

const nowSec = () => Math.floor(Date.now() / 1000);

// ── Theme ───────────────────────────────────────────────────────────────────

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

themeEl.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  void emitTo("widget", "widget-theme-changed", next).catch(() => {});
});

// Follow the system only while the user has expressed no preference of their own.
darkQuery.addEventListener("change", (event) => {
  if (localStorage.getItem(THEME_KEY)) return;
  document.documentElement.dataset.theme = event.matches ? "dark" : "light";
  void emitTo("widget", "widget-theme-changed", document.documentElement.dataset.theme).catch(
    () => {},
  );
});

// ── Companion views ──────────────────────────────────────────────────────────

function applyWidgetPreferences(preferences) {
  widgetPreferences = { ...widgetPreferences, ...preferences };
  applyLanguage(widgetPreferences.language);
  languageEl.value = i18n.language;
  renderRefreshStatus();
  const widgetActive = widgetPreferences.visible && !widgetPreferences.strip;
  const stripActive = widgetPreferences.visible && widgetPreferences.strip;
  widgetModeEl.setAttribute("aria-pressed", widgetActive.toString());
  stripModeEl.setAttribute("aria-pressed", stripActive.toString());
  widgetModeEl.title = widgetActive ? t("Return to dashboard") : t("Show desktop widget");
  stripModeEl.title = stripActive ? t("Return to dashboard") : t("Show strip");
  widgetModeEl.setAttribute("aria-label", widgetModeEl.title);
  stripModeEl.setAttribute("aria-label", stripModeEl.title);
}

async function setDisplayMode(mode, source) {
  try {
    applyWidgetPreferences(await invoke("set_display_mode", { mode }));
  } catch (error) {
    source.title = t("Could not change display mode: {error}", { error });
  }
}

widgetModeEl.addEventListener("click", () => {
  const active = widgetPreferences.visible && !widgetPreferences.strip;
  void setDisplayMode(active ? "dashboard" : "widget", widgetModeEl);
});

stripModeEl.addEventListener("click", () => {
  const active = widgetPreferences.visible && widgetPreferences.strip;
  void setDisplayMode(active ? "dashboard" : "strip", stripModeEl);
});

// ── Formatting ──────────────────────────────────────────────────────────────

const duration = (seconds) => i18n.duration(seconds);

function untilReset(resetsAt) {
  if (!resetsAt) return null;
  const left = resetsAt - nowSec();
  return left <= 0 ? t("Resetting now") : t("Resets in {time}", { time: duration(left) });
}

function ago(unixSeconds) {
  const past = nowSec() - unixSeconds;
  return past < 60 ? t("just now") : t("{time} ago", { time: duration(past) });
}

function updateAge(date) {
  return ago(date.getTime() / 1000);
}

/** The provider's own severity wins where it offers one — it knows what "close
 *  to the limit" means for a given plan better than a threshold guessed here.
 *  The 70/90 fallbacks match the sibling extensions. */
function meterVar(percent, severity) {
  if (severity === "critical" || severity === "severe") return "var(--crit)";
  if (severity === "warning") return "var(--warn)";
  if (severity === "normal") return percent >= 90 ? "var(--crit)" : "var(--ok)";
  if (percent >= 90) return "var(--crit)";
  if (percent >= 70) return "var(--warn)";
  return "var(--ok)";
}

/** How far through the window we are, as a percentage. Needs both a duration
 *  and an end; a row lacking either gets no pace mark. */
function pacePercent(quotaWindow) {
  const { quotaWindowseconds: length, resets_at: end } = quotaWindow;
  if (!length || !end) return null;
  const elapsed = (nowSec() - (end - length)) / length;
  return Math.min(100, Math.max(0, elapsed * 100));
}

// ── Rendering ───────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dashboardIcon(name, className) {
  const icon = el("span", className);
  icon.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  icon.append(svg);
  return icon;
}

function renderWindow(quotaWindow) {
  const percent = displayedPercent(quotaWindow.percent, widgetPreferences.usage_display);
  const pace = pacePercent(quotaWindow);
  const displayedPace =
    pace === null ? null : displayedPercent(pace, widgetPreferences.usage_display);

  const row = el("div", "row");
  const icon = !quotaWindow.quotaWindowseconds ? "window" : quotaWindow.quotaWindowseconds < 86400 ? "session" : "weekly";
  row.append(dashboardIcon(`icon-${icon}`, "row-icon"));
  row.style.setProperty("--meter", meterVar(quotaWindow.percent, quotaWindow.severity));
  row.style.setProperty("--fill", `${percent}%`);

  const head = el("div", "row-head");
  head.append(el("span", "row-label", i18n.quotaLabel(quotaWindow.label)));

  const figure = el("span", "row-figure", `${Math.round(percent)}%`);
  figure.append(el("span", "unit", ` ${t(usageDisplayLabel(widgetPreferences.usage_display))}`));
  head.append(figure);
  row.append(head);

  const track = el("div", "track");
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", Math.round(percent).toString());
  track.setAttribute("aria-label", `${i18n.quotaLabel(quotaWindow.label)} · ${t(usageDisplayLabel(widgetPreferences.usage_display))}`);
  track.append(el("div", "track-fill"));
  if (displayedPace !== null) {
    const mark = el("div", "track-pace");
    mark.style.setProperty("--pace-at", `${displayedPace}%`);
    track.append(mark);
  }
  row.append(track);

  const reset = untilReset(quotaWindow.resets_at);
  if (reset) {
    const note = el("p", "row-note", reset);
    if (pace !== null && quotaWindow.percent > pace + PACE_TOLERANCE) {
      note.append(document.createTextNode(" · "));
      note.append(el("span", "ahead", t("ahead of pace")));
    }
    row.append(note);
  }

  return row;
}

function renderAntigravityVisibilityControl() {
  const hidden = widgetPreferences.antigravity_claude_gpt_hidden;
  const button = el("button", "tool quota-visibility-toggle");
  button.id = "antigravity-visibility-toggle";
  button.type = "button";
  button.title = t(hidden ? "Show Antigravity Claude+GPT quotas in all views" : "Hide Antigravity Claude+GPT quotas in all views");
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", (!hidden).toString());
  button.disabled = antigravityVisibilityPending;
  if (antigravityVisibilityError) button.setAttribute("aria-describedby", "antigravity-visibility-error");

  // Only static SVG markup; no provider data is interpolated into HTML.
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' +
    (hidden ? '<path d="m3 3 18 18"/>' : '') + '</svg>';
  button.append(el("span", null, "Claude+GPT"));
  button.addEventListener("click", () => void setAntigravityClaudeGptHidden(!hidden));
  return button;
}

async function setAntigravityClaudeGptHidden(hidden) {
  if (antigravityVisibilityPending) return;
  const restoreFocus = document.activeElement?.id === "antigravity-visibility-toggle";
  antigravityVisibilityPending = true;
  antigravityVisibilityError = "";
  renderProviderResults();
  try {
    applyWidgetPreferences(await invoke("set_antigravity_claude_gpt_hidden", { hidden }));
  } catch (error) {
    antigravityVisibilityError = t("Could not change Antigravity quota visibility: {error}", { error });
  } finally {
    antigravityVisibilityPending = false;
    // Presentation only: no refresh, fetch or changes to provider scheduling.
    renderProviderResults();
    if (restoreFocus && document.activeElement === document.body) {
      document.getElementById("antigravity-visibility-toggle")?.focus({ preventScroll: true });
    }
  }
}

function renderProvider(provider, quota) {
  const section = el("section", "provider");
  section.dataset.provider = provider.id;
  if (provider.accountId) section.dataset.account = provider.accountId;
  const logo = dashboardIcon(`mark-${provider.id}`, "provider-logo");
  logo.dataset.source = provider.id;
  section.append(logo);

  const head = el("div", "provider-head");
  head.append(el("h2", "provider-name", provider.name));
  if (provider.multipleAccounts || provider.accountLabel) head.append(el("span", "plan account-label", provider.accountLabel || t("Current account")));

  if (quota?.status === "ok" && quota.plan) {
    head.append(el("span", "plan", quota.plan));
  }
  if (quota?.status === "ok" && quota.stale) {
    head.append(el("span", "badge", t("cached")));
  }
  if (provider.id === "antigravity") head.append(renderAntigravityVisibilityControl());
  section.append(head);
  if (provider.id === "antigravity" && antigravityVisibilityError) {
    const error = el("p", "note quota-visibility-error", antigravityVisibilityError);
    error.id = "antigravity-visibility-error";
    error.setAttribute("role", "alert");
    section.append(error);
  }

  if (!quota) {
    section.append(el("p", "note", t("Reading…")));
    return section;
  }

  if (quota.message && i18n.language !== "en" && !i18n.known(quota.message)) {
    const details = el("details", "note technical-details");
    details.append(el("summary", null, t("Technical details")), el("p", null, quota.message));
    section.append(details);
  }

  // Nothing is wrong here — the account just has no quota of this kind. Say it
  // plainly and quietly; most people who install the deck will see at least one.
  if (quota.status === "unavailable") {
    section.append(el("p", "note quiet", i18n.providerMessage(quota)));
    return section;
  }

  // Another application owns this credential and must renew it. Treating this
  // as a transient error would promise retries that cannot possibly help.
  if (quota.status === "action_required" || quota.status === "not_configured") {
    section.append(el("p", "note", i18n.providerMessage(quota)));
    return section;
  }

  if (quota.status === "error") {
    // The Rust side phrases these as something to do, not as a stack trace.
    const note = el("p", "note", i18n.providerMessage(quota));
    // A provider we are deliberately leaving alone is waiting, not broken. Say
    // which, or the card looks stuck.
    const waitMs = getProviderSchedule(providerKey(provider)).backoffUntil - Date.now();
    if (waitMs > 0) {
      note.append(document.createTextNode(` ${t("Retrying in {time}.", { time: duration(Math.ceil(waitMs / 1000)) })}`));
    }
    section.append(note);
    return section;
  }

  const windows = visibleQuotaWindows(provider.id, quota.windows, widgetPreferences);
  const body = el("div", "provider-body");
  const grid = el("div", "quota-grid");
  grid.dataset.count = windows.length.toString();
  for (const quotaWindow of windows) grid.append(renderWindow(quotaWindow));
  body.append(grid);
  section.append(body);
  if (quota.windows.length && !windows.length) {
    section.append(el("p", "note quiet", t("No visible quota windows. Use the eye button to show Claude+GPT.")));
  }

  if (quota.breakdown?.length) {
    body.classList.add("has-breakdown");
    const list = el("ul", "slices");
    for (const slice of quota.breakdown) {
      const item = el("li", null, slice.label);
      const percent = displayedPercent(slice.percent, "used");
      const value = el("span", "slice-value", `${Math.round(percent)}%`);
      value.append(el("span", "unit", ` ${t("used")}`));
      item.append(value);
      const track = el("div", "track");
      track.setAttribute("aria-hidden", "true");
      track.style.setProperty("--fill", `${percent}%`);
      track.style.setProperty("--meter", "var(--ok)");
      track.append(el("div", "track-fill"));
      item.append(track);
      list.append(item);
    }
    body.append(list);
  }

  if (quota.stale) {
    const when = quota.stale.observed_at ? ago(quota.stale.observed_at) : t("unknown age");
    const note = el("p", "note stale", t("From {source} · {time}", { source: t(quota.stale.source), time: when }));
    if (quota.stale.reason) {
      note.append(document.createElement("br"), document.createTextNode(t(quota.stale.reason)));
      const waitMs = getProviderSchedule(providerKey(provider)).backoffUntil - Date.now();
      if (waitMs > 0) {
        note.append(
          document.createTextNode(` ${t("Retrying in {time}.", { time: duration(Math.ceil(waitMs / 1000)) })}`),
        );
      }
    }
    section.append(note);
  }

  return section;
}

function renderEmptyState(checked, allHidden) {
  const section = el("section", "provider-empty");
  if (allHidden) {
    section.append(el("h2", null, t("All providers hidden")));
    section.append(el("p", null, t("Use AI sources above to bring a provider back.")));
    return section;
  }
  section.append(el("h2", null, checked ? t("No providers detected") : t("Checking for providers…")));
  section.append(
    el(
      "p",
      null,
      checked
        ? t("Sign in to Claude Code or Codex, keep Antigravity IDE or agy CLI running, or sign in with Grok Build or Grok Bot.")
        : t("Looking for existing Claude Code, Codex, Antigravity, Grok, and Grok Bot sign-ins."),
    ),
  );
  return section;
}

function renderProviderControls() {
  providerControlsEl.replaceChildren();

  const activeIds = new Set(activeAccountProviders().map(({ id }) => id));
  const displayName = widgetPreferences.usage_display === "remaining" ? t("Remaining") : t("Used");
  const button = el("button", "sources-trigger");
  button.type = "button";
  button.setAttribute("aria-expanded", sourcesExpanded.toString());
  button.setAttribute("aria-controls", "source-picker");
  button.setAttribute(
    "aria-label",
    t("Choose AI sources and quota display. {shown} of {total} shown; values show {mode}.", { shown: activeIds.size, total: QUOTA_PROVIDERS.length, mode: displayName }),
  );

  const orbit = el("span", "source-orbit");
  orbit.setAttribute("aria-hidden", "true");
  for (const provider of QUOTA_PROVIDERS) {
    const dot = el("span", "source-dot");
    dot.dataset.source = provider.id;
    if (!activeIds.has(provider.id)) dot.classList.add("is-hidden");
    orbit.append(dot);
  }

  const copy = el("span", "sources-trigger-copy");
  copy.append(
    el("span", "sources-trigger-label", t("AI sources & display")),
    el(
      "span",
      "sources-trigger-meta",
      t("{shown} of {total} shown · {mode}", { shown: activeIds.size, total: QUOTA_PROVIDERS.length, mode: displayName }),
    ),
  );
  button.append(orbit, copy, el("span", "sources-chevron"));
  button.addEventListener("click", () => {
    sourcesExpanded = !sourcesExpanded;
    render();
    if (sourcesExpanded) {
      document.querySelector(".source-toggle input")?.focus();
    }
  });
  providerControlsEl.append(button);

  if (!sourcesExpanded) return;

  const panel = el("div", "source-picker");
  panel.id = "source-picker";
  const heading = el("div", "source-picker-head");
  heading.append(
    el("strong", null, t("Displayed providers")),
    el("span", null, t("Hidden sources are not polled.")),
  );
  panel.append(heading);

  const list = el("div", "source-list");
  for (const provider of QUOTA_PROVIDERS) {
    const visible = activeIds.has(provider.id);
    const item = el("label", "source-option");
    item.dataset.source = provider.id;
    if (!visible) item.classList.add("is-hidden");

    const mark = el("span", "source-mark", provider.mark ?? provider.name.slice(0, 1));
    mark.dataset.source = provider.id;
    mark.setAttribute("aria-hidden", "true");

    const details = el("span", "source-copy");
    const name = el("span", "source-name", provider.name);
    details.append(name, el("span", "source-status", providerStatus(provider, visible)));

    const toggle = el("span", "source-toggle");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = visible;
    checkbox.dataset.provider = provider.id;
    checkbox.setAttribute("aria-label", t("Show {provider}", { provider: provider.name }));
    checkbox.addEventListener("change", () => {
      void setProviderHidden(provider, !checkbox.checked, checkbox);
    });
    toggle.append(checkbox, el("span", "source-switch"));
    item.append(mark, details, toggle);
    list.append(item);
  }
  panel.append(list);
  panel.append(renderUsageDisplay());
  providerControlsEl.append(panel);
}

function renderUsageDisplay() {
  const row = el("div", "usage-display-option");
  const copy = el("span", "usage-display-copy");
  copy.append(
    el("strong", null, t("Quota values")),
    el("span", null, t("Choose consumed or available allowance.")),
  );

  const choices = el("div", "usage-display-choices");
  choices.setAttribute("role", "radiogroup");
  choices.setAttribute("aria-label", t("Quota value display"));
  for (const [mode, label] of [
    ["used", t("Used")],
    ["remaining", t("Remaining")],
  ]) {
    const choice = el("label", "usage-display-choice");
    const input = el("input");
    input.type = "radio";
    input.name = "usage-display";
    input.value = mode;
    input.checked = widgetPreferences.usage_display === mode;
    input.dataset.usageDisplay = mode;
    input.addEventListener("change", () => {
      if (input.checked) void setUsageDisplay(mode, input);
    });
    choice.append(input, el("span", null, label));
    choices.append(choice);
  }
  row.append(copy, choices);
  return row;
}

async function setUsageDisplay(mode, input) {
  try {
    applyWidgetPreferences(await invoke("set_usage_display", { mode }));
  } catch (error) {
    input.checked = false;
    const current = document.querySelector(
      `[data-usage-display="${widgetPreferences.usage_display}"]`,
    );
    if (current) current.checked = true;
    input.title = t("Could not change quota display: {error}", { error });
    input.focus();
    return;
  }
  render();
  document.querySelector(`[data-usage-display="${mode}"]`)?.focus();
}

// ── Named Claude / Codex accounts ────────────────────────────────────────────

async function changeAccount(command, args = {}, focusId = "account-provider") {
  if (accountBusy) return;
  accountBusy = true;
  accountError = "";
  accountNotice = "";
  renderAccounts(true);
  try {
    if (command === "refresh_accounts") {
      await refreshQuotas();
    } else {
      const registry = await invoke(command, args);
      if (registry?.profiles) accountRegistry = registry;
      if (command === "account_cli") accountNotice = args.login
        ? t("Complete sign-in in the terminal, then check accounts.")
        : t("CLI opened with this account. Existing sessions are unchanged.");
      if (command === "add_account_profile") {
        document.getElementById("account-directory").value = "";
        const unchecked = activeAccountProviders().filter(provider => !quotaResults[providerKey(provider)]);
        const activity = await invoke("system_activity").catch(() => null);
        await settleProviders(unchecked, provider => checkProviderQuota(provider, { userAway: isUserAway(activity, USER_IDLE_THRESHOLD_SECONDS) }), provider => {
          recordQuotaObservation(quotaResults[providerKey(provider)]);
          renderProviderResults();
        });
      }
    }
  } catch (error) {
    accountError = t("Could not change accounts: {error}", { error });
  } finally {
    accountBusy = false;
    render();
    renderAccounts(true);
    scheduleQuotaRefresh();
    document.getElementById(focusId)?.focus({ preventScroll: true });
  }
}

function renderAccounts(force = false) {
  const root = document.getElementById("account-settings");
  if (!force && root.contains(document.activeElement)) return;
  const values = Object.fromEntries(["account-provider", "account-directory"].map(id => [id, document.getElementById(id)?.value ?? ""]));
  const list = el("div", "account-list");
  const groups = new Map();
  for (const profile of accountRegistry.profiles) {
    const provider = QUOTA_PROVIDERS.find(provider => provider.id === profile.provider);
    if (!provider) continue;
    let group = groups.get(provider.id);
    if (!group) {
      group = el("section", "account-group");
      group.dataset.provider = provider.id;
      group.append(el("h3", "account-group-title", provider.name));
      groups.set(provider.id, group);
      list.append(group);
    }
    const label = profile.username || (profile.id === "default" ? t("Current account") : profile.label);
    const row = el("div", "account-row");
    row.dataset.provider = profile.provider;
    row.dataset.account = profile.id;
    const copy = el("div", "account-copy");
    copy.append(el("strong", null, `${provider.name} · ${label}`), el("code", "account-path", profile.config_dir));
    const entry = accountProviders([provider], accountRegistry).find(entry => entry.accountId === profile.id);
    const quota = quotaResults[providerKey(entry)];
    const status = !quota ? t("Reading…") : quota.status === "not_configured" ? t("Not signed in")
      : ["ok", "unavailable"].includes(quota.status) ? t("Connected") : t("Needs attention");
    copy.append(el("span", "account-status", status));
    const actions = el("div", "account-actions");
    const choice = el("label", "account-selection");
    const radio = el("input");
    radio.type = "radio";
    radio.name = `companion-account-${profile.provider}`;
    radio.id = `account-select-${profile.provider}-${profile.id}`;
    radio.checked = (accountRegistry.selected[profile.provider] ?? "default") === profile.id;
    radio.disabled = accountBusy;
    radio.dataset.accountAction = "select";
    radio.setAttribute("aria-label", t("Show {account} in Strip", { account: `${provider.name} · ${label}` }));
    radio.addEventListener("change", () => { if (radio.checked) void changeAccount("select_account_profile", { provider: profile.provider, accountId: profile.id }, radio.id); });
    choice.append(radio, el("span", null, t("Selected for Strip")));
    actions.append(choice);
    for (const [action, text] of [["login", t("Sign in")], ["launch", t("Open CLI")], ...(profile.id !== "default" ? [["remove", t("Remove")]] : [])]) {
      const button = el("button", "action-button", text);
      button.type = "button";
      button.disabled = accountBusy;
      button.id = `account-${action}-${profile.provider}-${profile.id}`;
      button.dataset.accountAction = action;
      button.setAttribute("aria-label", `${text} · ${provider.name} · ${label}`);
      button.addEventListener("click", () => {
        if (action === "remove") {
          if (window.confirm(t("Remove {account}? Its files and running sessions will be kept.", { account: label }))) {
            void changeAccount("remove_account_profile", { provider: profile.provider, accountId: profile.id });
          }
        } else void changeAccount("account_cli", { provider: profile.provider, accountId: profile.id, login: action === "login" }, button.id);
      });
      actions.append(button);
    }
    row.append(copy, actions);
    group.append(row);
  }
  const form = el("form", "account-form");
  form.id = "account-add-form";
  for (const [id, text] of [["account-provider", t("Service")], ["account-directory", t("Existing configuration directory (optional)")]]) {
    const field = el("label", "account-field");
    const input = el(id === "account-provider" ? "select" : "input");
    input.id = id;
    input.disabled = accountBusy;
    if (id === "account-provider") {
      for (const provider of QUOTA_PROVIDERS.filter(provider => ["claude", "codex"].includes(provider.id))) {
        const option = el("option", null, provider.name);
        option.value = provider.id;
        input.append(option);
      }
      input.value = values[id] || "claude";
    } else {
      input.type = "text";
      input.value = values[id];
      input.maxLength = 32767;
      input.spellcheck = false;
      input.autocomplete = "off";
    }
    field.append(el("span", null, text), input);
    form.append(field);
  }
  form.append(el("p", "note", t("Leave the directory empty to create an isolated profile. No credentials are copied.")));
  const submit = el("button", "action-button", t("Add account"));
  submit.type = "submit";
  submit.disabled = accountBusy;
  form.append(submit);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const provider = document.getElementById("account-provider").value;
    void changeAccount("add_account_profile", {
      provider,
      label: nextAccountLabel(accountRegistry.profiles, provider, t),
      configDir: document.getElementById("account-directory").value || null,
    });
  });
  const check = el("button", "action-button", t("Check accounts"));
  check.id = "account-check";
  check.type = "button";
  check.disabled = accountBusy || isQuotaRefreshInProgress;
  check.addEventListener("click", () => { void changeAccount("refresh_accounts", {}, check.id); });
  root.replaceChildren(list, form, check);
  if (accountError || accountNotice) {
    const message = el("p", "note account-message", accountError || accountNotice);
    message.id = "account-message";
    message.setAttribute("role", accountError ? "alert" : "status");
    root.append(message);
  }
}

function providerStatus(provider, visible) {
  if (!visible) return t("Hidden · polling paused");
  const quota = quotaResults[providerKey(selectedAccountProvider(provider, accountRegistry))];
  if (!quota) return t("Checking connection…");
  if (quota.status === "not_configured") return t(provider.setup);
  if (quota.status === "error") return t("Shown · retrying automatically");
  if (quota.status === "action_required") return t("Shown · needs attention");
  if (quota.status === "unavailable") return t("Shown · no quota available");
  return t("Shown on Dashboard, Widget & Strip");
}

async function setProviderHidden(provider, hidden, checkbox) {
  try {
    applyWidgetPreferences(await invoke("set_provider_hidden", { id: provider.id, hidden }));
  } catch (error) {
    checkbox.checked = !hidden;
    checkbox.title = t("Could not change provider visibility: {error}", { error });
    return;
  }
  render();
  document.querySelector(`[data-provider="${provider.id}"]`)?.focus();
  if (hidden) return;

  // Go through checkProviderQuota directly rather than refreshQuotas([provider]): the
  // cycle-level isQuotaRefreshInProgress guard would silently drop a re-tick made while a
  // cycle is running. The provider's own floor and backoff gates still decide
  // whether a request is actually sent.
  const targets = accountProviders([provider], accountRegistry);
  const activity = provider.pauseWhileAway ? await invoke("system_activity").catch(() => null) : null;
  await settleProviders(targets, target => checkProviderQuota(target, { userAway: isUserAway(activity, USER_IDLE_THRESHOLD_SECONDS) }), target => recordQuotaObservation(quotaResults[providerKey(target)]));
  render();
  scheduleQuotaRefresh();
  document.querySelector(`[data-provider="${provider.id}"]`)?.focus();
}

// The providers the user has left ticked. Only these are scheduled or drawn;
// a hidden provider keeps its quota readings and account-local scheduling state untouched.
function activeAccountProviders() {
  return accountProviders(enabledProviders(QUOTA_PROVIDERS, widgetPreferences.hidden_providers), accountRegistry);
}

function allProvidersChecked() {
  return activeAccountProviders().every(provider => quotaResults[providerKey(provider)]);
}

function configuredProviders() {
  return activeAccountProviders().filter(
    provider => provider.multipleAccounts || provider.accountId && provider.accountId !== "default" ||
      quotaResults[providerKey(provider)] && quotaResults[providerKey(provider)].status !== "not_configured",
  );
}

function render() {
  renderDashboardChrome();
  renderProviderResults();
  const usage = document.getElementById("settings-usage");
  usage.replaceChildren(...(dashboardView === "settings" ? [renderUsageDisplay()] : []));
  const active = activeAccountProviders();
  const checked = allProvidersChecked();
  const missing = checked
    ? active.filter(provider => quotaResults[providerKey(provider)].status === "not_configured")
    : [];
  renderProviderControls();
  if (dashboardView === "services") renderAccounts();
}

// Provider calls finish independently. Update cards and the companion as each
// one lands without rebuilding the source picker under a user's keyboard focus.
function renderProviderResults() {
  const restoreVisibilityFocus = document.activeElement?.id === "antigravity-visibility-toggle";
  const active = activeAccountProviders();
  const checked = allProvidersChecked();
  const configured = configuredProviders();

  providersEl.replaceChildren(
    ...(configured.length
      ? configured.map((provider) => renderProvider(provider, quotaResults[providerKey(provider)]))
      : [renderEmptyState(checked, active.length === 0)]),
  );
  if (restoreVisibilityFocus) {
    document.getElementById("antigravity-visibility-toggle")?.focus({ preventScroll: true });
  }
  if (dashboardView === "statistics") renderStatistics();
  publishWidgetSnapshot();
}

function renderDashboardChrome() {
  const titles = { home: "Home", services: "Services", statistics: "Statistics", settings: "Settings" };
  const descriptions = {
    home: "Monitor your AI service usage limits in real time.",
    services: "Manage your AI services and accounts.",
    statistics: "Current quota snapshot. Historical data is not stored.",
    settings: "Customize your dashboard and desktop views.",
  };
  for (const [id, key] of [["page-title", titles[dashboardView]], ["page-description", descriptions[dashboardView]]]) {
    const node = document.getElementById(id);
    node.dataset.i18n = key;
    node.textContent = t(key);
  }
  providersEl.hidden = dashboardView !== "home";
  providerControlsEl.hidden = !["home", "services"].includes(dashboardView);
  statisticsEl.hidden = dashboardView !== "statistics";
  settingsEl.hidden = dashboardView !== "settings";
  servicesEl.hidden = dashboardView !== "services";
  for (const button of document.querySelectorAll("[data-view]")) {
    if (button.dataset.view === dashboardView) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function showDashboardView(view) {
  if (!["home", "services", "statistics", "settings"].includes(view)) return;
  dashboardView = view;
  sourcesExpanded = view === "services";
  render();
  document.querySelector(".deck").scrollTop = 0;
  document.getElementById("page-title").focus({ preventScroll: true });
}

function renderStatistics() {
  const accounts = accountProviders(QUOTA_PROVIDERS, accountRegistry).map(provider => ({
    ...provider, accountLabel: provider.accountLabel || (provider.accountId === "default" ? t("Current account") : null),
  }));
  const { reporting, attention, rows } = dashboardStatistics(accounts, quotaResults, widgetPreferences);
  const summary = el("div", "stat-summary");
  for (const [label, count] of [[t("Services reporting"), reporting], [t("Quota windows"), rows.length], [t("Needs attention"), attention]]) {
    const card = el("div", "stat-card", label);
    card.append(el("strong", null, count.toString()));
    summary.append(card);
  }
  statisticsEl.replaceChildren(summary);
  if (!rows.length) {
    statisticsEl.append(el("p", "provider-empty", t("No quota data available yet.")));
    return;
  }
  const wrapper = el("div", "table-scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", t("Current quotas"));
  const table = el("table", "quota-table");
  table.append(el("caption", null, t("Current quotas")));
  const head = el("thead");
  const heading = el("tr");
  for (const label of [t("Service"), t("Quota window"), t("Used"), t("Remaining"), t("Reset"), t("Status")]) {
    const cell = el("th", null, label);
    cell.scope = "col";
    heading.append(cell);
  }
  head.append(heading);
  table.append(head);
  const body = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    for (const text of [row.provider, i18n.quotaLabel(row.window.label), `${Math.round(row.used)}%`, `${Math.round(row.remaining)}%`, untilReset(row.window.resets_at) ?? "—", row.cached ? t("cached") : t("Available")]) {
      tr.append(el("td", null, text));
    }
    body.append(tr);
  }
  table.append(body);
  wrapper.append(table);
  statisticsEl.append(wrapper);
}

function recordQuotaObservation(result) {
  const observedAt = providerObservationMs(result);
  if (observedAt == null) return;
  if (!lastQuotaObservationAt || observedAt > lastQuotaObservationAt.getTime()) {
    lastQuotaObservationAt = new Date(observedAt);
  }
}

function publishWidgetSnapshot() {
  void emitTo("widget", "quota-snapshot", {
    ...companionAccountSnapshot(QUOTA_PROVIDERS, accountRegistry, quotaResults, providerSchedule),
    updatedAt: lastQuotaObservationAt?.getTime() ?? null,
    theme: document.documentElement.dataset.theme,
  }).catch(() => {});
}

// ── Polling ─────────────────────────────────────────────────────────────────

const quotaResults = {};
const providerSchedule = {};
let isQuotaRefreshInProgress = false;
let lastQuotaObservationAt = null;
let nextRegularRefreshAtMs = null;
let nextScheduledRefreshAtMs = null;
let isClaudeRefreshPaused = false;
let scheduledRefreshTimerId = null;
let sourcesExpanded = false;

document.addEventListener("pointerdown", (event) => {
  if (dashboardView !== "home" || !sourcesExpanded || providerControlsEl.contains(event.target)) return;
  sourcesExpanded = false;
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !sourcesExpanded) return;
  sourcesExpanded = false;
  render();
  document.querySelector(".sources-trigger")?.focus();
});

function getProviderSchedule(accountKey) {
  return (providerSchedule[accountKey] ??= {
    lastAttempt: 0,
    backoffUntil: 0,
    recheckAfter: 0,
    failures: 0,
    retryingRateLimit: false,
  });
}

async function checkProviderQuota(provider, { userAway = false } = {}) {
  const accountKey = providerKey(provider);
  const scheduleState = getProviderSchedule(accountKey);
  if (provider.pauseWhileAway && userAway) return false;

  if (provider.id === "claude") {
    try {
      const loginStatus = await invoke("claude_login_status", { accountId: provider.accountId ?? "default" });
      const loginIssue = applyClaudeLoginStatus(scheduleState, loginStatus);
      if (loginIssue) {
        quotaResults[accountKey] = { status: "action_required", provider: "claude", message: loginIssue };
        return true;
      }
    } catch {
      // A failed metadata read must not release an existing HTTP cooldown.
    }
  }

  const nowMs = Date.now();
  if (nowMs < scheduleState.backoffUntil || nowMs < scheduleState.recheckAfter) return false;
  const requestIntervalMs = providerRequestFloor(provider, scheduleState.retryingRateLimit, MIN_REQUEST_INTERVAL_MS);
  if (nowMs - scheduleState.lastAttempt < requestIntervalMs) return false;
  scheduleState.lastAttempt = nowMs;

  try {
    quotaResults[accountKey] = await invoke(provider.command, provider.accountId ? { accountId: provider.accountId } : {});
  } catch (error) {
    quotaResults[accountKey] = {
      status: "error",
      message: `The deck could not run its ${provider.name} check: ${error}`,
    };
  }

  const quotaResult = quotaResults[accountKey];
  const isRateLimited = Number.isFinite(quotaResult?.retry_after_seconds);
  const retryDelayMs = providerRetryDelay(quotaResult, provider, scheduleState.failures, ERROR_RETRY_DELAYS_MS);
  scheduleState.backoffUntil = 0;
  scheduleState.recheckAfter = 0;
  if (retryDelayMs !== null) {
    scheduleState.backoffUntil = Date.now() + retryDelayMs;
    scheduleState.failures += 1;
    scheduleState.retryingRateLimit = isRateLimited;
  } else {
    if (quotaResult?.status === "unavailable") {
      scheduleState.recheckAfter = Date.now() + UNAVAILABLE_REFRESH_INTERVAL_MS;
    }
    scheduleState.failures = 0;
    scheduleState.retryingRateLimit = false;
  }
  return true;
}

function getProviderRetryDeadlineMs(provider) {
  if (provider.pauseWhileAway && isClaudeRefreshPaused) return null;
  const accountKey = providerKey(provider);
  const quotaResult = quotaResults[accountKey];
  if (quotaResult?.status !== "error" && !Number.isFinite(quotaResult?.retry_after_seconds)) return null;
  return providerRetryDeadlineMs(provider, providerSchedule[accountKey], MIN_REQUEST_INTERVAL_MS);
}

function renderRefreshStatus() {
  if (activeAccountProviders().length === 0) {
    updatedEl.textContent = t("All providers hidden");
    countdownEl.textContent = "";
    return;
  }

  const checked = allProvidersChecked();
  const hasConfiguredProvider = configuredProviders().length > 0;

  if (checked && !hasConfiguredProvider) {
    updatedEl.textContent = t("Waiting for a provider");
    if (isQuotaRefreshInProgress) {
      countdownEl.textContent = t("Checking providers…");
      return;
    }
    if (!nextScheduledRefreshAtMs) {
      countdownEl.textContent = t("Provider check scheduled");
      return;
    }
    const seconds = Math.max(0, Math.ceil((nextScheduledRefreshAtMs - Date.now()) / 1000));
    countdownEl.textContent = t("Checking again in {time}", { time: duration(seconds) });
    return;
  }

  updatedEl.textContent = lastQuotaObservationAt
    ? t("Last updated: {time}", { time: updateAge(lastQuotaObservationAt) })
    : t("Last updated: {time}", { time: "—" });

  if (isQuotaRefreshInProgress) {
    countdownEl.textContent = t("Refreshing…");
    return;
  }
  if (!nextScheduledRefreshAtMs) {
    countdownEl.textContent = t("Refresh scheduled");
    return;
  }
  const seconds = Math.max(0, Math.ceil((nextScheduledRefreshAtMs - Date.now()) / 1000));
  countdownEl.textContent = t("Refresh in {time}", { time: duration(seconds) });
}

async function refreshQuotas(providers = activeAccountProviders()) {
  if (isQuotaRefreshInProgress) return;
  isQuotaRefreshInProgress = true;
  try {
    renderRefreshStatus();
    const checkedAccountKeys = new Set();
    if (providers.some(provider => provider.pauseWhileAway)) {
      const activity = await invoke("system_activity").catch(() => null);
      isClaudeRefreshPaused = isUserAway(activity, USER_IDLE_THRESHOLD_SECONDS);
    }
    await settleProviders(
      providers,
      provider => checkProviderQuota(provider, { userAway: isClaudeRefreshPaused }),
      provider => {
        const accountKey = providerKey(provider);
        checkedAccountKeys.add(accountKey);
        recordQuotaObservation(quotaResults[accountKey]);
        renderProviderResults();
        renderRefreshStatus();
      },
    );

    // Update only checked account names, preserving edits and Strip selection.
    try {
      const registrySnapshot = await invoke("account_profiles");
      for (const profile of registrySnapshot.profiles) {
        const accountKey = profile.id === "default" ? profile.provider : `${profile.provider}:${profile.id}`;
        const currentProfile = accountRegistry.profiles.find(current => current.provider === profile.provider && current.id === profile.id);
        if (currentProfile && checkedAccountKeys.has(accountKey)) currentProfile.username = profile.username;
      }
    } catch { /* Display metadata must not block quota rendering. */ }
    render();
  } finally {
    isQuotaRefreshInProgress = false;
    scheduleQuotaRefresh();
  }
}

function scheduleQuotaRefresh() {
  clearTimeout(scheduledRefreshTimerId);
  if (isQuotaRefreshInProgress) return;
  const nowMs = Date.now();
  nextRegularRefreshAtMs ??= nowMs + REFRESH_INTERVAL_MS;
  const retryDeadlinesMs = activeAccountProviders().map(getProviderRetryDeadlineMs).filter(deadlineMs => deadlineMs !== null);
  nextScheduledRefreshAtMs = Math.min(nextRegularRefreshAtMs, ...retryDeadlinesMs);
  renderRefreshStatus();
  scheduledRefreshTimerId = setTimeout(runScheduledQuotaRefresh, Math.max(0, nextScheduledRefreshAtMs - nowMs));
}

async function runScheduledQuotaRefresh() {
  if (isQuotaRefreshInProgress) return;
  const nowMs = Date.now();
  const isRegularRefreshDue = nextRegularRefreshAtMs !== null && nowMs >= nextRegularRefreshAtMs;
  if (isRegularRefreshDue && missedRefreshCycle(nowMs, nextRegularRefreshAtMs, REFRESH_INTERVAL_MS)) {
    deferClaudeRequestsAfterResume();
  }
  const providersToRefresh = isRegularRefreshDue ? activeAccountProviders() : activeAccountProviders().filter(provider => {
    const retryDeadlineMs = getProviderRetryDeadlineMs(provider);
    return retryDeadlineMs !== null && nowMs >= retryDeadlineMs;
  });
  if (isRegularRefreshDue) nextRegularRefreshAtMs = null;
  try {
    if (isRegularRefreshDue || providersToRefresh.length) await refreshQuotas(providersToRefresh);
  } catch (error) {
    console.error("Scheduled quota refresh failed:", error);
  } finally {
    scheduleQuotaRefresh();
  }
}

for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => showDashboardView(button.dataset.view));
}
function focusLanguage() {
  document.querySelector(".deck").scrollTop = 0;
  languageEl.focus();
}
document.getElementById("language-shortcut").addEventListener("click", focusLanguage);
document.getElementById("settings-language").addEventListener("click", focusLanguage);
document.getElementById("settings-theme").addEventListener("click", () => themeEl.click());

await listen("widget-ready", publishWidgetSnapshot);
await listen("widget-open-accounts", () => showDashboardView("services"));
await listen("widget-preferences-changed", ({ payload }) => {
  applyWidgetPreferences(payload);
  render();
  scheduleQuotaRefresh();
});
applyWidgetPreferences(await invoke("widget_preferences").catch(() => widgetPreferences));
languageEl.disabled = false;
try { accountRegistry = await invoke("account_profiles"); }
catch (error) { accountError = t("Could not change accounts: {error}", { error }); }

render();

// Rust emits this tick outside the WebView. It recovers an overdue global cycle
// when Chromium throttles the hidden dashboard and recovers any due account retry
// without moving the regular refresh deadline.
function handleNativeRefreshTick() {
  if (isQuotaRefreshInProgress) return;
  if (nextScheduledRefreshAtMs !== null && Date.now() >= nextScheduledRefreshAtMs) {
    void runScheduledQuotaRefresh();
    return;
  }
  // Check local Claude login metadata between cycles; native HTTP gates remain authoritative.
  const claudeAccounts = activeAccountProviders().filter(({ id }) => id === "claude");
  if (claudeAccounts.length) void refreshQuotas(claudeAccounts);
}

function deferClaudeRequestsAfterResume() {
  isClaudeRefreshPaused = false;
  for (const provider of activeAccountProviders().filter(({ id }) => id === "claude")) {
    const scheduleState = getProviderSchedule(providerKey(provider));
    scheduleState.recheckAfter = resumeGraceDeadline(Date.now(), scheduleState.recheckAfter, CLAUDE_RESUME_DELAY_MS);
  }
  scheduleQuotaRefresh();
}

await listen("system-activity-resumed", deferClaudeRequestsAfterResume);
await listen("active-refresh-tick", handleNativeRefreshTick);

await refreshQuotas();
setInterval(renderRefreshStatus, 1000);

// Countdowns and backoff timers are relative, so they go stale between polls
// even when the data does not.
setInterval(() => {
  // A render rebuilds the providers panel, so it would take focus off a
  // checkbox someone is on. Relative times can wait for the next tick.
  if (providerControlsEl.contains(document.activeElement) || settingsEl.contains(document.activeElement)) return;
  if (Object.keys(quotaResults).length) render();
}, 30_000);

// Chromium may throttle this WebView while the tray window is hidden. On
// reveal, notice an Antigravity IDE/CLI or Grok Build/Bot sign-in that appeared
// since, and let Claude catch up after an idle or locked stretch.
// Provider floors and backoff still suppress duplicate calls.
function providersToCheckOnReveal() {
  return activeAccountProviders().filter(
    ({ id }) =>
      id === "claude" ||
      id === "antigravity" ||
      id === "grok" ||
      id === "grok_bot",
  );
}

function handleDashboardReveal() {
  if (document.hidden) return;
  if (missedRefreshCycle(Date.now(), nextRegularRefreshAtMs, REFRESH_INTERVAL_MS)) deferClaudeRequestsAfterResume();
  void refreshQuotas(providersToCheckOnReveal());
}

document.addEventListener("visibilitychange", handleDashboardReveal);
window.addEventListener("focus", handleDashboardReveal);
