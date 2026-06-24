import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translation files
import tr from "./locales/tr/translation.json";
import en from "./locales/en/translation.json";
import es from "./locales/es/translation.json";
import de from "./locales/de/translation.json";
import ko from "./locales/ko/translation.json";

i18n
  // Detect user language from localStorage only
  .use(LanguageDetector)
  // Integrate with React
  .use(initReactI18next)
  // Initialize i18next
  .init({
    resources: {
      tr: { translation: tr },
      en: { translation: en },
      es: { translation: es },
      de: { translation: de },
      ko: { translation: ko },
    },
    fallbackLng: "en",
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18nextLng', lng);
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language || 'en';

export default i18n;
