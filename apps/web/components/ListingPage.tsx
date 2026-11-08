import type { Metadata } from "next";
import Link from "next/link";

import { DataNotFound, NOT_FOUND_METADATA } from "@/components/DataNotFound";
import { ListingFocus } from "@/components/ListingFocus";
import { CollectionHead, FeaturedSection, HEADING_ID, heading, offered } from "@/components/ListingSections";
import { Pagination } from "@/components/Pagination";
import { ResourceCard } from "@/components/ResourceCard";
import { loadListing } from "@/lib/listing-data";
import { listingPath, validListing, type ListingRequest } from "@/lib/routes";
import { toCard } from "@/lib/wp/cards";
import type { ResourceListing } from "@/lib/wp/resources";

import "@colbitron/resource-hub-ui/listing.css";

/**
 * The one listing behind the eight listing routes under `app/resources/`
 * (ADR 0024; the URL shape is in `packages/ui/README.md`): the library, a type,
 * a topic, a type within a topic, and page `n` of each. A route file parses its
 * segments and hands them here as a `ListingRequest`; this module validates
 * them, reads the data layer and renders the page, and `listingMetadata` gives
 * the route its `generateMetadata`.
 *
 * What a request gets:
 *
 * - A type segment that cannot be a type slug (`topic`, `page`, or not a
 *   slug), a topic segment that cannot be a slug, or a page segment that is
 *   not a canonical page number 2 or more (`0`, `01`, `1.5`, `x`, and `1`,
 *   whose URL is the listing's own) is a 404 before any request
 *   (`validListing` in `lib/routes.ts`). Mixed case and `/page/1/` never
 *   reach a route, and nor, in the usual case, do those segments:
 *   `proxy.ts` has already redirected the first to the canonical path and
 *   answered the second with the not-found page's HTML
 *   (`lib/path-decision.ts`, issue #46), so the check here is a second line.
 * - A type or topic that names no term, or a page past the last, is a 404:
 *   the data layer answers `null` or `NO_SUCH_PAGE`.
 * - Either 404 renders `DataNotFound`, which throws `notFound()` inside its
 *   own Suspense boundary so the 404's HTML is the site's not-found page
 *   (issue #46), and `listingMetadata` returns `NOT_FOUND_METADATA` rather
 *   than throwing (`components/DataNotFound.tsx` has why).
 * - A page with no resources is a 200 with the empty state, when both terms
 *   exist: a filter combination with nothing in it is not a missing page.
 * - A resource the reader schema refuses is left off the page and the rest
 *   render (the data layer parses a list one item at a time and reports
 *   `ResourceListing.skipped`; see `lib/wp/fetch.ts`); the count and the
 *   pagination stay the CMS's, so pages never shift. A page whose resources all
 *   fail, on a list too short to throw, is the empty state with a 200, saying
 *   the resources on the page can't be shown rather than that there are none,
 *   since the count above it says there are. That 200 is stored for up to the
 *   ISR interval, so its copy makes no claim about when it will clear, and its
 *   metadata says `noindex`. A list of four or more on which more than half
 *   fail throws in the data layer and is a 500 instead
 *   (`LIST_FAILURE_MIN_ITEMS` in `lib/wp/fetch.ts`).
 *
 * The lead (`FeaturedLead`, `packages/ui/DESIGN.md`, "Components") is the
 * newest featured resource, large, above the list, on the first page of the
 * unfiltered library only, and only when one exists:
 *
 * - Featured is the `resource_flag` term `featured` (`packages/ui/README.md`);
 *   `leadCard` reads the first page of the flag's listing, tagged
 *   `resources` and `terms` like every flag read, so any resource event
 *   clears it, and takes the newest resource on it that has a URL. A CMS
 *   without the flag term, or with nothing flagged, has no lead and the list
 *   stands alone; no empty slot is ever reserved.
 * - A filtered listing has no lead: the reader has narrowed the library, so
 *   the page answers the filter with its list, and a lead that matched the
 *   filter would need a flag read per filter combination. Later pages have
 *   none: the lead is the library's front, not every page's.
 * - The lead is left out of the list under it when it falls on the same
 *   page, so a resource is linked once per page; the count line and the
 *   pagination stay the CMS's (`total`, `totalPages`), so page 1 can hold
 *   eleven rows under the lead and every later page is as the CMS paginates
 *   it. A lead whose own place is on a later page appears there as a row.
 *   No request is added per item: the lead is matched by ID.
 * - With a lead the list is headed "Latest" and the rows take `h3`; without
 *   one the rows sit under the `h1` as `h2`s. They are plain headings, not
 *   labelled regions: two regions inside `main` would add landmark stops
 *   that name nothing the heading outline does not. The empty state shows
 *   only on a page with no lead, so the page never says it is empty beside
 *   one.
 * - A failed lead read is not a failed page: the lead is decoration over the
 *   list, so a `CmsError` from the flag lookup or the flag's listing is
 *   logged once and the page renders without a lead, which ISR stores like
 *   any render until the next event or the interval. Any other error still
 *   throws, and a failure of the list itself is still the page's 500.
 *
 * The routes are ISR (ADR 0043: `export const revalidate = 3600`,
 * the data layer's interval as a literal, and a `generateStaticParams` that
 * names the library and each type's first page when the CMS answers at build
 * and nothing otherwise, so every other page renders on its first request).
 * Every read the page makes goes through `loadListing` in
 * `lib/listing-data.ts`, which the build-time probe in `lib/prerender.ts`
 * calls too, so a page the build prerenders is rendered from reads the probe
 * has already put in the Data Cache (that module is in `lib/`, not here,
 * because a route importing it must not inline this component's CSS). Every
 * fetch here is tagged by the data layer (the tags each event clears are in
 * `docs/architecture/caching.md`), so a revalidation event from the CMS
 * clears the page; nothing here reads `searchParams`, `headers()` or
 * `connection()`, which would make the route dynamic (ADR 0024 keeps filters
 * out of `searchParams`, and `connection()` with an empty
 * `generateStaticParams` measured as a 500 on every request; see
 * `docs/architecture/caching.md`).
 *
 * Term names are shown as plain text through `plainText`, since WordPress
 * stores `&` as `&amp;` in a term name.
 *
 * The head (the heading, the count and the filter bar) and the lead's section
 * are `components/ListingSections.tsx`, with the text rules they use, so the
 * contract's markup fixtures can render each from a sample: the CMS theme
 * renders both through the plugin's `collection-head` and `featured-lead`
 * blocks (`packages/ui/README.md`, "Markup fixtures").
 */

