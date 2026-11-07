import "server-only";

import type { ListingFilter, ValidListing } from "./routes";
import { toCard, type CardData } from "./wp/cards";
import { CmsError, NO_SUCH_PAGE } from "./wp/fetch";
import { listResources, type ResourceListing } from "./wp/resources";
import type { WpTerm } from "./wp/schemas/rest";
import { FEATURED_FLAG_SLUG, getTermBySlug, listTerms } from "./wp/terms";

/**
 * Every read a listing page makes, in one pass, for `components/ListingPage.tsx`
 * to render from and for the build-time probe in `lib/prerender.ts` to make
 * first (ADR 0053), so a page the build prerenders finds its reads already in
 * the Data Cache. What a listing shows and why is in `ListingPage`'s docblock;
 * this module only reads. It lives in `lib/` rather than beside the component
 * because a route that imports it must not pull the listing's CSS into its
 * own: Next.js inlines every stylesheet in a route's module graph into that
 * route's HTML, whether or not the page renders it, and the resource page
 * grew by 3 KB gzipped, past the 14,600-byte first-round-trip budget, when
 * `lib/prerender.ts` reached `loadListing` through the component
 * (`apps/web/README.md`, "Images"; `e2e/document-size.spec.ts`).
 */

/** Everything a listing page renders from, read in one pass. */
export interface ListingData {
  readonly listing: ResourceListing;
  readonly terms: { type?: WpTerm; topic?: WpTerm };
  readonly types: WpTerm[];
  readonly topics: WpTerm[];
  /** The lead card, on the page that has one; `null` otherwise. */
  readonly lead: CardData | null;
}

/** The terms a filter names, or `null` when one of them does not exist. */
async function filterTerms(filter: ListingFilter): Promise<{ type?: WpTerm; topic?: WpTerm } | null> {
  const [type, topic] = await Promise.all([
    filter.type === undefined ? undefined : getTermBySlug("resource_type", filter.type),
    filter.topic === undefined ? undefined : getTermBySlug("resource_topic", filter.topic),
  ]);
  if (type === null || topic === null) {
    return null;
  }
  return { ...(type === undefined ? {} : { type }), ...(topic === undefined ? {} : { topic }) };
}

/** True when `valid` is the page the lead belongs to: the first page of the unfiltered library. */
function hasLead(valid: ValidListing): boolean {
  return valid.page === 1 && valid.filter.type === undefined && valid.filter.topic === undefined;
}

/**
 * The lead: the newest featured resource with a URL, or `null` when the CMS
 * has no `featured` flag term, nothing carries it, or none of the flagged
 * resources on its first page can be shown.
 */
async function leadCard(): Promise<CardData | null> {
  const featured = await listResources({ flag: FEATURED_FLAG_SLUG, page: 1 });
  if (featured === null || featured === NO_SUCH_PAGE) {
    return null;
  }
  return featured.items.map(toCard).find((card) => card !== null) ?? null;
}

/** `leadCard`, with a CMS failure logged and answered as no lead, so the list still renders. */
async function leadOrNone(): Promise<CardData | null> {
  try {
    return await leadCard();
  } catch (caught) {
    if (!(caught instanceof CmsError)) {
      throw caught;
    }
    console.error(`ListingPage: rendering the library without its lead; ${caught.message}`);
    return null;
  }
}

/**
 * Every read the listing `valid` makes, at once: its page of resources, the
 * terms it is filtered by, the filter bar's two lists and, on the library's
 * first page, the lead. `null` when the page is a 404: a term that does not
 * exist, or a page past the last. The page, its `generateMetadata` and the
 * build-time probe all call this, so they read the same things; within a
 * render the per-render memoization answers the second call from the first.
 * A `CmsError` from any read but the lead's is thrown.
 */
export async function loadListing(valid: ValidListing): Promise<ListingData | null> {
  const { filter, page } = valid;
  const [listing, terms, types, topics, lead] = await Promise.all([
    listResources({ ...filter, page }),
    filterTerms(filter),
    listTerms("resource_type"),
    listTerms("resource_topic"),
    hasLead(valid) ? leadOrNone() : null,
  ]);
  if (listing === null || listing === NO_SUCH_PAGE || terms === null) {
    return null;
  }
  return { listing, terms, types, topics, lead };
}
