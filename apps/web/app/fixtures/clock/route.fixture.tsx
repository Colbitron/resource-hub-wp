/**
 * A test-only route for the end-to-end harness (`e2e/revalidation.mts`): how
 * far the server's wall clock, `Date.now()`, runs ahead of the clock Next.js
 * checks a revalidated tag's expiry against, `performance.timeOrigin +
 * performance.now()`, in milliseconds. Next.js 16.4.5 stamps
 * `revalidateTag(tag, { expire: 0 })` with the first and compares with the
 * second, so while the wall clock is ahead (macOS's `timed` slewing it after
 * an NTP correction, say), a just-revalidated entry reads as stale but not
 * expired and is served from the cache once more. The harness waits that
 * long after a revalidation before it reads (`e2e/README.md`).
 *
 * A route handler named `route.fixture.tsx`: a route only under
 * `RH_FIXTURES=1`, as `next.config.ts` adds `.fixture.tsx` to the page
 * extensions then, so a production build never includes it.
 */

/** Measured on every request, never prerendered or cached. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const wall = Date.now();
  const monotonic = performance.timeOrigin + performance.now();
  return Response.json({ skewMs: wall - monotonic }, { headers: { "Cache-Control": "no-store" } });
}
