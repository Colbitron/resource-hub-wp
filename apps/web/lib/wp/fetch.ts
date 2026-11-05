import "server-only";

import { cache } from "react";
import { ZodError, type ZodType } from "zod";

import { wpApiUrl, wpMediaOrigin } from "../env";
import { parsePaginationHeaders, type Pagination } from "./schemas/pagination";
import { wpErrorSchema } from "./schemas/wp-error";

/**
 * The one way the data layer reads the CMS: a GET under `WP_API_URL`, made on
 * the server (ADR 0040), cached in the Next.js Data Cache with the tags the
 * caller fixed from the request (ADRs 0043, 0046), bounded by a timeout, and
 * parsed with a reader schema. What comes back is one of three outcomes the
 * fetchers turn into plain values:
 *
 * - `ok`: a 200 whose body the schema accepted.
 * - `miss`: a WordPress error the caller named as "nothing here" (a 404 for
 *   no such post, a 401 for an unpublished one). The fetcher returns `null`
 *   and the page calls `notFound()`.
 * - `no-such-page`: a WordPress error the caller named as a page number past
 *   the end (core's 400 `rest_post_invalid_page_number`).
 *
 * Anything else throws a `CmsError`: any other status, a timeout, a network
 * failure, a body that is not JSON, or a body the schema refuses. Its message
 * names the endpoint's path under the API base and never the CMS's origin,
 * and nothing here logs.
 */

/**
 * The ISR safety-net interval, in seconds, on every CMS fetch (ADR 0049). On-demand
 * revalidation is the primary path; the plugin sends each batch once, with
 * no retries (ADR 0013), so this interval is the only repair for a send that
 * failed. Pages that set a route `revalidate` must write the same number as
 * a literal, because Next.js reads segment config statically.
 */
export const CMS_REVALIDATE_SECONDS = 3600;

/**
 * How long one CMS request may take, headers and body together, in
 * milliseconds (ADR 0049). A healthy WordPress answers these reads in well
 * under two seconds even with a cold object cache, so ten gives a slow but
 * working CMS five times that, while a hung one fails the render with a
 * `CmsError` long before a Vercel function's duration limit, instead of
 * holding the function open. A resource page makes at most three requests
 * in sequence on a cold cache, so its worst case stays near thirty seconds.
 *
 * Next.js drops the signal when it refreshes a stale cache entry in the
 * background, so that refresh is not bounded by this; the visitor is served
 * the stale entry meanwhile and does not wait on it.
 */
export const CMS_TIMEOUT_MS = 10_000;

/** Why a CMS request failed. */
export type CmsErrorReason = "timeout" | "network" | "status" | "json" | "schema";

/**
 * A CMS request that failed in a way the page cannot treat as "not found".
 * The message names the endpoint path under `WP_API_URL` (`/wp/v2/resources`)
 * and never the CMS origin: any text that came from the CMS or the network
 * layer is left out or scrubbed of the CMS host, and the underlying error is
 * not kept as `cause`, because Node's network errors print the address.
 */
export class CmsError extends Error {
  override name = "CmsError";
  /** The path under the API base, without the query. */
  readonly endpoint: string;
  readonly reason: CmsErrorReason;
  /** The HTTP status, for `status`, `json` and `schema`. */
  readonly status: number | undefined;

  constructor(endpoint: string, reason: CmsErrorReason, detail: string, status?: number) {
    super(scrubCmsHost(`CMS request to ${endpoint} failed: ${detail}`));
    this.endpoint = endpoint;
    this.reason = reason;
    this.status = status;
  }
}

/** Returned by a collection fetcher when the page number is past the last page. */
export const NO_SUCH_PAGE = "no-such-page";
export type NoSuchPage = typeof NO_SUCH_PAGE;

/** A WordPress error, by status and `code`, that a fetcher treats as an expected answer. */
export interface WpErrorMatch {
  readonly status: number;
  readonly code: string;
}

export interface CmsRequest<T> {
  /** The path under `WP_API_URL`, starting with `/`, such as `/wp/v2/resources`. */
  readonly path: string;
  /** The query, already encoded, without the `?`; empty for none. */
  readonly query: string;
  /** From the functions in `lib/tags.ts`, fixed before the request is sent. */
  readonly tags: readonly string[];
  /** The reader schema for a 200 body. */
  readonly schema: ZodType<T>;
  /** Errors that mean "nothing here": the fetcher returns `null`. */
  readonly misses?: readonly WpErrorMatch[];
  /** Errors that mean "no such page": the fetcher returns `NO_SUCH_PAGE`. */
  readonly outOfRange?: readonly WpErrorMatch[];
}

export type CmsResult<T> =
  | { readonly kind: "ok"; readonly data: T; readonly headers: Headers }
  | { readonly kind: "miss" }
  | { readonly kind: typeof NO_SUCH_PAGE };

/** A response as read off the wire, before anything is decided about it. */
interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  /** The parsed body, or `undefined` when it was not JSON. */
  readonly json: unknown;
}

