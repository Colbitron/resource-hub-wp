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
 * It renders on every request, as the resource page must (no
 * `generateStaticParams`, and `connection()` to say so): that is what makes
 * every redirect a fresh 308 with Next.js's `no-store` header rather than a
 * stored one. The decision runs before anything is rendered and outside any
 * Suspense boundary, so the 308 is an HTTP response, not a meta refresh.
 */

const PREFIX = "/fixtures/redirect";

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
