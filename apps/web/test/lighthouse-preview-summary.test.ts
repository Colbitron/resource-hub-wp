import { describe, expect, it } from "vitest";

import {
  COMMENT_MARKER,
  decodeEntities,
  describeElement,
  findStickyComment,
  foreignOrigins,
  lcpElement,
  lcpImageBytes,
  previewComment,
  previewRows,
  previewTable,
  snippetImageUrl,
  type PreviewLhr,
  type PreviewResult,
} from "../e2e/lighthouse-preview-summary.mts";

// The pull-request comment the preview Lighthouse run posts
// (e2e/lighthouse-preview-summary.mts), from Lighthouse 13's results.

const ORIGIN = "https://preview.example";
const PAGE = `${ORIGIN}/resources/article/taxonomies-versus-fields/`;
const SOURCE = "%2Fmedia%2F2026%2F11%2Ftaxonomies-versus-fields-1024x538.png";
const IMAGE = `${ORIGIN}/_next/image/?url=${SOURCE}&w=750&q=75`;
// Lighthouse cuts attribute values at 75 characters, so a next/image srcset
// loses its width and descriptor; src becomes the absolute currentSrc, cut
// too. The snippet is serialised HTML, so `&` is `&amp;`.
const IMG_SNIPPET = `<img alt="" fetchpriority="high" width="1024" height="538" decoding="async" data-nimg="1" style="color:transparent" sizes="(max-width: 40rem) 100vw, 40rem" srcset="/_next/image/?url=${SOURCE.slice(0, 56)}…" src="${ORIGIN}/_next/image/?url=%2Fmedia%2F2026%2F11%2Ftaxonomies-…">`;

interface Numbers {
  lcp?: number;
  tbt?: number;
  cls?: number;
  snippet?: string | null;
  nodeLabel?: string;
  requests?: { url: string; resourceType?: string; transferSize?: number; networkEndTime?: number }[];
  error?: string;
}

function lhr(url: string, numbers: Numbers): PreviewLhr {
  const snippet = numbers.snippet === undefined ? IMG_SNIPPET : numbers.snippet;
  return {
    requestedUrl: url,
    finalDisplayedUrl: url,
    ...(numbers.error === undefined ? {} : { runtimeError: { code: numbers.error, message: "boom" } }),
    categories: { performance: { score: 1 } },
    audits: {
      ...(numbers.lcp === undefined ? {} : { "largest-contentful-paint": { numericValue: numbers.lcp } }),
      ...(numbers.tbt === undefined ? {} : { "total-blocking-time": { numericValue: numbers.tbt } }),
      ...(numbers.cls === undefined ? {} : { "cumulative-layout-shift": { numericValue: numbers.cls } }),
      "lcp-breakdown-insight": {
        details: {
          items: [
            { type: "table", items: [{ subpart: "timeToFirstByte", duration: 100 }] },
            ...(snippet === null ? [] : [{ type: "node", snippet, nodeLabel: numbers.nodeLabel ?? "" }]),
          ],
        },
      },
      "network-requests": {
        details: {
          items: numbers.requests ?? [
            { url: PAGE, resourceType: "Document", transferSize: 13_000, networkEndTime: 200 },
            { url: IMAGE, resourceType: "Image", transferSize: 2_445, networkEndTime: 900 },
          ],
        },
      },
    },
  };
}

const measured = (url: string, runs: PreviewLhr[]): PreviewResult => ({ url, runs, failure: null });

describe("lcpElement", () => {
  it("reads the tag and the label from the insight's node", () => {
    expect(lcpElement(lhr(PAGE, { nodeLabel: " A field guide " }))).toEqual({
      tag: "img",
      label: "A field guide",
      snippet: IMG_SNIPPET,
    });
    expect(lcpElement(lhr(PAGE, { snippet: '<h1 class="rh-page__title">', nodeLabel: "Sample Page" }))).toMatchObject({
      tag: "h1",
      label: "Sample Page",
    });
  });

  it("is null without a node, as in a run that errored", () => {
    expect(lcpElement(lhr(PAGE, { snippet: null }))).toBeNull();
    expect(lcpElement({ requestedUrl: PAGE, categories: {}, audits: {} })).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes what HTML serialisation writes in an attribute value", () => {
    expect(decodeEntities("/a?x=1&amp;y=2&quot;&nbsp;&lt;&gt;&#39;&other;")).toBe("/a?x=1&y=2\" <>'&other;");
  });
});

