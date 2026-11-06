import type { Metadata } from "next";

/**
 * A page's link-preview metadata: its Open Graph fields and the X card type
 * that goes with them, built in one place so no route sets one without the
 * other. The rule: a page whose Open Graph names an image gets
 * `twitter:card` `summary_large_image`; one that names none gets `summary`,
 * so a large card is never advertised with nothing to fill it. A route that
 * sets no Open Graph (the listings, the 404) sets no card either.
 *
 * Only the card type is set. X reads `twitter:title`, `twitter:description`,
 * `twitter:image` and `twitter:image:alt` from `og:title`, `og:description`,
 * `og:image` and `og:image:alt` when they are absent (X's cards markup
 * reference), so they are not written twice here. The card type is the one
 * tag X cannot infer: with no `twitter:card` it renders a summary card at
 * most, never the large one.
 *
 * Next.js (16.4) also copies Open Graph's title, description and images into
 * `twitter:*` itself when a page has `openGraph`, and picks the card from
 * whether there are images, so today's HTML would be the same without
 * `twitter`. That copy is in its source (`postProcessMetadata`), not its
 * documentation; setting `card` here keeps the rule ours if it changes.
 * Because segments merge shallowly, a `twitter` object in the root layout
 * would reach every page that sets none, and Next.js keeps an inherited
 * `card` even when it fills in images, so the root layout sets none.
 */
export function shareMetadata(openGraph: NonNullable<Metadata["openGraph"]>): Pick<Metadata, "openGraph" | "twitter"> {
  const { images } = openGraph;
  const hasImage = images !== undefined && (!Array.isArray(images) || images.length > 0);
  return {
    openGraph,
    twitter: { card: hasImage ? "summary_large_image" : "summary" },
  };
}
