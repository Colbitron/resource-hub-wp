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
   * seed. Such a page's LCP waits for its HTML, so its document must arrive
   * in Lighthouse's first simulated round trip (`document-size.spec.ts`).
   */
  readonly imageLed: boolean;
}

export const SAMPLED_URLS: readonly SampledUrl[] = [
  // The seed leaves the CMS's front page unset, as on the hosted CMS, so `/`
  // is the front end's own welcome page (ADR 0052).
  { label: "front page", path: "/", status: 200, lighthouse: true, imageLed: false },
  // A published CMS page with a body: a CMS link, an external link and an upload.
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
  {
    label: "resource",
    path: "/resources/article/taxonomies-versus-meta/",
    status: 200,
    lighthouse: true,
    imageLed: true,
  },
  // A path no page has: the root catch-all asks the CMS and answers with
  // `DataNotFound`, stored per URL (ADR 0052).
  { label: "not found by data", path: "/no-such-page/", status: 404, lighthouse: false, imageLed: false },
  // A listing page segment that is not a number: `proxy.ts` rewrites it to
  // the prerendered not-found page without asking the CMS (`lib/path-decision.ts`).
  { label: "not found by path", path: "/resources/page/x/", status: 404, lighthouse: false, imageLed: false },
];
