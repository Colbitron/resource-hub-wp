import type { APIRequestContext } from "@playwright/test";

import { E2E_REVALIDATE_SECRET } from "./mock-cms/config.mts";
import { TERMS } from "./mock-cms/seed.mts";

/**
 * Puts the app under test back in step with a freshly reset mock. The mock's
 * `/__mock/reset` changes the CMS's data, but the app's Data Cache and its
 * stored ISR pages keep what they hold, in the process and on disk across
 * runs (e2e/README.md), and the browser prefetches the shell's link to
 * `/resources/` on every page it opens, so a listing can be rendered and
 * stored at any moment of any spec, with whatever the mock held then.
 *
 * This sends what the CMS would send if every seeded type and topic had been
 * edited: a batch of term `update` events, which clears `resources`, `terms`
 * and every `type:` and `topic:` tag, which between them are every tag a
 * listing or term fetch carries (the table in `docs/architecture/caching.md`),
 * and the first page of every listing as a path. Resource pages by slug are
 * not covered; specs that read one give it a slug of its own.
 */
export async function clearAppCache(request: APIRequestContext): Promise<void> {
  const events = TERMS.filter((term) => term.taxonomy !== "resource_flag").map((term) => ({
    type: "term",
    taxonomy: term.taxonomy,
    event: "update",
    id: term.id,
    slug: term.slug,
    name: term.name,
    previous: { slug: term.slug, name: term.name },
  }));
  const response = await request.post("/api/revalidate/", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${E2E_REVALIDATE_SECRET}` },
    data: JSON.stringify({ version: 1, events }),
  });
  if (response.status() !== 200) {
    throw new Error(`clearAppCache: the revalidate route answered ${response.status()}: ${await response.text()}`);
  }
}
