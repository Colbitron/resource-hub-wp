import "server-only";

import { notFound, permanentRedirect } from "next/navigation";

import { canonicalSlug, isCanonicalSegment, isSlug, isTypeSlug, resourcePath } from "./routes";
import { resourceType } from "./wp/cards";
import { resolveSlug } from "./wp/resolve";
import { getResourceBySlug } from "./wp/resources";
import type { ResolveResponse } from "./wp/schemas/resolve";
import type { WpResource } from "./wp/schemas/rest";

/**
 * What a request for `/resources/{type}/{slug}/` gets: the resource to
 * render, a computed single-hop 308 to its canonical URL, or a 404 (root
 * `CLAUDE.md`, "Public URLs"; ADRs 0025, 0029, 0035 and 0049, and the
 * 2026-11-05 amendment to ADR 0035 for the mechanism).
 *
 * The slug is the identity and the type segment is checked:
 *
 * - A type segment that cannot be a type slug (`topic`, `page`, in any case
 *   or encoding, or not a slug at all) or a slug segment that cannot be a
 *   slug is a 404 without a request.
 * - The slug is looked up as it is stored, in its canonical form. When it is
 *   found, the request is compared with the resource's canonical URL: a
 *   wrong type segment, or either segment not in canonical form (upper-case
 *   letters, for instance), redirects to `resourcePath(type, slug)`, in one
 *   step; otherwise the resource is rendered.
 * - When the slug is not found, the CMS's resolve route is asked once. An old
 *   slug redirects to the canonical URL of the resource it now names;
 *   anything else is a 404.
 *
 * Why a redirect cannot loop, in two parts:
 *
 * - Within one state of the CMS, a target is a fixed point. It is built from
 *   canonical segments, which hold no upper-case letter and no escape of a
 *   character Next.js decodes in params, `encodeURIComponent`'s unescaped set
 *   `A-Z a-z 0-9 - _ . ! ~ * ' ( )` (`slugProblem` refuses a slug with one). Next.js's normalisation of the target therefore
 *   only upper-cases the hex of its escapes, which `isCanonicalSegment`
 *   (`lib/routes.ts`) ignores, so the request for the target is found and rendered, or is a
 *   404 when the CMS's answers disagree (a stale cached miss beside resolve).
 *   It never redirects again. `test/redirects.test.ts` checks this as a
 *   property over thousands of generated slugs and requests.
 * - Across changes, the target is always computed from the CMS's current
 *   answer, and the stored copy of a decision lives only until the event for
 *   the change that made it wrong, which clears the tags and paths of both
 *   the old and the new state (ADR 0046), so a type changed and changed back
 *   cannot loop either: after each event the old URL asks again. The data
 *   layer's Data Cache makes that cheap.
 *
 * How the 308 reaches the wire: `resourceForRequest` calls Next.js's
 * `permanentRedirect()` from an ISR route (`revalidate = 3600`, a
 * `generateStaticParams` returning `[]`), which renders the decision once
 * per URL and stores whatever it was, a 200, a 308 or a 404, under the tags
 * of the fetches that decided it, so the revalidation event for any change
 * to the resource clears a stored redirect at its old URL and a stored 404
 * at its new one (ADR 0035's 2026-11-06 amendment, measured). The stored
 * response leaves Next.js with `s-maxage` alone, which a browser ignores and
 * Chromium then keeps a 308 for ever, so the `headers()` rule in
 * `next.config.ts` puts `public, max-age=0, must-revalidate` on every
 * response of the route. Call it before anything is rendered and outside any
 * Suspense boundary or `loading.tsx`: once streaming has begun, Next.js can
 * only send a 200 with a meta refresh. The route must not call a
 * request-time API (`connection()`, `headers()`) or fetch with `no-store`,
 * since a dynamic bail-out in an ISR route with no prerendered params is a
 * runtime 500. A mixed-case request never reaches the route: `proxy.ts`
 * sends its own `no-store` 308 first, because Next.js keys a stored entry by
 * the decoded path and a case-insensitive file system shares the key
 * between `/A/` and `/a/`; the mixed-case branch below is a second line.
 *
 * `decideResourceRequest` is the decision without Next.js, for the unit
 * tests and for a caller that builds the response itself.
 */

