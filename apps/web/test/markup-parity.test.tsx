import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceArticle } from "../components/ResourceArticle";
import { ResourceCard } from "../components/ResourceCard";
import { toCard } from "../lib/wp/cards";
import { wpResourceSchema, type WpResource } from "../lib/wp/schemas/rest";

/**
 * The front end's half of the contract's markup fixtures
 * (`packages/ui/README.md`, "Markup fixtures"): the sample resource in
 * `packages/ui/fixtures/markup/resource.json`, fed through the same mapping
 * the pages use, renders exactly the HTML in `resource-card.html` (the
 * listing's row, `ResourceCard` at its default `h2`) and `resource-meta.html`
 * (the resource page's meta line, from `ResourceArticle`'s header). The
 * plugin's `MarkupParityTest` renders its `resource-card` and
 * `resource-meta` blocks from the same sample and compares them with the same
 * files, so a change to either side's markup fails one of the two until the
 * fixture, and the other side, follow.
 *
 * The comparison normalises two things the HTML parser ignores, and nothing
 * else: whitespace that holds a line break between two tags, the fixtures'
 * own indentation, which neither renderer writes; and the case of attribute
 * names, because React writes `dateTime` where PHP writes `datetime`, the
 * same attribute to every browser. Every other byte counts, the escaping
 * included.
 *
 * `next.config.ts` sets `trailingSlash: true`, which reaches `next/link` as
 * the build-time `__NEXT_TRAILING_SLASH`; outside a Next.js build the link
 * would drop the slash, so the test sets it as the build does.
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

const SAMPLE = JSON.parse(readFileSync(path.join(markup, "resource.json"), "utf8")) as Sample;

/**
 * The fixtures' formatting removed (whitespace with a line break in it,
 * between two tags) and attribute names lower-cased. ` name="` is only ever
 * an attribute's start here: both renderers escape every `"` in a value or a
 * text as `&quot;`.
 */
function normalise(html: string): string {
  return html
    .replace(/>\s*\n\s*</g, "><")
    .replace(/ ([A-Za-z][\w:.-]*)="/g, (_, name: string) => ` ${name.toLowerCase()}="`)
    .trim();
}

function fixture(name: string): string {
  return normalise(readFileSync(path.join(markup, name), "utf8"));
}

function term(taxonomy: "resource_type" | "resource_topic", sample: SampleTerm): Record<string, unknown> {
  return { id: sample.id, name: sample.name, slug: sample.slug, taxonomy, link: `https://cms.example/${sample.slug}/` };
}

/** A captured REST resource with the sample's values in place of its own, parsed by the reader schema. */
function sampleResource(): WpResource {
  const raw = JSON.parse(readFileSync(path.join(wpFixtures, "resource.single.json"), "utf8")) as Record<string, unknown>;
  return wpResourceSchema.parse({
    ...raw,
    id: SAMPLE.id,
    slug: SAMPLE.slug,
    title: { rendered: SAMPLE.title.rendered },
    date_gmt: SAMPLE.date_gmt,
    content: { rendered: "<p>Body.</p>", protected: false },
    featured_media: 0,
    meta: { ...(raw.meta as Record<string, unknown>), summary: SAMPLE.summary, source_url: "" },
    resource_type: [SAMPLE.type.id],
    resource_topic: SAMPLE.topics.map((topic) => topic.id),
    resource_flag: [],
    _embedded: {
      "wp:term": [
        SAMPLE.topics.map((topic) => term("resource_topic", topic)),
        [term("resource_type", SAMPLE.type)],
      ],
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
  vi.stubEnv("__NEXT_TRAILING_SLASH", "true");
  vi.stubEnv("WP_API_URL", "https://cms.example/wp-json");
  vi.stubEnv("WP_MEDIA_ORIGIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("markup parity with the CMS blocks", () => {
  it("renders the listing's row as resource-card.html", () => {
    const card = toCard(sampleResource());
    expect(card).not.toBeNull();
    expect(normalise(renderToStaticMarkup(<ResourceCard {...card!} />))).toBe(fixture("resource-card.html"));
  });

  it("renders the resource page's meta line as resource-meta.html", () => {
    const resource = sampleResource();
    const html = renderToStaticMarkup(
      <ResourceArticle rendered={{ kind: "render", resource, type: SAMPLE.type.slug, slug: SAMPLE.slug }} />,
    );
    expect(normalise(metaLine(html))).toBe(fixture("resource-meta.html"));
  });
});
