import { renderResource, renderTerm } from "./render.mts";
import { isTaxonomy, slugify, type MockState, type ResourceRecord, type TermRecord } from "./state.mts";
import type { Taxonomy } from "./types.mts";

/**
 * The public routes under `/wp-json/`, as WordPress core and the plugin
 * answer an anonymous reader: the resources collection and item, the three
 * taxonomy collections and items, the plugin's resolve route, and the REST
 * index. Each handler takes the request URL and returns a status, headers
 * and a JSON body; the HTTP layer is `server.ts`.
 *
 * Errors are core's `WP_Error` shape (`wp-error.schema.json`), with core's
 * codes and messages where core would send them, because the front end's
 * data layer branches on `code` and `data.status`.
 */

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8" };

/** ADR 0023: anonymous REST responses the front end reads must not be cached between it and the CMS. */
const NO_CACHE = "no-cache, must-revalidate, max-age=0";

function wpError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): MockResponse {
  return { status, headers: { ...JSON_HEADERS }, body: { code, message, data: { status, ...extra } } };
}

function noRoute(): MockResponse {
  return wpError(404, "rest_no_route", "No route was found matching the URL and request method.");
}

/** One bad query parameter, collected into core's `rest_invalid_param` 400. */
class ParamError {
  readonly param: string;
  readonly message: string;

  constructor(param: string, message: string) {
    this.param = param;
    this.message = message;
  }
}

function invalidParams(errors: ParamError[]): MockResponse {
  const params = Object.fromEntries(errors.map((e) => [e.param, e.message]));
  return wpError(400, "rest_invalid_param", `Invalid parameter(s): ${errors.map((e) => e.param).join(", ")}`, {
    params,
    details: Object.fromEntries(
      errors.map((e) => [e.param, { code: "rest_invalid_type", message: e.message, data: null }]),
    ),
  });
}

/** An integer parameter within `[min, max]`, or its default when absent. */
function intParam(
  query: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
  errors: ParamError[],
): number {
  const raw = query.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^-?\d+$/.test(raw)) {
    errors.push(new ParamError(name, `${name} is not of type integer.`));
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    errors.push(new ParamError(name, `${name} must be between ${min} (inclusive) and ${max} (inclusive)`));
    return fallback;
  }
  return value;
}

/** A comma-separated list of integers (`include`, the taxonomy filters), or `null` when absent. */
function intListParam(query: URLSearchParams, name: string, errors: ParamError[]): number[] | null {
  const raw = query.getAll(name).flatMap((value) => value.split(","));
  if (raw.length === 0 || raw.every((value) => value === "")) return null;
  const values = raw.filter((value) => value !== "");
  if (values.some((value) => !/^\d+$/.test(value))) {
    errors.push(new ParamError(name, `${name}[0] is not of type integer.`));
    return null;
  }
  return values.map(Number);
}

/** A comma-separated list of strings (`slug`), or `null` when absent. */
function listParam(query: URLSearchParams, name: string): string[] | null {
  const values = query
    .getAll(name)
    .flatMap((value) => value.split(","))
    .filter((value) => value !== "");
  return values.length === 0 ? null : values;
}

function oneOfParam<T extends string>(
  query: URLSearchParams,
  name: string,
  fallback: T,
  allowed: readonly T[],
  errors: ParamError[],
): T {
  const raw = query.get(name);
  if (raw === null || raw === "") return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    errors.push(new ParamError(name, `${name} is not one of ${allowed.join(", and ")}.`));
    return fallback;
  }
  return raw as T;
}

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
    "Cache-Control": NO_CACHE,
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
  const page = intParam(q, "page", 1, 1, Number.MAX_SAFE_INTEGER, errors);
  const perPage = intParam(q, "per_page", 10, 1, 100, errors);
  const include = intListParam(q, "include", errors);
  const slugs = listParam(q, "slug");
  const orderBy = oneOfParam(q, "orderby", "date", RESOURCE_ORDER_BY, errors);
  const order = oneOfParam(q, "order", "desc", ["asc", "desc"] as const, errors);
  const filters = new Map<Taxonomy, number[]>();
  for (const taxonomy of ["resource_topic", "resource_type", "resource_flag"] as const) {
    const ids = intListParam(q, taxonomy, errors);
    if (ids !== null) filters.set(taxonomy, ids);
  }
  if (errors.length > 0) return invalidParams(errors);

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
  const embed = q.has("_embed");
  return { status: 200, headers: result.headers, body: result.page.map((r) => renderResource(state, r, origin, embed)) };
}

