import { connect } from "node:net";
import { constants, gunzipSync } from "node:zlib";

import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { clearAppCache } from "./app-cache.mts";
import { mockCms } from "./mock-cms/client.mts";
import { SAMPLED_URLS } from "./sampled-urls.mts";

/**
 * The document-size guards: two checks of the HTML `next start` sends for
 * the sampled pages whose LCP is an image (`imageLed` in `sampled-urls.mts`),
 * both against the 14,600 bytes, ten 1,460-byte segments, that a new
 * connection's first round trip carries in Lighthouse's simulation, Lantern
 * (`TCPConnection.js` in `@paulirish/trace_engine`).
 *
 * **The whole-document check** (every image-led page the owner has not
 * exempted): the response's header bytes plus its gzipped body bytes,
 * Chromium's own count (`request.sizes()`), which is what Lighthouse reads
 * as `transferSize`, is at most 14,600. It guards the lab number. Lantern
 * starts the requests a document initiates only once the whole document has
 * downloaded (`lantern/simulation/Simulator.js`, where a node starts only
 * when every dependency has finished, and `graph/PageDependencyGraph.js`,
 * which makes each request depend on its initiator, the document), so a
 * document one byte over the window waits a second 150 ms round trip before
 * any script or image it names can start, and the simulated FCP and LCP of
 * an image-led page move by that much at once. With `experimental.inlineCss`
 * every byte of CSS a page imports is in its HTML twice, in `<style>` and in
 * the RSC payload, so one import can cross the line. Lighthouse's budget has
 * room for 150 ms and the screenshots look the same, so on these pages
 * nothing else notices. `apps/web/README.md`, "Images", has the measurements.
 *
 * **Exempting a page from it** (`wholeDocumentGuard: false`) is an owner
 * decision, not a loosened threshold. By the owner's decision of 2026-11-07
 * (issue #85), a page may be exempt only when its size is the cost of
 * content that is wanted on it, never to make room for CSS or markup the
 * page does not need; a page that fails for that reason is a finding to fix.
 * The cost is stated, not hidden: an exempt page may pay one simulated round
 * trip on FCP and LCP, a boundary that costs Lantern 150 ms and real browsers
 * almost nothing, because Blink's preload scanner runs on each chunk as it
 * arrives and starts the `<head>` preloads from the first one. Issue #85
 * measures that in real browsers. In the lab an exempt page is then guarded
 * only by the discovery check below, by the ceiling below, and by the
 * Lighthouse LCP budget (`lighthouserc.cjs`), where a miss is a warning, not
 * a block, until issue #76 calibrates the CPU slowdown (`e2e/README.md`,
 * "Lighthouse CI"). Two sampled pages are exempt. The first is the resource
 * page, by the owner's decision of 2026-11-07, for its related section
 * (issue #50), which is wanted content. The section's rows load `card.css` and `related.css`,
 * which the page's own meta line does without, and the body's
 * related-resources block renders the same rows. On 2026-11-07, on the
 * harness's seed, its HTML was 16,849 bytes (467 of headers), one window
 * boundary over and well under the ceiling; its preloads ended 985 bytes in,
 * inside the discovery check's limit; and its simulated LCP had gone from
 * 2,170 to a median of 2,322 ms, inside the 2,500 ms budget. The second is
 * the library, by the owner's decision of 2026-11-08, for the header's search
 * control (issue #115), which is wanted content on every page and costs
 * about 360 bytes on the CMS page. On the library it costs about 1,200 to
 * 1,700, because the page sits on a gzip-window edge: every page's HTML
 * carries its inlined CSS three times, once in `<style>` and twice in the
 * RSC payload, and on the library the `<style>` copy and the first RSC copy
 * were 32,351 bytes apart, 417 inside deflate's 32,768-byte window, so the
 * RSC copy compressed to almost nothing. Anything over about 150 bytes added
 * before the RSC payload pushes that copy out of the window, and the
 * document grows by about 870 bytes at once. On 2026-11-08, on the
 * harness's seed, its HTML went from 14,147 to 15,815 bytes with the
 * control (15,326 after the rebase onto #121 to #123), one window boundary
 * over and well under the ceiling; its preloads ended about 1,000 bytes in;
 * and its simulated LCP, in one quick run each, went from 2,175 to 2,411
 * ms, inside the 2,500 ms budget. The three copies are the root cause, and
 * issue #125 is the way out: removing the two in the RSC payload would put
 * the library back under the window, and its exemption should go with them.
 * These numbers are stated here only; the other documents point here.
 *
 * **The ceiling** (every exempt page): its transfer size, counted the same
 * way, is at most 43,800 bytes. Lantern's window starts at ten segments and
 * doubles each round trip (`TCPConnection.js`, line 115), so the first two
 * round trips carry 10 + 20 segments, and a document over 43,800 pays a
 * third. The exemption buys a page one round trip, never two. Together the
 * ceiling and the discovery check still catch a document that grows into a
 * third simulated round trip and anything that pushes the preloads late or
 * reorders the head. They do not catch growth inside the round trip the
 * exemption bought: an accidental CSS import that adds a round trip under
 * 43,800 bytes, say on an exempt page that had been under 14,600, is caught
 * only by the LCP budget, warning-only until #76.
 *
 * **The discovery check** (every image-led page): the
 * references the page's first paint needs are in the first 14,600 bytes on
 * the wire. Those are the LCP image's preload and the font's. The LCP image
 * is taken to be the body's one `<img fetchPriority="high">`; that it is
 * the element Lighthouse measures as the LCP is an assumption from the
 * measurements in `apps/web/README.md`, which this check does not verify
 * against Lighthouse. Its preload is the `<head>`'s `<link rel="preload"
 * as="image" fetchPriority="high">` with the same srcset and sizes. The font
 * preload is Figtree's `<link rel="preload" as="font">`, which puts the face
 * on the first paint (`packages/ui/DESIGN.md`, "Font display"). The bytes
 * are the header bytes plus the gzip stream's bytes up to and including the
 * image preload's last byte, at most 14,600. Stylesheets are not in the set
 * because the CSS is inline and makes no request. The async scripts are not
 * either: in a real browser they do not hold back an image's paint, only
 * Lantern's model of it, which the Lighthouse budget covers. On the CMS
 * page the LCP image is the body's first, the lead image `renderContent`
 * preloads (`takeLead` in `lib/content/render.tsx`). Until issue #86 it was
 * lazy with no preload, and the page was left out of this check, because
 * the preload scanner leaves a lazy image to layout and the bytes before its
 * tag did not decide when it started.
 *
 * In practice it guards the `<head>`'s order. React hoists the head as
 * charset, viewport, font preloads, high-priority image preloads, then the
 * inlined `<style>`, the scripts and the metadata, so CSS growth cannot push
 * the preloads out: on 2026-11-07 they ended about 1 KB in on every checked
 * page. What fails it is something placed ahead of them: more preloads, more
 * priority images, or an upgrade that reorders the head. The order asserts
 * are canaries for that: the font preload ends before the image preload
 * starts, and the image preload ends before the first `<style>`, the first
 * `<script>` and any `<link rel="stylesheet">` or `<link rel="preload"
 * as="style">`. A real browser's scanner is not held back by an inline
 * `<style>` or `<script>`, so a failed order assert is a warning that the
 * head has changed shape, not proof the image starts late; the byte count
 * is the check.
 *
 * Its byte count is exact, not an estimate. The spec requests the same
 * stored page again over a plain socket with the browser's
 * `Accept-Encoding`, and checks that the body bytes it reads, chunked
 * framing included, are exactly as many as Chromium's encoded body size
 * and that their gzip stream inflates to the body Chromium received. Then
 * it finds, by binary search, the shortest prefix of the stream that zlib
 * inflates (`Z_SYNC_FLUSH`, so a cut stream yields what it holds) past the
 * tag's last byte, which is what a decoder must have received to read the
 * tag, and adds the chunk-size lines on the wire before that byte. Gzipping
 * the decoded prefix instead closes the stream early and adds a trailer, and
 * was 47 to 59 bytes off. Both checks count the chunked framing, as
 * Chromium's encoded body size and so Lighthouse's `transferSize` do (18
 * bytes for the two chunks `next start` sends a stored page in), and the
 * headers as Chromium counts them; neither counts TCP, TLS or HTTP/2
 * framing. The header bytes are the HTTP/1.1 text `next start` sends, a lab
 * model: Vercel sends the headers HPACK-compressed over HTTP/2.
 *
 * Each page is requested until the app answers it from its store, so the
 * measured response is the stored ISR page a reader after the first gets,
 * as Lighthouse measures it (`lighthouse.mts`), and no regeneration is left
 * running. The browser runs no JavaScript: the document is the same, and
 * nothing hydrates to prefetch the page's links and send the CMS requests
 * after the test has ended, into the next spec's counters.
 */

