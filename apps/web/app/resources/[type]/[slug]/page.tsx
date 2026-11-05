import type { Metadata } from "next";
import { connection } from "next/server";

import { ResourceArticle, resourceMetadata } from "@/components/ResourceArticle";
import { resourceForRequest } from "@/lib/redirects";

/**
 * `/resources/[type]/[slug]/`: a single resource (root `CLAUDE.md`, "Public
 * URLs"; ADRs 0025, 0035 and 0049). The slug is the identity and the type
 * segment is checked: `resourceForRequest` returns the resource to render,
 * or sends a computed single-hop 308 to the canonical URL, or a 404.
 *
 * The route renders on every request, by design (ADR 0035's 2026-11-05
 * amendment, measured): `force-dynamic`, no `generateStaticParams`, no
 * `loading.tsx`, and `connection()` first. In a dynamic render Next.js sends
 * `permanentRedirect()` as a 308 with `Cache-Control: private, no-cache,
 * no-store, max-age=0, must-revalidate` and stores nothing, so a type
 * changed and changed back is answered afresh each time; from an ISR route
 * the same call would be prerendered and stored with `s-maxage`, and a
 * dynamic bail-out on the redirect branch alone is a runtime 500.
 * `force-dynamic` keeps the route dynamic even if a `generateStaticParams`
 * is ever added; `connection()` says so at the point of use. The decision
 * runs before anything is rendered and outside any Suspense boundary, in
 * the page and in `generateMetadata` alike, so the 308 reaches the wire as a
 * status and not as a meta refresh. The data layer's `cache: "force-cache"`
 * fetches keep the Data Cache behind the dynamic render (30 renders, one CMS
 * request), and its per-render memoization means the page and its metadata
 * make one request between them, not two. The static siblings `topic/` and
 * `page/` win over `[type]`, so `/resources/topic/x/` and
 * `/resources/page/2/` never arrive here (ADR 0050).
 *
 * A `CmsError` from the data layer is a 500. `error.tsx` beside this file
 * is the segment's error boundary: measured on 16.4.5, the response keeps
 * the 500 status and the `no-store` header, and the 308 and the 404 never
 * reach the boundary, so what it changes is only what a reader sees (the
 * shell and a plain sentence instead of Next.js's bare error page). A
 * redirect or `notFound()` thrown from `generateMetadata` alone is not
 * enough: with streaming metadata a browser gets a 200 with a meta refresh
 * (an HTML-limited bot a 308), so the page's own call is what sends the
 * status, and `generateMetadata` calls it too only to share the decision
 * and its memoised fetches.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/resources/[type]/[slug]">): Promise<Metadata> {
  await connection();
  const { type, slug } = await params;
  return resourceMetadata(await resourceForRequest(type, slug));
}

export default async function SingleResourcePage({ params }: PageProps<"/resources/[type]/[slug]">) {
  await connection();
  const { type, slug } = await params;
  const rendered = await resourceForRequest(type, slug);
  return <ResourceArticle rendered={rendered} />;
}
