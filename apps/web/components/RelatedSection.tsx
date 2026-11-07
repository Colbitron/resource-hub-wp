import { RelatedList, type RelatedCard } from "@/components/RelatedList";
import { CmsError } from "@/lib/wp/fetch";
import { getRelated, inRelatedOrder, toRelatedCard } from "@/lib/wp/related";
import { getResourcesByIds } from "@/lib/wp/resources";

/** The section's heading. The block's heading is the editor's; this one is the front end's. */
export const RELATED_HEADING = "Related resources";

/** The `id` of the section's heading, which names the section as a region; one section per page, so one id. */
export const RELATED_HEADING_ID = "rh-related-heading";

export interface RelatedSectionProps {
  /** The host resource's post ID, which the related route takes. */
  readonly id: number;
  /** The host's canonical slug, for `relatedTags`. */
  readonly slug: string;
}

/**
 * The resource page's related section (issue #50; the contract is in
 * `packages/ui/README.md`, "Related items"): the plugin's related route
 * chooses and orders the IDs, picks first and then the newest sharing a
 * topic, and `getResourcesByIds` reads the objects in that order, so one
 * code path renders a resource everywhere and no permalink is rewritten.
 * Two CMS requests on a cold cache, both in the Data Cache under
 * `relatedTags(slug)`, so any resource event clears them with the page.
 *
 * What it renders: nothing when the CMS has no answer (`getRelated` is
 * `null`: a CMS without the route, or a host that is no longer published),
 * when the route names nothing, or when none of the named resources can be
 * a row; otherwise `RelatedList` with the rows in the route's order. A pick
 * that is no longer published is already left out by the route; one the
 * reader schema refuses is left out by `getResourcesByIds`, logged; and one
 * with no visible title or no type is left out by `toRelatedCard`, so the
 * section can show fewer rows than the route named, down to none. It asks
 * the route for no more than it shows: the IDs are the route's choice, and
 * a second request to fill the gap would cost more than the rare short
 * list.
 *
 * A `CmsError` from either read is caught here, around the section alone,
 * and logged: the page renders without its related section rather than
 * failing, because the section is an aside to the resource and the resource
 * has already rendered from reads that succeeded. That is also what holds
 * the front end against a CMS one deploy behind: today's production CMS
 * answers the related route with core's 404 `rest_no_route`, which
 * `getRelated` reads as "no answer", warning once per process, and this
 * renders as no section. Any other error (a `RangeError` from a bad
 * argument) is a bug and still fails the page.
 *
 * An async server component, rendered by `ResourceArticle` where the route
 * passes it (`app/resources/[type]/[slug]/page.tsx`); the design specimen
 * renders the article without it, so the specimen stays fixed data.
 */
export async function RelatedSection({ id, slug }: RelatedSectionProps) {
  let cards: RelatedCard[];
  try {
    const related = await getRelated(id, { hostSlug: slug });
    if (related === null || related.length === 0) {
      return null;
    }
    const ids = related.map((item) => item.id);
    const resources = await getResourcesByIds(ids, { hostSlug: slug });
    cards = inRelatedOrder(ids, resources)
      .map(toRelatedCard)
      .filter((card): card is NonNullable<typeof card> => card !== null);
  } catch (error) {
    if (!(error instanceof CmsError)) {
      throw error;
    }
    console.error("RelatedSection: a related read failed; rendering the page without the section", error);
    return null;
  }
  if (cards.length === 0) {
    return null;
  }
  return <RelatedList heading={RELATED_HEADING} headingId={RELATED_HEADING_ID} cards={cards} />;
}
