import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";

import { FilterNav, type FilterTerm } from "@/components/FilterNav";
import { Pagination } from "@/components/Pagination";
import { ResourceCard, type ResourceCardProps } from "@/components/ResourceCard";
import { renderContent } from "@/lib/content/render";
import { cmsUrls } from "@/lib/env";

import {
  COLOR_TOKENS,
  FONT_TOKENS,
  LEADING_TOKENS,
  LINE_TOKENS,
  MEASURE_TOKENS,
  RADIUS_TOKENS,
  SPACE_TOKENS,
  TEXT_SIZE_TOKENS,
} from "./tokens";

// The listing's own styles (filters, pagination), which ListingPage imports
// for the real routes; the card and prose styles come with ResourceCard and
// the prose class below, as on the real pages.
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
 * one half-loaded. Specimen-only layout (swatch grids, bars) lives in
 * `specimen.css`, built on the same tokens; no component style is
 * overridden.
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
 * resource's or a page's (`renderContent`, ADR 0047), so the table gets its
 * labelled scrolling region and the links their rewrites, as on the real
 * pages.
 */
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
        <ul className="rh-specimen__list" role="list">
          {MEASURE_TOKENS.map((token) => (
            <TokenRow key={token} token={token}>
              <span className="rh-specimen__bar" style={{ width: `min(100%, ${cssVar(token)})` }} aria-hidden="true" />
            </TokenRow>
          ))}
        </ul>
      </Section>

      <Section id="specimen-filters" title="Filters">
        <FilterNav types={TYPES} topics={TOPICS} current={{ type: "webinar" }} />
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
    </div>
  );
}
