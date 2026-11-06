/**
 * Cache tags, which tags each data-layer fetch carries, and what a
 * revalidation batch invalidates. The events and their states are in
 * `packages/ui/README.md`, the union rule and `terms` in ADR 0043, and the
 * table of what each event clears in `docs/architecture/caching.md`.
 *
 * The tags are `resources`, `terms`, `resource:{slug}`, `topic:{slug}`,
 * `type:{slug}` and `pages`. Every fetch in the data layer carries the ones the functions
 * under "Fetch tags" below give it, fixed before the request from the URL and
 * its parameters, never from the response, so a miss is tagged too. The
 * revalidate route clears what `eventsToInvalidations` returns, the tags with
 * `revalidateTag` and the paths with `revalidatePath`.
 *
 * Tags are fixed from the request, but Next.js keys a cached fetch by its URL,
 * method and headers, not its tags: two callers of one URL share one entry,
 * stored under whichever caller's tags came first. So the rule relies only on
 * tags that every caller of that URL would add, and a tag that depends on the
 * calling page (the type segment it was reached under) is never put on a
 * shared URL.
 *
 * Every slug goes through `canonicalSlug` (`lib/routes.ts`), so a slug that
 * arrives raw (`日`), as WordPress stores it (`%e6%97%a5`) or upper-cased
 * (`%E6%97%A5`, `Example`) gives the same tag, and that tag is the one
 * Next.js stores.
 *
 * `eventsToInvalidations` covers the union of the current and the previous
 * state of every event:
 *
 * - A resource event, for its top-level state and for `previous` when set:
 *   `resources`, `resource:{slug}`, `type:{t}` and `topic:{t}`, and the paths
 *   `/resources/`, the resource's page, its type listing, each topic listing
 *   and each type plus topic listing.
 * - A term event: `resources`, `terms`, and `topic:{slug}` or `type:{slug}`
 *   for the current and the previous slug; the paths `/resources/` and the
 *   term's own listing for each slug. `terms` is on every fetch that embeds
 *   terms, so a rename reaches every page that shows the term's name: the
 *   library, the other listings, the resource pages and the filter bar, none of
 *   which the event can name. `resources` stays because the resolve route
 *   answers with the resource's type slug, which a type rename changes.
 *
 * - A page event (ADR 0052): `pages` and the path named at the top level and in
 *   `previous`. `pages` is on every page lookup and every page read: a
 *   parent's move or rename changes the paths of every page below it without an
 *   event for each, so one tag for every page is what reaches them, and the
 *   site has few pages. A page event clears nothing of the library's, and no
 *   resource or term event clears `pages`.
 *
 * Only term events produce `terms`. Tagging every fetch `resources` instead
 * would have done the same for term events, but then every resource event
 * would clear every page too. The fetches whose result can change with any
 * resource, whichever it is, do carry `resources`: the related section, the
 * featured list and the filter bar's term lists, whose counts WordPress
 * updates on every publish, trash and term assignment without a term event.
 *
 * Pagination pages (`…/page/{n}/`) are never enumerated as paths: the event
 * cannot say how many there are, and every listing page's fetch carries the
 * listing's tags, so the tags cover them.
 *
 * Remove (`unpublish`, `trash`, `delete`) and refresh (`publish`, `update`)
 * produce the same invalidations, and so do the three term events. The
 * refetch after invalidation decides what is shown: a removed resource's
 * refetch returns nothing and its page becomes a 404.
 *
 * Pure: no Next.js, `server-only` or Zod import at run time. The event types
 * are the ones the revalidate route's reader schema infers
 * (`lib/wp/schemas/revalidate.ts`), imported as types only.
 */

import {
  canonicalSlug,
  libraryPath,
  resourcePath,
  topicListingPath,
  typeListingPath,
  typeSlugProblem,
  typeTopicListingPath,
  type ListingFilter,
} from "./routes";
import type {
  PageEvent,
  PageState,
  ResourceEvent,
  ResourceState,
  RevalidationEvent,
  TermEvent,
  TermState,
} from "./wp/schemas/revalidate";

export type { PageEvent, PageState, ResourceEvent, ResourceState, RevalidationEvent, TermEvent, TermState };

/**
 * The tag every event clears: on the library listing, resolve, the related
 * section, the featured list and the filter bar's term lists.
 */
