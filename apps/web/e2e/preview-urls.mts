/**
 * The URLs the preview Lighthouse run measures on a pull request's Vercel
 * preview (`preview-lighthouse.mts`, run by the Preview Lighthouse
 * workflow, `.depot/workflows/preview-lighthouse.yml`).
 *
 * Why this is not `sampled-urls.mts`: the blocking gate measures the mock
 * CMS's seed, whose paths are the seed's. A preview reads the hosted CMS,
 * whose content differs, so some of the seed's paths do not exist there:
 * on 2026-11-07, `/welcome/`, `/resources/page/2/` and
 * `/resources/article/taxonomies-versus-meta/` answered 404 on
 * https://resource-hub-next.colbination.com. This list samples the same
 * routes and states as the gate with paths the hosted content has, checked
 * against production that day, and nothing the gate does not sample. It is
 * content, so it drifts: a path that stops answering 200 shows in the
 * pull-request comment as a warm-up failure, and the list is corrected by
 * hand against production (`curl -o /dev/null -w '%{http_code}'`).
 *
 * Not sampled, unlike the gate: the library's page 2 (the hosted library
 * holds exactly 12 resources, one page at 12 a page, so there is none) and
 * the two 404s (Lighthouse refuses to score them, as in the gate). The
 * empty type-within-topic listing is empty only while no podcast has the
 * accessibility topic.
 *
 * Kept short because of the image optimiser's allowance: the first time a
 * preview serves an image at the width Lighthouse's phone picks, it is one
 * transformation against the Vercel project's monthly allowance (Hobby:
 * 5,000; `apps/web/README.md`, "Images"). The runs after the first hit the
 * preview's cache. `images` is the count on each page on 2026-11-07, so one
 * run costs at most their sum, 19, about 0.4% of the month.
 *
 * Plain data with no imports, so `lighthouserc.preview.cjs` can
 * `require()` it under Node 24, like `sampled-urls.mts`.
 */

export interface PreviewUrl {
  /** What the URL samples, named as `sampled-urls.mts` names the same route. */
  readonly label: string;
  /** A root-relative path with the trailing slash every public URL has. */
  readonly path: string;
  /** Images the page loads, for the allowance estimate above. */
  readonly images: number;
}

export const PREVIEW_URLS: readonly PreviewUrl[] = [
  // The hosted CMS leaves its front page unset, so `/` is the front end's own welcome page (ADR 0052).
  { label: "front page", path: "/", images: 0 },
  // WordPress's default page, the one published CMS page on the hosted CMS; text-led.
  { label: "CMS page", path: "/sample-page/", images: 0 },
  { label: "library", path: "/resources/", images: 12 },
  { label: "type listing", path: "/resources/webinar/", images: 2 },
  { label: "topic listing", path: "/resources/topic/performance/", images: 3 },
  { label: "type within topic listing", path: "/resources/article/topic/accessibility/", images: 1 },
  // No podcast has the accessibility topic: the empty state, with its link back to the library.
  { label: "empty type within topic listing", path: "/resources/podcast/topic/accessibility/", images: 0 },
  // An article with a 1024×538 featured image, the hosted counterpart of the seed's long-form resource.
  { label: "resource", path: "/resources/article/taxonomies-versus-fields/", images: 1 },
];
