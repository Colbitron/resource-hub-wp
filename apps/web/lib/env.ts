import "server-only";

import {
  parseMediaOrigin,
  parseRevalidateSecret,
  parseWpApiUrl,
} from "./env-schema";

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