export const RESOURCES_TAG = "resources";

/** The tag only term events clear: on every fetch that embeds or lists terms. */
export const TERMS_TAG = "terms";

/** The tag only page events clear: on every page lookup and every page read (ADR 0052). */
export const PAGES_TAG = "pages";

/** `resource:{slug}`, on the fetches for one resource. Throws a `RangeError` on a bad slug. */
export function resourceTag(slug: string): string {
  return `resource:${canonicalSlug(slug)}`;
}

/** `topic:{slug}`, on the fetches for listings and blocks of one topic. Throws a `RangeError` on a bad slug. */
export function topicTag(slug: string): string {
  return `topic:${canonicalSlug(slug)}`;
}

/** `type:{slug}`, on the fetches for listings of one type. Throws a `RangeError` on a bad or reserved slug. */
export function typeTag(slug: string): string {
  const problem = typeSlugProblem(slug);
  if (problem !== null) {
    throw new RangeError(`Not a valid resource type slug (${problem}): ${JSON.stringify(slug)}`);
  }
  return `type:${canonicalSlug(slug)}`;
}

/*
 * Fetch tags: the data-layer tagging rule (ADR 0043). Each function names the
 * tags one kind of fetch carries. They throw a `RangeError` on a bad slug, so
 * a page checks its parameters with `isSlug` and `isTypeSlug` first and
 * answers a bad one with a 404.
 */

/**
 * Every page of a listing: the library (`resources`), a type (`type:{t}`), a
 * topic (`topic:{p}`) or both (`type:{t}` and `topic:{p}`), and `terms`, since
 * listings embed their resources' terms.
 */
export function listingTags(filter: ListingFilter = {}): string[] {
  const tags: string[] = [];
  if (filter.type === undefined && filter.topic === undefined) {
    tags.push(RESOURCES_TAG);
  }
  if (filter.type !== undefined) {
    tags.push(typeTag(filter.type));
  }
  if (filter.topic !== undefined) {
    tags.push(topicTag(filter.topic));
  }
  tags.push(TERMS_TAG);
  return tags;
}

/**
 * A resource fetched by slug, a miss included: `resource:{slug}`, so a publish
 * under that slug clears a cached miss, and `terms`, since it embeds its
 * terms, which also carries a type rename to the pages under the old segment,
 * so they redirect or 404. No `type:{t}` from the URL's type segment: the
 * fetch's URL has no type in it, so `/resources/right/foo/` and
 * `/resources/wrong/foo/` share one cache entry and its type tag would be
 * whichever page fetched first.
 */
export function resourceFetchTags(slug: string): string[] {
  return [resourceTag(slug), TERMS_TAG];
}

/**
 * The resource page's related section, both fetches: the related route
 * (`/resource-hub/v1/related/{id}`) and the `?include={ids}&_embed` read of the
 * items it returns. `resources`, because a pick from any topic may be
 * published, unpublished, trashed or renamed, and the topics the route merges
 * by may change; `terms`, since the read embeds terms; and
 * `resource:{hostSlug}`, the page the section sits on. The host tag is extra,
 * not relied on: two hosts with the same items share one `include=` URL and
 * one cache entry, and `resources` already reaches both.
 */
export function relatedTags(hostSlug: string): string[] {
  return [RESOURCES_TAG, TERMS_TAG, resourceTag(hostSlug)];
}

/**
 * A list filtered by `resource_flag`, such as the featured resources:
 * `resources`, because any resource event may add a resource to it or take
 * one away, and `terms`, since it embeds terms. Flags send no term events.
 */
export function flagListingTags(): string[] {
  return [RESOURCES_TAG, TERMS_TAG];
}

/**
 * A `resource_topic` or `resource_type` term looked up by slug, a miss
 * included: `topic:{slug}` or `type:{slug}`, which a term event for that slug
 * clears, a `create` included.
 */
export function termLookupTags(taxonomy: TermEvent["taxonomy"], slug: string): string[] {
  return [taxonomy === "resource_topic" ? topicTag(slug) : typeTag(slug)];
}