/** Node's network error codes (`ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`): safe to name, unlike the message. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,40}$/;

/** A WordPress error `code` shaped like one core or a plugin writes, safe to repeat. */
const WP_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/** At most this many schema issues are named in a message. */
const MAX_ISSUES = 5;

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : undefined;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * `GET {WP_API_URL}{path}?{query}`, once per render pass for the same
 * arguments. Next.js memoizes identical fetches within a render by itself,
 * but not a fetch that carries a `signal`, so React's `cache` does it here
 * instead: a page and its `generateMetadata` asking for the same resource
 * make one request on a cold cache, not two. Outside a render (a test, a
 * route handler) `cache` memoizes nothing. The arguments are strings, so
 * `cache` compares them by value; `tagsKey` is the tags joined by newlines,
 * which no tag contains.
 */
const load = cache(async (path: string, query: string, tagsKey: string): Promise<RawResponse> => {
  const url = `${wpApiUrl()}${path}${query === "" ? "" : `?${query}`}`;
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      cache: "force-cache",
      next: { revalidate: CMS_REVALIDATE_SECONDS, tags: tagsKey.split("\n") },
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CMS_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    if (isTimeout(error)) {
      throw new CmsError(path, "timeout", `no complete answer within ${CMS_TIMEOUT_MS} ms`);
    }
    const code = errorCode(error);
    throw new CmsError(path, "network", code === undefined ? "network error" : `network error ${code}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json };
});

function matches(error: { status: number; code: string }, list: readonly WpErrorMatch[] | undefined): boolean {
  return (list ?? []).some((match) => match.status === error.status && match.code === error.code);
}

/** A schema failure as a short list of `path: message`, without the values. */
function describeIssues(error: ZodError): string {
  const issues = error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const where = issue.path.length === 0 ? "(body)" : issue.path.map(String).join(".");
    return `${where}: ${issue.message}`;
  });
  const more = error.issues.length > MAX_ISSUES ? `; and ${error.issues.length - MAX_ISSUES} more` : "";
  return `${issues.join("; ")}${more}`;
}

/**
 * Reads one CMS endpoint and decides what its answer means; see the module
 * comment. Throws a `CmsError` on anything the caller did not name.
 */
export async function cmsGet<T>(request: CmsRequest<T>): Promise<CmsResult<T>> {
  const { path, query, tags, schema } = request;
  const raw = await load(path, query, tags.join("\n"));

  if (raw.status === 200) {
    if (raw.json === undefined) {
      throw new CmsError(path, "json", "the body is not JSON", raw.status);
    }
    const parsed = schema.safeParse(raw.json);
    if (!parsed.success) {
      throw new CmsError(path, "schema", `the body does not match the reader schema: ${describeIssues(parsed.error)}`, raw.status);
    }
    return { kind: "ok", data: parsed.data, headers: raw.headers };
  }

  const wpError = wpErrorSchema.safeParse(raw.json);
  if (wpError.success && wpError.data.data.status === raw.status) {
    const error = { status: raw.status, code: wpError.data.code };
    if (matches(error, request.misses)) {
      return { kind: "miss" };
    }
    if (matches(error, request.outOfRange)) {
      return { kind: NO_SUCH_PAGE };
    }
    const code = WP_ERROR_CODE.test(error.code) ? ` (${error.code})` : "";
    throw new CmsError(path, "status", `HTTP ${raw.status}${code}`, raw.status);
  }
  throw new CmsError(path, "status", `HTTP ${raw.status}`, raw.status);
}

/**
 * `cmsGet` for a request that names no expected errors, so the only outcome
 * that returns is `ok`; the narrowing is here once rather than in every
 * fetcher.
 */
export async function cmsGetOk<T>(
  request: Omit<CmsRequest<T>, "misses" | "outOfRange">,
): Promise<{ readonly data: T; readonly headers: Headers }> {
  const result = await cmsGet(request);
  if (result.kind !== "ok") {
    throw new CmsError(request.path, "status", "an answer the request did not expect");
  }
  return result;
}

/** The `X-WP-Total` and `X-WP-TotalPages` headers of an `ok` result, or a `CmsError` naming the bad one. */
export function readPagination(path: string, headers: Headers): Pagination {
  try {
    return parsePaginationHeaders(headers);
  } catch (error) {
    const detail = error instanceof ZodError ? describeIssues(error) : "unreadable headers";
    throw new CmsError(path, "schema", `the pagination headers do not parse: ${detail}`, 200);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `message` with every mention of a configured CMS host (with its port when
 * it has one) replaced by `[cms]`, in any case. A backstop: the messages
 * built above are not meant to contain one, and a missing or malformed
 * environment variable leaves the message as it is, since then there is no
 * host to leak.
 */
export function scrubCmsHost(message: string): string {
  const hosts: string[] = [];
  for (const read of [wpApiUrl, wpMediaOrigin]) {
    try {
      hosts.push(new URL(read()).host);
    } catch {
      // Not configured: nothing to scrub for it.
    }
  }
  let scrubbed = message;
  for (const host of hosts) {
    scrubbed = scrubbed.replace(new RegExp(escapeRegExp(host), "gi"), "[cms]");
  }
  return scrubbed;
}
