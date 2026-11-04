import { messages } from './strings.mjs';

let language = navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
try { const saved = localStorage.getItem('wpa-site-language'); if (saved === 'tr' || saved === 'en') language = saved; } catch { /* Storage may be unavailable in private browsers. */ }
const listeners = new Set();
export const getLanguage = () => language;
export const t = key => messages[language][key] ?? messages.en[key] ?? key;
export const onLanguageChange = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function translatePage() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nLabel)); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-language]').forEach(button => {
    button.textContent = language === 'en' ? 'TR' : 'EN';
    button.setAttribute('aria-label', language === 'en' ? 'Türkçeye geç' : 'Switch to English');
  });
}
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  language = language === 'en' ? 'tr' : 'en';
  try { localStorage.setItem('wpa-site-language', language); } catch { /* Switching language still works without storage. */ }
  translatePage(); listeners.forEach(listener => listener(language));
}));
translatePage();
