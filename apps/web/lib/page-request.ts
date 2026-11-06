import "server-only";

import { notFound, permanentRedirect } from "next/navigation";

import {
  isCanonicalSegment,
  isPageSegment,
  isReservedRootSegment,
  pagePath,
  pagePathSegments,
  ROOT_PATH,
} from "./routes";
import { getPageById, lookupPage } from "./wp/pages";
import type { PageLookup } from "./wp/schemas/page";
import type { WpPage } from "./wp/schemas/rest";

/**
 * What a request for `/` or `/{segments}/` gets (ADR 0051): the WordPress
 * page to render, the welcome page when the root has no front page, a
 * computed single-hop 308 to the page's canonical path, or a 404. The same
 * rules as the resource page's decision (`lib/redirects.ts`; ADRs 0025, 0035):
 *
 * - A segment that cannot be part of a page path (`isPageSegment`: not a slug,
 *   or holding a dot, as `favicon.ico` does) or a first segment the front
 *   end's own routes use (`RESERVED_ROOT_SEGMENTS`) is a 404 without a request.
 *   `/resources/…` never arrives here, since a static sibling wins over the
 *   catch-all; `/api/other/` and `/media/x/` with no rewrite configured do.
 * - The path is looked up in canonical form through the plugin's page route,
 *   which answers from the current state: the front page for `/`, the page
 *   whose parent chain is the path, or the one page that has the last
 *   segment as its slug now (a page moved under another parent). A miss is a
 *   404, or the welcome page for `/`.
 * - The answer carries the page's canonical path now. When it differs from
 *   what was asked (a wrong parent, the front page at its own slug, an
 *   upper-case letter in a segment), the request redirects to it in one hop;
 *   otherwise the page is read by ID and rendered. A page that is gone
 *   between the two reads is a 404.
 *
 * Why a redirect cannot loop: the target is built from the CMS's canonical
 * segments through `canonicalSlug`, so a request for it is canonical, and the
 * plugin answers a canonical path with itself, since each segment is a stored
 * slug under its stored parent. Across changes the target is computed from
 * the current answer and never stored (ADR 0025), and `test/page-request.test.ts`
 * checks the fixed point over generated paths.
 *
 * `pageForRequest` runs it with Next.js: the route is dynamic
 * (`force-dynamic`, `connection()` first, no `loading.tsx`), so a 308 goes out
 * with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
 * and is never stored (ADR 0035's 2026-11-05 amendment). `decidePageRequest`
 * is the decision without Next.js, for the unit tests.
 */

export type PageRequestDecision =
  | { readonly kind: "render"; readonly page: WpPage; readonly path: string }
  | { readonly kind: "welcome" }
  | { readonly kind: "redirect"; readonly path: string }
  | { readonly kind: "not-found" };

export type RenderedPage = Extract<PageRequestDecision, { kind: "render" | "welcome" }>;

export interface PageRequestOptions {
  /** The path lookup; the data layer's `lookupPage` by default. */
  readonly lookupPage?: (path: string) => Promise<PageLookup | null>;
  /** The page read; the data layer's `getPageById` by default. */
  readonly getPageById?: (id: number) => Promise<WpPage | null>;
}

const NOT_FOUND: PageRequestDecision = { kind: "not-found" };
const WELCOME: PageRequestDecision = { kind: "welcome" };

/**
 * The decision for the request `/{segments.join("/")}/`, with the segments as
 * Next.js gives them in `params` (`[]` for `/`). Never throws on a segment a
 * visitor can type: the checks run before any lookup, and the builders only
 * ever see validated segments from the request or the CMS.
 */
export async function decidePageRequest(
  segments: readonly string[],
  options: PageRequestOptions = {},
): Promise<PageRequestDecision> {
  const { lookupPage: lookup = lookupPage, getPageById: byId = getPageById } = options;

  if (segments.some((segment) => !isPageSegment(segment))) {
    return NOT_FOUND;
  }
  if (segments.length > 0 && isReservedRootSegment(segments[0])) {
    return NOT_FOUND;
  }
  const requested = pagePath(segments);

  const found = await lookup(requested);
  if (found === null) {
    return requested === ROOT_PATH ? WELCOME : NOT_FOUND;
  }

  const foundSegments = pagePathSegments(found.path);
  if (foundSegments === null || foundSegments.some((segment) => !isPageSegment(segment))) {
    // The reader schema refuses such a path; this is the belt to its braces.
    return NOT_FOUND;
  }
  const canonical = pagePath(foundSegments);
  const requestIsCanonical =
    canonical === requested &&
    segments.length === foundSegments.length &&
    segments.every((segment, index) => isCanonicalSegment(segment, foundSegments[index]));
  if (!requestIsCanonical) {
    return { kind: "redirect", path: canonical };
  }

  const page = await byId(found.id);
  if (page === null) {
    return requested === ROOT_PATH ? WELCOME : NOT_FOUND;
  }
  return { kind: "render", page, path: canonical };
}

/**
 * The page for the request, or no return: a redirect sends Next.js's 308 and
 * a miss renders the not-found page. For a page that renders on every
 * request; see the module comment for why, and call it first.
 */
export async function pageForRequest(
  segments: readonly string[],
  options?: PageRequestOptions,
): Promise<RenderedPage> {
  const decision = await decidePageRequest(segments, options);
  if (decision.kind === "redirect") {
    permanentRedirect(decision.path);
  }
  if (decision.kind === "not-found") {
    notFound();
  }
  return decision;
}
