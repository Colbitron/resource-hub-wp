import { renderPage, renderResource, renderTerm } from "./render.mts";
import { slugify, slugifyForQuery } from "./sanitize.mts";
import { isTaxonomy, MAX_RELATED, type MockState, type ResourceRecord, type TermRecord } from "./state.mts";
import type { Taxonomy } from "./types.mts";

/**
 * The public routes under `/wp-json/`, as WordPress core and the plugin
 * answer an anonymous reader: the resources collection and item, the three
 * taxonomy collections and items, the plugin's resolve and related routes,
 * and the REST index. Each handler takes the request URL and returns a status, headers
 * and a JSON body; the HTTP layer is `server.ts`.
 *
 * Errors are core's `WP_Error` shape (`wp-error.schema.json`), with core's
 * codes and messages where core would send them, because the front end's
 * data layer branches on `code` and `data.status`. Query parameters are read
 * as PHP reads `$_GET` and checked in core's two stages, each collecting its
 * failures into one `rest_invalid_param` 400:
 *
 * 1. `WP_REST_Request::has_valid_params()` runs the arguments that have a
 *    `validate_callback`, in the controller's argument order. In these
 *    controllers that is only `page` and `per_page` (and `search`, which the
 *    mock does not serve), from `WP_REST_Controller::get_collection_params()`.
 * 2. Only when those pass, `sanitize_params()` runs every argument's
 *    `sanitize_callback`. For every other argument that is
 *    `rest_parse_request_arg()`, which validates against the schema and
 *    sanitizes in one step; for the posts controller's `status` it is
 *    `sanitize_post_statuses()`. This stage walks the request's parameters
 *    in the order the query string gives them, so its errors come in that
 *    order (`sanitized()`).
 */

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8" };

/**
 * ADR 0023: anonymous REST responses the front end reads must not be cached
 * between it and the CMS. The plugin's filter sends this on every response
 * from `/wp/v2/resources`, the taxonomy routes and `/resource-hub/v1/`,
 * errors included, so the mock does too (`covered()`).
 */
const NO_CACHE = "no-cache, must-revalidate, max-age=0";

function wpError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): MockResponse {
  return { status, headers: { ...JSON_HEADERS }, body: { code, message, data: { status, ...extra } } };
}

function noRoute(): MockResponse {
  return wpError(404, "rest_no_route", "No route was found matching the URL and request method.");
}

/** A response from a route the plugin's no-cache filter covers. */
function covered(response: MockResponse): MockResponse {
  return { ...response, headers: { ...response.headers, "Cache-Control": NO_CACHE } };
}

/**
 * `rest_send_allow_header()`: on a matched route, `Allow` lists the methods
 * whose permission callback passes for this request. For an anonymous reader
 * that is `GET` on the collections, on a readable item and on the plugin's
 * public routes, and nothing (no header) on an item it cannot read or that
 * does not exist, whose permission check fails.
 */
function allowGet(response: MockResponse): MockResponse {
  return { ...response, headers: { ...response.headers, Allow: "GET" } };
}

// --- Query parameters ----------------------------------------------------------

/**
 * One bad query parameter, as `rest_convert_error_to_response()` puts it in
 * `data.details`: the inner error's code, message and data.
 */
interface ParamError {
  param: string;
  code: string;
  message: string;
  data: unknown;
}

function typeError(param: string, type: string): ParamError {
  return { param, code: "rest_invalid_type", message: `${param} is not of type ${type}.`, data: { param } };
}

/**
 * The failures of the two stages, kept apart: `validated` for arguments with
 * a `validate_callback` (stage 1), `sanitized` for the rest (stage 2).
 */
interface ParamErrors {
  validated: ParamError[];
  sanitized: ParamError[];
}

function paramErrors(): ParamErrors {
  return { validated: [], sanitized: [] };
}

function invalidParams(errors: ParamError[]): MockResponse {
  return wpError(400, "rest_invalid_param", `Invalid parameter(s): ${errors.map((e) => e.param).join(", ")}`, {
    params: Object.fromEntries(errors.map((e) => [e.param, e.message])),
    details: Object.fromEntries(errors.map((e) => [e.param, { code: e.code, message: e.message, data: e.data }])),
  });
}