/** The segments of a listing route, as Next.js hands them to the page: `ListingRequest` in `lib/routes.ts`. */
export type { ListingRequest };

/**
 * True when the CMS counts resources on this page and none of them can be
 * shown: each failed the reader schema or has no URL. The page then shows
 * the "can't be shown" state, and its metadata says `noindex`.
 */
function noneShowable(listing: ResourceListing, cardCount: number): boolean {
  return listing.total > 0 && cardCount === 0;
}

/**
 * The metadata for the listing `request`: its title, its canonical URL, and
 * `noindex` when none of the page's resources can be shown. It calls the
 * same `loadListing` as the page, which within a render runs once for both
 * (`lib/listing-data.ts`), so the two make one set of reads and a lead that
 * fails is logged once; a `CmsError` from a read the page depends on throws
 * here as it does in the page, and the response is the same 500.
 */
export async function listingMetadata(request: ListingRequest): Promise<Metadata> {
  const valid = validListing(request);
  if (valid === null) {
    return NOT_FOUND_METADATA;
  }
  const data = await loadListing(valid);
  if (data === null) {
    return NOT_FOUND_METADATA;
  }
  const name = heading(data.terms);
  const cardCount = data.listing.items.map(toCard).filter((card) => card !== null).length;
  return {
    title: valid.page === 1 ? name : `${name}, page ${valid.page}`,
    // A path, which the root layout's `metadataBase` (from the server-only
    // `SITE_URL`) makes absolute; relative when `SITE_URL` is unset, as in
    // local work (see apps/web/README.md). The CMS's absolute URLs are never
    // used (ADR 0040).
    alternates: { canonical: listingPath(valid.filter, valid.page) },
    ...(noneShowable(data.listing, cardCount) ? { robots: { index: false } } : {}),
  };
}

export async function ListingPage({ request }: { request: ListingRequest }) {
  const valid = validListing(request);
  if (valid === null) {
    return <DataNotFound />;
  }
  const { filter, page } = valid;

  const data = await loadListing(valid);
  if (data === null) {
    return <DataNotFound />;
  }
  const { listing, terms, types, topics, lead } = data;

  const cards = listing.items.map(toCard).filter((card) => card !== null);
  const rows = lead === null ? cards : cards.filter((card) => card.id !== lead.id);
  const name = heading(terms);

  return (
    <>
      <ListingFocus targetId={HEADING_ID} />
      <CollectionHead name={name} total={listing.total} types={offered(types, filter.type)} topics={offered(topics, filter.topic)} current={filter} />
      {lead !== null && <FeaturedSection lead={lead} />}
      {lead === null && cards.length === 0 ? (
        <div className="rh-listing__empty">
          <p>
            {noneShowable(listing, cards.length)
              ? "The resources on this page can't be shown."
              : filter.type !== undefined && filter.topic !== undefined
                ? "No resources match this type and topic yet."
                : "No resources here yet."}
          </p>
          {(filter.type !== undefined || filter.topic !== undefined) && (
            <p>
              <Link href={listingPath()}>Show all resources</Link>
            </p>
          )}
        </div>
      ) : lead === null ? (
        // role="list" because Safari drops list semantics under `list-style: none`.
        <ul className="rh-card-grid" role="list">
          {rows.map((card) => (
            <li key={card.id}>
              <ResourceCard {...card} />
            </li>
          ))}
        </ul>
      ) : (
        rows.length > 0 && (
          <div className="rh-listing__latest">
            <h2 className="rh-listing__section">Latest</h2>
            <ul className="rh-card-grid" role="list">
              {rows.map((card) => (
                <li key={card.id}>
                  <ResourceCard {...card} headingLevel="h3" />
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      <Pagination filter={filter} current={page} total={listing.totalPages} />
    </>
  );
}
