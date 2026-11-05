import type { ResourceStatus, Taxonomy } from "./types.mts";

/**
 * The dataset the mock starts from and resets to. The shapes are compact
 * rows; `state.ts` turns them into WordPress REST objects, following the
 * captured fixtures in `test/fixtures/wp/` field for field.
 *
 * What the rows guarantee, because the specs rely on it:
 * - 14 published resources: more than one page at core's default `per_page`
 *   of 10, and at least two in every type and topic.
 * - Term IDs are the captured ones, so a spec and the fixtures agree.
 * - One resource with no featured image (`mediaId: null`), one whose image is
 *   an SVG with no dimensions (`media_details: {}`), and one with a `sizes`
 *   entry, so every branch of the media schema is exercised.
 * - One resource whose body holds the things the HTML pass rewrites: a link
 *   to another resource at the CMS origin, an external link, an image with a
 *   `srcset` under the uploads directory, and the related-resources block
 *   marker. `{{origin}}` is the mock's origin and `{{topic-slug:ID}}` is that
 *   topic's current slug, both filled in at render time.
 * - Dates descend with the rows, so core's default order (`date` desc) is
 *   the row order.
 * - One draft (ID 34, the last row), so the related route has an
 *   unpublished pick to skip; it is in no listing.
 * - Editor picks (`related_picks`) on two resources. ID 33's are the draft,
 *   a resource from a topic 33 does not have (29), and one that also shares
 *   a topic (21), so its related list shows a skipped pick, a cross-topic
 *   pick and a pick that is not repeated by the topic fill. ID 24 has one
 *   pick followed by topic fill.
 */

export interface TermSeed {
  id: number;
  taxonomy: Taxonomy;
  slug: string;
  name: string;
  description: string;
}

export interface MediaSizeSeed {
  file: string;
  width: number;
  height: number;
}

export interface MediaSeed {
  id: number;
  /** The path under `e2e/mock-cms/fixtures/uploads/`, which is also the path under `/wp-content/uploads/`. */
  file: string;
  mime: string;
  alt: string;
  title: string;
  /** `null` when WordPress could not read the dimensions, as for an SVG. */
  width: number | null;
  height: number | null;
  sizes: Record<string, MediaSizeSeed>;
}

export interface ResourceSeed {
  id: number;
  slug: string;
  title: string;
  type: string;
  topics: string[];
  featured: boolean;
  mediaId: number | null;
  summary: string;
  sourceUrl: string;
  /** `content.rendered`, or `null` for the default two paragraphs. */
  content: string | null;
  status: ResourceStatus;
  /** `related_picks`: the editor's ordered picks, as post IDs. */
  picks: number[];
}

export const TERMS: TermSeed[] = [
  { id: 3, taxonomy: "resource_type", slug: "article", name: "Article", description: "" },
  { id: 7, taxonomy: "resource_type", slug: "case-study", name: "Case study", description: "" },
  { id: 4, taxonomy: "resource_type", slug: "ebook", name: "Ebook", description: "" },
  { id: 6, taxonomy: "resource_type", slug: "podcast", name: "Podcast", description: "" },
  { id: 5, taxonomy: "resource_type", slug: "webinar", name: "Webinar", description: "" },
  { id: 12, taxonomy: "resource_topic", slug: "accessibility", name: "Accessibility", description: "" },
  { id: 8, taxonomy: "resource_topic", slug: "content-modelling", name: "Content modelling", description: "" },
  { id: 10, taxonomy: "resource_topic", slug: "editorial-workflow", name: "Editorial workflow", description: "" },
  { id: 9, taxonomy: "resource_topic", slug: "headless-delivery", name: "Headless delivery", description: "" },
  { id: 11, taxonomy: "resource_topic", slug: "performance", name: "Performance", description: "" },
  {
    id: 2,
    taxonomy: "resource_flag",
    slug: "featured",
    name: "Featured",
    description: "Shown first in listings and eligible for the featured section of the front end.",
  },
];

export const MEDIA: MediaSeed[] = [
  {
    id: 101,
    file: "2026/11/content-model.png",
    mime: "image/png",
    alt: "A content model diagram",
    title: "Content model",
    width: 240,
    height: 160,
    sizes: { thumbnail: { file: "2026/11/content-model-150x150.png", width: 150, height: 150 } },
  },
  {
    id: 102,
    file: "2026/11/revalidation.png",
    mime: "image/png",
    alt: "A timeline of a revalidation",
    title: "Revalidation",
    width: 240,
    height: 90,
    sizes: {},
  },
  {
    id: 103,
    file: "2026/11/layout-shift.png",
    mime: "image/png",
    alt: "",
    title: "Layout shift",
    width: 160,
    height: 160,
    sizes: {},
  },
  {
    id: 104,
    file: "2026/11/diagram.svg",
    mime: "image/svg+xml",
    alt: "A diagram",
    title: "Diagram",
    width: null,
    height: null,
    sizes: {},
  },
];