/**
 * The 400 core sends for these failures, if any: stage 1's alone when it has
 * any, otherwise every stage-2 failure, in the query string's order.
 */
function invalidParamsResponse(query: URLSearchParams, errors: ParamErrors): MockResponse | null {
  if (errors.validated.length > 0) return invalidParams(errors.validated);
  if (errors.sanitized.length > 0) return invalidParams(sanitized(query, errors.sanitized));
  return null;
}

/** The base name of a query-string key as `phpParam()` reads it: `name` for `name`, `name[]` and `name[n]`. */
function phpName(key: string): string {
  return /^([^[]+)\[\d*\]$/.exec(key)?.[1] ?? key;
}

/** Stage-2 failures in the order their parameters first appear in the query string, which is `$_GET`'s key order. */
function sanitized(query: URLSearchParams, errors: ParamError[]): ParamError[] {
  const order = [...new Set([...query.keys()].map(phpName))];
  return [...errors].sort((a, b) => order.indexOf(a.param) - order.indexOf(b.param));
}

/**
 * A query parameter as PHP parses the query string into `$_GET`: `name=`
 * gives the last value, and `name[]=` or `name[n]=` build an array, as core
 * then reads it. `undefined` when absent.
 */
function phpParam(query: URLSearchParams, name: string): string | string[] | undefined {
  let value: string | string[] | undefined;
  for (const [key, raw] of query) {
    if (key === name) {
      value = raw;
    } else if (key.startsWith(`${name}[`) && /^\[\d*\]$/.test(key.slice(name.length))) {
      value = Array.isArray(value) ? [...value, raw] : [raw];
    }
  }
  return value;
}

/** `wp_parse_list()`: a string split on commas and whitespace, or an array as it is. */
function parseList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : value.split(/[\s,]+/).filter((item) => item !== "");
}

/** PHP's `is_numeric()` on a string, near enough: optional sign, decimals, exponent, surrounding whitespace. */
const NUMERIC = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;

