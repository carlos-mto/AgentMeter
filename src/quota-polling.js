export const providerKey = provider => provider.key ?? provider.id;

// Only a changed, valid local credential generation releases HTTP scheduling.
export function applyClaudeLoginStatus(state, login) {
  // Remember an initially unsigned profile, so its first valid login counts as
  // a credential change. A failed read must not erase a known valid generation.
  if (state.credentialGeneration == null && login.generation === 0) {
    state.credentialGeneration = 0;
  }
  if (login.generation > 0) {
    if (state.credentialGeneration != null && state.credentialGeneration !== login.generation) {
      state.lastAttempt = 0;
      state.backoffUntil = 0;
      state.recheckAfter = 0;
      state.failures = 0;
      state.retryingRateLimit = false;
    }
    state.credentialGeneration = login.generation;
  }
  return login.issue || null;
}

export function isUserAway(activity, idlePauseSeconds) {
  return Boolean(
    activity?.workstation_locked || activity?.idle_seconds >= idlePauseSeconds,
  );
}

export function resumeGraceDeadline(now, currentDeadline, graceMs) {
  return Math.max(currentDeadline ?? 0, now + graceMs);
}

export function missedRefreshCycle(now, scheduledAt, cycleMs) {
  return Boolean(scheduledAt && now - scheduledAt >= cycleMs);
}

// A provider the user unticked leaves the schedule entirely: no card, no
// request. Ids the hide-list names but this build does not know are ignored.
export function enabledProviders(providers, hiddenProviders = []) {
  return providers.filter(({ id }) => !hiddenProviders.includes(id));
}

// A backend-provided 429 deadline replaces the healthy polling cadence for
// that retry. Rust has already guaranteed that the deadline is no earlier than
// Claude's healthy floor. The small global gap still protects duplicate window
// lifecycle events firing the same command together.

export function providerRequestFloor(provider, isRateLimitRetry, minimumRequestIntervalMs) {
  return isRateLimitRetry
    ? minimumRequestIntervalMs
    : Math.max(minimumRequestIntervalMs, provider.pollMs ?? 0);
}

export function providerRetryDelay(quotaResult, provider, failureCount, retryDelaysMs) {
  const retryAfterSeconds = quotaResult?.retry_after_seconds;
  const isRateLimited = Number.isFinite(retryAfterSeconds);
  if (quotaResult?.status !== "error" && !isRateLimited) return null;
  if (isRateLimited) return Math.max(retryAfterSeconds, 0) * 1000;
  return Math.max(retryDelaysMs[Math.min(failureCount, retryDelaysMs.length - 1)], provider.pollMs ?? 0);
}

// A retry becomes due only after every account-local gate allows another request.
export function providerRetryDeadlineMs(provider, scheduleState, minimumRequestIntervalMs) {
  if (!scheduleState?.backoffUntil) return null;
  return Math.max(
    scheduleState.backoffUntil,
    scheduleState.recheckAfter ?? 0,
    (scheduleState.lastAttempt ?? 0) + providerRequestFloor(provider, scheduleState.retryingRateLimit, minimumRequestIntervalMs),
  );
}

// "Last updated" means the newest usable provider observation, not the time a
// failed request happened. Cached rows retain the provider's original age.
export function providerObservationMs(result) {
  if (result?.status !== "ok" && result?.status !== "unavailable") return null;
  const seconds = result?.stale ? result.stale.observed_at : result?.fetched_at;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : null;
}

export async function settleProviders(providers, checkProvider, onProviderSettled) {
  await Promise.all(providers.map(async provider => {
    const wasAttempted = await checkProvider(provider);
    if (wasAttempted) onProviderSettled(provider);
    return wasAttempted;
  }));
}
