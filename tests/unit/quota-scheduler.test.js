import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as polling from "../../src/quota-polling.js";

const mainSource = fs.readFileSync(new URL("../../src/dashboard.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const grok = { id: "grok", name: "Grok", command: "grok_quota" };
const codex = { id: "codex", name: "Codex", command: "codex_quota" };
const claude = { id: "claude", name: "Claude", command: "claude_quota", pollMs: 360_000, pauseWhileAway: true };

function createScheduler(providers, responseFor, { renderFailures = 0 } = {}) {
  const startedAtMs = 1_000_000;
  let nowMs = startedAtMs;
  let nextTimerId = 0;
  let activity = { idle_seconds: 0, workstation_locked: false };
  let loginIssue = null;
  const timers = new Map();
  const calls = [];
  const errors = [];
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  const context = {
    ...polling, Date: ClockDate,
    quotaResults: {}, providerSchedule: {}, lastQuotaObservationAt: null,
    isQuotaRefreshInProgress: false, isClaudeRefreshPaused: false,
    nextRegularRefreshAtMs: null, nextScheduledRefreshAtMs: null, scheduledRefreshTimerId: null,
    REFRESH_INTERVAL_MS: 180_000, MIN_REQUEST_INTERVAL_MS: 20_000,
    ERROR_RETRY_DELAYS_MS: [60_000, 120_000, 300_000], UNAVAILABLE_REFRESH_INTERVAL_MS: 1_800_000,
    USER_IDLE_THRESHOLD_SECONDS: 300, CLAUDE_RESUME_DELAY_MS: 120_000,
    hiddenProviders: [], accountRegistry: { profiles: [] },
    activeAccountProviders: () => polling.enabledProviders(providers, context.hiddenProviders),
    render: () => {}, renderRefreshStatus: () => {},
    renderProviderResults: () => { if (renderFailures-- > 0) throw new Error("synthetic render failure"); },
    console: { error: (...args) => errors.push(args) },
    setTimeout: (callback, delayMs) => {
      const timerId = ++nextTimerId;
      timers.set(timerId, { callback, dueAtMs: nowMs + delayMs });
      return timerId;
    },
    clearTimeout: timerId => timers.delete(timerId),
    invoke: async (command, args) => {
      if (command === "system_activity") return activity;
      if (command === "account_profiles") return { profiles: [] };
      if (command === "claude_login_status") return { generation: 1, issue: loginIssue };
      const provider = providers.find(provider => provider.command === command && (!provider.accountId || provider.accountId === args?.accountId));
      assert.ok(provider, command);
      const accountKey = polling.providerKey(provider);
      const attempt = calls.filter(call => call.accountKey === accountKey).length;
      calls.push({ accountKey, elapsedMs: nowMs - startedAtMs });
      return responseFor(provider, attempt) ?? { status: "ok", windows: [], fetched_at: nowMs / 1000 };
    },
  };
  vm.createContext(context);
  function loadSection(startMarker, endMarker) {
    const start = mainSource.indexOf(startMarker);
    const end = mainSource.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, startMarker);
    vm.runInContext(mainSource.slice(start, end), context);
  }
  loadSection("function recordQuotaObservation(", "function publishWidgetSnapshot(");
  loadSection("function getProviderSchedule(", "function renderRefreshStatus(");
  loadSection("async function refreshQuotas(", '\nfor (const button of document.querySelectorAll("[data-view]"))');
  loadSection("function handleNativeRefreshTick(", 'await listen("system-activity-resumed"');
  return {
    context, calls, errors, timers, startedAtMs,
    attempts: accountKey => calls.filter(call => call.accountKey === accountKey).map(call => call.elapsedMs),
    setActivity: value => { activity = value; },
    setLoginIssue: value => { loginIssue = value; },
    jumpWithoutTimers: elapsedMs => { nowMs = startedAtMs + elapsedMs; },
    async advanceTo(elapsedMs) {
      const targetMs = startedAtMs + elapsedMs;
      let executedTimers = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].dueAtMs - b[1].dueAtMs)[0];
        if (!next || next[1].dueAtMs > targetMs) break;
        assert.ok(++executedTimers < 100, "scheduler must not spin on an expired gate");
        nowMs = Math.max(nowMs, next[1].dueAtMs);
        timers.delete(next[0]);
        await next[1].callback();
      }
      nowMs = targetMs;
    },
  };
}

test("real scheduler retries at 60/120/300 seconds without delaying healthy providers or resetting the regular cycle", async () => {
  const scheduler = createScheduler([grok, codex], (provider, attempt) => provider.id === "grok" && attempt < 3 ? { status: "error" } : null);
  await scheduler.context.refreshQuotas();
  await scheduler.advanceTo(480_000);
  assert.deepEqual(scheduler.attempts("grok"), [0, 60_000, 180_000, 480_000]);
  assert.deepEqual(scheduler.attempts("codex"), [0, 180_000, 360_000]);
  assert.equal(scheduler.context.nextRegularRefreshAtMs, scheduler.startedAtMs + 540_000);
  assert.equal(scheduler.context.lastQuotaObservationAt.getTime(), scheduler.startedAtMs + 480_000);
  assert.equal(scheduler.timers.size, 1);
});