/** `rest_is_integer()`: numeric and whole, so `"2"` and `"2.0"` pass and `""` and `"2.5"` do not. */
function asInteger(value: string): number | null {
  if (!NUMERIC.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

/**
 * An integer parameter with core's schema checks (`rest_validate_integer_value_from_schema`),
 * or its default when absent. `max` is optional, as it is for `page`, and the
 * bounds message is the one core picks for the bounds given.
 */
function intParam(
  query: URLSearchParams,
  name: string,
  fallback: number,
  bounds: { min: number; max?: number },
  errors: ParamError[],
): number {
  const raw = phpParam(query, name);
  if (raw === undefined) return fallback;
  const value = Array.isArray(raw) ? null : asInteger(raw);
  if (value === null) {
    errors.push(typeError(name, "integer"));
    return fallback;
  }
  const { min, max } = bounds;
  if (max === undefined ? value < min : value < min || value > max) {
    const message =
      max === undefined
        ? `${name} must be greater than or equal to ${min}`
        : `${name} must be between ${min} (inclusive) and ${max} (inclusive)`;
    errors.push({ param: name, code: "rest_out_of_bounds", message, data: null });
    return fallback;
  }
  return value;
}

/**
 * An `include` parameter, an array of integers, as a comma list or
 * `name[]=`, or `null` when absent or empty, which core treats as no filter.
 * An item that is not an integer fails under the parameter's own name, with
 * the item named in the message and `data.param`, as
 * `rest_validate_array_value_from_schema()` reports it.
 */
function intListParam(query: URLSearchParams, name: string, errors: ParamError[]): number[] | null {
  const raw = phpParam(query, name);
  if (raw === undefined) return null;
  const values = parseList(raw).map(asInteger);
  const bad = values.findIndex((value) => value === null);
  if (bad !== -1) {
    errors.push({ ...typeError(`${name}[${bad}]`, "integer"), param: name });
    return null;
  }
  return values.length === 0 ? null : (values as number[]);
}

/**
 * A term filter on the posts controller (`resource_topic`, `resource_type`,
 * `resource_flag`). Its schema is `oneOf` a Term ID List (an array of
 * integers) and a Term ID Taxonomy Query (an object with `terms`), from
 * `prepare_taxonomy_limit_schema()`, so a bad value fails as
 * `rest_find_one_matching_schema()` words it:
 *
 * - a comma list can only be the list, so a bad item gives that schema's
 *   reason, at position 0;
 * - `name[]=` is a PHP array, which both schemas could take, so a bad item
 *   names both and gives no reason;
 * - an empty value is both an empty list and an empty object, which `oneOf`
 *   refuses.
 *
 * The mock reads only the list form; an object (`name[terms][]=`) is not served.
 */
function termFilterParam(query: URLSearchParams, name: string, errors: ParamError[]): number[] | null {
  const raw = phpParam(query, name);
  if (raw === undefined) return null;
  const both = "Term ID List and Term ID Taxonomy Query";
  if (raw === "") {
    const message = `${name} matches ${both}, but should match only one.`;
    errors.push({ param: name, code: "rest_one_of_multiple_matches", message, data: { positions: [0, 1] } });
    return null;
  }
  const values = parseList(raw).map(asInteger);
  const bad = values.findIndex((value) => value === null);
  if (bad !== -1) {
    errors.push(
      Array.isArray(raw)
        ? { param: name, code: "rest_no_matching_schema", message: `${name} is not a valid ${both}.`, data: null }
        : {
            param: name,
            code: "rest_no_matching_schema",
            message: `${name} is not a valid Term ID List. Reason: ${name}[${bad}] is not of type integer.`,
            data: { position: 0 },
          },
    );
    return null;
  }
  return values.length === 0 ? null : (values as number[]);
}

/**
 * The `slug` filter, as a comma list or `slug[]=`, cleaned as core cleans it
 * before querying, or `null` when absent or empty. The posts controller hands
 * it to `WP_Query` as `post_name__in`, which uses `sanitize_title_for_query()`
 * (`slugifyForQuery`); the terms controller hands it to `get_terms()`, which
 * uses `sanitize_title()` (`slugify`).
 */
function slugListParam(query: URLSearchParams, clean: (slug: string) => string): string[] | null {
  const raw = phpParam(query, "slug");
  if (raw === undefined) return null;
  const slugs = [...new Set(parseList(raw).map(clean))];
  return slugs.length === 0 ? null : slugs;
}

/** `wp_sprintf()`'s `%l`: "a", "a and b", "a, b, and c". */
function wpList(values: readonly string[]): string {
  if (values.length <= 2) return values.join(" and ");
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function enumParam<T extends string>(
  query: URLSearchParams,
  name: string,
  fallback: T,
  allowed: readonly T[],
  errors: ParamError[],
): T {
  const raw = phpParam(query, name);
  if (raw === undefined) return fallback;
  if (Array.isArray(raw)) {
    errors.push(typeError(name, "string"));
    return fallback;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    const message = allowed.length === 1 ? `${name} is not ${allowed[0]}.` : `${name} is not one of ${wpList(allowed)}.`;
    errors.push({ param: name, code: "rest_not_in_enum", message, data: null });
    return fallback;
  }
  return raw as T;
}

/** A boolean parameter as `rest_is_boolean()` accepts it: `true`, `false`, `1` or `0`, in any case. */
function boolParam(query: URLSearchParams, name: string, fallback: boolean, errors: ParamError[]): boolean {
  const raw = phpParam(query, name);
  if (raw === undefined) return fallback;
  const value = Array.isArray(raw) ? "" : raw.toLowerCase();
  if (!["true", "false", "1", "0"].includes(value)) {
    errors.push(typeError(name, "boolean"));
    return fallback;
  }
  return value === "true" || value === "1";
}

/**
 * The posts controller's `status` parameter, a stage-2 failure.
 * `sanitize_post_statuses()` cleans the list with `wp_parse_slug_list()` and
 * refuses any status but the default `publish` to a reader who cannot edit
 * posts, with `rest_forbidden_status` and `rest_authorization_required_code()`
 * (401 when logged out). It refuses before it would check the enum, so for an
 * anonymous reader an unknown status is refused the same way.
 */
function statusParam(query: URLSearchParams, errors: ParamError[]): void {
  const raw = phpParam(query, "status");
  if (raw === undefined) return;
  if (parseList(raw).every((status) => slugify(status) === "publish")) return;
  errors.push({ param: "status", code: "rest_forbidden_status", message: "Status is forbidden.", data: { status: 401 } });
}

/**
 * `_embed` as `WP_REST_Server::serve_request()` reads it through
 * `rest_parse_embed_param()`: absent is no embedding; a value PHP calls
 * falsy (`""`, `"0"`), `"true"` or `"1"` embeds every link; anything else is
 * a list of link relations to embed, so `_embed=false` embeds only a
 * relation named `false`, which is none.
 */
function embedParam(query: URLSearchParams): boolean | string[] {
  const raw = phpParam(query, "_embed");
  if (raw === undefined) return false;
  if (!Array.isArray(raw) && ["", "0", "true", "1"].includes(raw)) return true;
  const rels = parseList(raw);
  return rels.length === 0 ? true : rels;
}

// --- Pagination ----------------------------------------------------------------

/**
 * Core's pagination: `X-WP-Total`, `X-WP-TotalPages` and a `Link` header with
 * `prev` and `next`. A page past the last one differs by controller: the posts
 * controller answers it with a 400 when there is anything to page through (a
 * page past an empty result is an empty 200), so it passes `outOfRange`; the
 * terms controller has no such check and answers an empty 200 with the
 * totals, so it passes `null`.
 */
function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
  url: URL,
  outOfRange: (() => MockResponse) | null,
): { page: T[]; headers: Record<string, string> } | MockResponse {
  const total = items.length;
  const totalPages = Math.ceil(total / perPage);
  if (outOfRange !== null && page > totalPages && total > 0) return outOfRange();
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    "X-WP-Total": String(total),
    "X-WP-TotalPages": String(totalPages),
  };
  const links: string[] = [];
  const pageUrl = (n: number) => {
    const next = new URL(url);
    next.searchParams.set("page", String(n));
    return next.toString();
  };
  // Core clamps `prev` to the last page, so a page past the end points back at it.
  if (page > 1) links.push(`<${pageUrl(Math.min(page - 1, totalPages))}>; rel="prev"`);
  if (page < totalPages) links.push(`<${pageUrl(page + 1)}>; rel="next"`);
  if (links.length > 0) headers.Link = links.join(", ");
  return { page: items.slice((page - 1) * perPage, page * perPage), headers };
}

function isMockResponse(value: unknown): value is MockResponse {
  return typeof value === "object" && value !== null && "status" in value && "body" in value;
}

// --- /wp/v2/resources -------------------------------------------------------

/** `orderby`'s enum, in the order `WP_REST_Posts_Controller::get_collection_params()` lists it for a post type without page attributes. */
const RESOURCE_ORDER_BY = [
  "author",
  "date",
  "id",
  "include",
  "modified",
  "parent",
  "relevance",
  "slug",
  "include_slugs",
  "title",
] as const;
type ResourceOrderBy = (typeof RESOURCE_ORDER_BY)[number];

/**
 * `WP_Query`'s ordering. `include` and `include_slugs` follow the list given
 * and ignore `order`, as `WP_Query` forces them ascending; `include_slugs`
 * with no `slug` falls back to the date, ascending for the same reason.
 * Every resource has one author and no parent, so `author` and `parent` tie
 * throughout: MySQL leaves the order of ties undefined, and the mock keeps
 * newest first. (`relevance` never sorts: the caller refuses it first.)
 */
function sortResources(
  resources: ResourceRecord[],
  orderBy: ResourceOrderBy,
  order: "asc" | "desc",
  include: number[] | null,
  slugs: string[] | null,
): ResourceRecord[] {
  const sign = order === "asc" ? 1 : -1;
  // Already in date-desc order from `published()`.
  const sorted = [...resources];
  switch (orderBy) {
    case "date":
      return order === "asc" ? sorted.reverse() : sorted;
    case "include":
      return sorted.sort((a, b) => (include?.indexOf(a.id) ?? 0) - (include?.indexOf(b.id) ?? 0));
    case "include_slugs":
      return slugs === null ? sorted.reverse() : sorted.sort((a, b) => slugs.indexOf(a.slug) - slugs.indexOf(b.slug));
    case "id":
      return sorted.sort((a, b) => sign * (a.id - b.id));
    case "modified":
      return sorted.sort((a, b) => sign * a.modified.localeCompare(b.modified));
    case "slug":
      return sorted.sort((a, b) => sign * a.slug.localeCompare(b.slug));
    case "title":
      return sorted.sort((a, b) => sign * a.title.localeCompare(b.title));
    case "author":
    case "parent":
    case "relevance":
      return sorted;
  }
}

function resourcesCollection(state: MockState, url: URL, origin: string): MockResponse {
  const q = url.searchParams;
  const errors = paramErrors();
  const page = intParam(q, "page", 1, { min: 1 }, errors.validated);
  const perPage = intParam(q, "per_page", 10, { min: 1, max: 100 }, errors.validated);
  const include = intListParam(q, "include", errors.sanitized);
  const order = enumParam(q, "order", "desc", ["asc", "desc"] as const, errors.sanitized);
  const orderBy = enumParam(q, "orderby", "date", RESOURCE_ORDER_BY, errors.sanitized);
  statusParam(q, errors.sanitized);
  const filters = new Map<Taxonomy, number[]>();
  for (const taxonomy of ["resource_topic", "resource_type", "resource_flag"] as const) {
    const ids = termFilterParam(q, taxonomy, errors.sanitized);
    if (ids !== null) filters.set(taxonomy, ids);
  }
  const invalid = invalidParamsResponse(q, errors);
  if (invalid !== null) return invalid;
  const slugs = slugListParam(q, slugifyForQuery);

  // WP_REST_Posts_Controller::get_items, before it queries. The mock serves no `search`, so `relevance` always fails.
  if (orderBy === "relevance") {
    return wpError(400, "rest_no_search_term_defined", "You need to define a search term to order by relevance.");
  }
  if (orderBy === "include" && include === null) {
    return wpError(400, "rest_orderby_include_missing_include", "You need to define an include parameter to order by include.");
  }

  let matches = state.published();
  if (include !== null) matches = matches.filter((r) => include.includes(r.id));
  if (slugs !== null) matches = matches.filter((r) => slugs.includes(r.slug));
  // Terms are OR within a taxonomy and AND across taxonomies, as core's tax_query does.
  for (const [taxonomy, ids] of filters) {
    matches = matches.filter((r) => state.termIds(r, taxonomy).some((id) => ids.includes(id)));
  }
  matches = sortResources(matches, orderBy, order, include, slugs);

  const result = paginate(matches, page, perPage, url, () =>
    wpError(400, "rest_post_invalid_page_number", "The page number requested is larger than the number of pages available."),
  );
  if (isMockResponse(result)) return result;
  const embed = embedParam(q);
  return { status: 200, headers: result.headers, body: result.page.map((r) => renderResource(state, r, origin, embed)) };
}

function resourceItem(state: MockState, id: number, url: URL, origin: string): MockResponse {
  const resource = state.resource(id);
  if (!resource) return wpError(404, "rest_post_invalid_id", "Invalid post ID.");
  // A draft or trashed post exists but is not public: its permission check
  // returns false, and the server answers an anonymous reader with this 401.
  if (resource.status !== "publish") {
    return wpError(401, "rest_forbidden", "Sorry, you are not allowed to do that.");
  }
  return allowGet({
    status: 200,
    headers: { ...JSON_HEADERS },
    body: renderResource(state, resource, origin, embedParam(url.searchParams)),
  });
}

// --- /wp/v2/{taxonomy} ---------------------------------------------------------

/** `orderby`'s enum, in the order `WP_REST_Terms_Controller::get_collection_params()` lists it. */
const TERM_ORDER_BY = ["id", "include", "name", "slug", "include_slugs", "term_group", "description", "count"] as const;

function termsCollection(state: MockState, taxonomy: Taxonomy, url: URL, origin: string): MockResponse {
  const q = url.searchParams;
  const errors = paramErrors();
  const page = intParam(q, "page", 1, { min: 1 }, errors.validated);
  const perPage = intParam(q, "per_page", 10, { min: 1, max: 100 }, errors.validated);
  const include = intListParam(q, "include", errors.sanitized);
  const order = enumParam(q, "order", "asc", ["asc", "desc"] as const, errors.sanitized);
  const orderBy = enumParam(q, "orderby", "name", TERM_ORDER_BY, errors.sanitized);
  const hideEmpty = boolParam(q, "hide_empty", false, errors.sanitized);
  const invalid = invalidParamsResponse(q, errors);
  if (invalid !== null) return invalid;
  const slugs = slugListParam(q, slugify);

  let matches = state.termsOf(taxonomy);
  if (include !== null) matches = matches.filter((t) => include.includes(t.id));
  if (slugs !== null) matches = matches.filter((t) => slugs.includes(t.slug));
  if (hideEmpty) matches = matches.filter((t) => state.termCount(t) > 0);
  // `WP_Term_Query::parse_orderby()`: `order` applies to every key, the lists
  // included. `include` and `include_slugs` with nothing to follow fall back
  // to the name; `include_slugs` matches its list as `sanitize_title_for_query()`
  // cleans it, and a term it misses sorts first, as MySQL's FIELD() gives 0.
  // Every term has `term_group` 0, so that key ties throughout.
  const rawSlugs = phpParam(q, "slug");
  const querySlugs = rawSlugs === undefined ? [] : parseList(rawSlugs).map(slugifyForQuery);
  const sign = order === "asc" ? 1 : -1;
  const key = (t: TermRecord): number | string => {
    switch (orderBy) {
      case "id":
        return t.id;
      case "include":
        return include === null ? t.name : include.indexOf(t.id);
      case "name":
        return t.name;
      case "slug":
        return t.slug;
      case "include_slugs":
        return slugs === null ? t.name : querySlugs.indexOf(t.slug) + 1;
      case "term_group":
        return 0;
      case "description":
        return t.description;
      case "count":
        return state.termCount(t);
    }
  };
  matches = [...matches].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return sign * (typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb)));
  });

  // WP_REST_Terms_Controller::get_items has no page-number check: past the end it is a 200 with `[]`.
  const result = paginate(matches, page, perPage, url, null);
  if (isMockResponse(result)) return result;
  return { status: 200, headers: result.headers, body: result.page.map((t) => renderTerm(state, t, origin)) };
}

