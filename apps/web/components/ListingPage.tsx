import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FilterNav, type FilterTerm } from "@/components/FilterNav";
import { ListingFocus } from "@/components/ListingFocus";
import { Pagination } from "@/components/Pagination";
import { ResourceCard } from "@/components/ResourceCard";
import { isSlug, isTypeSlug, listingPath, parsePageSegment, type ListingFilter } from "@/lib/routes";
import { plainText, toCard } from "@/lib/wp/cards";
import { NO_SUCH_PAGE } from "@/lib/wp/fetch";
import { listResources, type ResourceListing } from "@/lib/wp/resources";
import { getTermBySlug, listTerms } from "@/lib/wp/terms";
import type { WpTerm } from "@/lib/wp/schemas/rest";

import "./listing.css";

/**
 * The one listing behind the eight listing routes under `app/resources/`
 * (root `CLAUDE.md`, "Public URLs"; ADRs 0024, 0034): the library, a type, a
 * topic, a type within a topic, and page `n` of each. A route file parses
 * its segments and hands them here as a `ListingRequest`; this module
 * validates them, reads the data layer and renders the page, and
 * `listingMetadata` gives the route its `generateMetadata`.
 *
 * What a request gets:
 *
 * - A type segment that cannot be a type slug (`topic`, `page`, or not a
 *   slug), a topic segment that cannot be a slug, or a page segment that is
 *   not a canonical page number 2 or more (`0`, `01`, `1.5`, `x`, and `1`,
 *   whose URL is the listing's own) is `notFound()` before any request.
 *   Mixed case and `/page/1/` never reach a route: `proxy.ts` has already
 *   redirected them to the canonical path.
 * - A type or topic that names no term, or a page past the last, is
 *   `notFound()`: the data layer answers `null` or `NO_SUCH_PAGE`.
 * - A page with no resources is a 200 with the empty state, when both terms
 *   exist: a filter combination with nothing in it is not a missing page.
 * - A resource the reader schema refuses is left off the page and the rest
 *   render (ADR 0049's per-item parsing, `ResourceListing.skipped`); the
 *   count and the pagination stay the CMS's, so pages never shift. A page
 *   whose resources all fail, on a list too short to throw, is the empty
 *   state with a 200, saying the resources on the page can't be shown
 *   rather than that there are none, since the count above it says there
 *   are. That 200 is stored for up to the ISR interval, so its copy makes no
 *   claim about when it will clear, and its metadata says `noindex`. A list
 *   of four or more on which more than half fail throws in the data layer
 *   and is a 500 instead (ADR 0049's threshold).
 *
 * The routes are ISR (`export const revalidate = 3600`, the data layer's
 * interval as a literal, ADR 0049, and `generateStaticParams` returning `[]`,
 * so the build asks the CMS for nothing and each page renders on its first
 * request). Every fetch here is tagged by the data layer per ADR 0046, so a
 * revalidation event from the CMS clears the page; nothing here reads
 * `searchParams`, `headers()` or `connection()`, which would make the route
 * dynamic (ADR 0034, and ADR 0035's measurement of `connection()` with an
 * empty `generateStaticParams`: a 500 on every request).
 *
 * Term names are shown as plain text through `plainText`, since WordPress
 * stores `&` as `&amp;` in a term name.
 */

/** The segments of a listing route, as Next.js hands them to the page. */
export interface ListingRequest {
  readonly type?: string;
  readonly topic?: string;
  /** The `[n]` of `…/page/[n]/`, or none for the first page. */
  readonly pageSegment?: string;
}

interface ValidListing {
  readonly filter: ListingFilter;
  readonly page: number;
}

