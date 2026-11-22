import { sentryEnabled } from "./instrument";
import { createRoot, type RootOptions } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

const rootOptions: RootOptions | undefined = sentryEnabled
  ? {
      onUncaughtError: Sentry.reactErrorHandler(),
      onCaughtError: Sentry.reactErrorHandler(),
      onRecoverableError: Sentry.reactErrorHandler(),
    }
  : undefined;

createRoot(document.getElementById("root")!, rootOptions).render(<App />);