function termItem(state: MockState, taxonomy: Taxonomy, id: number, origin: string): MockResponse {
  const term = state.term(taxonomy, id);
  if (!term) return wpError(404, "rest_term_invalid", "Term does not exist.");
  return allowGet({ status: 200, headers: { ...JSON_HEADERS }, body: renderTerm(state, term, origin) });
}

// --- /resource-hub/v1/resolve -------------------------------------------------------

const MAX_SLUG_LENGTH = 200;

/** The plugin's `validate_callback` returns its own `rest_invalid_param` errors, which core nests in the 400. */
function slugError(message: string): MockResponse {
  return invalidParams([{ param: "slug", code: "rest_invalid_param", message, data: null }]);
}

function resolve(state: MockState, url: URL): MockResponse {
  const raw = phpParam(url.searchParams, "slug");
  if (raw === undefined) {
    return wpError(400, "rest_missing_callback_param", "Missing parameter(s): slug", { params: ["slug"] });
  }
  if (Array.isArray(raw)) {
    return invalidParams([{ param: "slug", code: "rest_invalid_type", message: "slug must be a string.", data: null }]);
  }
  if (Buffer.byteLength(raw) > MAX_SLUG_LENGTH) return slugError(`slug is longer than ${MAX_SLUG_LENGTH} bytes.`);
  const slug = slugify(raw);
  if (slug === "") return slugError("slug is empty once sanitized.");
  const resource = state.publishedBySlug(slug) ?? state.publishedByOldSlug(slug);
  const type = resource?.typeIds.map((id) => state.term("resource_type", id)).find((t) => t !== undefined);
  if (!resource || !type) {
    return wpError(404, "resource_hub_not_found", "No published resource has or had that slug.");
  }
  return { status: 200, headers: { ...JSON_HEADERS }, body: { id: resource.id, type: type.slug, slug: resource.slug } };
}

