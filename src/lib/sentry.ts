/**
 * Optional Sentry browser monitoring.
 *
 * Configure VITE_SENTRY_DSN in the hosting environment to enable reporting.
 * Request bodies, user identity, cookies, and headers are deliberately excluded.
 * Session replay is intentionally not enabled to avoid capturing private UI content.
 */
const dsn = (import.meta as any).env?.VITE_SENTRY_DSN?.trim();

if (dsn) {
  // Dynamically load Sentry if DSN is configured
  import('@sentry/react' as any)
    .then((Sentry: any) => {
      Sentry.init({
        dsn,
        integrations: Sentry.browserTracingIntegration ? [Sentry.browserTracingIntegration()] : [],
        tracesSampleRate: 0.1,
        sendDefaultPii: false,
        beforeSend(event: any) {
          if (event.request) {
            delete event.request.data;
            delete event.request.cookies;
            delete event.request.headers;

            if (event.request.url) {
              try {
                const url = new URL(event.request.url);
                url.search = '';
                url.hash = '';
                event.request.url = url.toString();
              } catch {
                // Keep monitoring resilient if a non-standard URL is reported.
              }
            }
          }

          delete event.user;
          if (event.extra) {
            delete event.extra.prompt;
            delete event.extra.messages;
            delete event.extra.body;
            delete event.extra.formData;
          }

          return event;
        },
      });
    })
    .catch(() => {});
}

export {};
