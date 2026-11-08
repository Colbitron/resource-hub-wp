import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import appleIcon from "@/app/apple-icon.png";
import NotFound from "@/app/not-found";
import shareImage from "@/app/opengraph-image.png";
import { BrandLockup, BrandMark } from "@/components/Brand";
import { FeaturedLead, type FeaturedLeadProps } from "@/components/FeaturedLead";
import { FilterNav, type FilterTerm } from "@/components/FilterNav";
import { PageArticle } from "@/components/PageArticle";
import { Pagination } from "@/components/Pagination";
import { ResourceArticle } from "@/components/ResourceArticle";
import { ResourceCard, type ResourceCardProps } from "@/components/ResourceCard";
import { WelcomePage } from "@/components/WelcomePage";
import { renderContent, type RenderBlock } from "@/lib/content/render";
import { cmsUrls } from "@/lib/env";
import type { RenderedPage } from "@/lib/page-request";
import type { RenderedResource } from "@/lib/redirects";
import { listingPath } from "@/lib/routes";
import { THEME_CHOICES } from "@/lib/theme";
import { wpPageSchema, wpResourceSchema } from "@/lib/wp/schemas/rest";

import {
  COLOR_TOKENS,
  FONT_TOKENS,
  HEADING_TOKENS,
  LABEL_TOKENS,
  LEADING_TOKENS,
  MARK_TOKENS,
  LINE_TOKENS,
  MEASURE_TOKENS,
  RADIUS_TOKENS,
  SPACE_TOKENS,
  TEXT_SIZE_TOKENS,
} from "./tokens";
import { StillThemeFieldset } from "./StillThemeFieldset";

// The listing's own styles (filters, pagination, the empty state), which
// ListingPage imports for the real routes; every other component brings its
// own stylesheet, as on the real pages (ResourceArticle `resource.css` and
// `prose.css`, PageArticle and WelcomePage `page.css`, the 404 page
// `not-found.css`, ResourceCard the shared `card.css`).
import "@colbitron/resource-hub-ui/listing.css";
import "@colbitron/resource-hub-ui/prose.css";
import "./specimen.css";

/**
 * The design specimen: every shared token, and the real components with
 * fixture props, on one page. It is the reference the design work points
 * to and the target of the screenshot tests (`e2e/specimen.screenshot.ts`,
 * at 360 and 1280 px, light and dark), so a change to a token or a
 * component shows up here as a pixel diff. A route only under
 * `RH_FIXTURES=1`, like every page under `app/fixtures/`; a production build
 * never includes it.
 *
 * It renders inside the root layout, so the shell (skip link, header,
 * footer) is the real one. Everything here is static: no CMS request, no
 * client JavaScript of its own. The lead's image is one of the mock CMS's
 * uploads through `/media/`, loaded eagerly as on the library, so a
 * full-page screenshot never catches it half-loaded. Specimen-only layout
 * (swatch grids, bars, the frame around each whole-page component) lives in
 * `specimen.css`, built on the same tokens; no component style is
 * overridden.
 *
 * The whole-page components (a resource, a CMS page, the welcome page, the
 * 404 page) are rendered with fixture data shaped as the CMS sends it, parsed
 * with the data layer's own schemas, so they meet the same types the routes
 * hand them. Each brings its own `<h1>`, as on its route; here they are
 * samples under the specimen's sections, so the page has several `<h1>`s
 * nested under `<h2>`s. They come from the real components and are kept so
 * the pixels are theirs; this page is not a heading-structure reference
 * (each route's own spec and the axe scan check that).
 *
 * The brand section shows the mark at its sizes, the lockup with its clear
 * space, and the two committed PNGs, the apple touch icon and the default
 * share image, as the files `scripts/render-brand-images.mts` wrote them
 * (static imports, `unoptimized`, so the pixels are the committed ones).
 *
 * The states section shows what the other sections cannot: the focus ring
 * (the screenshot test focuses `#specimen-focus` before the capture), both
 * filter rows with a term selected, pagination at its first and last pages,
 * where Previous and Next are left out rather than disabled (the
 * component's rule), the theme control in each of its three states (the
 * footer's own copy is live and shows the stored choice; these are still),
 * a lead without an image, and a listing's empty state.
 */

export const metadata: Metadata = {
  title: "Design specimen",
  robots: { index: false },
};

/** The mark at the smallest size it is used (a 16 px favicon), the lockup's, and larger. */
const MARK_SIZES = [16, 24, 28, 48, 96];

