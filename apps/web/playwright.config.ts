import { defineConfig, devices } from "@playwright/test";

// End-to-end specs for the front end live in e2e/ as *.spec.ts. There are none
// yet: the script passes `--pass-with-no-tests` until the first spec lands,
// and the PR that adds it also adds the web server, the environment it needs
// and the CI step.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
