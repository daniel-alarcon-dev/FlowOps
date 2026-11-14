import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(root, "shared"),
    },
  },
  test: {
    environment: "node",
    globalSetup: "./api/test/global-setup.ts",
    setupFiles: ["./api/test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    include: ["api/**/*.test.ts"],
  },
});
