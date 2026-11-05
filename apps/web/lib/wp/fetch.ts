import "server-only";

import { cache } from "react";
import { ZodError, type ZodType } from "zod";

import { wpApiUrl, wpMediaOrigin } from "../env";
import { idSchema } from "./schemas/common";
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
 * Anything else throws a `CmsError`: any other status, a redirect, a
 * timeout, a network failure, a body that is not JSON, or a body the schema
 * refuses. Redirects are never followed (`redirect: "error"`): a followed
 * one (http to https, a `www` host, a moved CMS) would cache the final 200
 * under the original URL and hide a `WP_API_URL` that needs changing, so it
 * fails the render with reason `redirect` instead (ADR 0049). Its message
 * names the endpoint's path under the API base and never the CMS's origin.
 *
 * A collection (`cmsGetList`) is parsed one element at a time instead (ADR
 * 0049, amended 2026-11-05): an element the item schema refuses is skipped
 * with a `console.warn`, so one bad resource or term cannot take down every
 * listing it appears in, and a non-empty list in which every element fails
 * throws, because that is a systematic break, not one bad item. That warning
 * is the only thing here that logs; it names the endpoint path, the
 * element's position and ID and the paths of its failing fields, never a
 * value or the CMS origin.
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
export type CmsErrorReason = "timeout" | "network" | "redirect" | "status" | "json" | "schema";

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
  /** The HTTP status, for `status`, `json` and `schema`, and for a `redirect` that reached the reader. */
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

/** What every CMS read names, whatever its body's shape. */
interface CmsRequestBase {
  /** The path under `WP_API_URL`, starting with `/`, such as `/wp/v2/resources`. */
  readonly path: string;
  /** The query, already encoded, without the `?`; empty for none. */
  readonly query: string;
  /** From the functions in `lib/tags.ts`, fixed before the request is sent. */
  readonly tags: readonly string[];
  /** Errors that mean "nothing here": the fetcher returns `null`. */
  readonly misses?: readonly WpErrorMatch[];
  /** Errors that mean "no such page": the fetcher returns `NO_SUCH_PAGE`. */
  readonly outOfRange?: readonly WpErrorMatch[];
}

export interface CmsRequest<T> extends CmsRequestBase {
  /** The reader schema for a 200 body, parsed as a whole. */
  readonly schema: ZodType<T>;
}

export interface CmsListRequest<T> extends CmsRequestBase {
  /** The reader schema for one element of a 200 body, which must be an array. */
  readonly itemSchema: ZodType<T>;
}

/** A collection's elements that passed the item schema, in the CMS's order, and how many did not. */
export interface CmsList<T> {
  readonly items: T[];
  /** Elements skipped because the item schema refused them; each was logged. */
  readonly skipped: number;
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
 * True for the rejection `fetch` gives under `redirect: "error"`: Node's
 * fetch (undici) rejects with a `TypeError` whose `cause` is an `Error` with
 * the fixed message `unexpected redirect`. Any other failure stays a
 * `network` error.
 */
function isRedirectRefusal(error: unknown): boolean {
  const cause = (error as { cause?: { message?: unknown } } | null)?.cause;
  return cause?.message === "unexpected redirect";
}

/** A 3xx that reached the reader: one `fetch` did not refuse, such as a 304 or a 3xx without a `Location`. */
function isRedirectStatus(status: number): boolean {
  return status >= 300 && status <= 399;
}

/**
 * `GET {WP_API_URL}{path}?{query}`, once per render pass for the same
 * arguments. Next.js memoizes identical fetches within a render by itself,
 * but not a fetch that carries a `signal`, so React's `cache` does it here
 * instead: a page and its `generateMetadata` asking for the same resource
 * make one request on a cold cache, not two. For a 200, Next.js's lock on
 * each Data Cache key would also make two concurrent cold reads one request;
 * an answer it does not cache (a 404 or 401 miss by ID, a resolve miss) has
 * only this memoization, and `e2e/data-layer.spec.ts` checks it there.
 * Outside a render (a test, a route handler) `cache` memoizes nothing. The
 * arguments are strings, so `cache` compares them by value; `tagsKey` is the
 * tags joined by newlines, which no tag contains.
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
      redirect: "error",
      signal: AbortSignal.timeout(CMS_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    if (isTimeout(error)) {
      throw new CmsError(path, "timeout", `no complete answer within ${CMS_TIMEOUT_MS} ms`);
    }
    if (isRedirectRefusal(error)) {
      throw new CmsError(path, "redirect", "the CMS answered with a redirect; check WP_API_URL");
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

/**
 * A schema failure as a short list of `path: message`, without the values.
 * `prefix` goes before each issue's path: an element's index in its list.
 */
function describeIssues(error: ZodError, prefix: readonly PropertyKey[] = []): string {
  const issues = error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = [...prefix, ...issue.path];
    const where = path.length === 0 ? "(body)" : path.map(String).join(".");
    return `${where}: ${issue.message}`;
  });
  const more = error.issues.length > MAX_ISSUES ? `; and ${error.issues.length - MAX_ISSUES} more` : "";
  return `${issues.join("; ")}${more}`;
}

