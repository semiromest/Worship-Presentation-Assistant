import i18n, { type BackendModule, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// English is the fallback and ships in the startup bundle. The other locales (~120 KB each)
// are split into their own chunks and loaded only when that language is active, so neither
// the control window nor a projector parses five translation tables at launch.
import en from "./locales/en/translation.json";

const lazyLocales: Record<string, () => Promise<{ default: ResourceKey }>> = {
  tr: () => import("./locales/tr/translation.json"),
  es: () => import("./locales/es/translation.json"),
  de: () => import("./locales/de/translation.json"),
  ko: () => import("./locales/ko/translation.json"),
};

export const supportedUiLanguages = ['en', ...Object.keys(lazyLocales)];

const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const load = lazyLocales[language];
    if (!load) {
      callback(null, {}); // unknown language: fall back to English without an error
      return;
    }
    load().then(module => callback(null, module.default), error => callback(error, null));
  },
};

/**
 * Resolves once the active language's strings are in memory. The app entry waits for it
 * before importing the UI, so module-level `i18n.t()` calls (default presentation name…)
 * already see the user's language.
 */
export const i18nReady: Promise<unknown> = i18n
  // Detect user language from localStorage only
  .use(LanguageDetector)
  .use(lazyLocaleBackend)
  // Integrate with React
  .use(initReactI18next)
  // Initialize i18next
  .init({
    resources: { en: { translation: en } },
    // Keep the bundled English and fetch only what is missing through the backend.
    partialBundledLanguages: true,
    // Bundled English is usable synchronously (node unit tests import the store directly).
    initAsync: false,
    fallbackLng: "en",
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      // A language switch suspends nothing: strings swap in once the chunk has loaded.
      useSuspense: false,
    },
  })
  .catch(error => {
    console.error("[i18n] Failed to load translations", error);
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18nextLng', lng);
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language || 'en';

export default i18n;