/** The validated filter and page, or `null` when any segment can only be a 404. */
function validate(request: ListingRequest): ValidListing | null {
  if (request.type !== undefined && !isTypeSlug(request.type)) {
    return null;
  }
  if (request.topic !== undefined && !isSlug(request.topic)) {
    return null;
  }
  let page = 1;
  if (request.pageSegment !== undefined) {
    const parsed = parsePageSegment(request.pageSegment);
    if (parsed === null) {
      return null;
    }
    page = parsed;
  }
  const filter: ListingFilter = {
    ...(request.type === undefined ? {} : { type: request.type }),
    ...(request.topic === undefined ? {} : { topic: request.topic }),
  };
  return { filter, page };
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

/**
 * The listing's name, from the terms it is filtered by: "Resources", "Webinar
 * resources", "Resources on Accessibility", "Webinar resources on
 * Accessibility". Term names are used as the editor wrote them, never
 * pluralised.
 */
function heading(terms: { type?: WpTerm; topic?: WpTerm }): string {
  const head = terms.type === undefined ? "Resources" : `${plainText(terms.type.name)} resources`;
  return terms.topic === undefined ? head : `${head} on ${plainText(terms.topic.name)}`;
}

function countLine(total: number): string {
  return total === 1 ? "1 resource" : `${total} resources`;
}

/**
 * The terms the filter bar offers: every term with a published resource, in
 * name order, plus the current term even when its count is zero, so the bar
 * always shows what the page is filtered by. A term that can only lead to an
 * empty page is not offered.
 */
function offered(terms: WpTerm[], current: string | undefined): FilterTerm[] {
  return terms
    .filter((term) => term.count > 0 || term.slug === current)
    .map((term) => ({ slug: term.slug, name: plainText(term.name) }));
}

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
 * `noindex` when none of the page's resources can be shown. It reads the
 * same tagged fetches as the page, which the per-render memoization and the
 * Data Cache answer once.
 */
export async function listingMetadata(request: ListingRequest): Promise<Metadata> {
  const valid = validate(request);
  if (valid === null) {
    notFound();
  }
  const [terms, listing] = await Promise.all([
    filterTerms(valid.filter),
    listResources({ ...valid.filter, page: valid.page }),
  ]);
  if (terms === null || listing === null || listing === NO_SUCH_PAGE) {
    notFound();
  }
  const name = heading(terms);
  const cardCount = listing.items.map(toCard).filter((card) => card !== null).length;
  return {
    title: valid.page === 1 ? name : `${name}, page ${valid.page}`,
    // A path. No `metadataBase` is set yet, so it renders relative: Next.js's
    // fallback to the Vercel deployment's URL covers social images, not
    // alternates. Setting `metadataBase` from a server-only `SITE_URL` is a
    // slice 3 follow-up (ADR 0050). The CMS's absolute URLs are never used
    // (ADR 0040).
    alternates: { canonical: listingPath(valid.filter, valid.page) },
    ...(noneShowable(listing, cardCount) ? { robots: { index: false } } : {}),
  };
}

/** The `<h1>`'s ID, which `ListingFocus` moves focus to after a client navigation. */
const HEADING_ID = "rh-listing-heading";

/** Cards in the first row at the widest layout, which is where the LCP image usually is. */
const FIRST_ROW = 3;

export async function ListingPage({ request }: { request: ListingRequest }) {
  const valid = validate(request);
  if (valid === null) {
    notFound();
  }
  const { filter, page } = valid;

  const [listing, terms, types, topics] = await Promise.all([
    listResources({ ...filter, page }),
    filterTerms(filter),
    listTerms("resource_type"),
    listTerms("resource_topic"),
  ]);
  if (listing === null || listing === NO_SUCH_PAGE || terms === null) {
    notFound();
  }

  const cards = listing.items.map(toCard).filter((card) => card !== null);
  const name = heading(terms);

  return (
    <>
      <ListingFocus targetId={HEADING_ID} />
      <header className="rh-listing__header">
        <h1 id={HEADING_ID} tabIndex={-1}>
          {name}
        </h1>
        {listing.total > 0 && <p className="rh-listing__count">{countLine(listing.total)}</p>}
      </header>
      <FilterNav types={offered(types, filter.type)} topics={offered(topics, filter.topic)} current={filter} />
      {cards.length === 0 ? (
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
      ) : (
        // role="list" because Safari drops list semantics under `list-style: none`.
        <ul className="rh-card-grid" role="list">
          {cards.map((card, index) => (
            <li key={card.href}>
              <ResourceCard {...card} priority={index < FIRST_ROW} />
            </li>
          ))}
        </ul>
      )}
      <Pagination filter={filter} current={page} total={listing.totalPages} />
    </>
  );
}
