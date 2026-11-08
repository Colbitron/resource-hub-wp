"use client";

import "@/components/unavailable.css";

/**
 * The page route's error boundary: what a reader sees when the data layer
 * throws (a `CmsError`: the CMS down, slow, answering wrongly, or a page that
 * fails the reader schema). As measured for the resource route on Next.js
 * 16.4.5: the response is a 500 with Next.js's `no-store` header, which ISR
 * never stores (`docs/architecture/caching.md` has the 500's headers), a
 * `permanentRedirect()` thrown by the page, or the `notFound()` its
 * `DataNotFound` throws, never reaches this boundary, and the fallback renders
 * only after hydration, so what it changes is what a hydrated reader sees in
 * place of Next.js's bare "Application error" page.
 *
 * It takes no `error` prop on purpose, so no message or digest, and so no CMS
 * detail, can reach the page. The server log has the error.
 */
export default function PageError({ retry }: { retry: () => void }) {
  return (
    <div className="rh-unavailable">
      <h1>This page can&rsquo;t be shown right now</h1>
      <p>Something went wrong while loading it. You can try again, or come back later.</p>
      <p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </p>
    </div>
  );
}
