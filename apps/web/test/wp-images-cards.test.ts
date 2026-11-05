import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainText, toCard, UNTITLED } from "../lib/wp/cards";
import { CARD_SOURCE_MIN_WIDTH, featuredImage, MAX_IMAGE_DIMENSION } from "../lib/wp/images";
import { wpResourceSchema, type WpResource } from "../lib/wp/schemas/rest";

/**
 * `featuredImage`'s trust rules (the acceptance criteria from the security
 * review) and `toCard`'s mapping, on the captured resource with its media
 * replaced. Every resource goes through the reader schema first, as in the
 * data layer, so a media entry the schema turns into `null` is tested as the
 * fetchers would hand it over.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp");
const RAW = JSON.parse(readFileSync(path.join(fixtures, "resource.single.json"), "utf8")) as Record<string, unknown>;

const UPLOADS = "https://cms.example/wp-content/uploads";

type Json = Record<string, unknown>;

function media(overrides: Json = {}, details: Json = {}): Json {
  return {
    source_url: `${UPLOADS}/2026/11/photo.jpg`,
    alt_text: "A photo",
    media_details: { width: 1600, height: 900, sizes: {}, ...details },
    ...overrides,
  };
}

/** The captured resource, changed by `patch`, parsed by the reader schema. */
function resource(patch: Json = {}): WpResource {
  const raw = structuredClone(RAW);
  return wpResourceSchema.parse({ ...raw, ...patch });
}

function withMedia(entries: unknown[]): WpResource {
  const embedded = structuredClone(RAW._embedded) as Json;
  return resource({ _embedded: { ...embedded, "wp:featuredmedia": entries } });
}

function imageOf(entry: Json) {
  return featuredImage(withMedia([entry]));
}