const TYPES: FilterTerm[] = [
  { slug: "article", name: "Article" },
  { slug: "case-study", name: "Case study" },
  { slug: "ebook", name: "Ebook" },
  { slug: "podcast", name: "Podcast" },
  { slug: "webinar", name: "Webinar" },
];

const TOPICS: FilterTerm[] = [
  { slug: "accessibility", name: "Accessibility" },
  { slug: "content-modelling", name: "Content modelling" },
  { slug: "editorial-workflow", name: "Editorial workflow" },
  { slug: "headless-delivery", name: "Headless delivery" },
  { slug: "performance", name: "Performance" },
];

/**
 * The lead: the long-form resource with its 1600×900 image (the seed's ID
 * 30), as the library's first page shows its newest featured resource.
 */
const LEAD: FeaturedLeadProps = {
  title: "Taxonomies versus meta",
  href: "/resources/article/taxonomies-versus-meta/",
  typeLabel: "Article",
  accent: "mint",
  topicLabels: ["Content modelling"],
  summary: "When a value is a term and when it is a field, with the REST and query consequences of each.",
  date: "2026-10-28T09:00:00Z",
  image: {
    src: "/media/2026/11/taxonomies-versus-meta.png",
    alt: "Three boxes joined by two bars: a term, a post and a field",
    width: 1600,
    height: 900,
  },
};

/** A lead for a featured resource without a trusted image: the text alone, at the full width. */
const LEAD_WITHOUT_IMAGE: FeaturedLeadProps = {
  title: "The anatomy of a resource",
  href: "/resources/webinar/the-anatomy-of-a-resource/",
  typeLabel: "Webinar",
  accent: "coral",
  topicLabels: ["Content modelling", "Editorial workflow"],
  summary: "Which fields belong in meta, which in taxonomies, and what to leave out until an editor asks.",
  date: "2026-10-24T09:00:00Z",
};

/**
 * One row per resource type, each with its mark, then a type the accent
 * table does not know, with the neutral mark; one row has no summary and
 * a title long enough to wrap at every width.
 */
const CARDS: ResourceCardProps[] = [
  {
    title: "Alt text at scale",
    href: "/resources/article/alt-text-at-scale/",
    typeLabel: "Article",
    accent: "mint",
    topicLabels: ["Accessibility", "Editorial workflow"],
    summary: "How a small editorial team keeps alt text accurate across thousands of images without a bottleneck.",
    date: "2026-10-31T09:00:00Z",
  },
  {
    title: "One content model, five channels",
    href: "/resources/case-study/one-content-model-five-channels/",
    typeLabel: "Case study",
    accent: "cobalt",
    topicLabels: ["Content modelling", "Headless delivery"],
    summary: "A publisher's move from page-shaped content to a model that feeds the web, email, apps and partners.",
    date: "2026-10-14T12:00:00Z",
  },
  {
    title: "A field guide to revalidation",
    href: "/resources/ebook/a-field-guide-to-revalidation/",
    typeLabel: "Ebook",
    accent: "grape",
    topicLabels: ["Headless delivery", "Performance"],
    summary: "On-demand, time-based, and tag-based revalidation compared, with the failure modes of each written down.",
    date: "2026-09-30T08:30:00Z",
  },
  {
    title: "Editorial review without the bottleneck",
    href: "/resources/podcast/editorial-review-without-the-bottleneck/",
    typeLabel: "Podcast",
    accent: "lemon",
    topicLabels: ["Editorial workflow"],
    summary: "Two editors on review queues, who approves what, and how a headless site shows the result.",
    date: "2026-09-02T16:00:00Z",
  },
  {
    title: "A very long webinar title that wraps across several lines, to show how a row holds a heading that runs on",
    href: "/resources/webinar/the-anatomy-of-a-resource/",
    typeLabel: "Webinar",
    accent: "coral",
    topicLabels: ["Accessibility", "Content modelling", "Editorial workflow", "Performance"],
    summary: "",
    date: "2026-08-01T00:00:00Z",
  },
  {
    title: "A guide the accent table does not know",
    href: "/resources/guide/a-guide-the-accent-table-does-not-know/",
    typeLabel: "Guide",
    accent: "neutral",
    topicLabels: ["Content modelling"],
    summary: "A type added in the CMS before its accent row ships gets the neutral mark, in the ink.",
    date: "2026-07-01T09:00:00Z",
  },
];

