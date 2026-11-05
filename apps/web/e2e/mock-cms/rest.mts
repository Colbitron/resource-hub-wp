import { renderResource, renderTerm } from "./render.mts";
import { isTaxonomy, MAX_RELATED, slugify, type MockState, type ResourceRecord, type TermRecord } from "./state.mts";
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
 * as PHP reads `$_GET` and checked in core's order: every parameter is
 * validated first (`WP_REST_Request::has_valid_params`), and only when all
 * pass are they sanitized (`sanitize_params`), each stage collecting its
 * failures into one `rest_invalid_param` 400.
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

function invalidParams(errors: ParamError[]): MockResponse {
  return wpError(400, "rest_invalid_param", `Invalid parameter(s): ${errors.map((e) => e.param).join(", ")}`, {
    params: Object.fromEntries(errors.map((e) => [e.param, e.message])),
    details: Object.fromEntries(errors.map((e) => [e.param, { code: e.code, message: e.message, data: e.data }])),
  });
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
 * An array-of-integers parameter (`include`, the taxonomy filters), as a
 * comma list or `name[]=`, or `null` when absent or empty, which core treats
 * as no filter. An item that is not an integer fails as `name[index]`.
 */
function intListParam(query: URLSearchParams, name: string, errors: ParamError[]): number[] | null {
  const raw = phpParam(query, name);
  if (raw === undefined) return null;
  const values = parseList(raw).map(asInteger);
  const bad = values.findIndex((value) => value === null);
  if (bad !== -1) {
    errors.push(typeError(`${name}[${bad}]`, "integer"));
    return null;
  }
  return values.length === 0 ? null : (values as number[]);
}

/**
 * The `slug` filter, as a comma list or `slug[]=`, sanitized as core does
 * before querying (`wp_parse_slug_list()` for posts, `get_terms()` for terms),
 * or `null` when absent or empty.
 */
function slugListParam(query: URLSearchParams): string[] | null {
  const raw = phpParam(query, "slug");
  if (raw === undefined) return null;
  const slugs = [...new Set(parseList(raw).map(slugify))];
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

/** `register_post_status()` order in `create_initial_post_types()`, plus `any`: the `status` parameter's enum. */
const POST_STATUSES = [
  "publish",
  "future",
  "draft",
  "pending",
  "private",
  "trash",
  "auto-draft",
  "inherit",
  "request-pending",
  "request-confirmed",
  "request-failed",
  "request-completed",
  "any",
];

/**
 * The posts controller's `status` parameter. Validation checks each item
 * against the enum; sanitizing (`sanitize_post_statuses()`) then refuses any
 * status but the default `publish` to a reader who cannot edit posts, with
 * `rest_forbidden_status` and `rest_authorization_required_code()` (401 when
 * logged out) inside the request's `rest_invalid_param` 400. Returns the
 * sanitize-stage error, if any, for the caller to raise after validation.
 */
function statusParam(query: URLSearchParams, errors: ParamError[]): ParamError | null {
  const raw = phpParam(query, "status");
  if (raw === undefined) return null;
  const statuses = parseList(raw);
  const bad = statuses.findIndex((status) => !POST_STATUSES.includes(status));
  if (bad !== -1) {
    errors.push({
      param: "status",
      code: "rest_not_in_enum",
      message: `status[${bad}] is not one of ${wpList(POST_STATUSES)}.`,
      data: null,
    });
    return null;
  }
  if (statuses.every((status) => status === "publish")) return null;
  return { param: "status", code: "rest_forbidden_status", message: "Status is forbidden.", data: { status: 401 } };
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

type ResourceOrderBy = "date" | "id" | "include" | "modified" | "slug" | "title";
const RESOURCE_ORDER_BY: readonly ResourceOrderBy[] = ["date", "id", "include", "modified", "slug", "title"];

function sortResources(resources: ResourceRecord[], orderBy: ResourceOrderBy, order: "asc" | "desc", include: number[] | null) {
  const sign = order === "asc" ? 1 : -1;
  const sorted = [...resources];
  switch (orderBy) {
    case "date":
      // Already in date-desc order from `published()`.
      if (order === "asc") sorted.reverse();
      return sorted;
    case "include":
      return sorted.sort((a, b) => (include?.indexOf(a.id) ?? 0) - (include?.indexOf(b.id) ?? 0));
    case "id":
      return sorted.sort((a, b) => sign * (a.id - b.id));
    case "modified":
      return sorted.sort((a, b) => sign * a.modified.localeCompare(b.modified));
    case "slug":
      return sorted.sort((a, b) => sign * a.slug.localeCompare(b.slug));
    case "title":
      return sorted.sort((a, b) => sign * a.title.localeCompare(b.title));
  }
}

function resourcesCollection(state: MockState, url: URL, origin: string): MockResponse {
  const q = url.searchParams;
  const errors: ParamError[] = [];
  const page = intParam(q, "page", 1, { min: 1 }, errors);
  const perPage = intParam(q, "per_page", 10, { min: 1, max: 100 }, errors);
  const include = intListParam(q, "include", errors);
  const orderBy = enumParam(q, "orderby", "date", RESOURCE_ORDER_BY, errors);
  const order = enumParam(q, "order", "desc", ["asc", "desc"] as const, errors);
  const forbiddenStatus = statusParam(q, errors);
  const filters = new Map<Taxonomy, number[]>();
  for (const taxonomy of ["resource_topic", "resource_type", "resource_flag"] as const) {
    const ids = intListParam(q, taxonomy, errors);
    if (ids !== null) filters.set(taxonomy, ids);
  }
  if (errors.length > 0) return invalidParams(errors);
  // Sanitizing runs only once every parameter has validated.
  if (forbiddenStatus !== null) return invalidParams([forbiddenStatus]);
  const slugs = slugListParam(q);

  // WP_REST_Posts_Controller::get_items, before it queries.
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
  matches = sortResources(matches, orderBy, order, include);

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

type TermOrderBy = "name" | "slug" | "id" | "include" | "count";
const TERM_ORDER_BY: readonly TermOrderBy[] = ["name", "slug", "id", "include", "count"];

function termsCollection(state: MockState, taxonomy: Taxonomy, url: URL, origin: string): MockResponse {
  const q = url.searchParams;
  const errors: ParamError[] = [];
  const page = intParam(q, "page", 1, { min: 1 }, errors);
  const perPage = intParam(q, "per_page", 10, { min: 1, max: 100 }, errors);
  const include = intListParam(q, "include", errors);
  const orderBy = enumParam(q, "orderby", "name", TERM_ORDER_BY, errors);
  const order = enumParam(q, "order", "asc", ["asc", "desc"] as const, errors);
  const hideEmpty = boolParam(q, "hide_empty", false, errors);
  if (errors.length > 0) return invalidParams(errors);
  const slugs = slugListParam(q);

  let matches = state.termsOf(taxonomy);
  if (include !== null) matches = matches.filter((t) => include.includes(t.id));
  if (slugs !== null) matches = matches.filter((t) => slugs.includes(t.slug));
  if (hideEmpty) matches = matches.filter((t) => state.termCount(t) > 0);
  const sign = order === "asc" ? 1 : -1;
  const key = (t: TermRecord): number | string => {
    switch (orderBy) {
      case "name":
        return t.name;
      case "slug":
        return t.slug;
      case "id":
        return t.id;
      case "count":
        return state.termCount(t);
      case "include":
        return include?.indexOf(t.id) ?? 0;
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
  const errors: ParamError[] = [];
  const count = intParam(url.searchParams, "count", 3, { min: 1, max: MAX_RELATED }, errors);
  if (errors.length > 0) return invalidParams(errors);
  const source = state.resource(id);
  if (!source || source.status !== "publish") {
    return wpError(404, "resource_hub_not_found", "No published resource has that ID.");
  }
  return { status: 200, headers: { ...JSON_HEADERS }, body: { items: state.related(source, count) } };
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

  if (path === "/resource-hub/v1/resolve") return covered(allowGet(resolve(state, url)));

  match = /^\/resource-hub\/v1\/related\/(\d+)$/.exec(path);
  if (match) return covered(allowGet(related(state, Number(match[1]), url)));

  return noRoute();
}
