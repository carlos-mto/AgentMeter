export const LANGUAGES = Object.freeze([
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "pt", name: "Português" },
  { code: "it", name: "Italiano" },
  { code: "de", name: "Deutsch" },
]);

export function resolveLanguage(value) {
  for (const candidate of Array.isArray(value) ? value : [value]) {
    const code = typeof candidate === "string" ? candidate.toLowerCase().split(/[-_]/)[0] : "";
    if (LANGUAGES.some((language) => language.code === code)) return code;
  }
  return "en";
}

export function createI18n(catalogs, initialLanguage = "en") {
  let language = resolveLanguage(initialLanguage);
  function t(key, values = {}) {
    const own = (catalog) => catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined;
    const message = own(catalogs[language]) ?? own(catalogs.en) ?? key;
    return String(message).replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder);
  }
  return {
    get language() { return language; },
    setLanguage(value) { language = resolveLanguage(value); },
    t,
    known: (key) => Object.hasOwn(catalogs.en ?? {}, key),
    providerMessage(quota) {
      if (language === "en" || Object.hasOwn(catalogs.en ?? {}, quota.message)) return t(quota.message ?? "");
      const status = { unavailable: "Quota unavailable", action_required: "Action required", error: "Could not read quota" };
      return t(status[quota.status] ?? "Waiting for data");
    },
    // Localize presentation only. Pool matching and quota math use raw labels.
    quotaLabel: (label) => label.split("·").map((part) => t(part.trim())).join(" · "),
    duration(seconds) {
      seconds = Math.max(0, Math.floor(seconds));
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (days) return t("{days}d {hours}h", { days, hours });
      if (hours) return t("{hours}h {minutes}m", { hours, minutes });
      if (minutes) return t("{minutes}m", { minutes });
      return t("{seconds}s", { seconds });
    },
  };
}

export function translateDocument(document, i18n) {
  document.documentElement.lang = i18n.language;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = i18n.t(node.dataset.i18n);
  }
  for (const [data, attribute] of [["i18nTitle", "title"], ["i18nAria", "aria-label"]]) {
    const selector = data === "i18nTitle" ? "[data-i18n-title]" : "[data-i18n-aria]";
    for (const node of document.querySelectorAll(selector)) node.setAttribute(attribute, i18n.t(node.dataset[data]));
  }
}
