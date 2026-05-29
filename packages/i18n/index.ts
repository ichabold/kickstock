import en from './locales/en.json';
import fr from './locales/fr.json';

export { en, fr };

export const supportedLocales = ['en', 'fr'] as const;
export type Locale = (typeof supportedLocales)[number];
export const defaultLocale: Locale = 'en';

export function resolveLocale(raw: string | undefined | null): Locale {
  return supportedLocales.includes(raw as Locale) ? (raw as Locale) : defaultLocale;
}
