/**
 * The Docker image the screenshot tests run Chromium in
 * (`e2e/screenshots.mts`), pinned by digest so every run, on a laptop and
 * in CI, uses the same bytes: a tag can be re-pushed, a digest cannot.
 * CI's background pull reads the same constant (`.github/workflows/ci.yml`).
 *
 * The version must equal the installed `playwright-core`'s, whose server
 * runs in the container against the image's browsers; `screenshots.mts`
 * refuses to start otherwise. To move it on purpose, after upgrading
 * `@playwright/test`:
 *
 *   docker buildx imagetools inspect mcr.microsoft.com/playwright:v{version}-noble
 *
 * and copy the index's `Digest` (the multi-platform one at the top, not a
 * per-platform manifest's) and the version here, then regenerate the
 * baselines (`pnpm web:test:screenshots:update`) and commit them together.
 *
 * Plain data in an `.mts` module with no imports, so CI can read it with
 * `node -e` as well as the script importing it.
 */

export const PLAYWRIGHT_IMAGE_VERSION = "1.64.1";

export const PLAYWRIGHT_IMAGE =
  "mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f";
