import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderSearch } from "../components/HeaderSearch";
import { CollectionHead, FeaturedSection, heading, offered } from "../components/ListingSections";
import { PageCard } from "../components/PageCard";
import { RelatedList } from "../components/RelatedList";
import { RELATED_HEADING, RELATED_HEADING_ID } from "../components/RelatedSection";
import { ResourceArticle } from "../components/ResourceArticle";
import { ResourceCard } from "../components/ResourceCard";
import { SearchPage } from "../components/SearchPage";
import { ThemeFieldset } from "../components/ThemeFieldset";
import { cmsUrls } from "../lib/env";
import type { ListingFilter } from "../lib/routes";
import { parseSearchRequest } from "../lib/search-request";
import { toCard, toPageCard } from "../lib/wp/cards";
import { RELATED_COUNT, toRelatedCard } from "../lib/wp/related";
import { wpPageSchema, wpResourceSchema, wpTermSchema, type WpPage, type WpResource, type WpTerm } from "../lib/wp/schemas/rest";
import { MAX_SEARCH_PAGE, SEARCH_PER_PAGE } from "../lib/wp/schemas/search";
import { searchSite, type SearchHit } from "../lib/wp/search";
import nextConfig from "../next.config";

// The search page's one read, stubbed with each scene's results; the header's control reads the path.
vi.mock("../lib/wp/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/wp/search")>()),
  searchSite: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/resources/",
}));

/**
 * The front end's half of the contract's markup fixtures
 * (`packages/ui/README.md`, "Markup fixtures"): each sample resource in
 * `packages/ui/fixtures/markup/{case}.json`, fed through the same mapping the
 * pages use, renders exactly the HTML in `{case}.card.html` (the listing's
 * row, `ResourceCard` at its default `h2`), `{case}.meta.html` (the
 * resource page's meta line, from `ResourceArticle`'s header),
 * `{case}.summary.html` (its summary) and `{case}.lead.html` (the library's
 * lead section, `FeaturedSection`); the first `RELATED_COUNT` samples in name
 * order, as the rows of the resource page's related section (`RelatedList`
 * with the section's heading and id, as `RelatedSection` renders it), render
 * exactly the HTML in `related.html`; and each scene in
 * `collection/{case}.json` (terms, resources and a request) renders, through
 * the listing's own `heading()` and `offered()`, exactly the head in
 * `collection/{case}.head.html` (`CollectionHead`: the heading, the count and
 * the filter bar). The plugin's `MarkupParityTest` renders its
 * `resource-card`, `resource-meta`, `resource-summary`, `related`,
 * `featured-lead` and `collection-head` blocks from the same samples and
 * compares them with the same files, so a change to either side's markup
 * fails one of the two until the fixtures, and the other side, follow.
 * The footer's theme control takes no
 * sample: `ThemeFieldset`, as the server renders it (no choice known, so
 * nothing checked and the group pending), is `theme-control.html`, which the
 * CMS theme's footer part holds verbatim and the plugin's `ThemeControlTest`
 * renders. The ids differ by design, React's `useId` against the CMS's
 * `rh-theme-{choice}`, so the test writes each input's id, and the `for` of
 * its label, as the CMS's before comparing; everything else counts. Nor does
 * the header's search control: `HeaderSearch`, as the server renders it on
 * any page but the search page (a link to `/search/`), is
 * `header-search.html`, which the CMS theme's header part holds verbatim and
 * the plugin's `ThemeHeaderSearchTest` renders.
 *
 * The search page (issue #115) has its own scenes in `search/{scene}.json`:
 * the reader's `input`, the `page`, the `total` and the matching `items`,
 * each a kind and a title. `SearchPage`, rendered for the request the front
 * end parses from that input and page with `searchSite` answering the
 * scene's results, must open with `search/{scene}.head.html` (the heading,
 * the form showing the input, and the count line when there is one) and, when
 * it lists no rows, show `search/{scene}.empty.html` (the sentence in
 * `rh-listing__empty`; an empty file where it shows none), which the plugin's
 * `search-head` and `search-empty` blocks render from the same scene over
 * core's main search query. A page among the results is `PageCard` from
 * `toPageCard()`, held to `page/{case}.card.html` for each sample page in
 * `page/{case}.json` (the REST API's `title.rendered`, `excerpt.rendered` and
 * `link`), which the plugin's `page-card` block renders from the stored page.
 * Two things differ by design on the CMS, where the plugin's test normalises
 * them: the form's field, and the first page's link, name core's query var
 * `s` where the front end's name `q`; the fixtures hold the front end's.
 *
 * The comparison normalises three things the HTML parser ignores, and nothing
 * else: whitespace that holds a line break between two tags, the fixtures'
 * own indentation, which neither renderer writes; the case of attribute
 * names, because React writes `dateTime` where PHP writes `datetime`; and the
 * spelling of a numeric character reference, because React writes `'` as
 * `&#x27;` where PHP writes `&#039;`, the same character. Every other byte
 * counts, the rest of the escaping included.
 *
 * `next.config.ts`'s `trailingSlash` reaches `next/link` as the build-time
 * `__NEXT_TRAILING_SLASH`; outside a Next.js build the link would drop the
 * slash, so the test sets it from the config as the build does.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const markup = path.resolve(here, "../../../packages/ui/fixtures/markup");
const collection = path.join(markup, "collection");
const searchScenes = path.join(markup, "search");
const pages = path.join(markup, "page");
const wpFixtures = path.join(here, "fixtures/wp");

interface SampleTerm {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
}

interface Sample {
  readonly id: number;
  readonly slug: string;
  readonly title: { readonly rendered: string };
  readonly date_gmt: string;
  readonly summary: string;
  readonly type: SampleTerm;
  readonly topics: readonly SampleTerm[];
}

/** A collection scene: the terms as the REST API lists them, the published resources, and the request's filter. */
interface Scene {
  readonly request: ListingFilter;
  readonly types: readonly SampleTerm[];
  readonly topics: readonly SampleTerm[];
  readonly resources: readonly { readonly type: string; readonly topics: readonly string[] }[];
}

