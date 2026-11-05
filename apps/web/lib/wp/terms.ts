import "server-only";

import { canonicalSlug, isSlug, isTypeSlug } from "../routes";
import { flagLookupTags, taxonomyListTags, termLookupTags } from "../tags";
import { CmsError, cmsGetListOk, readPagination } from "./fetch";
import { wpTermSchema, type WpTaxonomy, type WpTerm } from "./schemas/rest";

/**
 * The three taxonomies' terms: every term of one (for the filter bar), one
 * by slug (to turn a listing's path segment into the term ID the REST
 * filter takes), and the `featured` flag's ID.
 *
 * Both reads of a collection are parsed per item (`cmsGetList`, ADR 0049): a
 * term the reader schema refuses is left out with a warning, and a non-empty
 * answer in which every term fails throws a `CmsError`.
 */

/** The `resource_flag` term that marks a featured resource (ADR 0009). */
export const FEATURED_FLAG_SLUG = "featured";

/** Core's largest `per_page`. */
const TERMS_PER_PAGE = 100;

/**
 * A backstop on the filter bar's pages. Past `MAX_TERM_PAGES * TERMS_PER_PAGE`
 * (1,000) terms something is wrong with the CMS, but the listing pages still
 * render: `listTerms` returns the first 1,000 and warns.
 */
export const MAX_TERM_PAGES = 10;

/**
 * Throws when a term in a taxonomy's list claims another taxonomy. Not
 * skipped per item: core serves one taxonomy per endpoint, so a term of
 * another one means the endpoint is answering for the wrong taxonomy, a
 * systematic fault rather than one bad term.
 */
function checkTaxonomy(path: string, taxonomy: WpTaxonomy, terms: readonly WpTerm[]): void {
  if (terms.some((term) => term.taxonomy !== taxonomy)) {
    throw new CmsError(path, "schema", `a term in the list is not in ${taxonomy}`, 200);
  }
}

/**
 * Every term of `taxonomy`, ordered by name, with its `count` of published
 * resources, empty ones included: the filter bar decides what to show.
 * Pages through the collection 100 at a time. Tagged `taxonomyListTags()`.
 *
 * At most `MAX_TERM_PAGES` pages are read. When the CMS has more, the first
 * 1,000 terms by name come back and a `console.warn` names the taxonomy
 * (never the CMS origin): a filter bar missing terms is better than every
 * listing page failing, which is what throwing here would do.
 *
 * A term the reader schema refuses is skipped and logged, so the bar lacks
 * it; a page of the collection on which every term fails throws.
 */
export async function listTerms(taxonomy: WpTaxonomy): Promise<WpTerm[]> {
  const path = `/wp/v2/${taxonomy}`;
  const terms: WpTerm[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      per_page: String(TERMS_PER_PAGE),
      page: String(page),
      orderby: "name",
      order: "asc",
    }).toString();
    const result = await cmsGetListOk({ path, query, tags: taxonomyListTags(), itemSchema: wpTermSchema });
    checkTaxonomy(path, taxonomy, result.data.items);
    terms.push(...result.data.items);
    const { totalPages } = readPagination(path, result.headers);
    if (page >= totalPages) {
      return terms;
    }
    if (page >= MAX_TERM_PAGES) {
      console.warn(
        `listTerms: ${taxonomy} has more than ${MAX_TERM_PAGES * TERMS_PER_PAGE} terms; using the first ${MAX_TERM_PAGES * TERMS_PER_PAGE} by name`,
      );
      return terms;
    }
  }
}

/**
 * The term of `taxonomy` whose slug is `slug`, or `null` when there is none.
 * A slug that cannot be one (`isSlug`, or `isTypeSlug` for a type) is `null`
 * without a request. The slug is canonicalised first (`canonicalSlug`, so
 * `Webinar` looks up `webinar`) and sent in that form, which is the form
 * WordPress stores, so the CMS compares it as stored.
 *
 * Tagged, a miss included, with `termLookupTags` for a topic or type, which a
 * term event for the slug clears, and with `flagLookupTags()` for a flag:
 * flags send no term events (ADR 0046).
 *
 * Parsed per item, like `getResourceBySlug`: core returns at most one term
 * here, so a matching term that fails the schema is the whole answer
 * failing and throws, while a bad term beside a good match is skipped.
 */
export async function getTermBySlug(taxonomy: WpTaxonomy, slug: string): Promise<WpTerm | null> {
  const valid = taxonomy === "resource_type" ? isTypeSlug(slug) : isSlug(slug);
  if (!valid) {
    return null;
  }
  const canonical = canonicalSlug(slug);
  const path = `/wp/v2/${taxonomy}`;
  const tags = taxonomy === "resource_flag" ? flagLookupTags() : termLookupTags(taxonomy, canonical);
  const result = await cmsGetListOk({
    path,
    query: new URLSearchParams({ slug: canonical }).toString(),
    tags,
    itemSchema: wpTermSchema,
  });
  checkTaxonomy(path, taxonomy, result.data.items);
  return result.data.items.find((term) => canonicalSlug(term.slug) === canonical) ?? null;
}

/** The ID of the `featured` flag term, or `null` when the CMS has none. */
export async function getFeaturedFlagId(): Promise<number | null> {
  const term = await getTermBySlug("resource_flag", FEATURED_FLAG_SLUG);
  return term === null ? null : term.id;
}
