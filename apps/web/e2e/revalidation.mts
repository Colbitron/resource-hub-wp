import { appendFileSync } from "node:fs";

import type { APIRequestContext, APIResponse } from "@playwright/test";

/**
 * Every spec's way of posting to the revalidate route. A 200 means the route
 * has called `revalidateTag(tag, { expire: 0 })`, but on Next.js 16.4.5 that
 * expiry is stamped with `Date.now()` and checked against
 * `performance.timeOrigin + performance.now()`
 * (`next/dist/server/lib/incremental-cache/file-system-cache.js` and
 * `tags-manifest.external.js`). While the server's wall clock runs ahead of
 * that second clock, which it does when macOS's `timed` slews it after an NTP
 * correction, a just-revalidated entry is stale but not yet expired, and the
 * next read is served from the cache while it refetches in the background.
 * A run once failed twenty specs with stale data while `timed` slewed the
 * clock by 43 ms, the likely cause though not a proven one. So after a 200
 * this asks the app how far ahead its wall clock is (`/fixtures/clock/`)
 * and waits that long plus a margin before the spec reads anything
 * (`e2e/README.md`, "Clock skew").
 */

/** The route the CMS posts to, with the trailing slash the plugin uses (ADR 0043). */
export const REVALIDATE_ROUTE = "/api/revalidate/";

/** The test-only route that reports the server's skew (`app/fixtures/clock/route.fixture.tsx`). */
export const CLOCK_FIXTURE = "/fixtures/clock/";

/**
 * Waited on top of the skew: the skew can shrink a little between the
 * revalidation and the measurement while the clock is being slewed (at most
 * a fraction of a millisecond over one request), and the comparison is `<=`.
 */
export const SKEW_MARGIN_MS = 5;

/**
 * Past this, the clock is wrong rather than being corrected: no wait is
 * trusted to cover it, and the run fails instead of waiting.
 */
export const MAX_SKEW_MS = 250;

type PostOptions = NonNullable<Parameters<APIRequestContext["post"]>[1]>;

/**
 * How long to wait after a revalidation, given the server's skew in ms
 * (`Date.now()` minus the monotonic clock), or an error past `MAX_SKEW_MS`.
 * A negative skew needs no wait: the expiry is then already in the past.
 */
export function skewWaitMs(skewMs: number): number {
  if (!Number.isFinite(skewMs)) {
    throw new Error(`The app's clock fixture reported ${String(skewMs)} as its clock skew, which is not a number of milliseconds.`);
  }
  if (Math.abs(skewMs) > MAX_SKEW_MS) {
    throw new Error(
      `The app server's wall clock (Date.now()) is ${Math.abs(skewMs).toFixed(1)} ms ${skewMs > 0 ? "ahead of" : "behind"} its monotonic clock ` +
        `(performance.timeOrigin + performance.now()), more than the ${MAX_SKEW_MS} ms the harness waits out. Next.js stamps a ` +
        "revalidated tag with the first clock and checks it with the second, so the app may serve stale data. This is a clock " +
        "problem on this machine, not a bug in a spec: the clock was probably stepped or slewed while the server ran (an NTP " +
        `correction, a sleep and wake). Check \`log show --last 1h --predicate 'process == "timed"' | grep cmd,apply\`, then ` +
        "restart the app server and run again.",
    );
  }
  return Math.max(0, skewMs) + SKEW_MARGIN_MS;
}

/**
 * Measures the app server's clock skew and waits it out. Called after every
 * revalidate 200, so the next read cannot meet an entry the slewed clock left
 * stale. With `RH_E2E_SKEW_LOG` set to a file path, each measurement is
 * appended to it as a line of JSON, for diagnosing a run.
 */
export async function waitOutClockSkew(request: APIRequestContext): Promise<number> {
  const response = await request.get(CLOCK_FIXTURE);
  if (response.status() !== 200) {
    throw new Error(`The clock fixture ${CLOCK_FIXTURE} answered ${response.status()}; is the app built with RH_FIXTURES=1?`);
  }
  const { skewMs } = (await response.json()) as { skewMs: number };
  const wait = skewWaitMs(skewMs);
  // A deadline rather than one timer: Node's setTimeout counts from the
  // event loop's cached time and can fire up to a millisecond early
  // (measured 34.3 ms for a 35 ms timer), so it sleeps until the full wait
  // has passed on the monotonic clock.
  const started = performance.now();
  for (let left = wait; left > 0; left = wait - (performance.now() - started)) {
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(left)));
  }
  const log = process.env.RH_E2E_SKEW_LOG;
  if (log) appendFileSync(log, `${JSON.stringify({ skewMs, waitMs: wait, waitedMs: performance.now() - started })}\n`);
  return skewMs;
}

/**
 * `request.post` to the revalidate route with the given headers and body,
 * and, when it answers 200, the clock-skew wait before returning. Every
 * answer is returned as it came; the caller checks the status.
 */
export async function postRevalidate(request: APIRequestContext, options: PostOptions): Promise<APIResponse> {
  const response = await request.post(REVALIDATE_ROUTE, options);
  if (response.status() === 200) await waitOutClockSkew(request);
  return response;
}
