/**
 * The URLs the axe scan (`a11y.spec.ts`), Lighthouse CI
 * (`lighthouserc.cjs`) and the document-size check (`document-size.spec.ts`)
 * read, from the mock CMS's seed (`mock-cms/seed.mts`), so the gates always
 * measure the same pages.
 *
 * What is sampled, exactly: the welcome page at `/`, one CMS page, the
 * library, a type listing, a topic listing, a type-within-topic listing with
 * resources and one without (the empty state), the library's page 2, one
 * resource (the long-form one), and both kinds of 404: one decided by data
 * (a path no CMS page has, the root catch-all's `DataNotFound`) and one
 * decided from the path alone (the proxy's rewrite to the prerendered
 * not-found page). Not sampled: a CMS page set as the static front page, a
 * paginated filtered listing, a listing's or resource's own `DataNotFound`,
 * a resource without an image or without a body, and every fixture page;
 * their markup is the same components with other data, which the specs for
 * each route check.
 *
 * Sampling is deliberate: every listing renders through `ListingPage`, every
 * resource through `ResourceArticle` and every CMS page through
 * `PageArticle`, so a second resource or a third listing like the others
 * adds run time and little coverage. The list grows when a route or a state
 * that renders differently is added, not when content is.
 *
 * Plain data in an `.mts` module with no imports, so `lighthouserc.cjs` can
 * `require()` it under Node 24 as well as the specs importing it.
 */

export interface SampledUrl {
  /**
   * What the URL samples, a route or a state of one (an empty listing, a
   * last page), as the test titles name it.
   */
  readonly label: string;
  /** A root-relative path with the trailing slash every public URL has. */
  readonly path: string;
  /** The status the URL answers with on the seed. */
  readonly status: 200 | 404;
  /**
   * Whether Lighthouse measures it. Lighthouse refuses to score a document
   * that answers 4xx (`ERRORED_DOCUMENT_REQUEST`), so the 404 is axe's
   * alone.
   */
  readonly lighthouse: boolean;
  /**
   * Whether the page's LCP is an image, as Lighthouse measures it on the
   * seed. Such a page's LCP waits for its HTML, so `document-size.spec.ts`
   * checks its document against Lighthouse's first simulated round trip.
   */
  readonly imageLed: boolean;
  /**
   * `false` on an image-led page the whole-document check in
   * `document-size.spec.ts` leaves out, which then holds it to a ceiling of
   * two round trips instead; absent, the page is checked. Set only by the
   * owner's decision, for a page whose size is the cost of content that is
   * wanted: the spec's docblock has the rule and its cost.
   */
  readonly wholeDocumentGuard?: false;
}

export const SAMPLED_URLS: readonly SampledUrl[] = [
  // The seed leaves the CMS's front page unset, as on the hosted CMS, so `/`
  // is the front end's own welcome page (ADR 0052).
  { label: "front page", path: "/", status: 200, lighthouse: true, imageLed: false },
  // A published CMS page with a body: a CMS link, an external link and an upload.
  // Its LCP image is the body's diagram, the lead image `renderContent`
  // preloads (`takeLead` in lib/content/render.tsx).
  { label: "CMS page", path: "/welcome/", status: 200, lighthouse: true, imageLed: true },
  { label: "library", path: "/resources/", status: 200, lighthouse: true, imageLed: true },
  { label: "type listing", path: "/resources/webinar/", status: 200, lighthouse: true, imageLed: false },
  { label: "topic listing", path: "/resources/topic/performance/", status: 200, lighthouse: true, imageLed: false },
  {
    label: "type within topic listing",
    path: "/resources/article/topic/accessibility/",
    status: 200,
    lighthouse: true,
    imageLed: false,
  },
  // No podcast has the accessibility topic: a 200 with the empty state and
  // its link back to the library, and no cards.
  {
    label: "empty type within topic listing",
    path: "/resources/podcast/topic/accessibility/",
    status: 200,
    lighthouse: true,
    imageLed: false,
  },
  // 14 published resources at 12 a page: page 2 is the last, with Previous and no Next.
  { label: "paginated listing", path: "/resources/page/2/", status: 200, lighthouse: true, imageLed: false },
  // The long-form resource: headings, lists, a blockquote, code, a table, a
  // figure, the related block and a 1600×900 featured image.
  // Exempt from the whole-document check by the owner's decision of
  // 2026-11-07 (issue #85): its related section is wanted content, and the
  // section's `card.css` and `related.css` put its HTML over the first round
  // trip. The rule, the ceiling it is held to instead and the measurements
  // are in `document-size.spec.ts`'s docblock.
  {
    label: "resource",
    path: "/resources/article/taxonomies-versus-meta/",
    status: 200,
    lighthouse: true,
    imageLed: true,
    wholeDocumentGuard: false,
  },
  // A path no page has: the root catch-all asks the CMS and answers with
  // `DataNotFound`, stored per URL (ADR 0052).
  { label: "not found by data", path: "/no-such-page/", status: 404, lighthouse: false, imageLed: false },
  // A listing page segment that is not a number: `proxy.ts` rewrites it to
  // the prerendered not-found page without asking the CMS (`lib/path-decision.ts`).
  { label: "not found by path", path: "/resources/page/x/", status: 404, lighthouse: false, imageLed: false },
];
