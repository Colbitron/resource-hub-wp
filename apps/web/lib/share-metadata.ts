import type { Metadata } from "next";

/**
 * A page's link-preview metadata: its Open Graph fields and the X card type
 * that goes with them, built in one place so no route sets one without the
 * other. The rule: a page whose Open Graph names an image gets
 * `twitter:card` `summary_large_image`; one that names none gets `summary`,
 * so a large card is never advertised with nothing to fill it.
 *
 * Every route that calls this names an image, so every one gets the large
 * card: a resource its trusted featured image, and the welcome page, a CMS
 * page and a resource without one the site's default share image
 * (`lib/share-image.ts`), which a route that writes its own `openGraph`
 * must name itself. The `summary` branch is kept for a route that ever
 * writes Open Graph with no image. A route that writes no Open Graph (a
 * listing, the 404) does not call this: Next.js gives it the file-based
 * `app/opengraph-image.png` and, from that image, the large card and
 * `twitter:image` itself.
 *
 * This helper adds only the card type, and Next.js fills in the rest. X's
 * cards markup reference (its "OpenGraph" column, read from the 2025-01-01
 * Wayback snapshot of developer.x.com's markup page, since the live page
 * now redirects) lists `og:title`, `og:description`, `og:image` and
 * `og:image:alt` as the fallbacks for `twitter:title`, `twitter:description`,
 * `twitter:image` and `twitter:image:alt`. For the card type it says only
 * that a summary card may be rendered when `og:type`, `og:title` and
 * `og:description` exist and `twitter:card` is absent, so the card type is
 * the tag worth setting ourselves.
 *
 * Next.js (16.4) copies Open Graph's title, description and images,
 * the image's alt included, into `twitter:*` whenever a page has
 * `openGraph`, and picks the card from whether there are images, so the
 * HTML would be the same without `twitter`. That copy is in its source
 * (`postProcessMetadata`), not its documentation; setting `card` here keeps
 * the rule ours if it changes, and the e2e specs pin the copy. Because
 * segments merge shallowly, a `twitter` object in the root layout would
 * reach every page that sets none, and Next.js keeps an inherited `card`
 * even when it fills in images, so the root layout sets none.
 *
 * An image counts only when it has a URL, as Next.js drops one without.
 */
export function shareMetadata(openGraph: NonNullable<Metadata["openGraph"]>): Pick<Metadata, "openGraph" | "twitter"> {
  const { images } = openGraph;
  const list = images === undefined ? [] : Array.isArray(images) ? images : [images];
  const hasImage = list.some((image) => {
    const url = typeof image === "string" || image instanceof URL ? image : image.url;
    return String(url ?? "") !== "";
  });
  return {
    openGraph,
    twitter: { card: hasImage ? "summary_large_image" : "summary" },
  };
}
