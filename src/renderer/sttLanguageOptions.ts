import { STT_LANGUAGES } from '../shared/stt';

export interface LanguageOption {
  code: string;
  /** Name in the interface language (e.g. "Türkçe" → "Turkish" for an English UI). */
  label: string;
  /** English catalogue name, shown as a hint when it differs from the label. */
  english: string;
  /** The language's own name (e.g. "Deutsch"), helps people find their language. */
  native: string;
}

/** Languages most churches ask for first; the UI language is always put in front. */
const COMMON_CODES = ['en', 'tr', 'es', 'de', 'ko', 'ar', 'fa', 'ru', 'fr', 'zh', 'pt'];

function displayName(code: string, locale: string): string | null {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

function capitalize(value: string, locale: string): string {
  return value ? value.charAt(0).toLocaleUpperCase(locale) + value.slice(1) : value;
}

const cache = new Map<string, LanguageOption[]>();

/** Every STT language with localized and native names, sorted for the UI locale. */
export function languageOptions(uiLocale: string): LanguageOption[] {
  const locale = uiLocale || 'en';
  const cached = cache.get(locale);
  if (cached) return cached;
  const options = STT_LANGUAGES.map(({ code, name }) => ({
    code,
    label: capitalize(displayName(code, locale) ?? name, locale),
    english: name,
    native: capitalize(displayName(code, code) ?? name, code),
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
  cache.set(locale, options);
  return options;
}

export function languageLabel(code: string, uiLocale: string): string {
  return languageOptions(uiLocale).find(option => option.code === code)?.label ?? code;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en');
}

/** Matches the localized, English and native names and the code; prefix matches rank first. */
export function searchLanguages(options: readonly LanguageOption[], query: string): LanguageOption[] {
  const q = fold(query.trim());
  if (!q) return [...options];
  const scored: { option: LanguageOption; score: number }[] = [];
  for (const option of options) {
    const names = [option.label, option.english, option.native].map(fold);
    if (option.code === q) scored.push({ option, score: 0 });
    else if (names.some(name => name.startsWith(q))) scored.push({ option, score: 1 });
    else if (names.some(name => name.includes(q))) scored.push({ option, score: 2 });
  }
  return scored.sort((a, b) => a.score - b.score).map(entry => entry.option);
}

/** Short "suggested" list: UI language first, then common choices that exist in the catalogue. */
export function suggestedLanguageCodes(uiLocale: string, exclude: readonly string[] = []): string[] {
  const ui = (uiLocale || 'en').split('-')[0].toLowerCase();
  const known = new Set(STT_LANGUAGES.map(language => language.code));
  const skip = new Set(exclude);
  return [...new Set([ui, ...COMMON_CODES])].filter(code => known.has(code) && !skip.has(code)).slice(0, 6);
}