/**
 * A body as an editor writes it, through the same server-side pass as a
 * resource's or a page's (`renderContent` in `lib/content/render.tsx`), so
 * the table gets its labelled scrolling region and the links their
 * rewrites, as on the real pages.
 */
/** The CMS's site origin and uploads directory under test, so the fixtures' URLs are rewritten as the CMS's are. */
function cms() {
  const urls = cmsUrls();
  return { site: urls.cmsOrigins[0], uploads: urls.uploadsBase };
}

/**
 * The block marker as the pass's own fallback: the specimen is fixture data
 * and makes no CMS read, so the two articles render the marker as the CMS
 * sent it, which is also what a reader sees when the block's read fails.
 */
const showFallback: RenderBlock = (_props, fallback) => fallback;

/**
 * The long-form resource's shape (the seed's ID 30) with a short body that
 * has one of each thing the article styles: a paragraph, a list, a quote,
 * a heading, a figure with an upload (through `/media/`, lazy as on the
 * page; the screenshot spec scrolls it into view before capturing), a
 * table, a code block, and the related-resources block marker as the CMS
 * renders it, its heading and the rows of `card.css`, whose links point at
 * the CMS. The default `renderBlock` renders the marker's fallback, which
 * is what the resource page shows when the block's own read fails; the
 * specimen makes no CMS read, so it shows that rendering rather than the
 * swapped `<RelatedResources>`.
 */
function resourceFixture(): RenderedResource {
  const { site, uploads } = cms();
  const resource = wpResourceSchema.parse({
    id: 30,
    slug: "taxonomies-versus-meta",
    link: `${site}/resources/article/taxonomies-versus-meta/`,
    date: "2026-10-28T09:00:00",
    date_gmt: "2026-10-28T09:00:00",
    modified: "2026-10-28T09:00:00",
    title: { rendered: "Taxonomies versus meta" },
    content: {
      rendered: `
<p>A value an editor filters by is a term; a value that belongs to one resource alone is a field. The rest of this resource is the reasoning, with <a href="${site}/resources/topic/content-modelling/">more on content modelling</a> in the library.</p>
<ul><li>Terms are shared and listed.</li><li>Fields are private to their post.</li></ul>
<blockquote class="wp-block-quote"><p>Put a value in a taxonomy when you would build a page for it. Put it in meta when you would not.</p><cite>A rule of thumb from the plugin's first review</cite></blockquote>
<h2 class="wp-block-heading">What each choice costs</h2>
<figure class="wp-block-image size-full"><img src="${uploads}/2026/11/content-model.png" alt="A content model diagram" class="wp-image-101" width="240" height="160" /><figcaption class="wp-element-caption">The content model: one post type, three taxonomies, two fields.</figcaption></figure>
<figure class="wp-block-table"><table><thead><tr><th>Question</th><th>Term</th><th>Field</th></tr></thead><tbody><tr><td>Filter a listing by it</td><td>Yes, by ID</td><td>No</td></tr><tr><td>Has a page of its own</td><td>Yes</td><td>No</td></tr><tr><td>Appears in <code>_embed</code></td><td>Under <code>wp:term</code></td><td>Under <code>meta</code></td></tr></tbody></table></figure>
<p>A resource's terms arrive as IDs with the terms embedded; its fields arrive inline:</p>
<pre class="wp-block-code"><code>{
  "resource_type": [3],
  "resource_topic": [8, 11],
  "meta": { "summary": "When a value is a term and when it is a field." }
}</code></pre>
<div class="wp-block-resource-hub-related-resources rh-related" data-rh-block="related-resources" data-count="3" data-topic="content-modelling" data-topic-id="8" data-exclude="30"><h2>More on content modelling</h2><ul class="rh-card-grid" role="list"><li><article class="rh-card"><p class="rh-card__meta"><span class="rh-card__type" data-accent="cobalt">Case study</span><time datetime="2026-10-28T09:00:00Z">Oct 28, 2026</time></p><div class="rh-card__body"><h3 class="rh-card__title"><a class="rh-card__link" href="${site}/resources/case-study/one-content-model-five-channels/">One content model, five channels</a></h3><p class="rh-card__summary">A publisher's move from page-shaped content to a model that feeds the web, email, apps and partners.</p><ul class="rh-card__topics" aria-label="Topics" role="list"><li class="rh-card__topic">Content modelling</li></ul></div></article></li><li><article class="rh-card"><p class="rh-card__meta"><span class="rh-card__type" data-accent="coral">Webinar</span><time datetime="2026-10-24T09:00:00Z">Oct 24, 2026</time></p><div class="rh-card__body"><h3 class="rh-card__title"><a class="rh-card__link" href="${site}/resources/webinar/the-anatomy-of-a-resource/">The anatomy of a resource</a></h3><p class="rh-card__summary">Which fields belong in meta, which in taxonomies, and what to leave out until an editor asks.</p><ul class="rh-card__topics" aria-label="Topics" role="list"><li class="rh-card__topic">Content modelling</li><li class="rh-card__topic">Editorial workflow</li></ul></div></article></li></ul></div>
`,
    },
    excerpt: { rendered: "" },
    meta: {
      summary: "When a value is a term and when it is a field, with the REST and query consequences of each.",
      source_url: "https://example.com/downloads/taxonomies-versus-meta",
    },
    resource_type: [3],
    resource_topic: [8, 11],
    resource_flag: [],
    _embedded: {
      "wp:term": [
        [{ id: 3, slug: "article", name: "Article", taxonomy: "resource_type" }],
        [
          { id: 8, slug: "content-modelling", name: "Content modelling", taxonomy: "resource_topic" },
          { id: 11, slug: "performance", name: "Performance", taxonomy: "resource_topic" },
        ],
      ],
      "wp:featuredmedia": [
        {
          source_url: `${uploads}/2026/11/taxonomies-versus-meta.png`,
          alt_text: "",
          media_details: { width: 1600, height: 900, sizes: {} },
        },
      ],
    },
  });
  return { kind: "render", resource, type: "article", slug: resource.slug };
}

