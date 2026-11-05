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
 * - One long-form resource (ID 30, `taxonomies-versus-meta`) with headings,
 *   lists, a blockquote, a code block, a table, a figure and the marker, and
 *   a 1600×900 featured image with `large` and `medium_large` sizes, for the
 *   resource page's screenshots and its long-form checks.
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
  {
    // A full-size hero with WordPress's `large` and `medium_large` sizes, so
    // the resource page's featured image has a size worth choosing and the
    // page can be looked at and measured at a real width.
    id: 105,
    file: "2026/11/taxonomies-versus-meta.png",
    mime: "image/png",
    alt: "Three boxes joined by two bars: a term, a post and a field",
    title: "Taxonomies versus meta",
    width: 1600,
    height: 900,
    sizes: {
      medium_large: { file: "2026/11/taxonomies-versus-meta-768x432.png", width: 768, height: 432 },
      large: { file: "2026/11/taxonomies-versus-meta-1024x576.png", width: 1024, height: 576 },
    },
  },
];

/** The newest resource's date; each later row is one day older. Site time, no offset. */
export const SEED_DATE = "2026-11-01T09:00:00";

const RICH_CONTENT = `
<p class="wp-block-paragraph">Revalidation looks different from the editor's chair. Start with <a href="{{origin}}/resources/ebook/a-field-guide-to-revalidation/">A field guide to revalidation</a> and then compare it with <a href="https://example.com/elsewhere/">a write-up on another site</a>.</p>



<figure class="wp-block-image size-full"><img src="{{origin}}/wp-content/uploads/2026/11/content-model.png" alt="A content model diagram" class="wp-image-101" width="240" height="160" srcset="{{origin}}/wp-content/uploads/2026/11/content-model.png 240w, {{origin}}/wp-content/uploads/2026/11/content-model-150x150.png 150w" sizes="(max-width: 240px) 100vw, 240px" /></figure>



<div data-rh-block="related-resources" data-count="3" data-topic="{{topic-slug:10}}" data-topic-id="10" data-exclude="33"><h2>Related resources</h2><ul><li><a href="{{origin}}/resources/article/alt-text-at-scale/">Alt text at scale</a></li><li><a href="{{origin}}/resources/podcast/editorial-review-without-the-bottleneck/">Editorial review without the bottleneck</a></li></ul></div>
`;

/**
 * A long-form body with every kind of element the front end's sanitiser
 * styles: headings, lists, a blockquote, a code block, a table, a figure with
 * an upload, links on the CMS and elsewhere, and the related-resources
 * marker. For the resource page's screenshots and its long-form checks.
 */
const LONG_CONTENT = `
<p class="wp-block-paragraph">Every field on a resource is a decision: is this value a <strong>term</strong>, shared across many resources and worth filtering by, or a <em>field</em> that belongs to one resource alone? The question sounds small. It decides what the REST API returns, what the front end can query, and what an editor sees when the value changes.</p>



<h2 class="wp-block-heading">When a value is a term</h2>



<p class="wp-block-paragraph">A term is a thing many resources share and a reader might want to narrow by. The type of a resource (a webinar, an ebook) and its topics are terms: each has a listing of its own, the filter bar offers it, and <a href="{{origin}}/resources/topic/content-modelling/">the topic's listing</a> is a page the CMS can revalidate when the term changes. A term carries a slug, a name and a count, and nothing else.</p>



<ul class="wp-block-list">
<li>It is shared: two resources with the same term are related by it.</li>
<li>It is queryable: the REST collection filters by its ID.</li>
<li>It is few: a taxonomy with ten thousand terms is a field pretending.</li>
</ul>



<h2 class="wp-block-heading">When a value is a field</h2>



<p class="wp-block-paragraph">A field describes one resource and no other. The summary and the source URL are fields: nobody filters by them, and a change to one revalidates the resource's own page and the listings that show it, not a listing of its own. Registering a field with <code>show_in_rest</code> puts it under <code>meta</code> in the REST response, with a schema that says what it holds.</p>



<figure class="wp-block-image size-full"><img src="{{origin}}/wp-content/uploads/2026/11/content-model.png" alt="A content model diagram" class="wp-image-101" width="240" height="160" /><figcaption class="wp-element-caption">The content model: one post type, three taxonomies, two fields.</figcaption></figure>



<blockquote class="wp-block-quote"><p>Put a value in a taxonomy when you would build a page for it. Put it in meta when you would not.</p><cite>A rule of thumb from the plugin's first review</cite></blockquote>



<h3 class="wp-block-heading">What each choice costs</h3>



<figure class="wp-block-table"><table><thead><tr><th>Question</th><th>Term</th><th>Field</th></tr></thead><tbody><tr><td>Filter a listing by it</td><td>Yes, by ID</td><td>No</td></tr><tr><td>Has a page of its own</td><td>Yes</td><td>No</td></tr><tr><td>Revalidates on change</td><td>Its listings and every resource that carries it</td><td>The resource's page</td></tr><tr><td>Appears in <code>_embed</code></td><td>Under <code>wp:term</code></td><td>Under <code>meta</code></td></tr></tbody></table></figure>



<p class="wp-block-paragraph">The REST consequence is visible in one request. A resource's terms arrive as IDs with the terms themselves embedded; its fields arrive inline:</p>



<pre class="wp-block-code"><code>{
  "resource_type": [5],
  "resource_topic": [8, 10],
  "meta": {
    "summary": "When a value is a term and when it is a field.",
    "source_url": "https://example.com/downloads/taxonomies-versus-meta"
  }
}</code></pre>



<h2 class="wp-block-heading">The featured flag</h2>



<p class="wp-block-paragraph">Featured looks like a field, a yes or no on one resource. It is a term, because the front end wants a listing of featured resources and the filter wants to narrow by it; a boolean in meta would need a query the core collection does not offer. See <a href="{{origin}}/resources/ebook/a-field-guide-to-revalidation/">the field guide</a> for how that listing is kept fresh, and <a href="https://example.com/rest-api-handbook/">the REST API handbook</a> for what the collection can filter.</p>



<ol class="wp-block-list">
<li>Decide whether readers will narrow by it.</li>
<li>Decide whether it needs a page.</li>
<li>Only then decide where it lives.</li>
</ol>



<div data-rh-block="related-resources" data-count="3" data-topic="{{topic-slug:8}}" data-topic-id="8" data-exclude="30"><h2>More on content modelling</h2><ul><li><a href="{{origin}}/resources/case-study/one-content-model-five-channels/">One content model, five channels</a></li><li><a href="{{origin}}/resources/webinar/the-anatomy-of-a-resource/">The anatomy of a resource</a></li></ul></div>
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
  row(30, "taxonomies-versus-meta", "Taxonomies versus meta", "article", ["content-modelling"], true, 105, "When a value is a term and when it is a field, with the REST and query consequences of each.", LONG_CONTENT),
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
