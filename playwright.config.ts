import { defineConfig } from "@playwright/test";

// E2E runs against its own dev server and a throwaway SQLite file, never ./data.
// AI features run offline (rule-based) unless E2E_LLM_PROVIDER names a configured provider, e.g. deepseek.
const port = 3123;
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  timeout: 300_000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Shanghai" },
  webServer: {
    // E2E_SERVER=build runs a production build instead, for when your own `next dev` is already running
    // (Next allows one dev server per project directory).
    command: `rm -rf test-results/e2e-db && ${process.env.E2E_SERVER === "build" ? `next build && next start --hostname 127.0.0.1 --port ${port}` : `next dev --hostname 127.0.0.1 --port ${port}`}`,
    url: `http://127.0.0.1:${port}/business-models`,
    env: { DATABASE_PATH: "test-results/e2e-db/composer.db", LLM_PROVIDER: process.env.E2E_LLM_PROVIDER ?? "mock" },
    reuseExistingServer: false,
    timeout: 400_000,
  },
});
