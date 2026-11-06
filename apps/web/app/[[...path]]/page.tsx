import type { Metadata } from "next";

import { DataNotFound, NOT_FOUND_METADATA } from "@/components/DataNotFound";
import { PageArticle, pageMetadata } from "@/components/PageArticle";
import { WelcomePage, welcomeMetadata } from "@/components/WelcomePage";
import { pageForRequest } from "@/lib/page-request";

/**
 * `/` and `/{segments}/`: the CMS's static front page at the root, every other
 * published WordPress page at its parent chain, and the welcome page when no
 * front page is set (root `CLAUDE.md`, "Pages"; ADR 0052). An optional
 * catch-all at the root, so every path no other route claims comes here:
 * `pageForRequest` returns the page to render or the not-found decision, or
 * sends a computed single-hop 308 to its canonical path itself, with the
 * same rules as the resource page (`lib/page-request.ts`). Static and dynamic siblings win over
 * the catch-all, so `/resources/…` and `/api/revalidate/` never arrive, and
 * the `/media/` rewrite runs before dynamic routes; a first segment the front
 * end's routes own is a 404 here without a request.
 *
 * The route is ISR, like the resource page and the listings (ADR 0052's
 * 2026-11-06 amendment; ADRs 0035 and 0050): `revalidate = 3600`, the data
 * layer's interval as a literal, and a `generateStaticParams` returning
 * `[]`, so the build renders nothing from the CMS, `/` included (an optional
 * catch-all with an empty `generateStaticParams` is what keeps a root path
 * out of the build, as `/resources/` is kept out, ADR 0050), and each path
 * is rendered on its first request, stored, and served from the route cache
 * until a page event or the interval clears it. Every entry, a 200, the
 * welcome page, a 308 or a 404, is stored under the `pages` tag its lookups
 * carry, and a page event clears that tag and the paths it names, so the
 * front page swaps in at `/` on the event for it, a stored redirect at
 * `/home/` or at a moved page's old path is cleared by the event that moves
 * it back, and a stored 404 at a path is cleared by the publish that fills
 * it. The `headers()` rule in `next.config.ts` for every path outside the
 * front end's own first segments puts `max-age=0, must-revalidate` on each
 * response, so a browser never keeps a stored 308 (ADR 0025).
 *
 * What the route must not do (measured on 16.4.5, ADR 0035): call
 * `connection()`, read `headers()` or `cookies()`, or fetch with
 * `cache: "no-store"`, since a dynamic bail-out in an ISR route with no
 * prerendered params is a runtime 500; have a `loading.tsx` or put the
 * decision under a Suspense boundary. The decision runs first, before
 * anything renders, so a redirect is thrown outside every boundary, and a
 * not-found decision renders `DataNotFound`, whose boundary puts the
 * not-found page in the 404's HTML (issue #46); the resource route's
 * comment has the measurements. It runs in the page and in
 * `generateMetadata` alike, and the per-render memoization in
 * `lib/wp/fetch.ts` means the two make one set of requests between them;
 * `generateMetadata` returns `NOT_FOUND_METADATA` on a not-found decision
 * and never throws `notFound()`, for the reason given there.
 *
 * A `CmsError` from the data layer is a 500, which ISR never stores;
 * `error.tsx` beside this file is the segment's error boundary, as for the
 * resource route.
 */

// The data layer's interval, as a literal: Next.js reads segment config statically (ADR 0049).
export const revalidate = 3600;

export function generateStaticParams(): { path: string[] }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/[[...path]]">): Promise<Metadata> {
  const { path } = await params;
  const decision = await pageForRequest(path ?? []);
  if (decision.kind === "not-found") {
    return NOT_FOUND_METADATA;
  }
  return decision.kind === "welcome" ? welcomeMetadata : pageMetadata(decision);
}

export default async function CmsPage({ params }: PageProps<"/[[...path]]">) {
  const { path } = await params;
  const decision = await pageForRequest(path ?? []);
  if (decision.kind === "not-found") {
    return <DataNotFound />;
  }
  return decision.kind === "welcome" ? <WelcomePage /> : <PageArticle rendered={decision} />;
}
