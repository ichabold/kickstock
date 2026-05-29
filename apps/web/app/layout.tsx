import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { resolveLocale } from '@kickstock/i18n';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'KickStock — FIFA World Cup 2026',
  description: 'Trade national teams like stocks during the FIFA World Cup 2026',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
};

async function getLocaleMessages(locale: string) {
  if (locale === 'fr') {
    return (await import('@kickstock/i18n/locales/fr.json')).default;
  }
  return (await import('@kickstock/i18n/locales/en.json')).default;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value);
  const messages = await getLocaleMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
