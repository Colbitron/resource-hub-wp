import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageCard } from "@/components/PageCard";
import { SearchForm } from "@/components/SearchForm";
import { Pagination } from "@/components/Pagination";
import { ResourceCard } from "@/components/ResourceCard";
import { cmsUrls } from "@/lib/env";
import { listingPath, searchPath } from "@/lib/routes";
import type { SearchRequest } from "@/lib/search-request";
import { toCard, toPageCard } from "@/lib/wp/cards";
import { MAX_SEARCH_PAGE, SEARCH_PER_PAGE } from "@/lib/wp/schemas/search";
import { MAX_SEARCH_QUERY_LENGTH, MIN_SEARCH_QUERY_LENGTH, searchSite, type SearchHit, type SearchResults } from "@/lib/wp/search";

import "@colbitron/resource-hub-ui/listing.css";

/**
 * The search page, `/search/?q=…&page=n` (issue #115; the reads are
 * `searchSite` in `lib/wp/search.ts` and the contract is
 * `packages/ui/README.md`, "Search"). The route hands it a `SearchRequest`
 * parsed from the query string alone (`lib/search-request.ts`), and it
 * renders the form and one state:
 *
 * - No query: the form alone.
 * - A query too short or too long: a sentence under the form, tied to the
 *   input by `aria-describedby`, and no request.
 * - Results: the count, the rows in the route's order, resources as the
 *   listing's row (`ResourceCard`) and pages as the same row with the label
 *   "Page" (`PageCard`), and the pagination up to the route's 10 pages, each
 *   link keeping the query. Past the 120th match a sentence says only the
 *   first 120 are listed.
 * - No results, or none on this page (a page past the last, or a `page` the
 *   route would refuse, which is never asked for): a sentence and a way on.
 * - A CMS with no search route (`searchSite` answers `null`): a sentence that
 *   search is not available, and a link to the library. Never an error page.
 *
 * Every state is a 200: the page never redirects, never answers a 404 and
 * never renders `DataNotFound`, whose 404 status holds only on an ISR route
 * (`components/DataNotFound.tsx`); this is the one dynamic route (ADR 0043,
 * amended). A `CmsError` from the reads is not caught: it reaches
 * `app/search/error.tsx`, as on every other route. Every read is the data
 * layer's `force-cache` fetch with `searchTags()`, so a repeated query is
 * answered from the Data Cache and a revalidation event clears it, though
 * the page itself is rendered on every request.
 *
 * The form is a plain GET form to `/search/`, so it works without
 * JavaScript and a submission is a full document load. The rows' links are
 * `<Link>`s to ISR pages, which prefetch as everywhere else; the
 * pagination's are plain links (`Pagination`'s docblock has why).
 */

/** The state message's ID, which the form's field names with `aria-describedby`. */
const MESSAGE_ID = "rh-search-message";

/** The most matches the route lists: 10 pages of 12. */
const MAX_LISTED = MAX_SEARCH_PAGE * SEARCH_PER_PAGE;

/** `“query”`, as the page and its title quote it. */
function quoted(query: string): string {
  return `“${query}”`;
}

function countLine(total: number, query: string): string {
  return `${total === 1 ? "1 result" : `${total} results`} for ${quoted(query)}`;
}

/**
 * The page's metadata, from the request alone, so it makes no request:
 * `noindex` in every state (issue #115: a page of results is not a page to
 * index, and an indexed one would invite junk queries), and a title that
 * names the query once there is one to search for.
 */
export function searchMetadata(request: SearchRequest): Metadata {
  const robots = { index: false };
  if (request.kind !== "search" && request.kind !== "no-such-page") {
    return { title: "Search", robots };
  }
  const title = `Results for ${quoted(request.query)}`;
  return { title: request.kind === "search" && request.page > 1 ? `${title}, page ${request.page}` : title, robots };
}

/** A state's sentences under the form, the first one the input's description. */
function Message({ children }: { children: ReactNode }) {
  return <div className="rh-listing__empty">{children}</div>;
}

/** A hit as the row it renders, or `null` when it has no URL on the front end (`toCard`, `toPageCard`). */
function rowFor(hit: SearchHit, cmsOrigins: readonly string[]): { key: string; row: ReactNode } | null {
  if (hit.type === "resource") {
    const card = toCard(hit.resource);
    return card === null ? null : { key: `resource-${card.id}`, row: <ResourceCard {...card} /> };
  }
  const card = toPageCard(hit.page, cmsOrigins);
  return card === null ? null : { key: `page-${card.id}`, row: <PageCard {...card} /> };
}

function Results({ query, page, results }: { query: string; page: number; results: SearchResults | null }) {
  if (results === null) {
    return (
      <Message>
        <p id={MESSAGE_ID}>Search isn&rsquo;t available right now.</p>
        <p>
          <Link href={listingPath()}>Browse all resources</Link>
        </p>
      </Message>
    );
  }
  const { cmsOrigins } = cmsUrls();
  const rows = results.items.map((hit) => rowFor(hit, cmsOrigins)).filter((row) => row !== null);
  if (results.total === 0) {
    return (
      <Message>
        <p id={MESSAGE_ID}>No results for {quoted(query)}.</p>
        <p>
          Try other words, or <Link href={listingPath()}>browse all resources</Link>.
        </p>
      </Message>
    );
  }
  return (
    <>
      <p className="rh-search__summary" id={MESSAGE_ID}>
        {countLine(results.total, query)}
        {results.total > MAX_LISTED && <>. The first {MAX_LISTED} are listed; add words to narrow the search.</>}
      </p>
      {rows.length === 0 ? (
        <Message>
          <p>{results.items.length === 0 ? `There are no results on page ${page}.` : "The results on this page can’t be shown."}</p>
          {page > 1 && (
            <p>
              <a href={searchPath(query)}>Go to the first page of results</a>
            </p>
          )}
        </Message>
      ) : (
        // role="list" because Safari drops list semantics under `list-style: none`.
        <ul className="rh-card-grid" role="list">
          {rows.map(({ key, row }) => (
            <li key={key}>{row}</li>
          ))}
        </ul>
      )}
      {/* A page past the last has no place in the pages' list; its sentence links to the first. */}
      {page <= results.pages && <Pagination search={query} current={page} total={results.pages} />}
    </>
  );
}

/**
 * The page for `request`. Its one read, `searchSite`, runs here, before
 * anything renders, so the tree under it is synchronous and a `CmsError`
 * leaves the page before a byte is sent.
 */
export async function SearchPage({ request }: { request: SearchRequest }) {
  const results = request.kind === "search" ? await searchSite(request.query, request.page) : null;
  return (
    <>
      <header className="rh-listing__header">
        <h1>Search</h1>
      </header>
      <SearchForm input={request.input} describedBy={request.kind === "none" ? undefined : MESSAGE_ID} />
      {request.kind === "too-short" && (
        <Message>
          <p id={MESSAGE_ID}>Enter at least {MIN_SEARCH_QUERY_LENGTH} characters to search.</p>
        </Message>
      )}
      {request.kind === "too-long" && (
        <Message>
          <p id={MESSAGE_ID}>Enter at most {MAX_SEARCH_QUERY_LENGTH} characters to search.</p>
        </Message>
      )}
      {request.kind === "no-such-page" && (
        <Message>
          <p id={MESSAGE_ID}>There are no results on this page.</p>
          <p>
            <a href={searchPath(request.query)}>Go to the first page of results</a>
          </p>
        </Message>
      )}
      {request.kind === "search" && <Results query={request.query} page={request.page} results={results} />}
    </>
  );
}
