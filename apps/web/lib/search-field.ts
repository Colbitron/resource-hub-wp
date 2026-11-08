/**
 * The IDs of the two search fields: the search page's own (`SearchPage`,
 * through `SearchForm`'s default) and the header's search bar's
 * (`HeaderSearch`), so the two forms never share an ID. A module of its own,
 * with no import, because the header's client component needs the page's ID
 * for its link to that field and must not import `SearchForm` eagerly: that
 * would put the form's stylesheet into every page's HTML (`HeaderSearch`'s
 * docblock has the bytes).
 */

/** The search page's field, which its label names and the header's control links to on that page. */
export const SEARCH_INPUT_ID = "rh-search-q";

/** The header's search bar's field. */
export const HEADER_SEARCH_INPUT_ID = "rh-header-search-q";
