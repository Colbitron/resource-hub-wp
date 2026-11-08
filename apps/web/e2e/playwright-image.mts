/**
 * The Docker image the screenshot tests run Chromium in
 * (`e2e/screenshots.mts`), pinned by digest so every run, on a laptop and
 * in CI, uses the same bytes: a tag can be re-pushed, a digest cannot.
 * CI's background pull reads the same constant (`.depot/workflows/ci.yml`).
 *
 * The image reference is built from the two constants below, so the tag's
 * version and the digest are each written once. The version must equal the
 * installed `playwright-core`'s, whose server runs in the container against
 * the image's browsers; `screenshots.mts` refuses to start otherwise. To move
 * both on purpose, after upgrading `@playwright/test`:
 *
 *   docker buildx imagetools inspect mcr.microsoft.com/playwright:v{version}-noble
 *
 * set PLAYWRIGHT_IMAGE_VERSION to the new version and PLAYWRIGHT_IMAGE_DIGEST
 * to the `Digest` that command prints at the top, the multi-platform index's
 * (`application/vnd.oci.image.index.v1+json`), not one of the per-platform
 * manifests listed under it; then regenerate the baselines
 * (`pnpm web:test:screenshots:update`) and commit all three together. The
 * CMS theme's baselines are drawn in the same image, by the plugin's
 * `tests/e2e/theme-screenshots.spec.js`, whose `@playwright/test` must be
 * the same version: move the plugin's with it and regenerate those too
 * (`pnpm test:e2e -- --update-snapshots`, with `WP_BASE_URL` set to the
 * wp-env tests site).
 * Checked for 1.64.1 on 2026-11-06: that digest is the index of
 * `v1.64.1-noble` (linux/amd64 and linux/arm64), and the installed
 * `playwright-core` has `cli.js` at its root, which the container runs.
 *
 * Plain data in an `.mts` module with no imports, so CI can read it with
 * `node -e` as well as the script importing it.
 */

export const PLAYWRIGHT_IMAGE_VERSION = "1.64.1";

export const PLAYWRIGHT_IMAGE_DIGEST = "sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f";

export const PLAYWRIGHT_IMAGE = `mcr.microsoft.com/playwright:v${PLAYWRIGHT_IMAGE_VERSION}-noble@${PLAYWRIGHT_IMAGE_DIGEST}`;
