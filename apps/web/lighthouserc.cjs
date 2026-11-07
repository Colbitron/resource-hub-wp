/**
 * Lighthouse CI: the performance and accessibility budgets of the sampled
 * pages, measured in the lab against `next start` and the mock CMS. Run it
 * with `pnpm web:test:lighthouse`, which starts both servers
 * (`e2e/lighthouse.mts`); `lhci` alone expects them running.
 *
 * - The URLs are `e2e/sampled-urls.mts`, the list the axe scan reads too:
 *   every sampled URL except the 404, which Lighthouse refuses to score.
 * - Lighthouse's default config is the mobile preset: a Moto G Power-sized
 *   screen and simulated slow 4G. No preset is named, because LHCI's presets
 *   are `desktop`, `perf` and `experimental`.
 * - The CPU slowdown is calibrated to the host rather than Lighthouse's
 *   constant 4x: `lighthouse.mts` measures the host's raw main-thread time
 *   on a frozen copy of the built `/` (`e2e/calibration-page/`) before the
 *   runs and passes the multiplier in `RH_LH_CPU_SLOWDOWN`
 *   (`e2e/cpu-calibration.mts` has the method, its evidence and its bounds).
 *   Unset, as when `lhci collect` runs alone, Lighthouse's 4x applies and the
 *   TBT is the runner's, not the code's.
 * - Five runs per URL; every assertion reads the median of the five, which
 *   moves only when three runs do, where the median of three moved with two.
 * - Lab numbers only: no field data and nothing sent anywhere. The reports
 *   are written to `lighthouse-results/` (the filesystem target), which CI
 *   uploads as an artifact; the repository is private, so LHCI's temporary
 *   public storage is never used.
 * - Chrome is Playwright's Chromium, the build the specs already install,
 *   so a laptop and CI measure with the same browser.
 */

const { chromium } = require("@playwright/test");

const { appSiteOrigin } = require("./e2e/mock-cms/config.mts");
const { SAMPLED_URLS } = require("./e2e/sampled-urls.mts");
const { slowdownFromEnv } = require("./e2e/cpu-calibration.mts");

const cpuSlowdownMultiplier = slowdownFromEnv(process.env);

const median = { aggregationMethod: "median" };

module.exports = {
  ci: {
    collect: {
      url: SAMPLED_URLS.filter((sample) => sample.lighthouse).map((sample) => `${appSiteOrigin()}${sample.path}`),
      numberOfRuns: 5,
      chromePath: chromium.executablePath(),
      settings: {
        // A lab run on localhost; the sandbox flag only matters on CI runners
        // whose kernel refuses Chrome's user namespaces.
        chromeFlags: "--headless=new --no-sandbox",
        // Lighthouse merges this into the mobile preset's throttling, so the
        // network figures stay its slow 4G.
        ...(cpuSlowdownMultiplier === undefined ? {} : { throttling: { cpuSlowdownMultiplier } }),
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { ...median, minScore: 0.95 }],
        "categories:accessibility": ["error", { ...median, minScore: 1 }],
        "largest-contentful-paint": ["error", { ...median, maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { ...median, maxNumericValue: 0.05 }],
        "total-blocking-time": ["error", { ...median, maxNumericValue: 200 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./lighthouse-results",
    },
  },
};