test("provider Retry-After is scheduled independently and still respects the duplicate-request floor", async () => {
  const scheduler = createScheduler([grok], (_, attempt) => attempt === 0 ? { status: "error", retry_after_seconds: 45 } : null);
  await scheduler.context.refreshQuotas();
  await scheduler.advanceTo(44_999);
  assert.deepEqual(scheduler.attempts("grok"), [0]);
  await scheduler.advanceTo(45_000);
  assert.deepEqual(scheduler.attempts("grok"), [0, 45_000]);
  assert.equal(polling.providerRetryDeadlineMs(claude, { lastAttempt: 1_000, backoffUntil: 2_000, recheckAfter: 3_000, retryingRateLimit: true }, 20_000), 21_000);
  assert.equal(polling.providerRetryDeadlineMs(claude, { lastAttempt: 1_000, backoffUntil: 2_000, retryingRateLimit: false }, 20_000), 361_000);
});

test("hidden accounts do not retry and overdue independent account retries resume when re-enabled", async () => {
  const profiles = ["work", "personal"].map(accountId => ({ ...codex, key: `codex:${accountId}`, accountId }));
  const scheduler = createScheduler(profiles, (_, attempt) => attempt === 0 ? { status: "error" } : null);
  await scheduler.context.refreshQuotas();
  scheduler.context.hiddenProviders = ["codex"];
  scheduler.context.scheduleQuotaRefresh();
  await scheduler.advanceTo(120_000);
  assert.equal(scheduler.calls.length, 2);
  scheduler.context.hiddenProviders = [];
  scheduler.context.scheduleQuotaRefresh();
  await scheduler.advanceTo(120_000);
  for (const profile of profiles) assert.deepEqual(scheduler.attempts(profile.key), [0, 120_000]);
  assert.equal(scheduler.timers.size, 1);
});

test("locked Claude retries do not spin or block other providers and resume observes the grace period", async () => {
  const scheduler = createScheduler([claude, grok], (_, attempt) => attempt === 0 ? { status: "error", retry_after_seconds: 60 } : null);
  await scheduler.context.refreshQuotas();
  scheduler.setActivity({ idle_seconds: 0, workstation_locked: true });
  await scheduler.advanceTo(60_000);
  assert.deepEqual(scheduler.attempts("claude"), [0]);
  assert.deepEqual(scheduler.attempts("grok"), [0, 60_000]);
  assert.equal(scheduler.timers.size, 1);
  scheduler.setActivity({ idle_seconds: 0, workstation_locked: false });
  scheduler.context.deferClaudeRequestsAfterResume();
  await scheduler.advanceTo(179_999);
  assert.deepEqual(scheduler.attempts("claude"), [0]);
  await scheduler.advanceTo(180_000);
  assert.deepEqual(scheduler.attempts("claude"), [0, 180_000]);
});

test("a required Claude login preserves cooldown without repeatedly scheduling an already-expired retry", async () => {
  const scheduler = createScheduler([claude], () => ({ status: "error", retry_after_seconds: 60 }));
  await scheduler.context.refreshQuotas();
  scheduler.setLoginIssue("Sign in again");
  await scheduler.advanceTo(60_000);
  assert.equal(scheduler.context.quotaResults.claude.status, "action_required");
  assert.equal(scheduler.context.providerSchedule.claude.backoffUntil, scheduler.startedAtMs + 60_000);
  assert.equal(scheduler.context.nextScheduledRefreshAtMs, scheduler.startedAtMs + 180_000);
  assert.deepEqual(scheduler.attempts("claude"), [0]);
});

test("native ticks recover any due provider retry after hidden WebView timers are throttled", async () => {
  const scheduler = createScheduler([grok], (_, attempt) => attempt === 0 ? { status: "error" } : null);
  await scheduler.context.refreshQuotas();
  scheduler.jumpWithoutTimers(90_000);
  scheduler.context.handleNativeRefreshTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(scheduler.attempts("grok"), [0, 90_000]);
  assert.equal(scheduler.context.nextRegularRefreshAtMs, scheduler.startedAtMs + 180_000);
  assert.equal(scheduler.timers.size, 1);
});

test("a failed render releases the refresh guard and leaves the retry timer operational", async () => {
  const scheduler = createScheduler([grok], (_, attempt) => attempt === 0 ? { status: "error" } : null, { renderFailures: 1 });
  await assert.rejects(scheduler.context.refreshQuotas(), /synthetic render failure/);
  assert.equal(scheduler.context.isQuotaRefreshInProgress, false);
  await scheduler.advanceTo(60_000);
  assert.deepEqual(scheduler.attempts("grok"), [0, 60_000]);
  assert.equal(scheduler.timers.size, 1);
});