// --- /resource-hub/v1/related/{id} --------------------------------------------------

/**
 * The plugin's related route (ADRs 0020, 0021, 0030): `count` is an integer
 * from 1 to 10, default 3, checked by core's schema validation; an ID that is
 * not a published resource is a 404; the merge is `MockState.related()`.
 */
function related(state: MockState, id: number, url: URL): MockResponse {
  const errors = paramErrors();
  const count = intParam(url.searchParams, "count", 3, { min: 1, max: MAX_RELATED }, errors.sanitized);
  const invalid = invalidParamsResponse(url.searchParams, errors);
  if (invalid !== null) return invalid;
  const source = state.resource(id);
  if (!source || source.status !== "publish") {
    return wpError(404, "resource_hub_not_found", "No published resource has that ID.");
  }
  return { status: 200, headers: { ...JSON_HEADERS }, body: { items: state.related(source, count) } };
}

// --- /wp/v2/pages/{id} and /resource-hub/v1/page (ADR 0052) -----------------------------

function pageItem(state: MockState, id: number, origin: string): MockResponse {
  const page = state.page(id);
  if (!page) return wpError(404, "rest_post_invalid_id", "Invalid post ID.");
  if (page.status !== "publish") return wpError(401, "rest_forbidden", "Sorry, you are not allowed to do that.");
  return allowGet({ status: 200, headers: { ...JSON_HEADERS }, body: renderPage(state, page, origin) });
}

