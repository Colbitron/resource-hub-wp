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
 * - `RH_PREVIEW_PATH`, optional: one path of the list, when the script
 *   collects the URLs one at a time so one failure costs one row.
 * - `VERCEL_PROTECTION_BYPASS`: the project's protection bypass secret, sent
 *   as `x-vercel-protection-bypass`. Lighthouse sets extra headers with
 *   `Network.setExtraHTTPHeaders`, so the page's own requests (scripts,
 *   images) carry it too, which the protected preview requires.
 *
 * `blockedUrlPatterns` keeps that header on the preview's origin. Every
 * page on a preview loads Vercel's preview toolbar from `vercel.live`
 * (`/_next-live/feedback/feedback.js`, a 204 for anyone not signed in to
 * the team); it is injected on previews only, production visitors never
 * load it, and with the header on every request it would carry the
 * bypass secret to that origin. Blocking it in Chrome means the request is
 * never made, so the measurement also matches what a production visitor
 * loads. The script's origin check (`e2e/preview-lighthouse.mts`) stays
 * as strict as before: this block is the fix, the check is the safety
 * net for anything else a page might request. The warm-up requests need
 * no block: they are single `fetch` calls for the HTML and load nothing
 * it references.
 */

const base = require("./lighthouserc.cjs");
const { PREVIEW_URLS } = require("./e2e/preview-urls.mts");

const origin = process.env.RH_PREVIEW_ORIGIN;
const bypass = process.env.VERCEL_PROTECTION_BYPASS;
const only = process.env.RH_PREVIEW_PATH;
if (!origin || !bypass) {
  throw new Error("lighthouserc.preview.cjs needs RH_PREVIEW_ORIGIN and VERCEL_PROTECTION_BYPASS in the environment.");
}
const samples = only ? PREVIEW_URLS.filter((sample) => sample.path === only) : PREVIEW_URLS;
if (samples.length === 0) {
  throw new Error(`RH_PREVIEW_PATH is not a path in e2e/preview-urls.mts: ${only}`);
}

module.exports = {
  ci: {
    collect: {
      ...base.ci.collect,
      url: samples.map((sample) => `${origin}${sample.path}`),
      settings: {
        ...base.ci.collect.settings,
        extraHeaders: { "x-vercel-protection-bypass": bypass },
        blockedUrlPatterns: ["https://vercel.live/*"],
      },
    },
  },
};
