import { expect, test } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { SAMPLED_URLS } from "./sampled-urls.mts";

/**
 * The document-size guard: on every sampled page whose LCP is an image
 * (`imageLed` in `sampled-urls.mts`), the HTML as `next start` sends it, its
 * response headers and its gzipped body as they cross the wire, is at most
 * the 14,600 bytes Lighthouse's simulated connection delivers in its first
 * round trip.
 *
 * Lantern, the simulation behind Lighthouse's lab numbers, opens every
 * connection with a congestion window of ten 1,460-byte segments
 * (`TCPConnection.js` in `@paulirish/trace_engine`) and charges a request its
 * `transferSize`. A document one byte over the window waits a second 150 ms
 * round trip before any script or image it names can start, and the FCP and
 * LCP of an image-led page move by that much at once. With
 * `experimental.inlineCss` every byte of CSS a page imports is in its HTML
 * twice, in `<style>` and in the RSC payload, so one import can cross the
 * line without any other gate noticing: Lighthouse's budget has room for
 * 150 ms, and the screenshots look the same. `apps/web/README.md`, "Images",
 * has the measurements.
 *
 * The size is Chromium's own count, the response's header bytes plus its
 * encoded body bytes (`request.sizes()`), which is what Lighthouse reads as
 * `transferSize`: on 2026-11-07 the two agreed within 3 bytes on every
 * sampled page. Each page is requested until the app answers it from its
 * store, so the measured response is the stored ISR page a reader after the
 * first gets, as Lighthouse measures it (`lighthouse.mts`), and no
 * regeneration is left running. The browser runs no JavaScript: the
 * document is the same, and nothing hydrates to prefetch the page's links
 * and send the CMS requests after the test has ended, into the next spec's
 * counters.
 */

/** Lantern's initial congestion window: ten segments of 1,460 bytes. */
const FIRST_ROUND_TRIP_BYTES = 10 * 1460;

const cms = mockCms();

test.use({ javaScriptEnabled: false });

test.beforeEach(async ({ request }) => {
  await cms.reset();
  // Listings outlive a reset in the app's cache (e2e/README.md); clear them
  // so every page is measured as the seed renders it.
  await clearAppCache(request);
});

for (const { label, path } of SAMPLED_URLS.filter((sample) => sample.imageLed && sample.status === 200)) {
  test(`the ${label}'s HTML (${path}) fits in Lighthouse's first round trip`, async ({ page, request }) => {
    // A cleared page answers once from the stale entry while it renders again; then from the new one.
    await expect
      .poll(
        async () => {
          const warm = await request.get(path);
          expect(warm.status(), path).toBe(200);
          return warm.headers()["x-nextjs-cache"];
        },
        { message: `${path} never answered from the app's store` },
      )
      .toBe("HIT");

    const response = await page.goto(path);
    expect(await response!.headerValue("x-nextjs-cache"), path).toBe("HIT");
    expect(response?.status(), path).toBe(200);
    // Lighthouse's Chromium asks for the same encodings; an uncompressed
    // response would fail below for the wrong reason.
    expect(await response!.headerValue("content-encoding"), `${path} was not sent gzipped`).toBe("gzip");

    const sizes = await response!.request().sizes();
    const transferSize = sizes.responseHeadersSize + sizes.responseBodySize;
    test.info().annotations.push({ type: "transfer size", description: `${transferSize} of ${FIRST_ROUND_TRIP_BYTES} bytes` });
    expect(
      transferSize,
      `${path} sends ${transferSize.toLocaleString("en")} bytes of HTML (${sizes.responseHeadersSize} of headers, ` +
        `${sizes.responseBodySize.toLocaleString("en")} gzipped), over the ${FIRST_ROUND_TRIP_BYTES.toLocaleString("en")} bytes ` +
        "Lighthouse's simulated connection sends in its first round trip, so its FCP and LCP pay a second 150 ms round trip. " +
        'Inlined CSS counts twice; import only the CSS the page renders (apps/web/README.md, "Images").',
    ).toBeLessThanOrEqual(FIRST_ROUND_TRIP_BYTES);
  });
}
