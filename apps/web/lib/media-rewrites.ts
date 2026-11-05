import { EnvError, isSet, optionalMediaOrigin, type EnvSource } from "./env-schema";

/** One entry of `next.config.ts`'s `rewrites()`, in the shape Next.js takes. */
export interface MediaRewrite {
  source: string;
  destination: string;
}

/**
 * The `/media/…` rewrite to the CMS's uploads directory, one to one (ADR 0040):
 * `/media/:path*` to `{base}/wp-content/uploads/:path*`, where the base is
 * `WP_MEDIA_ORIGIN` or `WP_API_URL` without its `/wp-json` suffix. Pure apart
 * from `warn`, so `next.config.ts` and unit tests share it.
 *
 * Next.js also loads the config for `next typegen`, which needs no CMS, and
 * `next typegen` and `next build` share the build phase and `NODE_ENV`, so
 * neither tells a type check from a build. Vercel sets `VERCEL` on its builds
 * only: there, a missing base throws, because a deploy without the rewrite
 * would serve every image as a 404. Elsewhere (local runs and CI) the rewrite
 * is left out with a warning. A value that is set but malformed always throws.
 */
export function mediaRewrites(
  env: EnvSource,
  warn: (message: string) => void = console.warn,
): MediaRewrite[] {
  const base = optionalMediaOrigin(env);
  if (base === undefined) {
    if (isSet(env, "VERCEL")) {
      throw new EnvError(
        "WP_API_URL is not set, so /media/ cannot be rewritten to the CMS's uploads. Set WP_API_URL (and WP_MEDIA_ORIGIN if uploads live elsewhere) in the Vercel project settings.",
      );
    }
    warn("WP_API_URL and WP_MEDIA_ORIGIN are not set: /media/ is not rewritten to the CMS.");
    return [];
  }
  return [
    {
      source: "/media/:path*",
      destination: `${base}/wp-content/uploads/:path*`,
    },
  ];
}
