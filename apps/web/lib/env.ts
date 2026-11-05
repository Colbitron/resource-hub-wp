import "server-only";

import {
  parseMediaOrigin,
  parseRevalidateSecret,
  parseSiteUrl,
  parseWpApiUrl,
} from "./env-schema";
import type { CmsUrls } from "./urls";

/**
 * Server-only access to the front end's environment (ADR 0040). Each getter
 * reads and validates its variable when called, so a missing value throws an
 * `EnvError` naming it at the point of use rather than at import during
 * `next build`. None of these is ever a `NEXT_PUBLIC_` variable.
 */

/** The CMS's REST API base (`WP_API_URL`), with no trailing slash. */
export function wpApiUrl(): string {
  return parseWpApiUrl(process.env);
}

/** The bearer secret for `POST /api/revalidate` (`REVALIDATE_SECRET`). */
export function revalidateSecret(): string {
  return parseRevalidateSecret(process.env);
}

/** The base behind `/media/…`: `WP_MEDIA_ORIGIN`, or `WP_API_URL` without `/wp-json`. */
export function wpMediaOrigin(): string {
  return parseMediaOrigin(process.env);
}

/**
 * The site's public origin (`SITE_URL`) as a URL, for the root layout's
 * `metadataBase`, or `undefined` when it is not set (only outside Vercel,
 * where `next.config.ts` refuses to build without it).
 */
export function siteUrl(): URL | undefined {
  const site = parseSiteUrl(process.env);
  return site === undefined ? undefined : new URL(site);
}

/**
 * What the HTML pass and the link rewrites need to know about the CMS
 * (`lib/urls.ts`, `lib/content/render.tsx`): the site's base URLs, whose
 * origin is stripped from links, and the uploads directory, whose files
 * become `/media/…`. The site base is `WP_API_URL` without `/wp-json`; the
 * media origin is listed too when it differs, so links to a separate media
 * host lose that host as well.
 */
export function cmsUrls(): CmsUrls {
  const site = wpApiUrl().replace(/\/wp-json$/, "");
  const media = wpMediaOrigin();
  return {
    cmsOrigins: site === media ? [site] : [site, media],
    uploadsBase: `${media}/wp-content/uploads`,
  };
}
