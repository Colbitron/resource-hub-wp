import type { Metadata } from "next";

import { SearchPage, searchMetadata } from "@/components/SearchPage";
import { parseSearchRequest } from "@/lib/search-request";

/**
 * `/search/?q=…&page=n`, the search page (issue #115): the site's one
 * dynamic route, the named exception to "every route is ISR" (ADR 0043,
 * amended; `.claude/rules/caching-and-redirects.md`). It reads
 * `searchParams`, a request-time API that makes the page render on every
 * request, because a search is the visitor's own words and no set of
 * queries could be prerendered. What it keeps from the caching model: every
 * CMS read is still the data layer's `force-cache` fetch, tagged
 * `searchTags()`, so a repeated query is expected to be answered from the
 * Data Cache until a revalidation event clears it (measured under `next
 * start`, not yet on Vercel); the cost is one function run per request,
 * bounded at the edge by the "Rate limit search" WAF rule
 * (`docs/architecture/caching.md`).
 *
 * What it must not do, held by `test/route-segments.test.ts`: export
 * `revalidate`, `dynamic` or a `generateStaticParams` (the first two would
 * say something the route does not do, and it has no dynamic segment to
 * list); read anything request-time beyond `searchParams`; have a
 * `loading.tsx` or a Suspense boundary, which would send a 200 before an
 * error could make it a 500; or answer a redirect or a 404. Every state is a
 * 200 rendered by `SearchPage`, never `DataNotFound`, whose 404 status holds
 * only on an ISR route. `/search/{anything}/` is not this route: the proxy
 * answers it with a 404 from the path alone (`lib/path-decision.ts`).
 *
 * The request is parsed from the query string alone (`parseSearchRequest`
 * in `lib/search-request.ts`), in the page and in `generateMetadata`; the
 * two read the CMS through the same memoised fetches, so one set of
 * requests serves both (`searchMetadata` has the title rules).
 */

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  return searchMetadata(parseSearchRequest(await searchParams));
}

export default async function Search({ searchParams }: PageProps<"/search">) {
  return <SearchPage request={parseSearchRequest(await searchParams)} />;
}