beforeEach(() => {
  vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("featuredImage", () => {
  it("maps a CMS upload with both dimensions to /media/", () => {
    expect(imageOf(media())).toEqual({ src: "/media/2026/11/photo.jpg", width: 1600, height: 900, alt: "A photo" });
  });

  it("takes the captured fixture's image", () => {
    expect(featuredImage(resource())).toEqual({
      src: "/media/2026/11/w-logo-blue.png",
      width: 80,
      height: 80,
      alt: "The WordPress logo",
    });
  });

  it("drops the query and the hash", () => {
    expect(imageOf(media({ source_url: `${UPLOADS}/2026/11/photo.jpg?ver=2#top` }))?.src).toBe(
      "/media/2026/11/photo.jpg",
    );
  });

  it("refuses an image on another host", () => {
    expect(imageOf(media({ source_url: "https://evil.example/wp-content/uploads/2026/11/photo.jpg" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://cms.example.evil/wp-content/uploads/a.jpg" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://cms.example:8443/wp-content/uploads/a.jpg" }))).toBeNull();
  });

  it("compares hosts as the URL parser normalises them", () => {
    // An upper-case host is the same host.
    expect(imageOf(media({ source_url: "https://CMS.Example/wp-content/uploads/a.jpg" }))?.src).toBe("/media/a.jpg");
    // A trailing dot is another origin to the parser, so it is refused rather than guessed at.
    expect(imageOf(media({ source_url: "https://cms.example./wp-content/uploads/a.jpg" }))).toBeNull();
    // Lookalikes: a hyphen for the dot, a prefix, and a Cyrillic "ѕ" that the parser turns into punycode.
    for (const host of ["cms-example", "evilcms.example", "xcms.example", "cmѕ.example", "cms.example.evil.example"]) {
      expect(imageOf(media({ source_url: `https://${host}/wp-content/uploads/a.jpg` })), host).toBeNull();
    }
  });

  it("refuses a URL with a user name or password", () => {
    expect(imageOf(media({ source_url: "https://user:secret@cms.example/wp-content/uploads/a.jpg" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://user@cms.example/wp-content/uploads/a.jpg" }))).toBeNull();
  });

  it("refuses http: when the CMS is https:", () => {
    expect(imageOf(media({ source_url: "http://cms.example/wp-content/uploads/a.jpg" }))).toBeNull();
    // Even from a media origin configured as http:, the origin check alone would accept.
    vi.stubEnv("WP_MEDIA_ORIGIN", "http://media.example");
    expect(imageOf(media({ source_url: "http://media.example/wp-content/uploads/a.jpg" }))).toBeNull();
  });

  it("accepts http: when the CMS itself is http:", () => {
    vi.stubEnv("WP_API_URL", "http://localhost:8888/wp-json");
    expect(imageOf(media({ source_url: "http://localhost:8888/wp-content/uploads/a.jpg" }))?.src).toBe("/media/a.jpg");
  });

  it("refuses a path outside the uploads directory", () => {
    expect(imageOf(media({ source_url: "https://cms.example/wp-content/plugins/x/a.png" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://cms.example/wp-content/uploads/../../wp-config.php" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://cms.example/wp-content/uploads/%2e%2e/x.png" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://cms.example/wp-content/uploads/a%2fb.png" }))).toBeNull();
    expect(imageOf(media({ source_url: "https://cms.example/a.png" }))).toBeNull();
  });

  it("requires both dimensions", () => {
    expect(imageOf(media({}, { width: undefined }))).toBeNull();
    expect(imageOf(media({}, { height: undefined }))).toBeNull();
    // An SVG: WordPress could not measure it, so media_details is empty.
    expect(imageOf(media({ source_url: `${UPLOADS}/2026/11/diagram.svg`, media_details: {} }))).toBeNull();
  });

  it("refuses a dimension that is not a whole number of pixels", () => {
    // The reader schema refuses these, so the media entry parses as null: no image.
    for (const bad of [1600.5, "1600", 0, -900, null]) {
      expect(imageOf(media({}, { width: bad })), String(bad)).toBeNull();
      expect(imageOf(media({}, { height: bad })), String(bad)).toBeNull();
    }
    // A bad size makes the whole entry unreadable the same way, not just that size.
    for (const bad of [900.5, "900", 0]) {
      const sizes = { large: { source_url: `${UPLOADS}/2026/11/photo-1024x576.jpg`, width: bad, height: 576 } };
      expect(imageOf(media({}, { sizes })), String(bad)).toBeNull();
    }
  });

  it(`refuses a dimension over ${MAX_IMAGE_DIMENSION}`, () => {
    expect(imageOf(media({}, { width: MAX_IMAGE_DIMENSION + 1 }))).toBeNull();
    expect(imageOf(media({}, { height: 10 ** 9 }))).toBeNull();
    expect(imageOf(media({}, { width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION }))?.width).toBe(
      MAX_IMAGE_DIMENSION,
    );
  });

  it("never uses a null entry", () => {
    expect(featuredImage(withMedia([null]))).toBeNull();
    // Core's error object in the entry's place parses as null too.
    expect(featuredImage(withMedia([{ code: "rest_forbidden", message: "No", data: { status: 401 } }]))).toBeNull();
    // A null size makes the whole media unreadable, so it is no image, not a partial one.
    expect(imageOf(media({}, { sizes: { large: null } }))).toBeNull();
    expect(featuredImage(withMedia([]))).toBeNull();
  });

  it("uses the smallest trusted size of the same shape that is wide enough", () => {
    const sizes = {
      thumbnail: { source_url: `${UPLOADS}/2026/11/photo-150x150.jpg`, width: 150, height: 150 },
      medium_large: { source_url: `${UPLOADS}/2026/11/photo-768x432.jpg`, width: 768, height: 432 },
      large: { source_url: `${UPLOADS}/2026/11/photo-1024x576.jpg`, width: 1024, height: 576 },
      cropped: { source_url: `${UPLOADS}/2026/11/photo-900x900.jpg`, width: 900, height: 900 },
    };
    expect(imageOf(media({}, { sizes }))).toEqual({
      src: "/media/2026/11/photo-1024x576.jpg",
      width: 1024,
      height: 576,
      alt: "A photo",
    });
    expect(CARD_SOURCE_MIN_WIDTH).toBe(800);
  });

  it("accepts a size within a pixel of the original's shape, and skips one two pixels off", () => {
    // 1600×900 scaled to 1024 wide is exactly 576 high.
    for (const [height, used] of [
      [575, true],
      [577, true],
      [574, false],
      [578, false],
    ] as const) {
      const sizes = { large: { source_url: `${UPLOADS}/2026/11/photo-1024x${height}.jpg`, width: 1024, height } };
      expect(imageOf(media({}, { sizes }))?.src, String(height)).toBe(
        used ? `/media/2026/11/photo-1024x${height}.jpg` : "/media/2026/11/photo.jpg",
      );
    }
  });

  it("checks every size it would use by the same rules, and skips one that fails", () => {
    const large = { source_url: `${UPLOADS}/2026/11/photo-1024x576.jpg`, width: 1024, height: 576 };
    const untrusted = [
      "https://evil.example/wp-content/uploads/2026/11/photo-900x506.jpg",
      "https://user:pw@cms.example/wp-content/uploads/2026/11/photo-900x506.jpg",
      "http://cms.example/wp-content/uploads/2026/11/photo-900x506.jpg",
      "https://cms.example/wp-content/themes/photo-900x506.jpg",
    ];
    for (const source_url of untrusted) {
      const sizes = { large, sneaky: { source_url, width: 900, height: 506 } };
      expect(imageOf(media({}, { sizes }))?.src, source_url).toBe("/media/2026/11/photo-1024x576.jpg");
    }
    const oversized = { large, huge: { source_url: `${UPLOADS}/h.jpg`, width: MAX_IMAGE_DIMENSION + 16, height: 9000 } };
    expect(imageOf(media({}, { sizes: oversized }))?.src).toBe("/media/2026/11/photo-1024x576.jpg");
  });

  it("refuses the image when the original fails, whatever its sizes", () => {
    const sizes = { large: { source_url: `${UPLOADS}/2026/11/photo-1024x576.jpg`, width: 1024, height: 576 } };
    expect(imageOf(media({ source_url: "https://evil.example/wp-content/uploads/a.jpg" }, { sizes }))).toBeNull();
  });

  it("follows a separate media origin, and refuses the CMS host's uploads then", () => {
    vi.stubEnv("WP_MEDIA_ORIGIN", "https://media.example");
    expect(imageOf(media({ source_url: "https://media.example/wp-content/uploads/a.jpg" }))?.src).toBe("/media/a.jpg");
    expect(imageOf(media())).toBeNull();
  });

  it("follows a subdirectory install's uploads", () => {
    vi.stubEnv("WP_API_URL", "https://example.com/blog/wp-json");
    expect(imageOf(media({ source_url: "https://example.com/blog/wp-content/uploads/a.jpg" }))?.src).toBe(
      "/media/a.jpg",
    );
    expect(imageOf(media({ source_url: "https://example.com/wp-content/uploads/a.jpg" }))).toBeNull();
  });
});

describe("toCard", () => {
  it("maps the captured resource to ResourceCard's props", () => {
    expect(toCard(resource())).toEqual({
      title: "A field guide to revalidation",
      href: "/resources/ebook/a-field-guide-to-revalidation/",
      typeLabel: "Ebook",
      topicLabels: ["Headless delivery", "Performance"],
      summary:
        "On-demand, time-based, and tag-based revalidation compared, with the failure modes of each written down.",
      date: "2026-11-05T09:31:32Z",
      image: { src: "/media/2026/11/w-logo-blue.png", alt: "The WordPress logo", width: 80, height: 80 },
    });
  });

  it("decodes the rendered title and term names to plain text", () => {
    const card = toCard(resource({ title: { rendered: "Alt text &#8217;n&#8217; <em>more</em> &#038; more" } }));
    expect(card?.title).toBe("Alt text ’n’ more & more");
    expect(plainText("Tips &amp;amp; tricks")).toBe("Tips &amp; tricks");
    expect(plainText("  a \n b  ")).toBe("a b");
  });

  it("gives an untitled resource a title, so its link has a name", () => {
    for (const rendered of ["", "   ", "<em> </em>", "\u200B", "&#8203;\u200C \u200D&#xFEFF;", "<b>\u200B</b>"]) {
      expect(toCard(resource({ title: { rendered } }))?.title, JSON.stringify(rendered)).toBe(UNTITLED);
    }
    expect(toCard(resource({ title: { rendered: "\u200BA title" } }))?.title).toBe("\u200BA title");
  });

  it("decodes escaped markup to inert text, for React to escape again", () => {
    expect(plainText("&lt;img src=x onerror=alert(1)&gt;")).toBe("<img src=x onerror=alert(1)>");
  });

  it("is null without exactly one type", () => {
    expect(toCard(resource({ resource_type: [] }))).toBeNull();
    expect(toCard(resource({ resource_type: [4, 5] }))).toBeNull();
  });

  it("is null when the type is not embedded", () => {
    expect(toCard(resource({ resource_type: [99] }))).toBeNull();
  });

  it("leaves out the image when there is none, and a topic that is not embedded", () => {
    const card = toCard(
      resource({
        resource_topic: [9, 77],
        _embedded: { "wp:term": (RAW._embedded as Json)["wp:term"] },
      }),
    );
    expect(card).not.toHaveProperty("image");
    expect(card?.topicLabels).toEqual(["Headless delivery"]);
  });

  it("builds a canonical href from the type and slug", () => {
    expect(toCard(resource({ slug: "Mixed-Case" }))?.href).toBe("/resources/ebook/mixed-case/");
  });
});
