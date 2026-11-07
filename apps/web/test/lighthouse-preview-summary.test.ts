import { describe, expect, it } from "vitest";

import {
  COMMENT_MARKER,
  describeElement,
  findStickyComment,
  lcpElement,
  lcpImageBytes,
  previewComment,
  previewRows,
  previewTable,
  snippetImageUrl,
  type PreviewLhr,
} from "../e2e/lighthouse-preview-summary.mts";

// The pull-request comment the preview Lighthouse run posts
// (e2e/lighthouse-preview-summary.mts), from Lighthouse 13's results.

const PAGE = "https://preview.example/resources/article/taxonomies-versus-fields/";
const SOURCE = "%2Fmedia%2F2026%2F11%2Ftaxonomies-versus-fields-1024x538.png";
// Lighthouse cuts attribute values at 75 characters, so a next/image srcset
// loses its width and descriptor; src becomes the absolute currentSrc, cut too.
const IMG_SNIPPET = `<img alt="" fetchpriority="high" width="1024" height="538" decoding="async" data-nimg="1" style="color:transparent" sizes="(max-width: 40rem) 100vw, 40rem" srcset="/_next/image/?url=${SOURCE.slice(0, 56)}…" src="https://preview.example/_next/image/?url=%2Fmedia%2F2026%2F11%2Ftaxonomies-…">`;

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
            { url: `https://preview.example/_next/image/?url=${SOURCE}&w=750&q=75`, resourceType: "Image", transferSize: 2_445, networkEndTime: 900 },
          ],
        },
      },
    },
  };
}

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

describe("snippetImageUrl", () => {
  it("prefers the first srcset candidate, and says when Lighthouse cut it", () => {
    expect(snippetImageUrl(IMG_SNIPPET)).toEqual({ url: `/_next/image/?url=${SOURCE.slice(0, 56)}`, cut: true });
    expect(snippetImageUrl('<img srcset="/a.avif 640w, /b.avif 750w" src="/b.avif">')).toEqual({ url: "/a.avif", cut: false });
  });

  it("falls back to src, and is null for an element without either", () => {
    expect(snippetImageUrl('<img alt="x" src="/hero.jpg">')).toEqual({ url: "/hero.jpg", cut: false });
    expect(snippetImageUrl('<h1 class="title">')).toBeNull();
    expect(snippetImageUrl('<img srcset="…">')).toBeNull();
  });
});