/** What to do with the request. `type` and `slug` on a render are the canonical segments. */
export type ResourceRequestDecision =
  | { readonly kind: "render"; readonly resource: WpResource; readonly type: string; readonly slug: string }
  | { readonly kind: "redirect"; readonly path: string }
  | { readonly kind: "not-found" };

export type RenderedResource = Extract<ResourceRequestDecision, { kind: "render" }>;

export interface ResourceRequestOptions {
  /** The slug lookup; the data layer's `getResourceBySlug` by default. */
  readonly getResourceBySlug?: (slug: string) => Promise<WpResource | null>;
  /** The resolve route; the data layer's `resolveSlug` by default. */
  readonly resolveSlug?: (slug: string) => Promise<ResolveResponse | null>;
  /**
   * Builds the canonical path a redirect points at from a type slug and a
   * slug; `resourcePath` by default. The fixture page under
   * `/fixtures/redirect/` points it under its own prefix, so the suite can
   * follow a redirect to a page that exists in this build.
   */
  readonly pathFor?: (type: string, slug: string) => string;
}

const NOT_FOUND: ResourceRequestDecision = { kind: "not-found" };

/**
 * The decision for the request `/resources/{typeSegment}/{slugSegment}/`,
 * with the segments as Next.js gives them in `params`. See the module
 * comment for the rules. Never throws on a segment a visitor can type: the
 * checks run before any lookup, and the builders only ever see validated
 * slugs from the CMS.
 */
export async function decideResourceRequest(
  typeSegment: string,
  slugSegment: string,
  options: ResourceRequestOptions = {},
): Promise<ResourceRequestDecision> {
  const { getResourceBySlug: bySlug = getResourceBySlug, resolveSlug: resolve = resolveSlug, pathFor = resourcePath } =
    options;

  if (!isTypeSlug(typeSegment) || !isSlug(slugSegment)) {
    return NOT_FOUND;
  }
  const slug = canonicalSlug(slugSegment);

  const resource = await bySlug(slug);
  if (resource !== null) {
    const type = resourceType(resource);
    if (type === null) {
      // No URL can be computed for it, so there is nothing to render or redirect to.
      return NOT_FOUND;
    }
    const canonicalType = canonicalSlug(type.slug);
    const canonicalResourceSlug = canonicalSlug(resource.slug);
    if (isCanonicalSegment(typeSegment, canonicalType) && isCanonicalSegment(slugSegment, canonicalResourceSlug)) {
      return { kind: "render", resource, type: canonicalType, slug: canonicalResourceSlug };
    }
    return { kind: "redirect", path: pathFor(type.slug, resource.slug) };
  }

  const resolved = await resolve(slug);
  if (resolved === null || !isTypeSlug(resolved.type)) {
    return NOT_FOUND;
  }
  if (isCanonicalSegment(typeSegment, canonicalSlug(resolved.type)) && isCanonicalSegment(slugSegment, canonicalSlug(resolved.slug))) {
    // Resolve names the URL that was just asked for, so the slug lookup's
    // cached miss is stale next to it (ADR 0049). A redirect to the same URL
    // would loop; a 404 until the next event clears the miss does not.
    return NOT_FOUND;
  }
  return { kind: "redirect", path: pathFor(resolved.type, resolved.slug) };
}

/**
 * The resource for the request, or no return: a redirect sends Next.js's
 * 308 and a miss renders the not-found page. For an ISR page that stores
 * the answer; see the module comment for how, and call it first.
 */
export async function resourceForRequest(
  typeSegment: string,
  slugSegment: string,
  options?: ResourceRequestOptions,
): Promise<RenderedResource> {
  const decision = await decideResourceRequest(typeSegment, slugSegment, options);
  if (decision.kind === "redirect") {
    permanentRedirect(decision.path);
  }
  if (decision.kind === "not-found") {
    notFound();
  }
  return decision;
}
