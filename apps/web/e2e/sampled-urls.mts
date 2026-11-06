/**
 * One representative URL per page template, from the mock CMS's seed
 * (`mock-cms/seed.mts`): the list the axe scan (`a11y.spec.ts`) and
 * Lighthouse CI (`lighthouserc.cjs`) both read, so the two gates always
 * measure the same pages.
 *
 * Sampling per template is deliberate: every listing renders through
 * `ListingPage`, every resource through `ResourceArticle` and every CMS page
 * through `PageArticle`, so a second resource or a third listing adds run
 * time and no coverage. The list grows when a template is added, not when
 * content is. Add the new template's URL here when you add a route.
 *
 * Plain data in an `.mts` module with no imports, so `lighthouserc.cjs` can
 * `require()` it under Node 24 as well as the specs importing it.
 */

export interface SampledUrl {
  /** The page template the URL stands for, as the test titles name it. */
  readonly template: string;
  /** A root-relative path with the trailing slash every public URL has. */
  readonly path: string;
  /** The status the URL answers with on the seed. */
  readonly status: 200 | 404;
  /**
   * Whether Lighthouse measures it. Lighthouse refuses to score a document
   * that answers 4xx (`ERRORED_DOCUMENT_REQUEST`), so the 404 template is
   * axe's alone.
   */
  readonly lighthouse: boolean;
}

export const SAMPLED_URLS: readonly SampledUrl[] = [
  // The seed leaves the CMS's front page unset, as on the hosted CMS, so `/`
  // is the front end's own welcome page (ADR 0052).
  { template: "front page", path: "/", status: 200, lighthouse: true },
  // A published CMS page with a body: a CMS link, an external link and an upload.
  { template: "CMS page", path: "/welcome/", status: 200, lighthouse: true },
  { template: "library", path: "/resources/", status: 200, lighthouse: true },
  { template: "type listing", path: "/resources/webinar/", status: 200, lighthouse: true },
  {
    template: "type within topic listing",
    path: "/resources/article/topic/accessibility/",
    status: 200,
    lighthouse: true,
  },
  // 14 published resources at 12 a page: page 2 is the last, with Previous and no Next.
  { template: "paginated listing", path: "/resources/page/2/", status: 200, lighthouse: true },
  // The long-form resource: headings, lists, a blockquote, code, a table, a
  // figure, the related block and a 1600×900 featured image.
  {
    template: "resource",
    path: "/resources/article/taxonomies-versus-meta/",
    status: 200,
    lighthouse: true,
  },
  // A path no page has: the root catch-all's `notFound()` (ADR 0052).
  { template: "not found", path: "/no-such-page/", status: 404, lighthouse: false },
];
