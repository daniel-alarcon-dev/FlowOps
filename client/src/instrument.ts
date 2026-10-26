import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

/** True when the Vite DSN is set and Sentry.init has run. */
export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    // Capture every trace in this first setup. Lower this if production volume grows.
    tracesSampleRate: 1.0,
    tracePropagationTargets: [/^\//],
  });
}
