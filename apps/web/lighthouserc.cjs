/**
 * Lighthouse CI: the performance and accessibility budgets of the sampled
 * pages, measured in the lab against `next start` and the mock CMS. Run it
 * with `pnpm web:test:lighthouse`, which starts both servers
 * (`e2e/lighthouse.mts`); `lhci` alone expects them running.
 *
 * - The URLs are `e2e/sampled-urls.mts`, the list the axe scan reads too:
 *   every sampled URL except the 404, which Lighthouse refuses to score.
 *   `RH_LIGHTHOUSE_SHARD=i/n` narrows them to one shard of the list
 *   (`e2e/lighthouse-shard.mts`), which is how CI spreads them across
 *   parallel jobs; unset, every URL is measured. `RH_LIGHTHOUSE_URLS`, a
 *   comma-separated list of those paths, narrows them for a local run of
 *   one page, and fails on a path the list does not hold.
 * - Lighthouse's default config is the mobile preset: a Moto G Power-sized
 *   screen and simulated slow 4G with a 4x CPU slowdown. No preset is named,
 *   because LHCI's presets are `desktop`, `perf` and `experimental`.
 * - The CPU slowdown is Lighthouse's fixed 4x. It multiplies the host's own
 *   task times, so TBT here measures the runner as well as the code: on
 *   CI's runners, faster than the reference phone, the gate is gentler
 *   than a calibrated one, and on a laptop far gentler. Calibrating it is
 *   issue #76 (`e2e/README.md`, "Lighthouse CI").
 * - Five runs per URL; every assertion reads the median of the five, which
 *   moves only when three runs do, where the median of three moved with two.
 *   `RH_LIGHTHOUSE_RUNS` changes it for a local run (`pnpm
 *   web:test:lighthouse:quick` makes it one), with the same assertions on
 *   noisier numbers. Both local settings are refused when `CI` is set
 *   (`assertNoLocalOverrides`), so CI always runs and expects five.
 * - Lab numbers only: no field data and nothing sent anywhere. The reports
 *   are written to `lighthouse-results/` (the filesystem target), which CI
 *   uploads as an artifact; the repository is private, so LHCI's temporary
 *   public storage is never used.
 * - Chrome is Playwright's Chromium, the build the specs already install,
 *   so a laptop and CI measure with the same browser.
 */

const { chromium } = require("@playwright/test");

const { assertNoLocalOverrides, onlyPaths, runsPerUrl, shard } = require("./e2e/lighthouse-shard.mts");
const { appSiteOrigin } = require("./e2e/mock-cms/config.mts");
const { SAMPLED_URLS } = require("./e2e/sampled-urls.mts");

const median = { aggregationMethod: "median" };

assertNoLocalOverrides(process.env);

module.exports = {
  ci: {
    collect: {
      url: shard(
        onlyPaths(
          SAMPLED_URLS.filter((sample) => sample.lighthouse),
          process.env.RH_LIGHTHOUSE_URLS,
        ),
        process.env.RH_LIGHTHOUSE_SHARD,
      ).map((sample) => `${appSiteOrigin()}${sample.path}`),
      numberOfRuns: runsPerUrl(process.env.RH_LIGHTHOUSE_RUNS),
      chromePath: chromium.executablePath(),
      settings: {
        // A lab run on localhost; the sandbox flag only matters on CI runners
        // whose kernel refuses Chrome's user namespaces.
        chromeFlags: "--headless=new --no-sandbox",
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
