import shareImage from "@/app/opengraph-image.png";

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
 * the 404 page).
 *
 * The URL is the file's static import: Next.js copies the PNG to
 * `/_next/static/media/opengraph-image.<content hash>.png`, served as
 * immutable, so when the image is re-rendered the URL changes with it and
 * no scraper or CDN keeps the old one. It is a path, made absolute by the
 * root layout's `metadataBase`, as the file-based tag's is. The routes that
 * use the file convention get Next.js's own content-hashed form of it,
 * `/opengraph-image.png?<hash>`; both change whenever the bytes do, and a
 * route carries exactly one of them. The size is the import's, read from
 * the file at build time; `test/share-image.test.ts` checks the alt text
 * against `opengraph-image.alt.txt`, which the file-based tag carries.
 */
export const DEFAULT_SHARE_IMAGE = {
  url: shareImage.src,
  type: "image/png",
  width: shareImage.width,
  height: shareImage.height,
  alt: "Resource Hub, published by Colbination",
} as const;