describe("lcpImageBytes", () => {
  it("finds the request a cut next/image URL is a prefix of", () => {
    expect(lcpImageBytes(lhr(PAGE, {}))).toBe(2_445);
  });

  it("takes the first of several widths of the same image to finish", () => {
    const base = `https://preview.example/_next/image/?url=${SOURCE}`;
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
        { url: `https://preview.example/_next/image/?url=${SOURCE}&w=750&q=75`, resourceType: "Image", transferSize: 2_445 },
        { url: `https://preview.example/_next/image/?url=${SOURCE.replace(".png", "-2.png")}&w=750&q=75`, resourceType: "Image", transferSize: 9 },
      ],
    });
    expect(lcpImageBytes(run)).toBeNull();
  });

  it("matches an uncut URL exactly, resolved against the page", () => {
    const run = lhr(PAGE, {
      snippet: '<img alt="hero" src="/hero.jpg">',
      requests: [
        { url: "https://preview.example/hero.jpg", resourceType: "Image", transferSize: 31_000 },
        { url: "https://preview.example/hero.jpg?v=2", resourceType: "Image", transferSize: 1 },
      ],
    });
    expect(lcpImageBytes(run)).toBe(31_000);
  });

  it("is null for a text LCP, a request that is not an image, or no match", () => {
    expect(lcpImageBytes(lhr(PAGE, { snippet: '<h1 class="rh-page__title">' }))).toBeNull();
    expect(lcpImageBytes(lhr(PAGE, { requests: [{ url: PAGE, resourceType: "Document", transferSize: 1 }] }))).toBeNull();
    expect(
      lcpImageBytes(lhr(PAGE, { requests: [{ url: `https://preview.example/_next/image/?url=${SOURCE}&w=750&q=75`, resourceType: "Script", transferSize: 1 }] })),
    ).toBeNull();
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
  it("has one row per URL with the medians, the element most runs agree on, and n/a where nothing was found", () => {
    const home = "https://preview.example/";
    const rows = previewRows([
      lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 }),
      lhr(home, { lcp: 700, tbt: 5, cls: 0.001, snippet: '<h1 class="rh-hero__title">', nodeLabel: "Welcome" }),
      lhr(PAGE, { lcp: 2_300, tbt: 30, cls: 0.002 }),
      lhr(PAGE, { lcp: 2_200, tbt: 20, cls: 0.001, snippet: '<p class="rh-lede">', nodeLabel: "A lede" }),
      lhr(home, { lcp: 710, tbt: 7, cls: 0.001, snippet: '<h1 class="rh-hero__title">', nodeLabel: "Welcome", requests: [] }),
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

  it("leaves an errored run out of the medians, and shows the error when every run errored", () => {
    const rows = previewRows([
      lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 }),
      lhr(PAGE, { lcp: 9_000, tbt: 900, cls: 1, error: "PAGE_HUNG" }),
      lhr("https://preview.example/down/", { error: "ERRORED_DOCUMENT_REQUEST", snippet: null }),
    ]);
    expect(rows[0]).toMatchObject({ runs: 1, lcp: 2_100, tbt: 10, cls: 0, error: null });
    expect(rows[1]).toMatchObject({ path: "/down/", runs: 0, lcp: null, element: "n/a", error: "ERRORED_DOCUMENT_REQUEST" });
    expect(previewTable(rows).split("\n")[3]).toBe("| /down/ | 0 | error: `ERRORED_DOCUMENT_REQUEST` | | | | |");
  });
});

describe("previewComment", () => {
  it("starts with the marker and names the preview, the commit and the runs", () => {
    const body = previewComment({
      previewUrl: "https://preview.example",
      sha: "0123456789abcdef0123456789abcdef01234567",
      runsPerUrl: 5,
      runs: [lhr(PAGE, { lcp: 2_100, tbt: 10, cls: 0 })],
      failure: null,
    });
    expect(body.startsWith(`${COMMENT_MARKER}\n\n### Lighthouse on the Vercel preview (mobile, median of 5)\n\n`)).toBe(true);
    expect(body).toContain("Preview: https://preview.example · Commit: `0123456789abcdef0123456789abcdef01234567`");
    expect(body).toContain("| /resources/article/taxonomies-versus-fields/ | 1 | 2100 | `img` | 2,445 | 10 | 0.000 |");
    expect(body).not.toContain("could not measure");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("reports a failure, with whatever rows were measured, and n/a for an unknown commit", () => {
    const body = previewComment({ previewUrl: "https://preview.example", sha: null, runsPerUrl: 5, runs: [], failure: "/resources/ answered 302 while warming." });
    expect(body).toContain("Commit: n/a");
    expect(body).toContain("**Lighthouse could not measure this preview.** /resources/ answered 302 while warming.");
    expect(body).not.toContain("| URL |");
  });
});

describe("findStickyComment", () => {
  it("is the id of the comment carrying the marker, or null", () => {
    const comments = [
      { id: 1, body: "Looks good" },
      { id: 2, body: null },
      { id: 3, body: `${COMMENT_MARKER}\n\n### Lighthouse` },
      { id: 4, body: `${COMMENT_MARKER} older` },
    ];
    expect(findStickyComment(comments)).toBe(3);
    expect(findStickyComment(comments.slice(0, 2))).toBeNull();
    expect(findStickyComment([])).toBeNull();
  });
});
