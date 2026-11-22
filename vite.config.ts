import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Definimos __dirname manualmente para asegurar compatibilidad
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read only PORT. Loading the whole .env would put NODE_ENV and secrets
// into the Vite process and can change the production build mode.
function readApiPort(envPath: string): string {
  const fromProcess = process.env.PORT;
  if (fromProcess && /^\d+$/.test(fromProcess)) return fromProcess;
  if (!fs.existsSync(envPath)) return "5000";

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0 || trimmed.slice(0, eq).trim() !== "PORT") continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (/^\d+$/.test(value)) return value;
  }

  return "5000";
}

// Fallback 5000 must match api/index.ts when PORT is unset.
const apiOrigin = `http://127.0.0.1:${readApiPort(path.resolve(__dirname, ".env"))}`;

export default defineConfig(({ command, mode }) => {
  // Vite's root is `client/`, so it does not load the repo-root .env.
  // Pull only VITE_SENTRY_* so NODE_ENV and server secrets stay out of this process.
  const sentryEnv = loadEnv(mode, __dirname, "VITE_SENTRY_");
  const viteSentryDsn = process.env.VITE_SENTRY_DSN?.trim() || sentryEnv.VITE_SENTRY_DSN?.trim();
  if (viteSentryDsn) {
    process.env.VITE_SENTRY_DSN = viteSentryDsn;
  }

  // Token stays in the build environment. Never read it from a committed file.
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
  const uploadSourceMaps = command === "build" && mode === "production" && Boolean(sentryAuthToken);

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Last, so it sees the finished client bundle. Disabled unless this is a
      // production build with SENTRY_AUTH_TOKEN, so local and CI builds still pass.
      sentryVitePlugin({
        org: "daniel-alarcon-rodriguez",
        project: "flowops",
        authToken: sentryAuthToken,
        url: "https://de.sentry.io",
        disable: !uploadSourceMaps,
        sourcemaps: {
          filesToDeleteAfterUpload: ["./dist/public/**/*.map"],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
      // Hidden maps are uploaded and then deleted. Without a token, emit none.
      sourcemap: uploadSourceMaps ? "hidden" : false,
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: true,
      proxy: {
        "/api": { target: apiOrigin, changeOrigin: true },
        "/uploads": { target: apiOrigin, changeOrigin: true },
      },
    },
  };
});