/** Lantern's initial congestion window: ten segments of 1,460 bytes. */
const FIRST_ROUND_TRIP_BYTES = 10 * 1460;

/** Lantern's first two round trips: the window doubles to twenty segments in the second, thirty in all. */
const SECOND_ROUND_TRIP_BYTES = FIRST_ROUND_TRIP_BYTES + 2 * FIRST_ROUND_TRIP_BYTES;

const IMAGE_LED = SAMPLED_URLS.filter((sample) => sample.imageLed && sample.status === 200);

const cms = mockCms();

test.use({ javaScriptEnabled: false });

test.beforeEach(async ({ request }) => {
  await cms.reset();
  // Listings outlive a reset in the app's cache (e2e/README.md); clear them
  // so every page is measured as the seed renders it.
  await clearAppCache(request);
});

/**
 * Loads `path` in the browser once the app answers it from its store, and
 * returns the response with Chromium's header and encoded body sizes.
 */
async function loadStored(
  page: Page,
  request: APIRequestContext,
  path: string,
): Promise<{ response: Response; headersSize: number; bodySize: number }> {
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

  const response = (await page.goto(path))!;
  expect(await response.headerValue("x-nextjs-cache"), path).toBe("HIT");
  expect(response.status(), path).toBe(200);
  // Lighthouse's Chromium asks for the same encodings; an uncompressed
  // response would fail below for the wrong reason.
  expect(await response.headerValue("content-encoding"), `${path} was not sent gzipped`).toBe("gzip");

  const sizes = await response.request().sizes();
  // A size the browser did not report must not pass a limit unmeasured:
  // Playwright stores the header size as 0 when Chromium's extra-info event
  // has no `headersText` (`setResponseHeadersSize` in playwright-core's
  // `coreBundle.js`), and counts a missing body size as the Content-Length,
  // which a streamed page lacks, or 0 (`internalSizes`).
  expect(sizes.responseHeadersSize, `${path}'s header size was not reported`).toBeGreaterThan(0);
  expect(sizes.responseBodySize, `${path}'s body size was not reported`).toBeGreaterThan(0);
  return { response, headersSize: sizes.responseHeadersSize, bodySize: sizes.responseBodySize };
}