describe("snippetImageUrl", () => {
  it("prefers the first srcset candidate, decoded, and says when Lighthouse cut it", () => {
    expect(snippetImageUrl(IMG_SNIPPET)).toEqual({ url: `/_next/image/?url=${SOURCE.slice(0, 56)}`, cut: true });
    expect(snippetImageUrl('<img srcset="/a.avif?v=1&amp;w=640 640w, /b.avif 750w" src="/b.avif">')).toEqual({ url: "/a.avif?v=1&w=640", cut: false });
  });

  it("falls back to src, and is null for an element without either", () => {
    expect(snippetImageUrl('<img alt="x" src="/hero.jpg?a=1&amp;b=2">')).toEqual({ url: "/hero.jpg?a=1&b=2", cut: false });
    expect(snippetImageUrl('<h1 class="title">')).toBeNull();
    expect(snippetImageUrl('<img srcset="…">')).toBeNull();
  });
});

describe("lcpImageBytes", () => {
  it("finds the request a cut next/image URL is a prefix of", () => {
    expect(lcpImageBytes(lhr(PAGE, {}))).toBe(2_445);
  });

  it("matches a serialised src with &amp; against the request's &", () => {
    const run = lhr(PAGE, {
      snippet: `<img alt="" src="/_next/image/?url=${SOURCE}&amp;w=750&amp;q=75">`,
      requests: [{ url: IMAGE, resourceType: "Image", transferSize: 2_445 }],
    });
    expect(lcpImageBytes(run)).toBe(2_445);
  });

  it("takes the first of several widths of the same image to finish", () => {
    const base = `${ORIGIN}/_next/image/?url=${SOURCE}`;
    const run = lhr(PAGE, {
      requests: [
        { url: `${base}&w=1080&q=75`, resourceType: "Image", transferSize: 4_000, networkEndTime: 1_200 },
        { url: `${base}&w=750&q=75`, resourceType: "Image", transferSize: 2_445, networkEndTime: 900 },
      ],
    });
    expect(lcpImageBytes(run)).toBe(2_445);
  });

  it("is null when the prefix matches two different images, rather than guess", () => {
    const run = lhr(PAGE, {
      requests: [
        { url: IMAGE, resourceType: "Image", transferSize: 2_445 },
        { url: `${ORIGIN}/_next/image/?url=${SOURCE.replace(".png", "-2.png")}&w=750&q=75`, resourceType: "Image", transferSize: 9 },
      ],
    });
    expect(lcpImageBytes(run)).toBeNull();
  });

  it("matches an uncut URL exactly, resolved against the page", () => {
    const run = lhr(PAGE, {
      snippet: '<img alt="hero" src="/hero.jpg">',
      requests: [
        { url: `${ORIGIN}/hero.jpg`, resourceType: "Image", transferSize: 31_000 },
        { url: `${ORIGIN}/hero.jpg?v=2`, resourceType: "Image", transferSize: 1 },
      ],
    });
    expect(lcpImageBytes(run)).toBe(31_000);
  });

  it("is null for a text LCP, a request that is not an image, or no match", () => {
    expect(lcpImageBytes(lhr(PAGE, { snippet: '<h1 class="rh-page__title">' }))).toBeNull();
    expect(lcpImageBytes(lhr(PAGE, { requests: [{ url: PAGE, resourceType: "Document", transferSize: 1 }] }))).toBeNull();
    expect(lcpImageBytes(lhr(PAGE, { requests: [{ url: IMAGE, resourceType: "Script", transferSize: 1 }] }))).toBeNull();
  });
});

describe("foreignOrigins", () => {
  it("lists the network origins other than the preview's, once each, sorted", () => {
    const run = lhr(PAGE, {
      requests: [
        { url: PAGE, resourceType: "Document" },
        { url: IMAGE, resourceType: "Image" },
        { url: "https://vercel.live/_next-live/feedback/feedback.js", resourceType: "Script" },
        { url: "https://vercel.live/other.js", resourceType: "Script" },
        { url: "https://cms.example/wp-content/uploads/x.png", resourceType: "Image" },
        { url: "data:image/svg+xml,…", resourceType: "Image" },
        { url: "not a url" },
      ],
    });
    expect(foreignOrigins(run, ORIGIN)).toEqual(["https://cms.example", "https://vercel.live"]);
    expect(foreignOrigins(lhr(PAGE, {}), ORIGIN)).toEqual([]);
    expect(foreignOrigins(lhr(PAGE, {}), `${ORIGIN}/`)).toEqual([]);
  });

  it("ignores a request the run's blockedUrlPatterns made Chrome abort, as Lighthouse records it, and nothing else", () => {
    // The signature of a blocked request on 2026-11-07: Lighthouse 13 lists
    // it with status -1, no protocol and no bytes.
    const aborted = { url: "https://vercel.live/_next-live/feedback/feedback.js", resourceType: "Script", statusCode: -1, protocol: "", transferSize: 0 };
    const withBlock = (requests: object[], patterns = ["https://vercel.live/*"]): PreviewLhr => ({
      ...lhr(PAGE, { requests: requests as never }),
      configSettings: { blockedUrlPatterns: patterns },
    });
    expect(foreignOrigins(withBlock([aborted]), ORIGIN)).toEqual([]);
    // The same request answered (the block did not work) counts.
    expect(foreignOrigins(withBlock([{ ...aborted, statusCode: 204, protocol: "h2", transferSize: 157 }]), ORIGIN)).toEqual(["https://vercel.live"]);
    expect(foreignOrigins(withBlock([{ ...aborted, statusCode: -1, protocol: "h2" }]), ORIGIN)).toEqual(["https://vercel.live"]);
    // A failed request to an origin no pattern names counts: it may have been sent.
    expect(foreignOrigins(withBlock([{ ...aborted, url: "https://other.example/x.js" }]), ORIGIN)).toEqual(["https://other.example"]);
    // Without the pattern the aborted signature alone is not enough.
    expect(foreignOrigins(withBlock([aborted], []), ORIGIN)).toEqual(["https://vercel.live"]);
    expect(foreignOrigins(lhr(PAGE, { requests: [aborted] }), ORIGIN)).toEqual(["https://vercel.live"]);
    // Patterns are Chrome's: `*` is a wildcard, the rest literal.
    expect(foreignOrigins(withBlock([aborted], ["https://vercel.live/_next-live/*.js"]), ORIGIN)).toEqual([]);
    expect(foreignOrigins(withBlock([aborted], ["https://vercel.live/other/*"]), ORIGIN)).toEqual(["https://vercel.live"]);
  });
});

