import { defineConfig, devices } from "@playwright/test";

import { appServerEnv, appSiteOrigin, mockCmsOrigin, mockCmsPort, webPort } from "./e2e/mock-cms/config.mts";

// A local check under `next dev`, never part of CI: `pnpm web:test:dev`.
//
// The suite in playwright.config.ts runs the production build, where React
// reports no attribute mismatch during hydration, so it cannot show whether
// `suppressHydrationWarning` on <html> is doing its job, nor whether
// development's Strict Mode remount clears the `data-theme` the head script
// set. Development React reports both. This config starts the same mock CMS
// and environment as the main one, but `next dev` instead of a build, on the
// same two ports (RH_WEB_PORT, RH_MOCK_CMS_PORT), and runs `e2e/*.dev.ts`
// alone. `next dev` writes to `.next/dev`, apart from the build in `.next`,
// so a stamped e2e build is left as it was.
//
// Not in CI because a development server's output is not what ships, its
// first compile is slow and variable, and the assertions it adds are pinned
// in the source by `test/hydration-warning.test.ts`. Run it after changing
// the root layout, the head script or the theme control.
const WEB_PORT = webPort();
const MOCK_PORT = mockCmsPort();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.dev.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  outputDir: "./test-results-dev",
  // The first request compiles the route.
  timeout: 120_000,
  use: { baseURL: appSiteOrigin(), trace: "retain-on-failure" },
  projects: [{ name: "chromium-dev", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/mock-cms/main.mts",
      url: `${mockCmsOrigin()}/__mock/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      env: { RH_MOCK_CMS_PORT: String(MOCK_PORT) },
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: appServerEnv(),
    },
  ],
});