const CASES = readdirSync(markup)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

const COLLECTION_CASES = readdirSync(collection)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

/** A search scene: the reader's words, the page, the total and what matched. */
interface SearchScene {
  readonly input: string;
  readonly page: number;
  readonly total: number;
  readonly items: readonly { readonly type: "resource" | "page"; readonly title: string }[];
}

/** A sample page in the REST API's forms, with the raw fields the CMS stores it from. */
interface SamplePage {
  readonly id: number;
  readonly slug: string;
  readonly link: string;
  readonly title: { readonly raw: string; readonly rendered: string };
  readonly excerpt: { readonly raw: string; readonly rendered: string };
}

const SEARCH_CASES = readdirSync(searchScenes)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

const PAGE_CASES = readdirSync(pages)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

/**
 * The fixtures' formatting removed (whitespace with a line break in it,
 * between two tags), attribute names lower-cased and numeric character
 * references written one way, in lower-case hex. ` name="` is only ever an
 * attribute's start here: both renderers escape every `"` in a value or a
 * text as `&quot;`.
 */
function normalise(html: string): string {
  return html
    .replace(/>\s*\n\s*</g, "><")
    .replace(/ ([A-Za-z][\w:.-]*)="/g, (_, name: string) => ` ${name.toLowerCase()}="`)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) => {
      const value = code[0] === "x" || code[0] === "X" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return `&#x${value.toString(16)};`;
    })
    .trim();
}

function fixture(name: string): string {
  return normalise(readFileSync(path.join(markup, name), "utf8"));
}

function scene(name: string): Scene {
  return JSON.parse(readFileSync(path.join(collection, `${name}.json`), "utf8")) as Scene;
}

/**
 * A scene's terms as the REST API lists them for the filter bar, each with
 * its `count` of the scene's resources carrying it, parsed by the reader schema.
 */
