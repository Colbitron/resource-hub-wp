import type { Metadata } from "next";

import { DataNotFound, NOT_FOUND_METADATA } from "@/components/DataNotFound";
import { ListingPage, listingMetadata } from "@/components/ListingPage";
import { libraryParams } from "@/lib/prerender";

/**
 * `/resources/`: the library, every published resource, newest first.
 *
 * An optional catch-all rather than a plain `app/resources/page.tsx` because a
 * route with no dynamic segment is prerendered at build whatever happens, and
 * that render needs the CMS; a dynamic segment lets `generateStaticParams`
 * decide: the library is prerendered when the CMS answers at build
 * (`libraryParams` in `lib/prerender.ts`) and rendered on its first request
 * when it does not, so a build never fails for a CMS reason, and stored by
 * ISR from then on either way (ADR 0043; see
 * `docs/architecture/caching.md`). Static and dynamic siblings win over a
 * catch-all, so this page serves `/resources/` only: `rest` is empty there,
 * and any path that fell through to it is a 404. Such a shape is known from
 * the path alone, so `proxy.ts` answers it first with the not-found page's
 * HTML (`lib/path-decision.ts`, issue #46); the `DataNotFound` here, which
 * has the same page in its HTML, is the second line.
 *
 * The catch-all's one cost is on the client, and `next.config.ts` pays it:
 * with the router's route prediction on, once it has learned this route's
 * tree it predicts every row and type link under `/resources/` as a path of
 * this catch-all, the only dynamic child it knows here, and prefetches the
 * wrong segment, which the server answers 404 (measured on Next.js 16.4.5,
 * a race it won or lost from one load to the next; `docs/architecture/caching.md`,
 * "Prefetching"). `experimental.optimisticRouting` is off for that reason,
 * so every link asks the server for its own tree; `e2e/prefetch.spec.ts`
 * fails on a request under this route's segment key.
 */

// The data layer's interval, as a literal: Next.js reads segment config statically.
export const revalidate = 3600;

/**
 * The library's one path, `/resources/` (`rest: []`), prerendered when the
 * CMS answers at build, or `[]` when it does not (ADR 0043; `lib/prerender.ts`).
 */
export function generateStaticParams(): Promise<{ rest: string[] }[]> {
  return libraryParams();
}

export async function generateMetadata({ params }: PageProps<"/resources/[[...rest]]">): Promise<Metadata> {
  const { rest } = await params;
  return rest !== undefined && rest.length > 0 ? NOT_FOUND_METADATA : listingMetadata({});
}

export default async function LibraryPage({ params }: PageProps<"/resources/[[...rest]]">) {
  const { rest } = await params;
  if (rest !== undefined && rest.length > 0) {
    return <DataNotFound />;
  }
  return <ListingPage request={{}} />;
}
