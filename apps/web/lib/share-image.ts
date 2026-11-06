/**
 * The default share image, `app/opengraph-image.png` (`packages/ui/DESIGN.md`,
 * "Brand"), as an Open Graph image entry for the routes that write an
 * `openGraph` object of their own.
 *
 * Next.js applies a file-based `opengraph-image` only to a route whose
 * resolved metadata has no `openGraph` of its own: a segment that sets
 * `openGraph` replaces the object wholesale, images included (the metadata
 * merging rule in the `generateMetadata` reference), so the welcome page, a
 * CMS page and a resource without a trusted featured image would have no
 * share image at all. Each of them spreads this entry into its `openGraph`
 * instead, and the file keeps serving the routes that set none (a listing,
 * the 404 page). The URL is the file's own route, without the cache-busting
 * query Next.js adds for the file-based tag, so every page names the one
 * image; `test/share-image.test.ts` checks the size and the alt text against
 * the file and `opengraph-image.alt.txt`.
 */
export const DEFAULT_SHARE_IMAGE = {
  url: "/opengraph-image.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: "Resource Hub, published by Colbination",
} as const;