/** A path segment the reader schema names (`slug`, `wp:term`, an index), or `?` for one that could hold body text. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_:]{1,40}$/;

/**
 * Where a schema failure is, as its distinct issue paths (`slug`, `title`,
 * `_embedded.wp:term.1.0.slug`), with no messages: a refinement's message can
 * quote part of the value (`slugProblem` names the escape it found), and a
 * warning must never repeat what the CMS sent. A segment that is neither an
 * index nor a plain field name is written `?`, so a key taken from the body
 * cannot appear either.
 */
function describeIssuePaths(error: ZodError): string {
  const segment = (key: PropertyKey): string =>
    typeof key === "number" || SAFE_PATH_SEGMENT.test(String(key)) ? String(key) : "?";
  const where = (path: readonly PropertyKey[]): string => (path.length === 0 ? "(item)" : path.map(segment).join("."));
  const paths = [...new Set(error.issues.map((issue) => where(issue.path)))];
  const more = paths.length > MAX_ISSUES ? ` and ${paths.length - MAX_ISSUES} more` : "";
  return `${paths.slice(0, MAX_ISSUES).join(", ")}${more}`;
}

/** An element's `id` when it is a WordPress ID (a positive integer), safe to name in a log. */
function elementId(element: unknown): number | undefined {
  const id = typeof element === "object" && element !== null ? (element as { id?: unknown }).id : undefined;
  const parsed = idSchema.safeParse(id);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Parses a collection one element at a time; see the module comment. Not an
 * array is a `CmsError`; an element the item schema refuses is skipped and
 * logged; a non-empty list with no element left is a `CmsError` naming the
 * first element's issues, as a whole-body parse would.
 */
function parseList<T>(path: string, json: unknown, itemSchema: ZodType<T>, status: number): CmsList<T> {
  if (!Array.isArray(json)) {
    throw new CmsError(path, "schema", "the body does not match the reader schema: (body): must be an array", status);
  }
  const items: T[] = [];
  let firstFailure: { index: number; error: ZodError } | undefined;
  json.forEach((element: unknown, index) => {
    const parsed = itemSchema.safeParse(element);
    if (parsed.success) {
      items.push(parsed.data);
      return;
    }
    firstFailure ??= { index, error: parsed.error };
    const id = elementId(element);
    console.warn(
      scrubCmsHost(
        `CMS list ${path}: skipped item ${index}${id === undefined ? "" : ` (ID ${id})`}, which fails the reader schema at ${describeIssuePaths(parsed.error)}`,
      ),
    );
  });
  if (firstFailure !== undefined && items.length === 0) {
    throw new CmsError(
      path,
      "schema",
      `every item fails the reader schema; the first: ${describeIssues(firstFailure.error, [firstFailure.index])}`,
      status,
    );
  }
  return { items, skipped: json.length - items.length };
}

/**
 * Reads one CMS endpoint and decides what its answer means, with `parseBody`
 * reading a 200's JSON (and throwing a `CmsError` when it refuses it).
 */
async function read<T>(
  request: CmsRequestBase,
  parseBody: (json: unknown, status: number) => T,
): Promise<CmsResult<T>> {
  const { path, query, tags } = request;
  const raw = await load(path, query, tags.join("\n"));

  if (raw.status === 200) {
    if (raw.json === undefined) {
      throw new CmsError(path, "json", "the body is not JSON", raw.status);
    }
    return { kind: "ok", data: parseBody(raw.json, raw.status), headers: raw.headers };
  }

  if (isRedirectStatus(raw.status)) {
    throw new CmsError(path, "redirect", `the CMS answered with a redirect (HTTP ${raw.status}); check WP_API_URL`, raw.status);
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
 * Reads one CMS endpoint whose 200 body is parsed as a whole, and decides
 * what its answer means; see the module comment. Throws a `CmsError` on
 * anything the caller did not name. For a single object: a by-ID read, the
 * resolve route.
 */
export function cmsGet<T>(request: CmsRequest<T>): Promise<CmsResult<T>> {
  const { path, schema } = request;
  return read(request, (json, status) => {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new CmsError(path, "schema", `the body does not match the reader schema: ${describeIssues(parsed.error)}`, status);
    }
    return parsed.data;
  });
}

/**
 * `cmsGet` for a collection: the 200 body must be an array, parsed one
 * element at a time with `itemSchema` (`parseList`). The pagination headers
 * are left as the CMS sent them, so a page with a skipped element still
 * reports the CMS's totals.
 */
export function cmsGetList<T>(request: CmsListRequest<T>): Promise<CmsResult<CmsList<T>>> {
  const { path, itemSchema } = request;
  return read(request, (json, status) => parseList(path, json, itemSchema, status));
}

type OkResult<T> = { readonly data: T; readonly headers: Headers };

/** The `ok` result of a request that names no expected errors; the narrowing is here once rather than in every fetcher. */
function okOnly<T>(path: string, result: CmsResult<T>): OkResult<T> {
  if (result.kind !== "ok") {
    throw new CmsError(path, "status", "an answer the request did not expect");
  }
  return result;
}

/** `cmsGet` for a request that names no expected errors, so the only outcome that returns is `ok`. */
export async function cmsGetOk<T>(request: Omit<CmsRequest<T>, "misses" | "outOfRange">): Promise<OkResult<T>> {
  return okOnly(request.path, await cmsGet(request));
}

/** `cmsGetList` for a request that names no expected errors, so the only outcome that returns is `ok`. */
export async function cmsGetListOk<T>(
  request: Omit<CmsListRequest<T>, "misses" | "outOfRange">,
): Promise<OkResult<CmsList<T>>> {
  return okOnly(request.path, await cmsGetList(request));
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
 * `message` with every mention of a configured CMS host replaced by `[cms]`,
 * in any case: for `WP_API_URL` and the media origin, the host with its port
 * when it has one, and the bare hostname as well, so a CMS on `:8443` is
 * scrubbed from `http://cms.example/x` too. The longer form goes first, so
 * `cms.example:8443` becomes `[cms]`, not `[cms]:8443`. A backstop: the
 * messages built above are not meant to contain one, and a missing or
 * malformed environment variable leaves the message as it is, since then
 * there is no host to leak.
 */
export function scrubCmsHost(message: string): string {
  const hosts = new Set<string>();
  for (const read of [wpApiUrl, wpMediaOrigin]) {
    try {
      const url = new URL(read());
      hosts.add(url.host);
      hosts.add(url.hostname);
    } catch {
      // Not configured: nothing to scrub for it.
    }
  }
  let scrubbed = message;
  for (const host of [...hosts].filter((host) => host !== "").sort((a, b) => b.length - a.length)) {
    scrubbed = scrubbed.replace(new RegExp(escapeRegExp(host), "gi"), "[cms]");
  }
  return scrubbed;
}
