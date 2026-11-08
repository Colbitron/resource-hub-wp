import { MAX_SEARCH_PAGE } from "./wp/schemas/search";
import { normalizeSearchQuery, searchQuery } from "./wp/search";

/**
 * What a request to the search page (`/search/?q=…&page=n`, issue #115)
 * asks for, read from its query string alone, before any request to the CMS.
 * The page renders one state per kind and answers every one with a 200: the
 * search page never redirects and never answers a 404, because it is the one
 * dynamic route (ADR 0043, amended) and `DataNotFound` sets its 404 status
 * only on an ISR route (`components/DataNotFound.tsx`).
 *
 * - `none`: no `q`, or one that is only whitespace. The form alone.
 * - `too-short`, `too-long`: a `q` that is under 2 or over 100 code points
 *   once normalised, which the plugin's route would refuse with a 400
 *   (`searchQuery`). A message beside the form; no request.
 * - `search`: a query to send and a page from 1 to `MAX_SEARCH_PAGE`.
 * - `no-such-page`: a valid query with a `page` that is not a canonical
 *   number from 1 to `MAX_SEARCH_PAGE` (`0`, `02`, `1.5`, `11`, `x`): the
 *   route would refuse it with a 400, so it is the "no results on this page"
 *   state, a 200 with a link to the first page, and no request. A page from
 *   2 to 10 past the last one with results is asked for, and the route
 *   answers it with no items, the same state.
 *
 * `input` is `q` as the visitor typed it, so the form shows their words
 * again, whitespace and all; the query sent and every link built from it use
 * the normalised form, so one search has one URL per page. A parameter given
 * more than once (`?q=a&q=b`) counts its first value, as `URLSearchParams.get`
 * does.
 */
export type SearchRequest =
  | { readonly kind: "none"; readonly input: string }
  | { readonly kind: "too-short"; readonly input: string }
  | { readonly kind: "too-long"; readonly input: string }
  | { readonly kind: "search"; readonly input: string; readonly query: string; readonly page: number }
  | { readonly kind: "no-such-page"; readonly input: string; readonly query: string; readonly page: string };

/** A query-string value as Next.js hands `searchParams` to a page. */
export type SearchParamValue = string | string[] | undefined;

/** The first value of a parameter, or `""` when it is absent. */
function first(value: SearchParamValue): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

/** A canonical page number from 1 to `MAX_SEARCH_PAGE`: decimal digits, no sign, no leading zero, no fraction. */
function pageNumber(value: string): number | null {
  if (!/^[1-9][0-9]?$/.test(value)) {
    return null;
  }
  const page = Number(value);
  return page <= MAX_SEARCH_PAGE ? page : null;
}

/** The search page's request, from its `q` and `page` parameters (see the type for each kind). */
export function parseSearchRequest(params: { readonly q?: SearchParamValue; readonly page?: SearchParamValue }): SearchRequest {
  const input = first(params.q);
  const normalised = normalizeSearchQuery(input);
  if (normalised === "") {
    return { kind: "none", input };
  }
  const query = searchQuery(input);
  if (query === null) {
    return { kind: [...normalised].length < 2 ? "too-short" : "too-long", input };
  }
  const rawPage = first(params.page);
  if (rawPage === "") {
    return { kind: "search", input, query, page: 1 };
  }
  const page = pageNumber(rawPage);
  return page === null ? { kind: "no-such-page", input, query, page: rawPage } : { kind: "search", input, query, page };
}
