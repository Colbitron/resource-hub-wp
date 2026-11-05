import { connection } from "next/server";

import { wpApiUrl } from "@/lib/env";
import { resourceFetchTags } from "@/lib/tags";
import { wpResourceListSchema } from "@/lib/wp/schemas/rest";

/**
 * A test-only page for e2e/revalidate.spec.ts: one tagged, cached fetch of a
 * resource from the CMS, so the spec can prove the Data Cache serves it
 * (one upstream request for two page loads), that the mock's upstream
 * `Cache-Control: no-cache` does not stop Next.js caching it (ADR 0023's
 * open question), and that a `POST /api/revalidate/` for the resource makes
 * the next load fetch again. It is a route only under `RH_FIXTURES=1`, as
 * `next.config.ts` adds `.fixture.tsx` to the page extensions then.
 *
 * The fetch is shaped as the data layer's will be (ADR 0043): `force-cache`,
 * the tags from `lib/tags.ts`, and a long `revalidate` as the safety net.
 * `connection()` makes the page dynamic without touching the fetch's cache
 * options, as `dynamic = "force-dynamic"` would, so the build makes no CMS
 * request and every load goes through the Data Cache.
 */

/** A seed resource; `e2e/mock-cms/seed.mts` has it as an article, and the spec names the same slug. */
const FIXTURE_SLUG = "alt-text-at-scale";

export default async function RevalidateFixturePage() {
  await connection();

  const url = `${wpApiUrl()}/wp/v2/resources?slug=${FIXTURE_SLUG}&per_page=1&_embed`;
  const response = await fetch(url, {
    cache: "force-cache",
    next: { tags: resourceFetchTags(FIXTURE_SLUG), revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`The CMS answered ${response.status} for the fixture resource.`);
  }
  const [resource] = wpResourceListSchema.parse(await response.json());
  if (resource === undefined) {
    throw new Error(`The CMS has no published resource with the slug ${FIXTURE_SLUG}.`);
  }

  return (
    <>
      <h1 data-testid="fixture-title">{resource.title.rendered}</h1>
      <p>
        Fetched with the tags <code data-testid="fixture-tags">{resourceFetchTags(FIXTURE_SLUG).join(" ")}</code>.
      </p>
    </>
  );
}
