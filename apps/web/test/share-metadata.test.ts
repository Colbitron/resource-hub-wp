import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listingMetadata } from "../components/ListingPage";
import { pageMetadata } from "../components/PageArticle";
import { resourceMetadata } from "../components/ResourceArticle";
import { welcomeMetadata } from "../components/WelcomePage";
import { generateMetadata as rootMetadata } from "../app/layout";
import { shareMetadata } from "../lib/share-metadata";
import { wpPageSchema, wpResourceSchema, type WpResource } from "../lib/wp/schemas/rest";

// The root layout loads Figtree through `next/font/local`, which only Next.js's
// compiler can run; its metadata never reads the font, so the module is stood in.
vi.mock("../app/fonts", () => ({ figtree: { className: "", variable: "", style: { fontFamily: "" } } }));

/**
 * The X card rule (`lib/share-metadata.ts`): `summary_large_image` only with
 * an Open Graph image, `summary` otherwise, and only the card type, since X
 * reads the title, description, image and alt from `og:*`. Then each builder
 * that sets Open Graph, so every route follows the rule; a listing, which
 * sets neither; and the root layout, which sets neither and so cannot leak a
 * card into a page.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp");
const RAW = JSON.parse(readFileSync(path.join(fixtures, "resource.single.json"), "utf8")) as Record<string, unknown>;
const LIST = readFileSync(path.join(fixtures, "resources.list.json"), "utf8");
const LIST_HEADERS = JSON.parse(readFileSync(path.join(fixtures, "resources.list.headers.json"), "utf8")) as Record<string, string>;

/** The captured resource with its featured media replaced, parsed by the reader schema. */
function withMedia(entries: unknown[]): WpResource {
  const raw = structuredClone(RAW);
  const embedded = raw._embedded as Record<string, unknown>;
  return wpResourceSchema.parse({ ...raw, _embedded: { ...embedded, "wp:featuredmedia": entries } });
}

const WIDE = {
  source_url: "https://cms.example/wp-content/uploads/2026/11/share.jpg",
  alt_text: "A photo",
  media_details: {
    width: 2400,
    height: 1260,
    sizes: { "1536x1536": { source_url: "https://cms.example/wp-content/uploads/2026/11/share-1536x806.jpg", width: 1536, height: 806 } },
  },
};

beforeEach(() => {
  vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("shareMetadata", () => {
  it("advertises the large card when Open Graph names an image", () => {
    expect(shareMetadata({ title: "A", images: [{ url: "/media/a.jpg", width: 1200, height: 630 }] }).twitter).toEqual({
      card: "summary_large_image",
    });
    expect(shareMetadata({ title: "A", images: "/media/a.jpg" }).twitter).toEqual({ card: "summary_large_image" });
  });

  it("falls back to the summary card with no image, never the large one", () => {
    expect(shareMetadata({ title: "A" }).twitter).toEqual({ card: "summary" });
    expect(shareMetadata({ title: "A", images: [] }).twitter).toEqual({ card: "summary" });
  });

  it("does not count an image with no URL, which Next.js drops", () => {
    expect(shareMetadata({ title: "A", images: "" }).twitter).toEqual({ card: "summary" });
    expect(shareMetadata({ title: "A", images: [{ url: "" }] }).twitter).toEqual({ card: "summary" });
    expect(shareMetadata({ title: "A", images: [{ url: "" }, { url: "/media/a.jpg" }] }).twitter).toEqual({ card: "summary_large_image" });
    expect(shareMetadata({ title: "A", images: new URL("https://site.example/media/a.jpg") }).twitter).toEqual({ card: "summary_large_image" });
  });

  it("passes Open Graph through unchanged and copies nothing of it into twitter", () => {
    const openGraph = { type: "website" as const, title: "A", description: "B", images: ["/media/a.jpg"] };
    const share = shareMetadata(openGraph);
    expect(share.openGraph).toBe(openGraph);
    expect(Object.keys(share.twitter ?? {})).toEqual(["card"]);
  });
});

describe("the builders", () => {
  it("gives a resource with a featured image the large card, beside its og:image", () => {
    const metadata = resourceMetadata({ kind: "render", resource: withMedia([WIDE]), type: "guide", slug: "a-field-guide-to-revalidation" });
    expect(metadata.twitter).toEqual({ card: "summary_large_image" });
    expect(metadata.openGraph?.images).toEqual([{ url: "/media/2026/11/share-1536x806.jpg", width: 1536, height: 806, alt: "A photo" }]);
  });

  it("gives a resource with no featured image the summary card", () => {
    const metadata = resourceMetadata({ kind: "render", resource: withMedia([]), type: "guide", slug: "a-field-guide-to-revalidation" });
    expect(metadata.twitter).toEqual({ card: "summary" });
    expect(metadata.openGraph?.images).toBeUndefined();
  });

  it("gives a CMS page and the welcome page the summary card", () => {
    const page = wpPageSchema.parse({
      id: 14,
      slug: "team",
      link: "https://cms.example/about/team/",
      parent: 13,
      date_gmt: "2026-11-01T09:00:00",
      modified_gmt: "2026-11-02T10:00:00",
      title: { rendered: "Team" },
      content: { rendered: "<p>Us.</p>", protected: false },
      excerpt: { rendered: "<p>Who we are.</p>\n", protected: false },
    });
    expect(pageMetadata({ kind: "render", page, path: "/about/team/" }).twitter).toEqual({ card: "summary" });
    expect(welcomeMetadata.twitter).toEqual({ card: "summary" });
  });

  it("leaves Open Graph and twitter out of a listing, which X then gives no card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(LIST, { status: 200, headers: { "Content-Type": "application/json; charset=UTF-8", ...LIST_HEADERS } })),
    );
    const metadata = await listingMetadata({});
    expect(metadata.title).toBe("Resources");
    expect(metadata).not.toHaveProperty("openGraph");
    expect(metadata).not.toHaveProperty("twitter");
  });

  it("leaves Open Graph and twitter out of the root layout, so no page inherits a card", () => {
    const metadata = rootMetadata();
    expect(metadata).not.toHaveProperty("openGraph");
    expect(metadata).not.toHaveProperty("twitter");
  });
});