/** A published CMS page (the seed's `welcome`) with a short body: a CMS link and an external one. */
function pageFixture(): Extract<RenderedPage, { kind: "render" }> {
  const { site } = cms();
  const page = wpPageSchema.parse({
    id: 60,
    slug: "welcome",
    link: `${site}/welcome/`,
    parent: 0,
    date_gmt: "2026-11-01T09:00:00",
    modified_gmt: "2026-11-01T09:00:00",
    title: { rendered: "Welcome to the hub" },
    content: {
      rendered: `
<p>This library collects what the team has written about running a headless site: <a href="${site}/resources/">the whole library</a>, sorted by type and topic.</p>
<h2>Who it is for</h2>
<p>Editors and developers who share one content model. The <a href="https://www.w3.org/WAI/standards-guidelines/wcag/">accessibility guidelines</a> it follows are public.</p>
`,
      protected: false,
    },
    excerpt: { rendered: "<p>What this library is for.</p>" },
  });
  return { kind: "render", page, path: "/welcome/" };
}

const PROSE = `
<p>A paragraph of body text with <a href="/resources/">a link to the library</a>, some <strong>strong</strong> and <em>emphasised</em> words, and <code>inline code</code>. Body text sits at the reading measure, so a line never runs much past sixty-five characters.</p>
<h2>A second-level heading</h2>
<p>Headings in a body start at the second level: the page's title is its only first-level heading.</p>
<h3>A third-level heading</h3>
<ul>
<li>An unordered list item</li>
<li>A second item, long enough to wrap onto another line at phone width and show the hanging indent</li>
<li>A third item</li>
</ul>
<ol>
<li>An ordered list item</li>
<li>A second step</li>
</ol>
<blockquote><p>A blockquote: what someone said, set apart from the text around it.</p><cite>A source</cite></blockquote>
<p>A code block, which wraps rather than scrolls, and keeps its <code>indentation</code>:</p>
<pre><code>{
  "resource_type": [5],
  "meta": { "source_url": "https://example.com/downloads/a-field-guide" }
}</code></pre>
<table>
<caption>Release matrix</caption>
<thead><tr><th>Event</th><th>Tags</th><th>Paths</th></tr></thead>
<tbody>
<tr><td>publish</td><td>resources, resource:slug, type:slug, topic:slug</td><td>/resources/, the type and topic listings</td></tr>
<tr><td>update</td><td>the current and the previous state</td><td>both states' listings and the resource</td></tr>
<tr><td>delete</td><td>the last public state</td><td>the listings it was on</td></tr>
</tbody>
</table>
`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="rh-specimen__section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** A token's name as the specimen labels it, with `data-token` for e2e/specimen.spec.ts. */
function TokenRow({ token, children }: { token: string; children: ReactNode }) {
  return (
    <li className="rh-specimen__row" data-token={token}>
      {children}
      <code className="rh-specimen__name">{token}</code>
    </li>
  );
}

function cssVar(token: string): string {
  return `var(${token})`;
}

