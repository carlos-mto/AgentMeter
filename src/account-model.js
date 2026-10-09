import { providerKey } from "./quota-polling.js";

// Provider ids remain stable for colours/visibility; keys isolate every account.
export function accountProviders(providers, registry = {}) {
  return providers.flatMap(provider => {
    if (!["claude", "codex"].includes(provider.id)) return [provider];
    const profiles = registry.profiles?.filter(profile => profile.provider === provider.id) ?? [];
    if (!profiles.length) return [{ ...provider, accountId: "default" }];
    return profiles.map(profile => ({
      ...provider,
      key: profile.id === "default" ? provider.id : `${provider.id}:${profile.id}`,
      accountId: profile.id,
      accountLabel: profile.username || (profile.id === "default" ? null : profile.label),
      multipleAccounts: profiles.length > 1,
    }));
  });
}

export function selectedAccountProvider(provider, registry) {
  const profiles = accountProviders([provider], registry);
  const selected = registry.selected?.[provider.id] ?? "default";
  return profiles.find(profile => profile.accountId === selected) ?? profiles[0];
}

// The implicit default account is account 1, so generated labels start at 2.
export function nextAccountLabel(profiles, providerId, t) {
  const taken = new Set((profiles ?? []).filter(profile => profile.provider === providerId).map(profile => profile.label));
  let number = 2;
  while (taken.has(t("Account {number}", { number }))) number += 1;
  return t("Account {number}", { number });
}

// Legacy fields keep Strip exactly as before; accounts adds every Widget row.
export function companionAccountSnapshot(providers, registry, results, schedule) {
  const snapshot = { results: {}, backoffUntil: {}, accountLabels: {}, accounts: [] };
  for (const provider of providers) {
    const selected = selectedAccountProvider(provider, registry);
    const key = providerKey(selected);
    if (results[key]) snapshot.results[provider.id] = results[key];
    snapshot.backoffUntil[provider.id] = schedule[key]?.backoffUntil ?? 0;
    if (selected.accountId && selected.accountId !== "default") {
      const profile = registry.profiles?.find(profile => profile.provider === provider.id && profile.id === selected.accountId);
      snapshot.accountLabels[provider.id] = selected.accountLabel ?? profile?.label;
    }
  }
  snapshot.accounts = accountProviders(providers, registry).map(provider => ({
    id: provider.id,
    key: providerKey(provider),
    accountId: provider.accountId,
    accountLabel: provider.accountLabel,
    multipleAccounts: provider.multipleAccounts,
    quota: results[providerKey(provider)],
    backoffUntil: schedule[providerKey(provider)]?.backoffUntil ?? 0,
  }));
  return snapshot;
}

export function widgetAccountProviders(providers, snapshot, strip = false) {
  return providers.flatMap(provider => {
    const accounts = !strip && Array.isArray(snapshot.accounts)
      ? snapshot.accounts.filter(account => account.id === provider.id)
      : [{ quota: snapshot.results?.[provider.id], backoffUntil: snapshot.backoffUntil?.[provider.id] ?? 0,
          accountLabel: snapshot.accountLabels?.[provider.id] }];
    return accounts.map(account => ({ ...provider, ...account }));
  });
}
