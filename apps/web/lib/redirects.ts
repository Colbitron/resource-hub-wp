import "server-only";

import { notFound, permanentRedirect } from "next/navigation";

import { canonicalSlug, isSlug, isTypeSlug, resourcePath } from "./routes";
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
 * The target is always computed from the CMS's current answer, never stored,
 * so a type changed and changed back cannot loop: each request to the old
 * URL asks again. The data layer's Data Cache is what makes that cheap, and
 * the revalidation events clear it (ADR 0046).
 *
 * How the 308 reaches the wire: `resourceForRequest` calls Next.js's
 * `permanentRedirect()`, and the route that calls it must render on every
 * request, which a dynamic segment without `generateStaticParams` does. In
 * a dynamic render Next.js sends the redirect as a 308 with
 * `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
 * and stores nothing. Measured on 2026-11-05 (ADR 0035's amendment): from an
 * ISR route the same call is prerendered and stored as a 308 with
 * `s-maxage=3600`, which browsers keep for ever, and making only the
 * redirecting render dynamic (`connection()`, an uncached fetch) fails with
 * `DYNAMIC_SERVER_USAGE` at runtime. So the route is dynamic, by design, and
 * the e2e suite asserts the header on every redirect. Call it before
 * anything is rendered and outside any Suspense boundary or `loading.tsx`:
 * once streaming has begun, Next.js can only send a 200 with a meta refresh.
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

/** `segment` without its percent escapes, so the hex of `%E6` is not read as a letter. */
function outsideEscapes(segment: string): string {
  return segment.replace(/%[0-9A-Fa-f]{2}/g, "");
}

/**
 * True when `segment`, as Next.js hands it to the page, is the canonical
 * form `canonical` (from `canonicalSlug`). Next.js normalises a path segment
 * before the page sees it: escapes of unreserved ASCII characters are decoded
 * (`%52esource` arrives as `Resource`) and the hex of every other escape is
 * upper-cased (`%e6%97%a5` and `%E6%97%A5` both arrive as `%E6%97%A5`), so the
 * page cannot tell those two requests apart and must treat both as canonical,
 * or the redirect to the lower-case form would loop. What it can see, and
 * redirects, is an upper-case ASCII letter outside an escape, and any other
 * difference once both sides are in canonical form (a wrong type segment).
 */
function isCanonicalSegment(segment: string, canonical: string): boolean {
  return !/[A-Z]/.test(outsideEscapes(segment)) && canonicalSlug(segment) === canonical;
}

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
 * 308 and a miss renders the not-found page. For a page that renders on
 * every request; see the module comment for why, and call it first.
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