export default function SpecimenFixturePage() {
  return (
    <div className="rh-specimen">
      <h1>Design specimen</h1>
      <p>Every shared token and every component of the front end, with fixture content.</p>

      <Section id="specimen-colour" title="Colour">
        <ul className="rh-specimen__swatches" role="list">
          {COLOR_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__swatch" style={{ background: cssVar(token) }} aria-hidden="true" />
            </TokenRow>
          ))}
        </ul>
        <h3 id="specimen-marks">Marks</h3>
        <p>The five brand accents, for a small mark beside a printed type name only; never text.</p>
        <ul className="rh-specimen__swatches" role="list" aria-labelledby="specimen-marks">
          {MARK_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__swatch" style={{ background: cssVar(token) }} aria-hidden="true" />
            </TokenRow>
          ))}
        </ul>
      </Section>

      <Section id="specimen-brand" title="Brand">
        <p>
          Colbination&rsquo;s mark, in its own two colours in both schemes, and the lockup as the header renders it
          (DESIGN.md, &ldquo;Brand&rdquo;).
        </p>
        <h3 id="specimen-brand-sizes">The mark at its sizes</h3>
        <ul className="rh-specimen__marks" role="list" aria-labelledby="specimen-brand-sizes">
          {MARK_SIZES.map((size) => (
            <li key={size} className="rh-specimen__mark">
              <BrandMark style={{ width: size, height: size }} />
              <code className="rh-specimen__name">{size} px</code>
            </li>
          ))}
        </ul>
        <h3>The lockup and its clear space</h3>
        <p>
          The header&rsquo;s home link, at the type scale. The clear space around it is half the mark&rsquo;s width
          on every side, drawn here as a dashed line.
        </p>
        <div className="rh-specimen__lockup">
          <BrandLockup />
        </div>
        <h3>Icons and share image</h3>
        <p>
          The apple touch icon and the default share image: the committed PNGs that{" "}
          <code>scripts/render-brand-images.mts</code> draws from the mark, the tokens and Figtree.
        </p>
        <div className="rh-specimen__images">
          <Image src={appleIcon} alt="The apple touch icon: the mark on the paper surface" width={90} height={90} unoptimized />
          <Image
            src={shareImage}
            alt="The default share image: the mark, the wordmark and the publisher's name on the paper surface"
            className="rh-specimen__share"
            unoptimized
          />
        </div>
      </Section>

      <Section id="specimen-type" title="Type">
        <ul className="rh-specimen__list" role="list">
          {FONT_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__sample" style={{ fontFamily: cssVar(token), fontSize: "var(--rh-text-lg)" }}>
                Resources for a headless library
              </span>
            </TokenRow>
          ))}
          {HEADING_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span
                className="rh-specimen__sample"
                style={{
                  fontSize: "var(--rh-text-lg)",
                  fontWeight: token === "--rh-weight-heading" ? cssVar(token) : undefined,
                  letterSpacing: token === "--rh-tracking-heading" ? cssVar(token) : undefined,
                }}
              >
                Resources for a headless library
              </span>
            </TokenRow>
          ))}
          {LABEL_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span
                className="rh-specimen__sample"
                style={{ fontSize: "var(--rh-text-sm)", fontWeight: 600, letterSpacing: cssVar(token), textTransform: "uppercase" }}
              >
                Case study
              </span>
            </TokenRow>
          ))}
          {TEXT_SIZE_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__sample" style={{ fontSize: cssVar(token) }}>
                Resources for a headless library
              </span>
            </TokenRow>
          ))}
          {LEADING_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__sample rh-specimen__paragraph" style={{ lineHeight: cssVar(token) }}>
                Two or more lines of text at this line height, long enough to wrap at every width the specimen is
                captured at, so the spacing between lines can be read.
              </span>
            </TokenRow>
          ))}
        </ul>
      </Section>

      <Section id="specimen-space" title="Spacing">
        <ul className="rh-specimen__list" role="list">
          {SPACE_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__bar" style={{ width: cssVar(token) }} aria-hidden="true" />
            </TokenRow>
          ))}
        </ul>
      </Section>

      <Section id="specimen-shape" title="Shape and lines">
        <ul className="rh-specimen__swatches" role="list">
          {RADIUS_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__box" style={{ borderRadius: cssVar(token) }} aria-hidden="true" />
            </TokenRow>
          ))}
          {LINE_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span
                className="rh-specimen__box"
                style={
                  token === "--rh-focus-width"
                    ? ({ outline: `${cssVar(token)} solid var(--rh-color-focus)`, outlineOffset: "2px" } as CSSProperties)
                    : { borderWidth: cssVar(token) }
                }
                aria-hidden="true"
              />
            </TokenRow>
          ))}
        </ul>
      </Section>

      <Section id="specimen-measure" title="Measure">
        <p>Each bar is drawn at a quarter of its measure, so both fit a phone&rsquo;s screen in proportion.</p>
        <ul className="rh-specimen__list" role="list">
          {MEASURE_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span
                className="rh-specimen__bar"
                style={{ width: `min(100%, calc(${cssVar(token)} / 4))` }}
                aria-hidden="true"
              />
            </TokenRow>
          ))}
        </ul>
      </Section>

      <Section id="specimen-filters" title="Filters">
        <p>A type and a topic selected, each marked with <code>aria-current</code>.</p>
        <FilterNav types={TYPES} topics={TOPICS} current={{ type: "webinar", topic: "performance" }} />
      </Section>

      <Section id="specimen-lead" title="Lead">
        <p>The featured resource at the top of the library: its image beside the meta line, title, summary and topics.</p>
        <FeaturedLead {...LEAD} />
      </Section>

      <Section id="specimen-cards" title="Rows">
        <p>One row per type with its mark, and a type the accent table does not know, with the neutral mark.</p>
        <ul className="rh-card-grid" role="list">
          {CARDS.map((card) => (
            <li key={card.href}>
              <ResourceCard {...card} headingLevel="h3" />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="specimen-pagination" title="Pagination">
        <Pagination filter={{}} current={4} total={9} />
      </Section>

      <Section id="specimen-prose" title="Prose">
        {/* At the reading measure, as a body is on its page, so the insets are the width the article gives them. */}
        <div className="rh-prose rh-specimen__prose">{renderContent(PROSE, cmsUrls())}</div>
      </Section>

      <Section id="specimen-states" title="States">
        <div className="rh-specimen__state">
          <h3>Focus</h3>
          <p>
            {/* The screenshot test focuses this link, so the baselines show the focus ring. */}
            <Link id="specimen-focus" href="/resources/">
              A link with keyboard focus
            </Link>
          </p>
        </div>
        <div className="rh-specimen__state">
          <h3>Pagination at its ends</h3>
          <p>On the first page there is no Previous, and on the last no Next.</p>
          <Pagination filter={{}} current={1} total={3} />
          <Pagination filter={{}} current={3} total={3} />
        </div>
        <div className="rh-specimen__state">
          <h3>Theme control</h3>
          <p>The footer&rsquo;s control with each option checked. These copies change nothing; the footer&rsquo;s is live.</p>
          <div className="rh-specimen__themes">
            {THEME_CHOICES.map((choice) => (
              <StillThemeFieldset key={choice} name={`specimen-theme-${choice}`} value={choice} />
            ))}
          </div>
        </div>
        <div className="rh-specimen__state">
          <h3>A lead without an image</h3>
          <p>A featured resource with no trusted image: the text alone, at the full width, and no empty box.</p>
          <FeaturedLead {...LEAD_WITHOUT_IMAGE} />
        </div>
        <div className="rh-specimen__state">
          <h3>An empty listing</h3>
          {/*
           * The empty state is markup inside ListingPage, not a component of
           * its own, so it is written out here as ListingPage renders it for a
           * type and topic with nothing in them; e2e/specimen.spec.ts checks it
           * against the real route's HTML, so the two cannot drift apart.
           */}
          <div className="rh-listing__empty">
            <p>No resources match this type and topic yet.</p>
            <p>
              <Link href={listingPath()}>Show all resources</Link>
            </p>
          </div>
        </div>
      </Section>

      <Section id="specimen-resource" title="Resource">
        <div className="rh-specimen__frame">
          <ResourceArticle rendered={resourceFixture()} renderBlock={showFallback} />
        </div>
      </Section>

      <Section id="specimen-page" title="CMS page">
        <div className="rh-specimen__frame">
          <PageArticle rendered={pageFixture()} renderBlock={showFallback} />
        </div>
      </Section>

      <Section id="specimen-welcome" title="Welcome page">
        <div className="rh-specimen__frame">
          <WelcomePage />
        </div>
      </Section>

      <Section id="specimen-not-found" title="Not found">
        <div className="rh-specimen__frame">
          <NotFound />
        </div>
      </Section>
    </div>
  );
}
