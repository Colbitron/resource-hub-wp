import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import NotFound from "@/app/not-found";
import { FilterNav, type FilterTerm } from "@/components/FilterNav";
import { PageArticle } from "@/components/PageArticle";
import { Pagination } from "@/components/Pagination";
import { ResourceArticle } from "@/components/ResourceArticle";
import { ResourceCard, type ResourceCardProps } from "@/components/ResourceCard";
import { WelcomePage } from "@/components/WelcomePage";
import { renderContent } from "@/lib/content/render";
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
import "@/components/listing.css";
import "@/components/prose.css";
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
 * client JavaScript of its own. The card images are the mock CMS's uploads
 * through `/media/`, loaded eagerly so a full-page screenshot never catches
 * one half-loaded. Specimen-only layout (swatch grids, bars, the frame
 * around each whole-page component) lives in `specimen.css`, built on the
 * same tokens; no component style is overridden.
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
 * The states section shows what the other sections cannot: the focus ring
 * (the screenshot test focuses `#specimen-focus` before the capture), both
 * filter rows with a term selected, pagination at its first and last pages,
 * where Previous and Next are left out rather than disabled (the
 * component's rule), the theme control in each of its three states (the
 * header's own copy is live and shows the stored choice; these are still),
 * and a listing's empty state.
 */

export const metadata: Metadata = {
  title: "Design specimen",
  robots: { index: false },
};

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

/** One card per resource type, with images of different shapes and one card without. */
const CARDS: ResourceCardProps[] = [
  {
    title: "Taxonomies versus meta",
    href: "/resources/article/taxonomies-versus-meta/",
    typeLabel: "Article",
    topicLabels: ["Content modelling"],
    summary: "When a value is a term and when it is a field, with the REST and query consequences of each.",
    date: "2026-10-28T09:00:00Z",
    image: { src: "/media/2026/11/taxonomies-versus-meta.png", alt: "", width: 1600, height: 900 },
  },
  {
    title: "One content model, five channels",
    href: "/resources/case-study/one-content-model-five-channels/",
    typeLabel: "Case study",
    topicLabels: ["Content modelling", "Headless delivery"],
    summary: "A publisher's move from page-shaped content to a model that feeds the web, email, apps and partners.",
    date: "2026-10-14T12:00:00Z",
    image: { src: "/media/2026/11/content-model.png", alt: "", width: 240, height: 160 },
  },
  {
    title: "A field guide to revalidation",
    href: "/resources/ebook/a-field-guide-to-revalidation/",
    typeLabel: "Ebook",
    topicLabels: ["Headless delivery", "Performance"],
    summary: "On-demand, time-based, and tag-based revalidation compared, with the failure modes of each written down.",
    date: "2026-09-30T08:30:00Z",
    image: { src: "/media/2026/11/revalidation.png", alt: "", width: 240, height: 90 },
  },
  {
    title: "Editorial review without the bottleneck",
    href: "/resources/podcast/editorial-review-without-the-bottleneck/",
    typeLabel: "Podcast",
    topicLabels: ["Editorial workflow"],
    summary: "Two editors on review queues, who approves what, and how a headless site shows the result.",
    date: "2026-09-02T16:00:00Z",
    image: { src: "/media/2026/11/layout-shift.png", alt: "", width: 160, height: 160 },
  },
  {
    title: "A very long webinar title that wraps across several lines, to show how a card holds a heading that runs on",
    href: "/resources/webinar/the-anatomy-of-a-resource/",
    typeLabel: "Webinar",
    topicLabels: ["Accessibility", "Content modelling", "Editorial workflow", "Performance"],
    summary: "",
    date: "2026-08-01T00:00:00Z",
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
 * The long-form resource's shape (the seed's ID 30) with a short body: a
 * paragraph, a list, and the related-resources block marker as the CMS
 * renders it, whose links point at the CMS. The default `renderBlock`
 * renders the marker's fallback, the CMS's own heading and list, as the
 * resource page does until slice 4 plugs in `<RelatedResources>`.
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
<div data-rh-block="related-resources" data-count="3" data-topic="content-modelling" data-topic-id="8" data-exclude="30"><h2>More on content modelling</h2><ul><li><a href="${site}/resources/case-study/one-content-model-five-channels/">One content model, five channels</a></li><li><a href="${site}/resources/webinar/the-anatomy-of-a-resource/">The anatomy of a resource</a></li></ul></div>
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

      <Section id="specimen-cards" title="Cards">
        <ul className="rh-card-grid" role="list">
          {CARDS.map((card) => (
            <li key={card.href}>
              <ResourceCard {...card} headingLevel="h3" priority />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="specimen-pagination" title="Pagination">
        <Pagination filter={{}} current={4} total={9} />
      </Section>

      <Section id="specimen-prose" title="Prose">
        <div className="rh-prose">{renderContent(PROSE, cmsUrls())}</div>
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
          <p>The header&rsquo;s control with each option checked. These copies change nothing; the header&rsquo;s is live.</p>
          <div className="rh-specimen__themes">
            {THEME_CHOICES.map((choice) => (
              <StillThemeFieldset key={choice} name={`specimen-theme-${choice}`} value={choice} />
            ))}
          </div>
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
          <ResourceArticle rendered={resourceFixture()} />
        </div>
      </Section>

      <Section id="specimen-page" title="CMS page">
        <div className="rh-specimen__frame">
          <PageArticle rendered={pageFixture()} />
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
