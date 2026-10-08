import { defineConfig } from "@playwright/test";

// E2E runs against its own dev server and a throwaway SQLite file, never ./data.
const port = 3123;
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  timeout: 90_000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Shanghai" },
  webServer: {
    command: `rm -rf test-results/e2e-db && next dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/business-models`,
    env: { DATABASE_PATH: "test-results/e2e-db/composer.db" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
