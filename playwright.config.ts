import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { PASSCODE } from "./e2e/fixtures";

const PORT = 3300;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, headless: true },
  // CI runs `npm run web:build` first; this only serves what's built.
  webServer: {
    command: "npx tsx src/server.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      MISE_LLM: "mock",
      MISE_RESTAURANT: "ruki",
      MISE_TODAY: "2026-12-04",
      DATA_DIR: mkdtempSync(join(tmpdir(), "mise-e2e-")),
      MISE_OWNER_PASSCODE: PASSCODE,
      ANTHROPIC_API_KEY: "",
      CRM_WEBHOOK_URL: "",
      CRM_WEBHOOK_SECRET: "",
      ADMIN_TOKEN: "",
    },
  },
  projects: [
    {
      name: "smoke",
      testMatch: "smoke.e2e.ts",
      retries: process.env.CI ? 1 : 0,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, trace: "retain-on-failure" },
    },
    {
      name: "demo",
      testMatch: "demo.e2e.ts",
      outputDir: "demo/raw",
      timeout: 240_000,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        colorScheme: "dark",
      },
    },
  ],
});
