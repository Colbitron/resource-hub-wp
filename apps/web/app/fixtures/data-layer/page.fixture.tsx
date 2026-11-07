import { connection } from "next/server";

import { ResourceCard } from "@/components/ResourceCard";
import { toCard, type CardData } from "@/lib/wp/cards";
import { NO_SUCH_PAGE } from "@/lib/wp/fetch";
import { getResourceById, getResourceBySlug, listResources, type ResourceListing } from "@/lib/wp/resources";
import type { WpResource } from "@/lib/wp/schemas/rest";

/**
 * A test-only page over the real data layer, for e2e/data-layer.spec.ts: the
 * first two pages of the library and one seeded resource by slug, read from
 * the mock CMS and rendered with `ResourceCard`. A route only under
 * `RH_FIXTURES=1` (see `next.config.ts`).
 *
 * `connection()` renders it on every request, so a second load exercises the
 * Data Cache rather than a prerendered page: the spec counts the mock's
 * requests to show that the fetches, not the page, are cached.
 *
 * With `?twice={id}` it also reads that resource by ID twice in the same
 * render, at once, as a page and its `generateMetadata` would. The spec
 * passes an ID the CMS answers with a 404, which the Data Cache never keeps,
 * so every load is a cold one, and the mock's counters show one request: the
 * per-render memoization in `lib/wp/fetch.ts` at work. (A 200 would not show
 * it: Next.js locks each Data Cache key while it fetches, so two concurrent
 * cold reads of a cacheable answer make one request even without it.)
 */

/** A resource in the mock's seed with a featured image and a rich body. */
const SEEDED_SLUG = "revalidation-from-the-editors-chair";

function cards(resources: readonly WpResource[]): CardData[] {
  return resources.map(toCard).filter((card): card is CardData => card !== null);
}

function Listing({ id, label, listing }: { id: string; label: string; listing: ResourceListing | typeof NO_SUCH_PAGE | null }) {
  if (listing === null || listing === NO_SUCH_PAGE) {
    return (
      <section aria-labelledby={id} data-testid={id}>
        <h2 id={id}>{label}</h2>
        <p data-testid={`${id}-missing`}>{listing === null ? "Not found" : "No such page"}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} data-testid={id}>
      <h2 id={id}>{label}</h2>
      <p data-testid={`${id}-totals`}>
        {`${listing.total} resources on ${listing.totalPages} pages`}
      </p>
      <ul className="rh-card-grid" role="list">
        {cards(listing.items).map((card) => (
          <li key={card.href}>
            <ResourceCard {...card} headingLevel="h3" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function DataLayerFixturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { twice } = await searchParams;
  const twiceId = typeof twice === "string" ? Number(twice) : undefined;
  const [first, second, resource, ...twiceReads] = await Promise.all([
    listResources({ page: 1 }),
    listResources({ page: 2 }),
    getResourceBySlug(SEEDED_SLUG),
    ...(twiceId === undefined ? [] : [getResourceById(twiceId), getResourceById(twiceId)]),
  ]);
  const single = resource === null ? null : toCard(resource);

  return (
    <>
      <h1>Data layer fixtures</h1>
      <Listing id="page-1" label="Library, page 1" listing={first} />
      <Listing id="page-2" label="Library, page 2" listing={second} />
      <section aria-labelledby="by-slug" data-testid="by-slug">
        <h2 id="by-slug">One resource by slug</h2>
        {single === null ? (
          <p data-testid="by-slug-missing">Not found</p>
        ) : (
          <ResourceCard {...single} headingLevel="h3" />
        )}
      </section>
      {twiceId === undefined ? null : (
        <p data-testid="twice">{twiceReads.map((read) => (read === null ? "miss" : read.slug)).join(", ")}</p>
      )}
    </>
  );
}
