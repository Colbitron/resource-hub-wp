import "server-only";

import { cmsUrls, wpApiUrl, wpMediaOrigin } from "../env";
import { mediaPath } from "../urls";
import type { WpResource } from "./schemas/rest";

/**
 * A resource's featured image, made safe for `next/image` and for
 * `og:image`: a same-origin `/media/…` path (ADR 0040) with both dimensions,
 * or nothing. Two choices of file are made from the same media by the same
 * rules, differing only in the minimum width of rule 4: `featuredImage`, for
 * the card and the resource page's `next/image`, with
 * `CARD_SOURCE_MIN_WIDTH`, and `openGraphImage`, for the page's `og:image`,
 * with `OPEN_GRAPH_MIN_WIDTH`. Both are `chooseImage`; whichever is called,
 * the original either passes rules 1 to 3 or there is no image, so the two
 * are `null` together. The image trust rule is ADR 0047's for images in a
 * body, held to a stricter bar because `next/image` needs a size (ADR 0039):
 *
 * 1. The embedded media is the first entry of `_embedded['wp:featuredmedia']`
 *    (core embeds one); a `null` entry, which is how the reader schema keeps
 *    an unreadable one, means no image.
 * 2. Its `media_details` has both `width` and `height`, each a whole number
 *    from 1 to `MAX_IMAGE_DIMENSION`. An SVG, which WordPress cannot measure,
 *    has neither and so has no card image.
 * 3. Its `source_url`, and each `sizes[*].source_url` that is used, must be
 *    a CMS image: an http(s) URL with no user name or password, not `http:`
 *    when the CMS is `https:`, whose origin (scheme, host and port) is the
 *    CMS's or the media origin's from `lib/env.ts`, and whose path lies under
 *    the uploads directory as `mediaPath` decides (which also refuses `..`,
 *    encoded slashes and `%25`). Origins compare as the URL parser
 *    normalises them, case-folded and in punycode: `CMS.Example` is the CMS
 *    and a lookalike is not, while `cms.example.` (trailing dot) is another
 *    origin and refused. The result is `mediaPath`'s `/media/…`, without a
 *    query or a hash.
 * 4. A size is used in place of the original only when it passes rule 3, has
 *    valid dimensions, is the original's shape (WordPress crops some sizes,
 *    such as the 150×150 thumbnail), is at least the minimum width and is
 *    smaller than anything chosen so far, so the reader gets the smallest
 *    file that is still sharp where it is shown: the optimizer reads it for
 *    the card and the page, a social network for a link preview. When no
 *    size qualifies, the original is used, as the largest file there is,
 *    even if it is narrower than the minimum. A size that fails any of these
 *    is skipped, never a reason to drop the image; the original failing is.
 *
 * Neither choice checks a file size. Social networks cap `og:image` (LinkedIn
 * at 5 MB). A size is a WordPress derivative, usually well under that but not
 * always (a 2048-wide PNG of a photograph can pass it); the original is
 * whatever was uploaded; and the REST response carries `filesize` only
 * sometimes, so keeping the files under a cap is the editor's part.
 */

/** The largest width or height accepted, in pixels: well past any camera's, small enough to be a real number. */
export const MAX_IMAGE_DIMENSION = 16_384;

/**
 * The narrowest size worth using for a card. A card is at most about 360 CSS
 * pixels wide (`IMAGE_SIZES` in `components/ResourceCard.tsx`), so 800 is
 * sharp at a device pixel ratio of two with room to spare.
 */
export const CARD_SOURCE_MIN_WIDTH = 800;

/**
 * The narrowest size worth using for `og:image`. LinkedIn asks for at least
 * 1200×627 (https://www.linkedin.com/help/linkedin/answer/46687), and
 * Facebook and X show a large preview at 1200×630; WordPress's 1024-wide
 * `large` size, which the card takes, is under all three.
 */
export const OPEN_GRAPH_MIN_WIDTH = 1200;

export interface FeaturedImage {
  /** `/media/…`, same-origin. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
  /** The attachment's alternative text, possibly empty. */
  readonly alt: string;
}

/** What rule 3 compares against, read from the environment. */
interface ImageTrust {
  readonly origins: ReadonlySet<string>;
  readonly uploadsBase: string;
  readonly httpsOnly: boolean;
}

function imageTrust(): ImageTrust {
  const api = new URL(wpApiUrl());
  const media = new URL(wpMediaOrigin());
  return {
    origins: new Set([api.origin, media.origin]),
    uploadsBase: cmsUrls().uploadsBase,
    httpsOnly: api.protocol === "https:",
  };
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_IMAGE_DIMENSION;
}

/** The `/media/…` path for `source`, or `null` when it is not a CMS image by rule 3. */
function trustedPath(source: string, trust: ImageTrust): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (url.username !== "" || url.password !== "") {
    return null;
  }
  if (trust.httpsOnly && url.protocol === "http:") {
    return null;
  }
  if (!trust.origins.has(url.origin)) {
    return null;
  }
  const path = mediaPath(source, trust.uploadsBase);
  if (path === null) {
    return null;
  }
  const hash = path.indexOf("#");
  return hash === -1 ? path : path.slice(0, hash);
}

/** True when `width`×`height` is `original` scaled, to within a pixel of rounding. */
function sameShape(width: number, height: number, original: { width: number; height: number }): boolean {
  return Math.abs(height - (width * original.height) / original.width) <= 1;
}

/** The resource's featured image by the rules above with `minWidth` as rule 4's minimum, or `null`. Reads `WP_API_URL` and `WP_MEDIA_ORIGIN`. */
function chooseImage(resource: WpResource, minWidth: number): FeaturedImage | null {
  const media = resource._embedded["wp:featuredmedia"][0];
  if (media === undefined || media === null) {
    return null;
  }
  const { width, height, sizes } = media.media_details;
  if (!isDimension(width) || !isDimension(height)) {
    return null;
  }
  const trust = imageTrust();
  const original = trustedPath(media.source_url, trust);
  if (original === null) {
    return null;
  }

  let chosen = { src: original, width, height };
  for (const size of Object.values(sizes)) {
    if (size === null || typeof size !== "object") {
      continue;
    }
    if (!isDimension(size.width) || !isDimension(size.height)) {
      continue;
    }
    if (size.width < minWidth || size.width >= chosen.width) {
      continue;
    }
    if (!sameShape(size.width, size.height, { width, height })) {
      continue;
    }
    const src = trustedPath(size.source_url, trust);
    if (src !== null) {
      chosen = { src, width: size.width, height: size.height };
    }
  }
  return { ...chosen, alt: media.alt_text };
}

/** The image for the card and the resource page's `next/image`: rule 4 with `CARD_SOURCE_MIN_WIDTH`. */
export function featuredImage(resource: WpResource): FeaturedImage | null {
  return chooseImage(resource, CARD_SOURCE_MIN_WIDTH);
}

/** The image for the resource page's `og:image`: rule 4 with `OPEN_GRAPH_MIN_WIDTH`. */
export function openGraphImage(resource: WpResource): FeaturedImage | null {
  return chooseImage(resource, OPEN_GRAPH_MIN_WIDTH);
}
