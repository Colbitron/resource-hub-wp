import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { NotFoundContent } from "./NotFoundContent";

/**
 * A 404 that a route decides from data (an unknown slug, an unknown term, a
 * page past the end, a path no page has), with the not-found page in the
 * server HTML (issue #46). The resource page, the listings and the page
 * catch-all return `<DataNotFound />` in place of calling `notFound()`
 * themselves.
 *
 * Why: Next.js renders `app/not-found.tsx` through a client error boundary,
 * and React's server renderer runs no error boundaries; the only thing that
 * catches an error on the server is the nearest Suspense boundary. A
 * `notFound()` thrown with no Suspense boundary around it aborts the shell,
 * and Next.js 16.4.5 then sends its empty `<html id="__next_error__">`
 * document with the page only in the RSC payload (vercel/next.js#62228).
 *
 * How: the `notFound()` here is thrown inside a Suspense boundary whose
 * fallback is the not-found page's own content. The server renderer stops at
 * that boundary and writes the fallback into the HTML; Next.js's HTML error
 * handler sees the `notFound()` and sets the response's status to 404 and
 * adds `<meta name="robots" content="noindex">`. That works because the
 * routes are ISR: Next.js renders an ISR page completely before it answers
 * or stores it, so the status is set before anything is sent, and the stored
 * entry keeps the 404 and the HTML (measured on Next.js 16.4.5 under `next
 * start` and on a remote-built Vercel preview, the first request and the
 * cached one, for browsers and for crawlers). In the browser, React renders
 * the boundary again, the `notFound()` reaches the root's not-found boundary,
 * and `app/not-found.tsx` takes the place of the same content, with one
 * `<h1>` throughout and no error on the page or in the console beyond the
 * browser's own note of the 404 (measured in Chromium, 2026-11-06). A
 * client-side navigation to such a URL gets a 404 for its RSC request, which
 * the router answers with a full document load (it does that for any non-ok
 * RSC response), and that load gets the same 404 HTML, with no error.
 *
 * The rules that keep the statuses right:
 *
 * - The route decides first, outside any Suspense boundary, and throws a
 *   redirect there, as before, so a 308 is still a 308 with its `Location`
 *   and nobody reads its body; only a not-found decision reaches this
 *   component.
 * - `generateMetadata` never throws `notFound()`: for a crawler Next.js
 *   renders metadata in the `<head>`, outside every boundary, and a throw
 *   there aborts the shell as before. It returns `NOT_FOUND_METADATA`.
 * - The route stays ISR (no `connection()`, no request-time API): a dynamic
 *   render streams the shell before the boundary fails, and its status would
 *   already be sent as a 200. The unit pins that a route "calls nothing
 *   dynamic" read only the route files; a `connection()` or `headers()` in a
 *   layout or an imported component is caught only by the e2e suite (one in
 *   `app/resources/layout.tsx` turned every `/resources/**` request into a
 *   500, measured).
 */
export function DataNotFound() {
  return (
    <Suspense fallback={<NotFoundContent />}>
      <RaiseNotFound />
    </Suspense>
  );
}

/** The metadata of a data-decided 404: the not-found page's title. Next.js adds `noindex` itself. */
export const NOT_FOUND_METADATA: Metadata = { title: "Page not found" };

function RaiseNotFound(): never {
  notFound();
}
