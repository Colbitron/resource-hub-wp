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

/**
 * True for a host name that always means this machine: `localhost` and its
 * subdomains, the IPv4 loopback block and the IPv6 loopback address, the
 * only hosts `SITE_URL` may name over plain `http:`.
 */
function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(hostname) ||
    hostname === "[::1]"
  );
}

/**
 * `SITE_URL`, the front end's public origin, which the root layout sets as
 * `metadataBase` so the canonical `link`, `og:url` and `og:image` are
 * absolute. `https:`, or `http:` for a loopback host (local work and the
 * e2e run), with no query, fragment or credentials, and no path beyond `/`:
 * every path the app builds is root-relative, so a base path would be
 * dropped by the resolution anyway, and is refused rather than ignored. It
 * is the origin, with no trailing slash.
 */
const siteUrlSchema = httpUrl
  .refine(urlCheck((url) => url.protocol === "https:" || isLoopback(url.hostname)), {
    error: "must use https, or http only for localhost",
  })
  .refine(noCredentials, { error: "must not contain a user name or password" })
  .refine(noQueryOrFragment, { error: "must not have a query string or fragment" })
  .refine(urlCheck((url) => url.pathname === "/"), { error: "must be an origin, with no path" })
  .transform((value) => new URL(value).origin);

/** The fewest characters `REVALIDATE_SECRET` may have. */
export const MIN_SECRET_LENGTH = 32;

/**
 * The most characters `REVALIDATE_SECRET` may have: the CMS's cap
 * (`Config::SECRET_MAX_LENGTH`), so a secret one side accepts the other does
 * too.
 */
export const MAX_SECRET_LENGTH = 256;

/** Printable ASCII without the space (0x21 to 0x7E): every character a bearer token can carry. */
const BEARER_SAFE = /^[\x21-\x7E]*$/;

/**
 * What can be wrong with a `REVALIDATE_SECRET` that is set:
 * `"bad-characters"` when it has a character outside printable ASCII or any
 * whitespace (a trailing newline or a space pasted with it), which the
 * bearer token the CMS sends can never carry, so no request could ever
 * match it; `"too-short"` when it has fewer than `MIN_SECRET_LENGTH`
 * characters; `"too-long"` when it has more than `MAX_SECRET_LENGTH`, which
 * the CMS refuses, so the two sides could never share it.
 */
export type SecretProblem = "bad-characters" | "too-short" | "too-long";

/**
 * What is wrong with a `REVALIDATE_SECRET` value, or `null` when nothing is.
 * The characters are checked first, so the length is counted in ASCII
 * characters, which are bytes. The CMS's settings page holds its copy of the
 * secret to the same rule.
 */
export function secretProblem(value: string): SecretProblem | null {
  if (!BEARER_SAFE.test(value)) {
    return "bad-characters";
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return "too-short";
  }
  if (value.length > MAX_SECRET_LENGTH) {
    return "too-long";
  }
  return null;
}

const SECRET_PROBLEM_MESSAGES: Record<SecretProblem, string> = {
  "bad-characters":
    "must be printable ASCII with no whitespace, because a bearer token cannot carry anything else",
  "too-short": `must be at least ${MIN_SECRET_LENGTH} characters long`,
  "too-long": `must be at most ${MAX_SECRET_LENGTH} characters long, the most the CMS accepts`,
};

/** A `REVALIDATE_SECRET` that is set but breaks the rule; `problem` says which part. */
export class SecretError extends EnvError {
  override name = "SecretError";
  readonly problem: SecretProblem;

  constructor(problem: SecretProblem) {
    super(`REVALIDATE_SECRET ${SECRET_PROBLEM_MESSAGES[problem]}. ${WHERE}`);
    this.problem = problem;
  }
}

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

/**
 * The bearer secret the CMS sends to `POST /api/revalidate`: 32 to 256
 * printable ASCII characters with no whitespace (root `CLAUDE.md`,
 * "Configuration, front end"). Compared byte for byte, so it is never
 * trimmed: a value with a space or newline in it is refused, not repaired.
 * Throws `EnvError` when it is missing and `SecretError` when it breaks the
 * rule; neither message includes the value.
 */
export function parseRevalidateSecret(env: EnvSource): string {
  const value = present(env, "REVALIDATE_SECRET");
  if (value === undefined) {
    throw new EnvError(`REVALIDATE_SECRET is not set. ${WHERE}`);
  }
  const problem = secretProblem(value);
  if (problem !== null) {
    throw new SecretError(problem);
  }
  return value;
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

/**
 * The site's public origin from `SITE_URL`, e.g. `https://resources.example`,
 * or `undefined` when it is not set, in which case the canonical and
 * `og:url` stay relative paths. A value that is set but malformed throws an
 * `EnvError` naming it.
 */
export function parseSiteUrl(env: EnvSource): string | undefined {
  return present(env, "SITE_URL") === undefined ? undefined : parse(env, "SITE_URL", siteUrlSchema);
}

/**
 * `parseSiteUrl` for `next.config.ts`, which every build loads: on Vercel
 * (`VERCEL` set, as for the `/media/` rewrite in `lib/media-rewrites.ts`) an
 * unset `SITE_URL` throws, because a deploy without it would publish a
 * relative canonical and `og:url` on every page. Elsewhere it may be unset.
 */
export function buildSiteUrl(env: EnvSource): string | undefined {
  const site = parseSiteUrl(env);
  if (site === undefined && isSet(env, "VERCEL")) {
    throw new EnvError(
      "SITE_URL is not set, so the canonical link and og:url would be relative paths. Set SITE_URL to the site's public origin (https://…) in the Vercel project settings, for Production and Preview.",
    );
  }
  return site;
}

/** True when the variable is set to a non-empty value. */
export function isSet(env: EnvSource, name: string): boolean {
  return present(env, name) !== undefined;
}