function sceneTerms(data: Scene, taxonomy: "resource_type" | "resource_topic"): WpTerm[] {
  const terms = taxonomy === "resource_type" ? data.types : data.topics;
  return terms.map((value) =>
    wpTermSchema.parse({
      ...term(taxonomy, value),
      count: data.resources.filter((resource) =>
        taxonomy === "resource_type" ? resource.type === value.slug : resource.topics.includes(value.slug),
      ).length,
    }),
  );
}

/** The scene's resources that match its request: what the CMS counts for the page. */
function sceneTotal(data: Scene): number {
  const { type, topic } = data.request;
  return data.resources.filter(
    (resource) => (type === undefined || resource.type === type) && (topic === undefined || resource.topics.includes(topic)),
  ).length;
}

function sample(name: string): Sample {
  return JSON.parse(readFileSync(path.join(markup, `${name}.json`), "utf8")) as Sample;
}

function term(taxonomy: "resource_type" | "resource_topic", value: SampleTerm): Record<string, unknown> {
  return { id: value.id, name: value.name, slug: value.slug, taxonomy, link: `https://cms.example/${value.slug}/` };
}

/** A captured REST resource with the sample's values in place of its own, parsed by the reader schema. */
function sampleResource(data: Sample): WpResource {
  const raw = JSON.parse(readFileSync(path.join(wpFixtures, "resource.single.json"), "utf8")) as Record<string, unknown>;
  return wpResourceSchema.parse({
    ...raw,
    id: data.id,
    slug: data.slug,
    title: { rendered: data.title.rendered },
    date_gmt: data.date_gmt,
    content: { rendered: "<p>Body.</p>", protected: false },
    featured_media: 0,
    meta: { ...(raw.meta as Record<string, unknown>), summary: data.summary, source_url: "" },
    resource_type: [data.type.id],
    resource_topic: data.topics.map((topic) => topic.id),
    resource_flag: [],
    _embedded: {
      "wp:term": [data.topics.map((topic) => term("resource_topic", topic)), [term("resource_type", data.type)]],
    },
  });
}

function searchScene(name: string): SearchScene {
  return JSON.parse(readFileSync(path.join(searchScenes, `${name}.json`), "utf8")) as SearchScene;
}

function samplePage(name: string): SamplePage {
  return JSON.parse(readFileSync(path.join(pages, `${name}.json`), "utf8")) as SamplePage;
}

/** A sample page as the REST API lists it, parsed by the reader schema. */
function wpPage(data: Pick<SamplePage, "id" | "slug" | "link" | "title" | "excerpt">): WpPage {
  return wpPageSchema.parse({
    id: data.id,
    slug: data.slug,
    link: data.link,
    parent: 0,
    date_gmt: "2026-11-01T09:00:00",
    modified_gmt: "2026-11-02T10:00:00",
    title: { rendered: data.title.rendered },
    content: { rendered: "<p>Body.</p>", protected: false },
    excerpt: { rendered: data.excerpt.rendered, protected: false },
  });
}

/** A scene's items as the route's hits: the captured resource with the item's title, or a page at its own path. */
function sceneHits(data: SearchScene): SearchHit[] {
  const raw = JSON.parse(readFileSync(path.join(wpFixtures, "resource.single.json"), "utf8")) as Record<string, unknown>;
  return data.items.map((item, index) => {
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (item.type === "resource") {
      return { type: "resource", resource: wpResourceSchema.parse({ ...raw, id: 9000 + index, slug, title: { rendered: item.title } }) };
    }
    return {
      type: "page",
      page: wpPage({
        id: 9000 + index,
        slug,
        link: `https://cms.example/${slug}/`,
        title: { raw: item.title, rendered: item.title },
        excerpt: { raw: "", rendered: "<p>An excerpt.</p>\n" },
      }),
    };
  });
}

/** Where the search page's head ends: at its list, its empty state or its pagination, or the end. */
function searchHead(html: string): string {
  const ends = ['<ul class="rh-card-grid"', '<div class="rh-listing__empty"', '<nav class="rh-pagination"']
    .map((marker) => html.indexOf(marker))
    .filter((index) => index !== -1);
  return ends.length === 0 ? html : html.slice(0, Math.min(...ends));
}

