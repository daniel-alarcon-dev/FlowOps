import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
});
