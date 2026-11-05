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

/** `WP_API_URL`, the CMS's `/wp-json` base, without a trailing slash. */
const wpApiUrlSchema = httpUrl.transform((value) => value.replace(/\/+$/, ""));

/** `WP_MEDIA_ORIGIN`, a bare origin with no path, query or fragment. */
const mediaOriginSchema = httpUrl
  .refine(
    (value) => {
      const url = new URL(value);
      return url.pathname === "/" && url.search === "" && url.hash === "";
    },
    { error: "must be an origin only (scheme, host and port), with no path" },
  )
  .transform((value) => new URL(value).origin);

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
 * The origin `/media/…` is rewritten to (ADR 0040): `WP_MEDIA_ORIGIN` when
 * set, otherwise the origin of `WP_API_URL`.
 */
export function parseMediaOrigin(env: EnvSource): string {
  if (present(env, "WP_MEDIA_ORIGIN") !== undefined) {
    return parse(env, "WP_MEDIA_ORIGIN", mediaOriginSchema);
  }
  return new URL(parseWpApiUrl(env)).origin;
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
