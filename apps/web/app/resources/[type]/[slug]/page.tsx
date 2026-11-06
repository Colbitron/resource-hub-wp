import type { Metadata } from "next";

import { ResourceArticle, resourceMetadata } from "@/components/ResourceArticle";
import { resourceForRequest } from "@/lib/redirects";

/**
 * `/resources/[type]/[slug]/`: a single resource (ADRs 0024 and 0025; the URL
 * shape is in `packages/ui/README.md`). The slug is the identity and the type
 * segment is checked: `resourceForRequest` returns the resource to render, or
 * sends a computed single-hop 308 to the canonical URL, or a 404.
 *
 * The route is ISR, like the listings (ADR 0043; see
 * `docs/architecture/caching.md`): `revalidate = 3600`, the data layer's
 * interval as a literal, and a `generateStaticParams` returning `[]`, so the
 * build never asks the CMS and each URL is rendered on its first request,
 * stored, and served from the route cache until an event or the interval clears
 * it. The stored entry is whatever the decision produced: a 200, a 308 or a
 * 404, each under the tags of the fetches that decided it (`resource:{slug}`
 * and `terms` from the slug lookup, `resources` from resolve on a miss), so the
 * revalidation event for any change to the resource (ADR 0043's union of the
 * current and previous state, by tag and by path) clears a stored redirect at
 * its old URL and a stored 404 at its new one. A stored 308 leaves Next.js with
 * `s-maxage` only, which a browser would keep for ever (ADR 0025); the
 * `headers()` rule in `next.config.ts` for this route is what makes every
 * response of it, the 308 included, `max-age=0, must-revalidate` on the wire,
 * so a browser asks again each time.
 *
 * What the route must not do (ADR 0025; measured on 16.4.5, see
 * `docs/architecture/caching.md`): call `connection()`, read `headers()` or
 * `cookies()`, or fetch with `cache: "no-store"`, since a dynamic bail-out in
 * an ISR route with no prerendered params is a runtime 500; have a
 * `loading.tsx` or put the decision under a Suspense boundary, since once
 * streaming has begun a redirect is a 200 with a meta refresh. The decision
 * runs first, in the page and in `generateMetadata` alike; the per-render
 * memoization in `lib/wp/fetch.ts` means the two calls cost one CMS request.
 * The static siblings `topic/` and `page/` win over `[type]`, so
 * `/resources/topic/x/` and `/resources/page/2/` never arrive here.
 *
 * A `CmsError` from the data layer is a 500, which ISR never stores.
 * `error.tsx` beside this file is the segment's error boundary: the response
 * keeps the 500 status, and the 308 and the 404 never reach the boundary, so
 * what it changes is only what a hydrated reader sees. A redirect or
 * `notFound()` thrown from `generateMetadata` alone is not enough: with
 * streaming metadata a browser gets a 200 with a meta refresh, so the page's
 * own call is what sends the status, and `generateMetadata` calls it too
 * only to share the decision and its memoised fetches.
 */

// The data layer's interval, as a literal: Next.js reads segment config statically.
export const revalidate = 3600;

export function generateStaticParams(): { type: string; slug: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/resources/[type]/[slug]">): Promise<Metadata> {
  const { type, slug } = await params;
  return resourceMetadata(await resourceForRequest(type, slug));
}

export default async function SingleResourcePage({ params }: PageProps<"/resources/[type]/[slug]">) {
  const { type, slug } = await params;
  const rendered = await resourceForRequest(type, slug);
  return <ResourceArticle rendered={rendered} />;
}
