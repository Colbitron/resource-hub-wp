import { connection } from "next/server";

import { resourceForRequest } from "@/lib/redirects";
import { resourcePath } from "@/lib/routes";
import { plainText } from "@/lib/wp/cards";

/**
 * A test-only page for e2e/redirects.spec.ts: the resource page's redirect
 * decision (`lib/redirects.ts`) over the real data layer and the mock CMS,
 * at `/fixtures/redirect/[type]/[slug]/`. Redirects stay under this prefix,
 * so the spec can follow one to a page that exists in this build; the real
 * resource page uses the default `resourcePath`. A route only under
 * `RH_FIXTURES=1` (see `next.config.ts`).
 *
 * It renders on every request (no `generateStaticParams`, `export const
 * dynamic = "force-dynamic"`, and `connection()` to say so), unlike the real
 * route, which is ISR since 2026-11-06 and stores what it answers (ADR
 * 0035's amendment): here every redirect is a fresh decision, so the spec
 * can exercise the decision's edge cases without a route cache in the way,
 * while `e2e/resource-page.spec.ts` covers what the real route stores. It
 * sits behind the same proxy and the catch-all's `headers()` rule as every
 * path, so a mixed-case segment is the proxy's `no-store` 308 and its own
 * 308s carry `public, max-age=0, must-revalidate`. The decision runs before
 * anything is rendered and outside any Suspense boundary, so the 308 is an
 * HTTP response, not a meta refresh.
 */

const PREFIX = "/fixtures/redirect";

/**
 * The guard that keeps this fixture dynamic. Measured under `next start` on
 * 2026-11-05 (ADR 0035): with it, the route stays dynamic whatever
 * `generateStaticParams` returns; with `connection()` alone, a
 * `generateStaticParams` returning `[]` makes every request a 500. The data
 * layer's fetches ask for `cache: "force-cache"` explicitly, so they keep the
 * Data Cache (30 renders, one CMS request).
 */
export const dynamic = "force-dynamic";

/** `resourcePath(type, slug)` with `/resources` replaced by this fixture's prefix. */
function fixturePath(type: string, slug: string): string {
  return PREFIX + resourcePath(type, slug).slice("/resources".length);
}

export default async function RedirectFixturePage({ params }: { params: Promise<{ type: string; slug: string }> }) {
  await connection();
  const { type, slug } = await params;
  const rendered = await resourceForRequest(type, slug, { pathFor: fixturePath });

  return (
    <>
      <h1 data-testid="fixture-title">{plainText(rendered.resource.title.rendered)}</h1>
      <p>
        Canonical path <code data-testid="fixture-path">{fixturePath(rendered.type, rendered.slug)}</code>
      </p>
    </>
  );
}