const MAX_PAGE_PATH_LENGTH = 2010;

/**
 * The plugin's page route: `path` defaults to `/`; its segments, split on `/`
 * with the ends trimmed, are each sanitized as a slug, and an empty one is a
 * 400 `rest_invalid_param` as the plugin's `validate_callback` words it.
 */
function pageLookup(state: MockState, url: URL): MockResponse {
  const raw = phpParam(url.searchParams, "path") ?? "/";
  if (Array.isArray(raw)) {
    return invalidParams([{ param: "path", code: "rest_invalid_type", message: "path must be a string.", data: null }]);
  }
  if (Buffer.byteLength(raw) > MAX_PAGE_PATH_LENGTH) {
    return invalidParams([{ param: "path", code: "rest_invalid_param", message: `path is longer than ${MAX_PAGE_PATH_LENGTH} bytes.`, data: null }]);
  }
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  const segments = trimmed === "" ? [] : trimmed.split("/").map(slugify);
  if (segments.some((segment) => segment === "")) {
    return invalidParams([{ param: "path", code: "rest_invalid_param", message: "path has a segment that is empty once sanitized.", data: null }]);
  }
  return { status: 200, headers: { ...JSON_HEADERS }, body: { page: state.lookupPage(segments) } };
}

// --- Routing -----------------------------------------------------------------------

