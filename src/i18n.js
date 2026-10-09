import { createI18n, translateDocument, LANGUAGES } from "./i18n-core.js";
export { LANGUAGES };

// Both webviews and the native tray use this same bundled catalogue.
const catalogs = await fetch(new URL("./locales.json", import.meta.url))
  .then((response) => { if (!response.ok) throw new Error("Missing locale catalog"); return response.json(); })
  .catch(() => ({ en: {} }));
export const i18n = createI18n(catalogs, navigator.languages);
export const t = i18n.t;
export function applyLanguage(language) {
  i18n.setLanguage(language);
  translateDocument(document, i18n);
}
