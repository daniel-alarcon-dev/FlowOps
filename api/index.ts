import "dotenv/config";
import * as Sentry from "@sentry/node";
import { createApp } from "./app";
import { bootstrapSystemAdmin } from "./bootstrap";
import { serveStatic } from "./static";

// Express errors and traces are captured by the default expressIntegration.
// That integration needs the diagnostics-channel hook installed before Express
// loads, which `npm run dev` / `npm start` do via `--import @sentry/node/import`.
// setupExpressErrorHandler is deprecated in @sentry/node 11; do not add it back.
const sentryDsn = process.env.SENTRY_DSN?.trim();
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || "development",
    // SDK 11 removed this flag from the option types. The spread keeps it on the
    // init object. dataCollection is what the SDK actually enforces.
    ...{ sendDefaultPii: false },
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // Capture every trace in this first setup. Lower this if production volume grows.
    tracesSampleRate: 1.0,
  });
}

async function main(): Promise<void> {
  const app = await createApp();

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  }

  await bootstrapSystemAdmin();

  // Render sets PORT. Locally it comes from .env, otherwise 5000.
  // The Vite dev server listens on 5173 and proxies to this same port.
  const PORT = process.env.PORT || 5000;

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`✅ Servidor escuchando en el puerto ${PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
