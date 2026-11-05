import "server-only";

import { canonicalSlug, isSlug } from "../routes";
import { resolveTags } from "../tags";
import { CmsError, cmsGet } from "./fetch";
import { resolveResponseSchema, type ResolveResponse } from "./schemas/resolve";

/**
 * The plugin's resolve route, `GET /resource-hub/v1/resolve?slug=…`: the
 * current identity (`id`, `type`, `slug`) of the published resource that has
 * or had `slug`, or `null` for the plugin's 404 `resource_hub_not_found`. The
 * page calls it only when `getResourceBySlug` misses, and redirects to the
 * canonical URL it gives. A slug that cannot be one (`isSlug`) is `null`
 * without a request; the slug is sent canonical, as WordPress stores it.
 *
 * Tagged `resolveTags()`. A miss is a 404, which the Data Cache does not
 * keep, so an unknown slug is asked again on every render.
 */
export async function resolveSlug(slug: string): Promise<ResolveResponse | null> {
  if (!isSlug(slug)) {
    return null;
  }
  const path = "/resource-hub/v1/resolve";
  const result = await cmsGet({
    path,
    query: new URLSearchParams({ slug: canonicalSlug(slug) }).toString(),
    tags: resolveTags(),
    schema: resolveResponseSchema,
    misses: [{ status: 404, code: "resource_hub_not_found" }],
  });
  if (result.kind === "miss") {
    return null;
  }
  if (result.kind !== "ok") {
    throw new CmsError(path, "status", "an answer the request did not expect");
  }
  return result.data;
}