/** The newest resource's date; each later row is one day older. Site time, no offset. */
export const SEED_DATE = "2026-11-01T09:00:00";

const RICH_CONTENT = `
<p class="wp-block-paragraph">Revalidation looks different from the editor's chair. Start with <a href="{{origin}}/resources/ebook/a-field-guide-to-revalidation/">A field guide to revalidation</a> and then compare it with <a href="https://example.com/elsewhere/">a write-up on another site</a>.</p>



<figure class="wp-block-image size-full"><img src="{{origin}}/wp-content/uploads/2026/11/content-model.png" alt="A content model diagram" class="wp-image-101" width="240" height="160" srcset="{{origin}}/wp-content/uploads/2026/11/content-model.png 240w, {{origin}}/wp-content/uploads/2026/11/content-model-150x150.png 150w" sizes="(max-width: 240px) 100vw, 240px" /></figure>



<div data-rh-block="related-resources" data-count="3" data-topic="{{topic-slug:10}}" data-topic-id="10" data-exclude="33"><h2>Related resources</h2><ul><li><a href="{{origin}}/resources/article/alt-text-at-scale/">Alt text at scale</a></li><li><a href="{{origin}}/resources/podcast/editorial-review-without-the-bottleneck/">Editorial review without the bottleneck</a></li></ul></div>
`;

function row(
  id: number,
  slug: string,
  title: string,
  type: string,
  topics: string[],
  featured: boolean,
  mediaId: number | null,
  summary: string,
  content: string | null = null,
): ResourceSeed {
  return {
    id,
    slug,
    title,
    type,
    topics,
    featured,
    mediaId,
    summary,
    sourceUrl: `https://example.com/downloads/${slug}`,
    content,
    status: "publish",
    picks: [],
  };
}

export const RESOURCES: ResourceSeed[] = [
  row(20, "a-field-guide-to-revalidation", "A field guide to revalidation", "ebook", ["headless-delivery", "performance"], true, 101, "On-demand, time-based, and tag-based revalidation compared, with the failure modes of each written down."),
  row(21, "alt-text-at-scale", "Alt text at scale", "article", ["accessibility", "editorial-workflow"], false, null, "How a small editorial team keeps alt text accurate across thousands of images without a bottleneck."),
  row(22, "choosing-a-headless-architecture", "Choosing a headless architecture", "webinar", ["headless-delivery", "content-modelling"], true, 102, "REST, GraphQL and static export compared for a content site that changes a few times a day."),
  row(23, "measuring-layout-shift-on-listing-pages", "Measuring layout shift on listing pages", "article", ["performance", "accessibility"], false, 103, "Reserved aspect ratios, sized images and why late content is a gate rather than a claim."),
  { ...row(24, "one-content-model-five-channels", "One content model, five channels", "case-study", ["content-modelling"], false, 101, "A publisher's move from page-shaped content to a model that feeds the web, email, apps and partners."), picks: [26] },
  row(25, "editorial-review-without-the-bottleneck", "Editorial review without the bottleneck", "podcast", ["editorial-workflow"], false, 104, "Two editors on review queues, who approves what, and how a headless site shows the result."),
  row(26, "keyboard-first-filters", "Keyboard-first filters", "article", ["accessibility"], true, 103, "Filter controls that work before the mouse arrives: focus order, labels and what to announce."),
  row(27, "cache-tags-explained", "Cache tags explained", "ebook", ["headless-delivery", "performance"], false, 102, "What a cache tag names, which fetches carry which tags, and how an editor's save reaches a page."),
  row(28, "the-anatomy-of-a-resource", "The anatomy of a resource", "webinar", ["content-modelling", "editorial-workflow"], false, null, "Which fields belong in meta, which in taxonomies, and what to leave out until an editor asks."),
  row(29, "core-web-vitals-for-content-sites", "Core Web Vitals for content sites", "case-study", ["performance"], false, 101, "A listing page taken from a 70 to a 98 on mobile, one metric at a time."),
  row(30, "taxonomies-versus-meta", "Taxonomies versus meta", "article", ["content-modelling"], true, 102, "When a value is a term and when it is a field, with the REST and query consequences of each."),
  row(31, "previewing-drafts-headlessly", "Previewing drafts headlessly", "podcast", ["headless-delivery", "editorial-workflow"], false, 103, "Signed preview tokens, what the front end checks, and what the editor sees."),
  row(32, "an-accessibility-audit-in-a-day", "An accessibility audit in a day", "ebook", ["accessibility"], false, null, "A checklist that fits in a day and catches what automated tools miss."),
  {
    ...row(33, "revalidation-from-the-editors-chair", "Revalidation from the editor's chair", "webinar", ["editorial-workflow", "headless-delivery"], false, 101, "What an editor sees when a save reaches the front end, and what to do when it does not.", RICH_CONTENT),
    picks: [34, 29, 21],
  },
  {
    ...row(34, "an-unfinished-draft", "An unfinished draft", "article", ["editorial-workflow"], false, null, "Not published: it is picked by resource 33 and must never be shown."),
    status: "draft",
  },
];
