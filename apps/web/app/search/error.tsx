"use client";

import "@/components/unavailable.css";

/**
 * The search route's error boundary: what a reader sees when the data layer
 * throws (a `CmsError`: the CMS down, slow or answering wrongly, a 400 from
 * the search route included, which means the two sides disagree on the
 * query rules). A CMS with no search route is not an error: `searchSite`
 * answers `null` and the page says search is not available, with a 200.
 * The page awaits its reads before anything is sent, with no Suspense
 * boundary or `loading.tsx`, so an error is a 500 with Next.js's `no-store`
 * header, as on the ISR routes (`e2e/search.spec.ts` pins the status); the
 * page is dynamic, so nothing would store it anyway.
 *
 * It takes no `error` prop on purpose, so no message or digest, and so no
 * CMS detail, can reach the page. The server log has the error.
 */
export default function SearchError({ retry }: { retry: () => void }) {
  return (
    <div className="rh-unavailable">
      <h1>Search can&rsquo;t be shown right now</h1>
      <p>Something went wrong while searching. You can try again, or come back later.</p>
      <p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </p>
    </div>
  );
}
