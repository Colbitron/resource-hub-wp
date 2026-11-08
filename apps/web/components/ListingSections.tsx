import { FilterNav, type FilterTerm } from "@/components/FilterNav";
import { FeaturedLead } from "@/components/FeaturedLead";
import type { ListingFilter } from "@/lib/routes";
import { plainText, type CardData } from "@/lib/wp/cards";
import type { WpTerm } from "@/lib/wp/schemas/rest";

/**
 * The two pieces of a listing page the CMS theme renders too, and the
 * text rules they share, split out of `ListingPage` so the contract's
 * markup fixtures can render each from a sample alone
 * (`test/markup-parity.test.tsx`; `packages/ui/README.md`, "Markup
 * fixtures"): the head (the heading and the count over the filter bar),
 * which the plugin's `resource-hub/collection-head` block writes, and the
 * lead's section, which its `resource-hub/featured-lead` block writes. The
 * listing's reads, its states and its order stay in `ListingPage`; nothing
 * here fetches. The classes are `listing.css`'s, which `ListingPage` imports
 * for the whole page.
 */

/**
 * The listing's name, from the terms it is filtered by: "Resources", "Webinar
 * resources", "Resources on Accessibility", "Webinar resources on
 * Accessibility". Term names are used as the editor wrote them, never
 * pluralised.
 */
export function heading(terms: { type?: WpTerm; topic?: WpTerm }): string {
  const head = terms.type === undefined ? "Resources" : `${plainText(terms.type.name)} resources`;
  return terms.topic === undefined ? head : `${head} on ${plainText(terms.topic.name)}`;
}

/** "1 resource", or "{n} resources". */
export function countLine(total: number): string {
  return total === 1 ? "1 resource" : `${total} resources`;
}

/**
 * The terms the filter bar offers: every term with a published resource, in
 * name order, plus the current term even when its count is zero, so the bar
 * always shows what the page is filtered by. A term that can only lead to an
 * empty page is not offered.
 */
export function offered(terms: WpTerm[], current: string | undefined): FilterTerm[] {
  return terms
    .filter((term) => term.count > 0 || term.slug === current)
    .map((term) => ({ slug: term.slug, name: plainText(term.name) }));
}

/** The `<h1>`'s ID, which `ListingFocus` moves focus to after a client navigation. */
export const HEADING_ID = "rh-listing-heading";

export interface CollectionHeadProps {
  /** The listing's name, from `heading()`. */
  name: string;
  /** Resources across every page, as the CMS counts them; the count line shows only when there are any. */
  total: number;
  /** The types the filter bar offers, from `offered()`. */
  types: FilterTerm[];
  /** The topics the filter bar offers, from `offered()`. */
  topics: FilterTerm[];
  /** The filter the page is showing. */
  current: ListingFilter;
}

/**
 * The head of a collection page: the heading and the count on one line, then
 * the filter bar (`packages/ui/DESIGN.md`, "The collection pages"). The
 * heading carries the ID `ListingFocus` targets and `tabIndex={-1}` so it can
 * take focus.
 */
export function CollectionHead({ name, total, types, topics, current }: CollectionHeadProps) {
  return (
    <>
      <header className="rh-listing__header">
        <h1 id={HEADING_ID} tabIndex={-1}>
          {name}
        </h1>
        {total > 0 && <p className="rh-listing__count">{countLine(total)}</p>}
      </header>
      <FilterNav types={types} topics={topics} current={current} />
    </>
  );
}

/** The lead's section at the top of the library: the "Featured" heading over the lead, its title at `h3`. */
export function FeaturedSection({ lead }: { lead: CardData }) {
  return (
    <div className="rh-listing__lead">
      <h2 className="rh-listing__section">Featured</h2>
      <FeaturedLead {...lead} headingLevel="h3" />
    </div>
  );
}
