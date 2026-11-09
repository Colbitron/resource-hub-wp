import { SEARCH_PATH } from "@/lib/routes";
import { SEARCH_INPUT_ID } from "@/lib/search-field";

import "@colbitron/resource-hub-ui/search.css";

/**
 * The search page's form (`SearchPage`): a plain GET form to `/search/` in a
 * `search` landmark, so it works without JavaScript and a submission is a
 * full document load. A visible label, a `type="search"` field named `q`
 * that shows `input` again (the visitor's own words, not the normalised
 * query), and a submit button. `describedBy` names the sentence the page
 * shows about the query (too short, no results, the count), so a screen
 * reader hears it on the field, and `invalid` marks the field
 * `aria-invalid` when that sentence says the query cannot be searched as it
 * is (too short, too long, a control character). No `required`, `minlength` or `maxlength`:
 * the page says what is wrong in words, and `maxlength` counts UTF-16 units
 * where the route counts code points. Its CSS is the contract package's
 * `search.css`, which also styles the page's count line, `.rh-search__summary`,
 * and which the CMS theme loads for the same form on its search template
 * (`packages/ui/README.md`, "Stylesheets").
 *
 * The header's search bar (`HeaderSearch`) renders the same form, empty,
 * with its own `id` for the field, so the two never share an ID; the page's
 * sentences about a query are the hints for a search started from either,
 * since both submit to the page.
 */
export function SearchForm({
  input,
  describedBy,
  invalid = false,
  id = SEARCH_INPUT_ID,
}: {
  input: string;
  describedBy?: string;
  invalid?: boolean;
  /** The field's ID; the search page's own by default. */
  id?: string;
}) {
  return (
    <form className="rh-search" role="search" action={SEARCH_PATH} method="get">
      <label className="rh-search__label" htmlFor={id}>
        Search resources and pages
      </label>
      <div className="rh-search__row">
        <input
          className="rh-search__input"
          id={id}
          type="search"
          name="q"
          defaultValue={input}
          enterKeyHint="search"
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
        />
        <button className="rh-search__button" type="submit">
          Search
        </button>
      </div>
    </form>
  );
}
