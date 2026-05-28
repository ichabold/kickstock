import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Capture 100% of transactions in dev, 20% in prod (adjust for volume)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Replay captures user sessions around errors — useful for debugging UX bugs
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],

  // Don't send errors from local dev unless DSN is set
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
