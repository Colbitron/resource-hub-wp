import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceArticle } from "../components/ResourceArticle";
import { ResourceCard } from "../components/ResourceCard";
import { toCard } from "../lib/wp/cards";
import { wpResourceSchema, type WpResource } from "../lib/wp/schemas/rest";
import nextConfig from "../next.config";

/**
 * The front end's half of the contract's markup fixtures
 * (`packages/ui/README.md`, "Markup fixtures"): each sample resource in
 * `packages/ui/fixtures/markup/{case}.json`, fed through the same mapping the
 * pages use, renders exactly the HTML in `{case}.card.html` (the listing's
 * row, `ResourceCard` at its default `h2`) and `{case}.meta.html` (the
 * resource page's meta line, from `ResourceArticle`'s header). The plugin's
 * `MarkupParityTest` renders its `resource-card` and `resource-meta` blocks
 * from the same samples and compares them with the same files, so a change to
 * either side's markup fails one of the two until the fixtures, and the other
 * side, follow.
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

const CASES = readdirSync(markup)
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
  it("finds the samples, each with its two fixtures", () => {
    expect(CASES).toEqual(expect.arrayContaining(["bare", "full", "unmapped"]));
    for (const name of CASES) {
      expect(readdirSync(markup)).toEqual(expect.arrayContaining([`${name}.card.html`, `${name}.meta.html`]));
    }
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
  });
});
