import { defineConfig, devices } from "@playwright/test";

import { mockCmsApiUrl, mockCmsOrigin, mockCmsPort, webPort } from "./e2e/mock-cms/config.mts";

// End-to-end specs for the front end live in e2e/ as *.spec.ts. They run
// against a production build (`next build && next start`) so what they check
// is what ships, with one difference: RH_FIXTURES=1 adds the test-only pages
// under app/fixtures/ to the routes (see pageExtensions in next.config.ts).
//
// Two servers start, in this order: the mock CMS (e2e/mock-cms/, a Node
// server that answers the REST routes the front end reads, serves a few
// uploads, and takes control requests from the specs), then the app, with
// WP_API_URL pointing at the mock. The front end never talks to wp-env or the
// hosted CMS in a test: e2e/README.md has the ports, the env vars and the
// control endpoints. The build makes no CMS request; it only needs WP_API_URL
// for the /media/ rewrite, which here maps to the mock's uploads.
const WEB_PORT = webPort();
const MOCK_PORT = mockCmsPort();
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Node 24 runs the TypeScript entry directly; no build, no loader.
      command: "node e2e/mock-cms/main.mts",
      url: `${mockCmsOrigin()}/__mock/health`,
      reuseExistingServer,
      timeout: 15_000,
      env: { RH_MOCK_CMS_PORT: String(MOCK_PORT) },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer,
      timeout: 180_000,
      env: {
        RH_FIXTURES: "1",
        WP_API_URL: mockCmsApiUrl(),
      },
    },
  ],
});
