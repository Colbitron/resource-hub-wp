import type { Metadata } from "next";
import { connection } from "next/server";

import { PageArticle, pageMetadata } from "@/components/PageArticle";
import { WelcomePage, welcomeMetadata } from "@/components/WelcomePage";
import { pageForRequest } from "@/lib/page-request";

/**
 * `/` and `/{segments}/`: the CMS's static front page at the root, every other
 * published WordPress page at its parent chain, and the welcome page when no
 * front page is set (root `CLAUDE.md`, "Pages"; ADR 0051). An optional
 * catch-all at the root, so every path no other route claims comes here:
 * `pageForRequest` returns the page to render, sends a computed single-hop
 * 308 to its canonical path, or answers a 404, with the same rules as the
 * resource page (`lib/page-request.ts`). Static and dynamic siblings win over
 * the catch-all, so `/resources/…` and `/api/revalidate/` never arrive, and
 * the `/media/` rewrite runs before dynamic routes; a first segment the front
 * end's routes own is a 404 here without a request.
 *
 * The route renders on every request, by design and for the same measured
 * reasons as the resource route (ADR 0035's 2026-11-05 amendment):
 * `force-dynamic`, no `generateStaticParams`, no `loading.tsx`, and
 * `connection()` first, so a `permanentRedirect()` goes out as a 308 with
 * `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and
 * is never stored, and so the build never renders `/` from the CMS, which a
 * route with no dynamic segment otherwise would (ADR 0050). The data layer's
 * tagged fetches keep the Data Cache behind the dynamic render, and its
 * per-render memoization means the page and its metadata make one set of
 * requests between them.
 *
 * A `CmsError` from the data layer is a 500; `error.tsx` beside this file is
 * the segment's error boundary, as for the resource route.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[[...path]]">): Promise<Metadata> {
  await connection();
  const { path } = await params;
  const rendered = await pageForRequest(path ?? []);
  return rendered.kind === "welcome" ? welcomeMetadata : pageMetadata(rendered);
}

export default async function CmsPage({ params }: PageProps<"/[[...path]]">) {
  await connection();
  const { path } = await params;
  const rendered = await pageForRequest(path ?? []);
  return rendered.kind === "welcome" ? <WelcomePage /> : <PageArticle rendered={rendered} />;
}
