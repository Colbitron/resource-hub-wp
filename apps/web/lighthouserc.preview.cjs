/**
 * Lighthouse CI on a pull request's Vercel preview: the blocking gate's
 * collect settings (`lighthouserc.cjs`: Lighthouse's mobile preset at its
 * fixed 4x CPU slowdown, five runs per URL, Playwright's Chromium) on the
 * preview's URLs (`e2e/preview-urls.mts`), with the deployment-protection
 * bypass header on every request Lighthouse makes. `e2e/preview-lighthouse.mts`
 * runs it; `lhci collect --config=./lighthouserc.preview.cjs` by hand needs
 * the same two variables.
 *
 * The settings are read from the gate's config, not copied, so the two
 * cannot drift and a preview's numbers are comparable to the gate's. No
 * `assert` block: the run never blocks a merge. No `upload` block: the raw
 * reports carry the header (`configSettings.extraHeaders`), so the script
 * writes its own redacted copies instead of LHCI's filesystem target.
 *
 * - `RH_PREVIEW_ORIGIN`: the preview's origin, `https://…vercel.app`.
 * - `VERCEL_PROTECTION_BYPASS`: the project's protection bypass secret, sent
 *   as `x-vercel-protection-bypass`. Lighthouse sets extra headers with
 *   `Network.setExtraHTTPHeaders`, so the page's own requests (scripts,
 *   images) carry it too, which the protected preview requires.
 */

const base = require("./lighthouserc.cjs");
const { PREVIEW_URLS } = require("./e2e/preview-urls.mts");

const origin = process.env.RH_PREVIEW_ORIGIN;
const bypass = process.env.VERCEL_PROTECTION_BYPASS;
if (!origin || !bypass) {
  throw new Error("lighthouserc.preview.cjs needs RH_PREVIEW_ORIGIN and VERCEL_PROTECTION_BYPASS in the environment.");
}

module.exports = {
  ci: {
    collect: {
      ...base.ci.collect,
      url: PREVIEW_URLS.map((sample) => `${origin}${sample.path}`),
      settings: {
        ...base.ci.collect.settings,
        extraHeaders: { "x-vercel-protection-bypass": bypass },
      },
    },
  },
};