describe("describeElement", () => {
  it("shows the tag in code and the label in quotes, cut at 40 characters, with pipes escaped", () => {
    expect(describeElement({ tag: "img", label: "", snippet: "" })).toBe("`img`");
    expect(describeElement({ tag: "h1", label: "Sample | Page", snippet: "" })).toBe("`h1` “Sample \\| Page”");
    expect(describeElement({ tag: "p", label: "a".repeat(41), snippet: "" })).toBe(`\`p\` “${"a".repeat(39)}…”`);
  });
});

describe("previewRows and previewTable", () => {
  it("has one row per result with the medians, the element most runs agree on, and n/a where nothing was found", () => {
    const home = `${ORIGIN}/`;
    const rows = previewRows([
      measured(PAGE, [
        lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 }),
        lhr(PAGE, { lcp: 2_300, tbt: 30, cls: 0.002 }),
        lhr(PAGE, { lcp: 2_200, tbt: 20, cls: 0.001, snippet: '<p class="rh-lede">', nodeLabel: "A lede" }),
      ]),
      measured(home, [
        lhr(home, { lcp: 700, tbt: 5, cls: 0.001, snippet: '<h1 class="rh-hero__title">', nodeLabel: "Welcome" }),
        lhr(home, { lcp: 710, tbt: 7, cls: 0.001, snippet: '<h1 class="rh-hero__title">', nodeLabel: "Welcome", requests: [] }),
      ]),
    ]);
    expect(rows).toEqual([
      { path: "/resources/article/taxonomies-versus-fields/", runs: 3, lcp: 2_200, element: "`img`", imageBytes: 2_445, tbt: 20, cls: 0.001, error: null },
      { path: "/", runs: 2, lcp: 705, element: "`h1` “Welcome”", imageBytes: null, tbt: 6, cls: 0.001, error: null },
    ]);
    expect(previewTable(rows)).toBe(
      [
        "| URL | Runs | LCP (ms) | LCP element | LCP image (bytes) | TBT (ms) | CLS |",
        "| --- | ---: | ---: | --- | ---: | ---: | ---: |",
        "| /resources/article/taxonomies-versus-fields/ | 3 | 2200 | `img` | 2,445 | 20 | 0.001 |",
        "| / | 2 | 705 | `h1` “Welcome” | n/a | 6 | 0.001 |",
      ].join("\n"),
    );
  });

  it("reads the image's bytes only from the runs whose LCP was the element most runs agreed on", () => {
    const text = { snippet: '<h1 class="rh-page__title">', nodeLabel: "Title" };
    const rows = previewRows([
      measured(PAGE, [
        lhr(PAGE, { lcp: 2_100, ...text }),
        lhr(PAGE, { lcp: 2_000 }),
        lhr(PAGE, { lcp: 2_050, ...text }),
        lhr(PAGE, { lcp: 1_900 }),
        lhr(PAGE, { lcp: 2_200, ...text }),
      ]),
    ]);
    expect(rows[0]).toMatchObject({ runs: 5, lcp: 2_050, element: "`h1` “Title”", imageBytes: null });
    const flipped = previewRows([measured(PAGE, [lhr(PAGE, { lcp: 2_000 }), lhr(PAGE, { lcp: 2_100, ...text }), lhr(PAGE, { lcp: 1_900 })])]);
    expect(flipped[0]).toMatchObject({ element: "`img`", imageBytes: 2_445 });
  });

  it("gives a URL that could not be measured a row with the reason, and shows a runtime error when every run errored", () => {
    const rows = previewRows([
      { url: `${ORIGIN}/gone/`, runs: [], failure: "/gone/ answered 404 while warming." },
      measured(PAGE, [lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 }), lhr(PAGE, { lcp: 9_000, tbt: 900, cls: 1, error: "PAGE_HUNG" })]),
      measured(`${ORIGIN}/down/`, [lhr(`${ORIGIN}/down/`, { error: "ERRORED_DOCUMENT_REQUEST", snippet: null })]),
      measured(`${ORIGIN}/empty/`, []),
    ]);
    expect(rows[0]).toMatchObject({ path: "/gone/", runs: 0, lcp: null, element: "n/a", error: "/gone/ answered 404 while warming." });
    expect(rows[1]).toMatchObject({ runs: 1, lcp: 2_100, tbt: 10, cls: 0, error: null });
    expect(rows[2]).toMatchObject({ path: "/down/", runs: 0, error: "ERRORED_DOCUMENT_REQUEST" });
    expect(rows[3]).toMatchObject({ path: "/empty/", runs: 0, error: "no runs" });
    const lines = previewTable(rows).split("\n");
    expect(lines[2]).toBe("| /gone/ | 0 | not measured: /gone/ answered 404 while warming. | | | | |");
    expect(lines[4]).toBe("| /down/ | 0 | not measured: ERRORED_DOCUMENT_REQUEST | | | | |");
  });

  it("keeps a reason with a pipe or a newline inside its cell", () => {
    const [row] = previewRows([{ url: `${ORIGIN}/x/`, runs: [], failure: "a | b\nc" }]);
    expect(previewTable([row]).split("\n")[2]).toBe("| /x/ | 0 | not measured: a \\| b c | | | | |");
  });
});

