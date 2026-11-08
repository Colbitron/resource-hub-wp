"use client";

import "@/components/unavailable.css";

/**
 * The resource route's error boundary: what a reader sees when the data layer
 * throws (a `CmsError`: the CMS down, slow, answering wrongly, or a resource
 * that fails the reader schema). Measured on Next.js 16.4.5 under `next start`:
 * the response is a 500 with Next.js's `no-store` header, which ISR never
 * stores (`docs/architecture/caching.md` has the 500's headers), so nothing
 * caches or indexes it and the next request renders again; and a
 * `permanentRedirect()` thrown by the page, or the `notFound()` its
 * `DataNotFound` throws, never reaches this boundary, so the 308 and the 404
 * are untouched. The 500's body is Next.js's empty `__next_error__` document,
 * not the site's shell: this fallback, inside the root layout, renders only
 * after hydration, so a reader without JavaScript gets an empty page. What the
 * boundary changes is what a hydrated reader sees: a plain sentence and a way
 * to try again, in place of Next.js's bare "Application error" page.
 *
 * It takes no `error` prop on purpose: in production the message is a generic
 * one with a digest, and the `CmsError` message is scrubbed of the CMS host
 * anyway (`CmsError` in `lib/wp/fetch.ts`), but a page that never reads it
 * cannot show a CMS detail by mistake. The server log has the error.
 */
export default function ResourceError({ retry }: { retry: () => void }) {
  return (
    <div className="rh-unavailable">
      <h1>This resource can&rsquo;t be shown right now</h1>
      <p>Something went wrong while loading it. You can try again, or come back later.</p>
      <p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </p>
    </div>
  );
}