/** One HTTP/1.1 chunk's data: where it starts in the gzip stream and on the wire. */
interface Chunk {
  readonly encodedStart: number;
  readonly wireStart: number;
  readonly length: number;
}

/**
 * GETs `url` over a plain socket with `headers` and returns the response as
 * it crossed the wire: its status, its body bytes with any chunked
 * framing, the gzip stream the framing carries, and where each chunk's data
 * sits in both, so a byte of the stream maps back to a byte on the wire.
 */
function getWire(
  url: URL,
  headers: Record<string, string>,
): Promise<{ status: string; cache: string | undefined; wireBody: Buffer; encoded: Buffer; chunks: Chunk[] }> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname);
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    // A server that stops sending must fail the test, not hold it to Playwright's timeout.
    socket.setTimeout(10_000, () => socket.destroy(new Error(`${url.pathname}: no data from the app for 10 s`)));
    const received: Buffer[] = [];
    socket.on("data", (data: Buffer) => received.push(data));
    socket.on("error", fail);
    socket.on("end", () => {
      try {
        const all = Buffer.concat(received);
        const terminator = all.indexOf("\r\n\r\n");
        if (terminator < 0) throw new Error(`${url.pathname}: the response has no blank line ending its headers`);
        const headerBytes = terminator + 4;
        const head = all.subarray(0, headerBytes).toString("latin1");
        const field = (name: string) => new RegExp(`^${name}:\\s*(.*?)\\s*$`, "im").exec(head)?.[1];
        const wireBody = all.subarray(headerBytes);
        const chunks: Chunk[] = [];
        if (field("transfer-encoding")?.toLowerCase() === "chunked") {
          let at = 0;
          let encodedStart = 0;
          for (;;) {
            const line = wireBody.indexOf("\r\n", at);
            const length = parseInt(wireBody.subarray(at, line).toString("latin1"), 16);
            if (!Number.isInteger(length) || line < 0) throw new Error(`${url.pathname}: unreadable chunk at ${at}`);
            if (length === 0) break;
            chunks.push({ encodedStart, wireStart: line + 2, length });
            encodedStart += length;
            at = line + 2 + length + 2;
          }
        } else {
          chunks.push({ encodedStart: 0, wireStart: 0, length: wireBody.length });
        }
        const encoded = Buffer.concat(chunks.map((chunk) => wireBody.subarray(chunk.wireStart, chunk.wireStart + chunk.length)));
        resolve({ status: head.split(" ")[1], cache: field("x-nextjs-cache"), wireBody, encoded, chunks });
      } catch (error) {
        fail(error as Error);
      }
    });
    const lines = [`GET ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`, "Connection: close"];
    for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
    // Written, not ended: a half-closed socket can make the server drop the request.
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
  });
}