describe("previewComment", () => {
  it("starts with the marker and names the preview, the commit and the runs", () => {
    const body = previewComment({
      previewUrl: ORIGIN,
      sha: "0123456789abcdef0123456789abcdef01234567",
      runsPerUrl: 5,
      results: [measured(PAGE, [lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 })])],
      failure: null,
    });
    expect(body.startsWith(`${COMMENT_MARKER}\n\n### Lighthouse on the Vercel preview (mobile, median of 5)\n\n`)).toBe(true);
    expect(body).toContain(`Preview: ${ORIGIN} · Commit: \`0123456789abcdef0123456789abcdef01234567\``);
    expect(body).toContain("| /resources/article/taxonomies-versus-fields/ | 1 | 2100 | `img` | 2,445 | 10 | 0.000 |");
    expect(body).not.toContain("could not be measured");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("says when some URLs could not be measured, keeping the rows that were", () => {
    const body = previewComment({
      previewUrl: ORIGIN,
      sha: null,
      runsPerUrl: 5,
      results: [
        { url: `${ORIGIN}/`, runs: [], failure: "/ answered 302 while warming." },
        measured(PAGE, [lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 })]),
      ],
      failure: null,
    });
    expect(body).toContain("Commit: n/a");
    expect(body).toContain("**Some URLs could not be measured**; their rows say why.");
    expect(body).toContain("| / | 0 | not measured: / answered 302 while warming. | | | | |");
    expect(body).toContain("| /resources/article/taxonomies-versus-fields/ | 1 | 2100 |");
  });

  it("reports a failure of the whole run above the table", () => {
    const body = previewComment({ previewUrl: ORIGIN, sha: null, runsPerUrl: 5, results: [measured(PAGE, [lhr(PAGE, { lcp: 2_100 })])], failure: "Requests went to https://vercel.live." });
    expect(body).toContain("**Lighthouse could not measure this preview.** Requests went to https://vercel.live.");
    expect(body).not.toContain("Some URLs");
    expect(body).toContain("| URL |");
  });
});

describe("findStickyComment", () => {
  it("is the id of the workflow's own comment carrying the marker, or null", () => {
    const bot = { login: "github-actions[bot]" };
    const comments = [
      { id: 1, body: "Looks good", user: bot },
      { id: 2, body: null, user: bot },
      { id: 3, body: `${COMMENT_MARKER} quoted by a person`, user: { login: "colby" } },
      { id: 4, body: `${COMMENT_MARKER}\n\n### Lighthouse`, user: bot },
      { id: 5, body: `${COMMENT_MARKER} older`, user: bot },
    ];
    expect(findStickyComment(comments)).toBe(4);
    expect(findStickyComment(comments.slice(0, 3))).toBeNull();
    expect(findStickyComment([{ id: 6, body: COMMENT_MARKER }])).toBeNull();
    expect(findStickyComment([])).toBeNull();
  });
});
