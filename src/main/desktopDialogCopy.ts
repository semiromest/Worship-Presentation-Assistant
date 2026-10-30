import en from '../renderer/locales/en/translation.json';
import tr from '../renderer/locales/tr/translation.json';
import de from '../renderer/locales/de/translation.json';
import es from '../renderer/locales/es/translation.json';
import ko from '../renderer/locales/ko/translation.json';

const copies = { en, tr, de, es, ko };
export function replacementDialogCopy(language: string) {
  const locale = language.toLowerCase().split(/[-_]/)[0];
  return (copies[locale as keyof typeof copies] ?? en).desktop.replaceChoice;
}

export function systemMessageCopy(language: string) {
  const locale = language.toLowerCase().split(/[-_]/)[0];
  return (copies[locale as keyof typeof copies] ?? en).desktop.systemMessages;
}