/** How many body bytes on the wire carry the first `encodedBytes` bytes of the gzip stream, framing included. */
function wireBytesThrough(chunks: readonly Chunk[], encodedBytes: number): number {
  const chunk = chunks.find(({ encodedStart, length }) => encodedBytes <= encodedStart + length);
  if (!chunk) throw new Error(`byte ${encodedBytes} is past the stream's end`);
  return chunk.wireStart + (encodedBytes - chunk.encodedStart);
}

/** How many bytes a cut gzip stream inflates to; 0 while its header is incomplete. */
function inflatedLength(prefix: Buffer): number {
  try {
    return gunzipSync(prefix, { finishFlush: constants.Z_SYNC_FLUSH }).length;
  } catch {
    return 0;
  }
}

/**
 * The fewest bytes of the gzip stream `encoded` a decoder needs to have
 * received to output the first `decodedBytes` bytes of the body. The
 * inflated length only grows with the prefix, so a binary search finds it.
 */
function encodedBytesThrough(encoded: Buffer, decodedBytes: number): number {
  let low = 1;
  let high = encoded.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (inflatedLength(encoded.subarray(0, middle)) >= decodedBytes) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Every match of `pattern` in `text`, with its start and its end, one past its last character. */
function tags(text: string, pattern: RegExp): { tag: string; start: number; end: number }[] {
  return [...text.matchAll(pattern)].map((match) => ({ tag: match[0], start: match.index, end: match.index + match[0].length }));
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

for (const { label, path } of IMAGE_LED.filter((sample) => sample.wholeDocumentGuard !== false)) {
  test(`the ${label}'s HTML (${path}) fits in Lighthouse's first round trip`, async ({ page, request }) => {
    const { headersSize, bodySize } = await loadStored(page, request, path);
    const transferSize = headersSize + bodySize;
    test.info().annotations.push({ type: "transfer size", description: `${transferSize} of ${FIRST_ROUND_TRIP_BYTES} bytes` });
    expect(
      transferSize,
      `${path} sends ${transferSize.toLocaleString("en")} bytes of HTML (${headersSize} of headers, ` +
        `${bodySize.toLocaleString("en")} gzipped), over the ${FIRST_ROUND_TRIP_BYTES.toLocaleString("en")} bytes ` +
        "Lighthouse's simulated connection sends in its first round trip, so its FCP and LCP pay a second 150 ms round trip. " +
        'Inlined CSS counts twice; import only the CSS the page renders (apps/web/README.md, "Images").',
    ).toBeLessThanOrEqual(FIRST_ROUND_TRIP_BYTES);
  });
}

for (const { label, path } of IMAGE_LED.filter((sample) => sample.wholeDocumentGuard === false)) {
  test(`the ${label}'s HTML (${path}), exempt from the first round trip, fits in Lighthouse's second`, async ({
    page,
    request,
  }) => {
    const { headersSize, bodySize } = await loadStored(page, request, path);
    const transferSize = headersSize + bodySize;
    test.info().annotations.push({ type: "transfer size", description: `${transferSize} of ${SECOND_ROUND_TRIP_BYTES} bytes` });
    expect(
      transferSize,
      `${path} sends ${transferSize.toLocaleString("en")} bytes of HTML (${headersSize} of headers, ` +
        `${bodySize.toLocaleString("en")} gzipped), over the ${SECOND_ROUND_TRIP_BYTES.toLocaleString("en")} bytes ` +
        "Lighthouse's simulated connection sends in its first two round trips, so its FCP and LCP pay a third. " +
        "Its exemption from the first round trip buys one round trip, not two (this spec's docblock).",
    ).toBeLessThanOrEqual(SECOND_ROUND_TRIP_BYTES);
  });
}

for (const { label, path } of IMAGE_LED) {
  test(`the ${label}'s font and LCP image preloads (${path}) arrive first, in the first round trip`, async ({
    page,
    request,
    baseURL,
  }) => {
    const { response, headersSize, bodySize } = await loadStored(page, request, path);
    const decoded = await response.body();

    // The same stored page, as its bytes crossed the wire.
    const acceptEncoding = (await response.request().allHeaders())["accept-encoding"];
    expect(acceptEncoding, "the browser's Accept-Encoding").toBeTruthy();
    const wire = await getWire(new URL(path, baseURL), { "accept-encoding": acceptEncoding });
    expect(wire.status, path).toBe("200");
    expect(wire.cache, `${path} was not answered from the store the second time`).toBe("HIT");
    expect(wire.wireBody.length, `${path}'s body on the wire is not the size Chromium received`).toBe(bodySize);
    expect(gunzipSync(wire.encoded).equals(decoded), `${path}'s gzip stream does not inflate to the body Chromium received`).toBe(
      true,
    );

    // Latin-1 keeps one character per byte, so string offsets are byte offsets.
    const html = decoded.toString("latin1");
    const headEnd = html.indexOf("</head>");
    expect(headEnd, `${path} has no </head>`).toBeGreaterThan(0);
    const head = html.slice(0, headEnd);

    const priorityImages = tags(html, /<img\b[^>]*\sfetchPriority="high"[^>]*>/g);
    expect(priorityImages, `${path} should have one <img fetchPriority="high">, its LCP image`).toHaveLength(1);
    const lcpImage = priorityImages[0].tag;
    const srcSet = attribute(lcpImage, "srcSet");
    expect(srcSet, `${path}'s LCP image has no srcSet`).toBeTruthy();
    const imagePreload = tags(head, /<link\b[^>]*\sas="image"[^>]*>/g).find(({ tag }) => attribute(tag, "imageSrcSet") === srcSet);
    if (!imagePreload) throw new Error(`${path}'s <head> has no <link rel="preload" as="image"> for its LCP image`);
    expect(attribute(imagePreload.tag, "rel"), `${path}'s LCP image link is not a preload`).toBe("preload");
    const sizes = attribute(lcpImage, "sizes");
    expect(sizes, `${path}'s LCP image has no sizes`).toBeTruthy();
    expect(attribute(imagePreload.tag, "imageSizes"), `${path}'s LCP image preload has other sizes than the image`).toBe(sizes);
    expect(attribute(imagePreload.tag, "fetchPriority"), `${path}'s LCP image preload is not fetchPriority="high"`).toBe("high");
    const fontPreloads = tags(head, /<link\b[^>]*\sas="font"[^>]*>/g);
    expect(fontPreloads, `${path}'s <head> should preload one font, Figtree`).toHaveLength(1);
    expect(attribute(fontPreloads[0].tag, "rel"), `${path}'s font link is not a preload`).toBe("preload");

    // Canaries for the head's shape (this spec's docblock); the byte count below is the check.
    expect(fontPreloads[0].end, `${path} preloads its font after its LCP image`).toBeLessThanOrEqual(imagePreload.start);
    for (const element of ["<style", "<script"]) {
      const first = html.indexOf(element);
      expect(first, `${path} has no ${element} element`).toBeGreaterThan(0);
      expect(imagePreload.end, `${path}'s LCP image preload comes after its first ${element} element`).toBeLessThanOrEqual(first);
    }
    const stylesheets = tags(html, /<link\b[^>]*>/g).filter(
      ({ tag }) => attribute(tag, "rel") === "stylesheet" || (attribute(tag, "rel") === "preload" && attribute(tag, "as") === "style"),
    );
    if (stylesheets.length > 0) {
      expect(imagePreload.end, `${path}'s LCP image preload comes after ${stylesheets[0].tag}`).toBeLessThanOrEqual(stylesheets[0].start);
    }

    const bodyPrefix = wireBytesThrough(wire.chunks, encodedBytesThrough(wire.encoded, imagePreload.end));
    const discoverySize = headersSize + bodyPrefix;
    test.info().annotations.push({
      type: "discovery size",
      description: `${discoverySize} of ${FIRST_ROUND_TRIP_BYTES} bytes (${headersSize} of headers, ${bodyPrefix} of the body's ${bodySize})`,
    });
    expect(
      discoverySize,
      `${path}'s LCP image preload ends ${discoverySize.toLocaleString("en")} bytes into the response (${headersSize} of headers, ` +
        `${bodyPrefix.toLocaleString("en")} of gzipped body), past the ${FIRST_ROUND_TRIP_BYTES.toLocaleString("en")} bytes of a ` +
        "connection's first round trip, so the browser cannot start its LCP image until a second. Something " +
        "now comes before them in <head>: more preloads or priority images, or a reordered head.",
    ).toBeLessThanOrEqual(FIRST_ROUND_TRIP_BYTES);
  });
}