/**
 * A resource fetched by ID (`/wp/v2/resources/{id}`), a miss included:
 * `resources`, which every event clears, and `terms`, since it embeds terms.
 * The URL names no slug, and the tags must be fixed before the request, so
 * `resource:{slug}` is not available; no tag names an ID, so `resources` is
 * the one that reaches every event on the resource, whatever its slug.
 */
export function resourceByIdTags(): string[] {
  return [RESOURCES_TAG, TERMS_TAG];
}

/**
 * A `resource_flag` term looked up by slug, such as `featured`, a miss
 * included: `resources`. Flags send no term events, so no term tag reaches
 * it; a flag only matters once a resource carries it, and assigning it to
 * one sends a resource event, which clears `resources`.
 */
export function flagLookupTags(): string[] {
  return [RESOURCES_TAG];
}

/**
 * The resolve route: `resources`. Every event clears it: a resource event may
 * add or move an old slug, and a type event changes the type it answers with.
 */
export function resolveTags(): string[] {
  return [RESOURCES_TAG];
}

/**
 * The taxonomy lists the filter bar reads: `terms` for names and slugs, and
 * `resources` for each term's `count`, which WordPress updates on every
 * publish, trash and term assignment with no term event.
 */
export function taxonomyListTags(): string[] {
  return [RESOURCES_TAG, TERMS_TAG];
}

/**
 * A page lookup by path (`/resource-hub/v1/page`) and a page read by ID
 * (`/wp/v2/pages/{id}`), a miss included: `pages`. The lookup's answer can
 * change with any page event, including one for an ancestor whose move or
 * rename changed this path, which no per-page tag could name.
 */
export function pageTags(): string[] {
  return [PAGES_TAG];
}

/** What a batch invalidates: tags for `revalidateTag`, paths for `revalidatePath`. */
export interface Invalidations {
  /** Deduplicated and sorted. */
  readonly tags: string[];
  /** Deduplicated and sorted; every one ends with a slash. */
  readonly paths: string[];
}

function addResourceState(state: ResourceState, tags: Set<string>, paths: Set<string>): void {
  tags.add(resourceTag(state.slug));
  paths.add(libraryPath());
  for (const topic of state.topics) {
    tags.add(topicTag(topic));
    paths.add(topicListingPath(topic));
  }
  for (const type of state.types) {
    tags.add(typeTag(type));
    paths.add(typeListingPath(type));
    paths.add(resourcePath(type, state.slug));
    for (const topic of state.topics) {
      paths.add(typeTopicListingPath(type, topic));
    }
  }
}

function addTermSlug(
  taxonomy: TermEvent["taxonomy"],
  slug: string,
  tags: Set<string>,
  paths: Set<string>,
): void {
  tags.add(TERMS_TAG);
  paths.add(libraryPath());
  if (taxonomy === "resource_topic") {
    tags.add(topicTag(slug));
    paths.add(topicListingPath(slug));
  } else {
    tags.add(typeTag(slug));
    paths.add(typeListingPath(slug));
  }
}

/**
 * Every tag and path a batch of events invalidates, over the union of each
 * event's current and previous state.
 *
 * Never throws on a batch the route's schema accepted: the schema's slug rule
 * is the builders' rule (`slugProblem` in `lib/routes.ts`). On an event that
 * is type-correct but schema-invalid, such as a slug that is a lone surrogate
 * or a type slug `page`, it throws a `RangeError`; it does not return a
 * partial result. The route parses the body first, so that throw is a bug,
 * not a bad request.
 */
export function eventsToInvalidations(events: readonly RevalidationEvent[]): Invalidations {
  const tags = new Set<string>();
  const paths = new Set<string>();
  for (const event of events) {
    if (event.type === "page") {
      tags.add(PAGES_TAG);
      paths.add(event.path);
      if (event.previous !== null) {
        paths.add(event.previous.path);
      }
      continue;
    }
    tags.add(RESOURCES_TAG);
    if (event.type === "resource") {
      addResourceState(event, tags, paths);
      if (event.previous !== null) {
        addResourceState(event.previous, tags, paths);
      }
    } else {
      addTermSlug(event.taxonomy, event.slug, tags, paths);
      if (event.previous !== null) {
        addTermSlug(event.taxonomy, event.previous.slug, tags, paths);
      }
    }
  }
  return { tags: [...tags].sort(), paths: [...paths].sort() };
}
