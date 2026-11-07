import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A test-only route for `e2e/harness.spec.ts`: which app server is answering.
 * With `RH_E2E_REUSE=1` the harness tests whatever already listens on the
 * app's port, so the spec checks this against the checkout it runs from, as
 * it checks the mock's `/__mock/health`: the directory the server runs from,
 * when the process started, its process ID, and the build stamp the harness
 * wrote into `.next` (`e2e/build-stamp.mts`), read when this module was
 * first loaded.
 *
 * A route handler named `route.fixture.tsx`: a route only under
 * `RH_FIXTURES=1`, as `next.config.ts` adds `.fixture.tsx` to the page
 * extensions then, so a production build never includes it.
 */

/** Never prerendered or cached: every request reports the process answering it. */
export const dynamic = "force-dynamic";

/** `next start` runs from the app's directory and serves `.next` inside it. */
const DIR = process.cwd();

function readStamp(): unknown {
  try {
    return JSON.parse(readFileSync(join(/* turbopackIgnore: true */ DIR, ".next", "rh-e2e-build.json"), "utf8"));
  } catch {
    return null;
  }
}

const STAMP = readStamp();

export function GET(): Response {
  return Response.json(
    { dir: DIR, pid: process.pid, startedAt: performance.timeOrigin, stamp: STAMP },
    { headers: { "Cache-Control": "no-store" } },
  );
}