/** The search page's empty state, or `""` when it shows none: its `<div>` holds only paragraphs. */
function searchEmpty(html: string): string {
  const start = html.indexOf('<div class="rh-listing__empty">');
  return start === -1 ? "" : html.slice(start, html.indexOf("</div>", start) + "</div>".length);
}

/** The summary paragraph out of the article, or `""` when it has none: its `<p>` holds no other `<p>`. */
function summaryParagraph(article: string): string {
  const start = article.indexOf('<p class="rh-resource__summary">');
  return start === -1 ? "" : article.slice(start, article.indexOf("</p>", start) + "</p>".length);
}

/** The meta line out of the article: its `<div>` holds no other `<div>`, so the first close after it ends it. */
function metaLine(article: string): string {
  const start = article.indexOf('<div class="rh-resource__meta">');
  expect(start).toBeGreaterThanOrEqual(0);
  return article.slice(start, article.indexOf("</div>", start) + "</div>".length);
}

beforeEach(() => {
  vi.stubEnv("__NEXT_TRAILING_SLASH", nextConfig.trailingSlash === true ? "true" : "");
  vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("markup parity with the CMS blocks", () => {
  it("finds the samples, each with its fixtures, the related section's and the collection scenes'", () => {
    expect(CASES).toEqual(expect.arrayContaining(["bare", "full", "unmapped"]));
    for (const name of CASES) {
      expect(readdirSync(markup)).toEqual(
        expect.arrayContaining([`${name}.card.html`, `${name}.meta.html`, `${name}.summary.html`, `${name}.lead.html`]),
      );
    }
    expect(readdirSync(markup)).toContain("related.html");
    expect(COLLECTION_CASES).toEqual(expect.arrayContaining(["library", "type", "topic", "type-topic", "empty-type"]));
    for (const name of COLLECTION_CASES) {
      expect(readdirSync(collection)).toContain(`${name}.head.html`);
    }
    expect(readdirSync(markup)).toContain("theme-control.html");
    expect(readdirSync(markup)).toContain("header-search.html");
    expect(SEARCH_CASES).toEqual(expect.arrayContaining(["none", "results", "one-result", "no-results", "later-page", "too-short", "past-the-cap"]));
    for (const name of SEARCH_CASES) {
      expect(readdirSync(searchScenes)).toEqual(expect.arrayContaining([`${name}.head.html`, `${name}.empty.html`]));
    }
    expect(PAGE_CASES).toEqual(expect.arrayContaining(["about", "untitled", "texturized"]));
    for (const name of PAGE_CASES) {
      expect(readdirSync(pages)).toContain(`${name}.card.html`);
    }
  });

  it("renders the header's search control, as the server does off the search page, as header-search.html", () => {
    expect(normalise(renderToStaticMarkup(<HeaderSearch />))).toBe(fixture("header-search.html"));
  });

  it("renders the footer's theme control, before the choice is known, as theme-control.html", () => {
    let html = renderToStaticMarkup(<ThemeFieldset name="theme" value={null} onChange={() => undefined} />);
    // Each input's generated id, and its label's `for`, as the CMS writes them.
    const ids = [...html.matchAll(/ id="([^"]+)" name="theme" value="([a-z]+)"/g)];
    expect(ids).toHaveLength(3);
    for (const [, id, value] of ids) {
      html = html.replaceAll(`"${id}"`, `"rh-theme-${value}"`);
    }
    expect(normalise(html)).toBe(fixture("theme-control.html"));
  });

  it(`renders the resource page's related section, with the first ${RELATED_COUNT} samples as rows, as related.html`, () => {
    const cards = CASES.slice(0, RELATED_COUNT).map((name) => toRelatedCard(sampleResource(sample(name))));
    for (const card of cards) {
      expect(card).not.toBeNull();
    }
    const html = renderToStaticMarkup(
      <RelatedList heading={RELATED_HEADING} headingId={RELATED_HEADING_ID} cards={cards.filter((card) => card !== null)} />,
    );
    expect(normalise(html)).toBe(fixture("related.html"));
  });

  describe.each(CASES)("%s", (name) => {
    it(`renders the listing's row as ${name}.card.html`, () => {
      const card = toCard(sampleResource(sample(name)));
      expect(card).not.toBeNull();
      expect(normalise(renderToStaticMarkup(<ResourceCard {...card!} />))).toBe(fixture(`${name}.card.html`));
    });

    it(`renders the resource page's meta line as ${name}.meta.html`, () => {
      const data = sample(name);
      const resource = sampleResource(data);
      const html = renderToStaticMarkup(
        <ResourceArticle rendered={{ kind: "render", resource, type: data.type.slug, slug: data.slug }} />,
      );
      expect(normalise(metaLine(html))).toBe(fixture(`${name}.meta.html`));
    });

    it(`renders the resource page's summary as ${name}.summary.html`, () => {
      const data = sample(name);
      const html = renderToStaticMarkup(
        <ResourceArticle rendered={{ kind: "render", resource: sampleResource(data), type: data.type.slug, slug: data.slug }} />,
      );
      expect(normalise(summaryParagraph(html))).toBe(fixture(`${name}.summary.html`));
    });

    it(`renders the library's lead section as ${name}.lead.html`, () => {
      const card = toCard(sampleResource(sample(name)));
      expect(card).not.toBeNull();
      expect(normalise(renderToStaticMarkup(<FeaturedSection lead={card!} />))).toBe(fixture(`${name}.lead.html`));
    });
  });

  describe.each(PAGE_CASES)("page %s", (name) => {
    it(`renders the search results' page row as page/${name}.card.html`, () => {
      const card = toPageCard(wpPage(samplePage(name)), cmsUrls().cmsOrigins);
      expect(card).not.toBeNull();
      expect(normalise(renderToStaticMarkup(<PageCard {...card!} />))).toBe(fixture(`page/${name}.card.html`));
    });
  });

  describe.each(SEARCH_CASES)("search %s", (name) => {
    it(`renders the search page's head as search/${name}.head.html and its empty state as search/${name}.empty.html`, async () => {
      const data = searchScene(name);
      expect(data.items).toHaveLength(data.total === 0 || data.page > Math.ceil(data.total / SEARCH_PER_PAGE) ? data.items.length : Math.min(data.total, SEARCH_PER_PAGE));
      const search = vi.mocked(searchSite);
      search.mockReset();
      search.mockResolvedValue({
        items: data.page <= Math.ceil(data.total / SEARCH_PER_PAGE) ? sceneHits(data) : [],
        total: data.total,
        pages: Math.min(Math.ceil(data.total / SEARCH_PER_PAGE), MAX_SEARCH_PAGE),
      });
      const html = renderToStaticMarkup(await SearchPage({ request: parseSearchRequest({ q: data.input, page: String(data.page) }) }));
      expect(normalise(searchHead(html))).toBe(fixture(`search/${name}.head.html`));
      expect(normalise(searchEmpty(html))).toBe(fixture(`search/${name}.empty.html`));
    });
  });

  describe.each(COLLECTION_CASES)("collection %s", (name) => {
    it(`renders the collection's head as collection/${name}.head.html`, () => {
      const data = scene(name);
      const types = sceneTerms(data, "resource_type");
      const topics = sceneTerms(data, "resource_topic");
      const current = {
        type: types.find((candidate) => candidate.slug === data.request.type),
        topic: topics.find((candidate) => candidate.slug === data.request.topic),
      };
      expect(current.type === undefined).toBe(data.request.type === undefined);
      expect(current.topic === undefined).toBe(data.request.topic === undefined);
      const html = renderToStaticMarkup(
        <CollectionHead
          name={heading(current)}
          total={sceneTotal(data)}
          types={offered(types, data.request.type)}
          topics={offered(topics, data.request.topic)}
          current={data.request}
        />,
      );
      expect(normalise(html)).toBe(fixture(`collection/${name}.head.html`));
    });
  });
});