/**
 * Answers a request whose path starts with `/wp-json`. `origin` is the mock's
 * own address, used for every absolute URL in a body.
 */
export function handleRest(state: MockState, method: string, url: URL, origin: string): MockResponse {
  if (method !== "GET" && method !== "HEAD") return noRoute();
  const path = url.pathname.replace(/^\/wp-json/, "").replace(/\/+$/, "");

  if (path === "") {
    return allowGet({
      status: 200,
      headers: { ...JSON_HEADERS },
      body: { name: "Resource Hub mock CMS", url: origin, home: origin, namespaces: ["wp/v2", "resource-hub/v1"], routes: {} },
    });
  }

  let match = /^\/wp\/v2\/resources(?:\/(\d+))?$/.exec(path);
  if (match) {
    return covered(
      match[1] === undefined
        ? allowGet(resourcesCollection(state, url, origin))
        : resourceItem(state, Number(match[1]), url, origin),
    );
  }

  match = /^\/wp\/v2\/(resource_topic|resource_type|resource_flag)(?:\/(\d+))?$/.exec(path);
  if (match && isTaxonomy(match[1])) {
    return covered(
      match[2] === undefined
        ? allowGet(termsCollection(state, match[1], url, origin))
        : termItem(state, match[1], Number(match[2]), origin),
    );
  }

  match = /^\/wp\/v2\/pages\/(\d+)$/.exec(path);
  if (match) return covered(pageItem(state, Number(match[1]), origin));

  if (path === "/resource-hub/v1/page") return covered(allowGet(pageLookup(state, url)));

  if (path === "/resource-hub/v1/resolve") return covered(allowGet(resolve(state, url)));

  match = /^\/resource-hub\/v1\/related\/(\d+)$/.exec(path);
  if (match) return covered(allowGet(related(state, Number(match[1]), url)));

  return noRoute();
}
