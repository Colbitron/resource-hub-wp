/**
 * Cache tags, and what a revalidation batch invalidates (root `CLAUDE.md`,
 * "Revalidation request" and "Public URLs"; ADRs 0014 to 0017 and 0043).
 *
 * The tags are `resources`, `resource:{slug}`, `topic:{slug}` and
 * `type:{slug}`. Every fetch in the data layer carries the ones that describe
 * what it reads, and the revalidate route clears them with `revalidateTag`
 * and the paths below with `revalidatePath`.
 *
 * `eventsToInvalidations` covers the union of the current and the previous
 * state of every event:
 *
 * - A resource event, for its top-level state and for `previous` when set:
 *   `resources`, `resource:{slug}`, `type:{t}` and `topic:{t}`, and the paths
 *   `/resources/`, the resource's page, its type listing, each topic listing
 *   and each type plus topic listing.
 * - A term event: `resources` and `topic:{slug}` or `type:{slug}`, for the
 *   current and the previous slug, and the term's own listing path for each.
 *   The type plus topic listings that name the term, and for a type the
 *   resource pages under it, cannot be named from the event; their fetches
 *   carry the term's tag, which covers them.
 *
 * Pagination pages (`…/page/{n}/`) are never enumerated as paths: the event
 * cannot say how many there are, and every listing page's fetch carries the
 * listing's tags, so the tags cover them.
 *
 * Remove (`unpublish`, `trash`, `delete`) and refresh (`publish`, `update`)
 * produce the same invalidations, and so do the three term events. The
 * refetch after invalidation decides what is shown: a removed resource's
 * refetch returns nothing and its page becomes `notFound()`.
 *
 * Pure: no Next.js, `server-only` or Zod import at run time. The event types
 * are the ones the revalidate route's reader schema infers
 * (`lib/wp/schemas/revalidate.ts`), imported as types only.
 */

import type {
  ResourceEvent,
  ResourceState,
  RevalidationEvent,
  TermEvent,
  TermState,
} from "./wp/schemas/revalidate";
import {
  isSlug,
  isTypeSlug,
  libraryPath,
  resourcePath,
  topicListingPath,
  typeListingPath,
  typeTopicListingPath,
} from "./routes";

/** The tag on every fetch that lists or shows resources. */
export const RESOURCES_TAG = "resources";

function checked(kind: string, slug: string, valid: (value: string) => boolean): string {
  if (!valid(slug)) {
    throw new RangeError(`Not a valid ${kind} slug for a cache tag: ${JSON.stringify(slug)}`);
  }
  return slug;
}

/** `resource:{slug}`, on the fetches for one resource. */
export function resourceTag(slug: string): string {
  return `resource:${checked("resource", slug, isSlug)}`;
}

/** `topic:{slug}`, on the fetches for listings and blocks of one topic. */
export function topicTag(slug: string): string {
  return `topic:${checked("topic", slug, isSlug)}`;
}

/** `type:{slug}`, on the fetches for listings of one type. */
export function typeTag(slug: string): string {
  return `type:${checked("type", slug, isTypeSlug)}`;
}


export type { ResourceEvent, ResourceState, RevalidationEvent, TermEvent, TermState };

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
 * event's current and previous state. Throws a `RangeError` on a slug the
 * schema would have rejected, so call it on a body that has been validated.
 */
export function eventsToInvalidations(events: readonly RevalidationEvent[]): Invalidations {
  const tags = new Set<string>();
  const paths = new Set<string>();
  for (const event of events) {
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
