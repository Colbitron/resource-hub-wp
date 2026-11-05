import { z } from "zod";

/**
 * The front end's environment, parsed with Zod. Pure functions over a plain
 * record, with no `server-only` import, so `next.config.ts` and unit tests can
 * use them too. Application code reads the values through `lib/env.ts`, which
 * is server-only and passes `process.env`.
 *
 * Each value is parsed when it is asked for, never at import, so `next build`
 * succeeds without a secret it does not use (CI builds with none), and a
 * missing value fails with its name where it is needed.
 *
 * No message here includes a variable's value.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** A missing or malformed environment variable. */
export class EnvError extends Error {
  override name = "EnvError";
}

const WHERE =
  "Set it in apps/web/.env.local for local work and in the Vercel project settings for deploys (see apps/web/.env.example).";

const httpUrl = z.url({
  protocol: /^https?$/,
  error: "must be an absolute http or https URL",
});

/**
 * A refinement over a parsed URL. Zod runs refinements even after the URL
 * format check has failed, so a value that does not parse passes here and is
 * reported once, by `httpUrl`.
 */
function urlCheck(test: (url: URL) => boolean): (value: string) => boolean {
  return (value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return true;
    }
    return test(url);
  };
}

const noCredentials = urlCheck((url) => url.username === "" && url.password === "");
const noQueryOrFragment = urlCheck((url) => url.search === "" && url.hash === "");
/**
 * No empty path segment. `https://cms.example//wp-json` would otherwise pass
 * the suffix check and leave a base ending in `/`, so the rewrite destination
 * would be `https://cms.example//wp-content/uploads/…`. Rejected rather than
 * collapsed, so the value in the settings is the value in use.
 */
const noEmptySegment = urlCheck((url) => !url.pathname.includes("//"));
const NO_EMPTY_SEGMENT = "must not contain an empty path segment (//)";

/** The path without trailing slashes; `/` becomes the empty string. */
function trimmedPath(url: URL): string {
  return url.pathname.replace(/\/+$/, "");
}

/** The URL as origin plus path, without a trailing slash. */
function originAndPath(value: string): string {
  const url = new URL(value);
  return `${url.origin}${trimmedPath(url)}`;
}

/**
 * `WP_API_URL`, the CMS's `/wp-json` base, without a trailing slash. Its path
 * must end in `/wp-json` (a subdirectory install's `/blog/wp-json` is fine),
 * with no `//` anywhere in it, and it may carry no query, fragment or
 * credentials: the data layer appends
 * paths and query strings to it, and a credential would be sent with every
 * request and printed in any error that names the URL.
 */
const wpApiUrlSchema = httpUrl
  .refine(noCredentials, { error: "must not contain a user name or password" })
  .refine(noQueryOrFragment, { error: "must not have a query string or fragment" })
  .refine(noEmptySegment, { error: NO_EMPTY_SEGMENT })
  .refine(
    urlCheck((url) => /(^|\/)wp-json$/.test(trimmedPath(url))),
    { error: "must be the REST API base, ending in /wp-json" },
  )
  .transform(originAndPath);

/**
 * `WP_MEDIA_ORIGIN`, the site base that `/wp-content/uploads/` sits under: an
 * origin, optionally with the path WordPress is installed in
 * (`https://example.com/blog`), with no query, fragment, credentials or `//`
 * in the path, and not already ending in the uploads directory. A trailing
 * slash is dropped.
 */
const mediaOriginSchema = httpUrl
  .refine(noCredentials, { error: "must not contain a user name or password" })
  .refine(noQueryOrFragment, { error: "must not have a query string or fragment" })
  .refine(noEmptySegment, { error: NO_EMPTY_SEGMENT })
  .refine(
    urlCheck((url) => !/(^|\/)wp-content(\/|$)/.test(url.pathname)),
    { error: "must be the site's base URL, without /wp-content/uploads" },
  )
  .transform(originAndPath);

/** `REVALIDATE_SECRET`, compared byte for byte, so it is never trimmed. */
const secretSchema = z.string().min(1, { error: "must not be empty" });

/** An unset variable and an empty one (`NAME=` copied from .env.example) are the same. */
function present(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function parse<T>(env: EnvSource, name: string, schema: z.ZodType<T>): T {
  const value = present(env, name);
  if (value === undefined) {
    throw new EnvError(`${name} is not set. ${WHERE}`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const reason = result.error.issues.map((issue) => issue.message).join("; ");
    throw new EnvError(`${name} ${reason}. ${WHERE}`);
  }
  return result.data;
}

/** The CMS's REST API base, e.g. `http://localhost:8888/wp-json`, with no trailing slash. */
export function parseWpApiUrl(env: EnvSource): string {
  return parse(env, "WP_API_URL", wpApiUrlSchema);
}

/** The bearer secret the CMS sends to `POST /api/revalidate`. */
export function parseRevalidateSecret(env: EnvSource): string {
  return parse(env, "REVALIDATE_SECRET", secretSchema);
}

/**
 * The base `/media/…` is rewritten under, as `{base}/wp-content/uploads/…`
 * (ADR 0040), with no trailing slash: `WP_MEDIA_ORIGIN` when set, otherwise
 * `WP_API_URL` without its `/wp-json` suffix, so a subdirectory install
 * (`https://example.com/blog/wp-json`) maps to
 * `https://example.com/blog/wp-content/uploads` with no extra setting. An
 * install whose uploads live elsewhere (WordPress in its own directory, or a
 * media host) sets `WP_MEDIA_ORIGIN`.
 */
export function parseMediaOrigin(env: EnvSource): string {
  if (present(env, "WP_MEDIA_ORIGIN") !== undefined) {
    return parse(env, "WP_MEDIA_ORIGIN", mediaOriginSchema);
  }
  return parseWpApiUrl(env).replace(/\/wp-json$/, "");
}

/**
 * `parseMediaOrigin`, or `undefined` when neither variable is set. For
 * `next.config.ts`, which Next.js also loads for `next typegen` (part of
 * `pnpm typecheck`), where no CMS is needed. A value that is set but malformed
 * still throws.
 */
export function optionalMediaOrigin(env: EnvSource): string | undefined {
  if (
    present(env, "WP_MEDIA_ORIGIN") === undefined &&
    present(env, "WP_API_URL") === undefined
  ) {
    return undefined;
  }
  return parseMediaOrigin(env);
}

/** True when the variable is set to a non-empty value. */
export function isSet(env: EnvSource, name: string): boolean {
  return present(env, name) !== undefined;
}
