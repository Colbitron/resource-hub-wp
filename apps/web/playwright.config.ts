import { defineConfig, devices } from "@playwright/test";

import {
  appServerEnv,
  appSiteOrigin,
  mockCmsOrigin,
  mockCmsPort,
  prebuilt,
  webPort,
} from "./e2e/mock-cms/config.mts";

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

// Reusing servers already listening on the two ports is opt-in, never in CI:
// a silently reused server may be another checkout's build or mock, or one
// started with different settings, and the run would test that instead.
// RH_E2E_REUSE=1 opts in while iterating on a spec; harness.spec.ts then
// checks that the mock answering is this checkout's (`/__mock/health`).
const reuseExistingServer = process.env.RH_E2E_REUSE === "1" && !process.env.CI;

// The screenshot project exists only when a browser server is given: the
// specimen's baselines come from Chromium in Playwright's official Linux
// Docker image, never from the host's browser, whose fonts render
// differently. `e2e/screenshots.mts` (`pnpm web:test:screenshots`) starts
// that container, sets RH_PW_REMOTE_WS to its endpoint and runs this project
// alone; the test runner, the mock and the app stay on the host, and the
// container's browser reaches the app's `localhost` through the connection
// (`exposeNetwork`).
const remoteBrowser = process.env.RH_PW_REMOTE_WS;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One worker, files in order: every spec shares the one mock CMS process
  // and its data, and `/__mock/reset` in one worker would undo another's
  // setup mid-test. The app's fetch cache is shared too, and no reset clears
  // it; it starts empty on each run (e2e/README.md). Parallel workers would
  // need a mock per worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // The same origin as SITE_URL below (`appSiteOrigin`).
    baseURL: appSiteOrigin(),
    trace: "retain-on-failure",
  },
  // Screenshots live beside the specs, one directory per spec file, with no
  // platform suffix: there is one platform, the Docker image's.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  // CI never writes a baseline; a missing one fails. Baselines are written
  // only by `pnpm web:test:screenshots:update`.
  updateSnapshots: process.env.CI ? "none" : "missing",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(remoteBrowser
      ? [
          {
            name: "screenshots",
            testMatch: "**/*.screenshot.ts",
            // threshold 0: any change in a pixel's colour counts that pixel as
            // different. The default 0.2 let the accent move from #1f4f8f to
            // #2a5a9a unnoticed, which is the kind of change this gate exists
            // to show. maxDiffPixelRatio 0.001: up to one pixel in a thousand
            // may differ before the shot fails. Baselines are rendered under
            // amd64 emulation on Apple silicon and compared on CI's native
            // amd64, where anti-aliasing at a glyph's or a curve's edge can
            // land a pixel apart; a token or component change moves far more
            // than that (an accent change fails every shot in the light
            // scheme, measured when this was set).
            // Under QEMU emulation one full-page shot of the specimen takes a few
            // seconds, and toHaveScreenshot needs two; the default 5 s is too short.
            expect: { toHaveScreenshot: { timeout: 30_000, threshold: 0, maxDiffPixelRatio: 0.001 } },
            use: {
              ...devices["Desktop Chrome"],
              reducedMotion: "reduce" as const,
              // No zygote: Chromium's renderers crash without it when the amd64
              // image runs under QEMU on an Apple-silicon laptop. The flag only
              // changes how renderer processes start, not how they paint, and it
              // is set everywhere, CI included, so every baseline is taken the
              // same way.
              launchOptions: { args: ["--no-zygote"] },
              connectOptions: { wsEndpoint: remoteBrowser, exposeNetwork: "<loopback>" },
            },
          },
        ]
      : []),
  ],
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
      // The fetch Data Cache is deleted between the build and the start, so no
      // entry outlives the process whose revalidated tags it would need
      // (e2e/clear-fetch-cache.mts, e2e/README.md). RH_E2E_PREBUILT=1 skips
      // the build and starts the one already in .next (config.mts, `prebuilt`).
      command: `${prebuilt() ? "" : "pnpm exec next build && "}node e2e/clear-fetch-cache.mts && pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer,
      timeout: 180_000,
      // RH_FIXTURES=1, the mock as WP_API_URL, the test secret and SITE_URL.
      env: appServerEnv(),
    },
  ],
});
