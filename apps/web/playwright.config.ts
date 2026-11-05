import { defineConfig, devices } from "@playwright/test";

// End-to-end specs for the front end live in e2e/ as *.spec.ts. They run
// against a production build (`next build && next start`) so what they check
// is what ships, with one difference: RH_FIXTURES=1 adds the test-only pages
// under app/fixtures/ to the routes (see pageExtensions in next.config.ts).
// WP_API_URL is a placeholder the build needs for the /media/ rewrite; nothing
// is fetched from it, and the specs abort image requests themselves.
const PORT = 3310;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      RH_FIXTURES: "1",
      WP_API_URL: process.env.WP_API_URL ?? "https://cms.example/wp-json",
    },
  },
});