function resourceItem(state: MockState, id: number, url: URL, origin: string): MockResponse {
  const resource = state.resource(id);
  if (!resource) return wpError(404, "rest_post_invalid_id", "Invalid post ID.");
  // A draft or trashed post exists but is not public: core answers an anonymous reader with 401.
  if (resource.status !== "publish") {
    return wpError(401, "rest_forbidden", "Sorry, you are not allowed to view this post.");
  }
  return {
    status: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": NO_CACHE },
    body: renderResource(state, resource, origin, url.searchParams.has("_embed")),
  };
}

// --- /wp/v2/{taxonomy} ---------------------------------------------------------

type TermOrderBy = "name" | "slug" | "id" | "include" | "count";
const TERM_ORDER_BY: readonly TermOrderBy[] = ["name", "slug", "id", "include", "count"];

function termsCollection(state: MockState, taxonomy: Taxonomy, url: URL, origin: string): MockResponse {
  const q = url.searchParams;
  const errors: ParamError[] = [];
  const page = intParam(q, "page", 1, 1, Number.MAX_SAFE_INTEGER, errors);
  const perPage = intParam(q, "per_page", 10, 1, 100, errors);
  const include = intListParam(q, "include", errors);
  const slugs = listParam(q, "slug");
  const orderBy = oneOfParam(q, "orderby", "name", TERM_ORDER_BY, errors);
  const order = oneOfParam(q, "order", "asc", ["asc", "desc"] as const, errors);
  const hideEmpty = oneOfParam(q, "hide_empty", "false", ["true", "false", "1", "0"] as const, errors);
  if (errors.length > 0) return invalidParams(errors);

  let matches = state.termsOf(taxonomy);
  if (include !== null) matches = matches.filter((t) => include.includes(t.id));
  if (slugs !== null) matches = matches.filter((t) => slugs.includes(t.slug));
  if (hideEmpty === "true" || hideEmpty === "1") matches = matches.filter((t) => state.termCount(t) > 0);
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
  return { status: 200, headers: { ...JSON_HEADERS, "Cache-Control": NO_CACHE }, body: renderTerm(state, term, origin) };
}

// --- /resource-hub/v1/resolve -------------------------------------------------------

const MAX_SLUG_LENGTH = 200;

function resolve(state: MockState, url: URL): MockResponse {
  const raw = url.searchParams.get("slug");
  const headers = { ...JSON_HEADERS, "Cache-Control": NO_CACHE };
  if (raw === null) {
    return { ...wpError(400, "rest_missing_callback_param", "Missing parameter(s): slug", { params: ["slug"] }), headers };
  }
  if (Buffer.byteLength(raw) > MAX_SLUG_LENGTH) {
    return { ...invalidParams([new ParamError("slug", `slug is longer than ${MAX_SLUG_LENGTH} bytes.`)]), headers };
  }
  const slug = slugify(raw);
  if (slug === "") {
    return { ...invalidParams([new ParamError("slug", "slug is empty once sanitized.")]), headers };
  }
  const resource = state.publishedBySlug(slug) ?? state.publishedByOldSlug(slug);
  const type = resource?.typeIds.map((id) => state.term("resource_type", id)).find((t) => t !== undefined);
  if (!resource || !type) {
    return { ...wpError(404, "resource_hub_not_found", "No published resource has or had that slug."), headers };
  }
  return { status: 200, headers, body: { id: resource.id, type: type.slug, slug: resource.slug } };
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
    return {
      status: 200,
      headers: { ...JSON_HEADERS },
      body: { name: "Resource Hub mock CMS", url: origin, home: origin, namespaces: ["wp/v2", "resource-hub/v1"], routes: {} },
    };
  }

  let match = /^\/wp\/v2\/resources(?:\/(\d+))?$/.exec(path);
  if (match) {
    return match[1] === undefined ? resourcesCollection(state, url, origin) : resourceItem(state, Number(match[1]), url, origin);
  }

  match = /^\/wp\/v2\/(resource_topic|resource_type|resource_flag)(?:\/(\d+))?$/.exec(path);
  if (match && isTaxonomy(match[1])) {
    return match[2] === undefined
      ? termsCollection(state, match[1], url, origin)
      : termItem(state, match[1], Number(match[2]), origin);
  }

  if (path === "/resource-hub/v1/resolve") return resolve(state, url);

  return noRoute();
}
