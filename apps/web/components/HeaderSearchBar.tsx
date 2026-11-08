import { HEADER_SEARCH_INPUT_ID } from "@/lib/search-field";

import { SearchForm } from "./SearchForm";

import "@colbitron/resource-hub-ui/header-search-bar.css";

/**
 * The inside of the header's search bar: the search page's own form
 * (`SearchForm`, a GET form to `/search/` in a `search` landmark), empty,
 * with the bar's field ID, in the shell's gutter. `HeaderSearch` imports
 * this module on demand, never eagerly, so the form's `search.css` and the
 * bar's `header-search-bar.css` reach a page's CSS only once a reader is
 * about to open the bar, and never its HTML (`HeaderSearch`'s docblock has
 * the bytes).
 */
export function HeaderSearchBar() {
  return (
    <div className="rh-shell__inner">
      <SearchForm input="" id={HEADER_SEARCH_INPUT_ID} />
    </div>
  );
}
