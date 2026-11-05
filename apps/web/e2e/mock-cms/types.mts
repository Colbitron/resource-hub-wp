/**
 * The shapes the mock's control endpoints (`/__mock/…`) accept and return.
 * Shared by the server side (`control.ts`) and the client the specs use
 * (`client.ts`), so a spec's view of the mock is typed end to end. The public
 * REST responses are not described here: they follow WordPress core's shapes
 * and are parsed with the front end's reader schemas in `lib/wp/schemas/`.
 */

export type Taxonomy = "resource_topic" | "resource_type" | "resource_flag";

/** A resource's publication status, as `post_status` in WordPress. */
export type ResourceStatus = "publish" | "draft" | "trash";

/** One resource as `GET /__mock/state` summarises it: term slugs, not IDs. */
export interface ResourceSummary {
  id: number;
  slug: string;
  /** Every slug the resource had before, oldest first, as `_wp_old_slug` records them. */
  previousSlugs: string[];
  status: ResourceStatus;
  title: string;
  /** The type's slug, or `null` when the resource has none (after its type was deleted). */
  type: string | null;
  topics: string[];
  featured: boolean;
  /** The featured image's media ID, or `null` for no image. */
  mediaId: number | null;
  date: string;
  modified: string;
}

export interface TermSummary {
  id: number;
  taxonomy: Taxonomy;
  slug: string;
  name: string;
  /** Published resources with the term, as the REST `count` reports it. */
  count: number;
}

export interface MediaSummary {
  id: number;
  /** The path under `/wp-content/uploads/`. */
  file: string;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface StateSummary {
  origin: string;
  resources: ResourceSummary[];
  terms: TermSummary[];
  media: MediaSummary[];
}

/** `POST /__mock/resources`: a new published resource. */
export interface CreateResourceInput {
  title: string;
  /** Defaults to the title slugified. */
  slug?: string;
  /** A `resource_type` slug that exists. */
  type: string;
  /** `resource_topic` slugs that exist. Default none. */
  topics?: string[];
  /** Give the resource the `featured` flag term. Default false. */
  featured?: boolean;
  summary?: string;
  /** An absolute http(s) URL or the empty string. Default empty. */
  sourceUrl?: string;
  /** `content.rendered`; `{{origin}}` is replaced with the mock's origin. Default: two seeder-style paragraphs. */
  content?: string;
  /** The ID of a media item the mock holds, or `null` for no image. Default `null`. */
  mediaId?: number | null;
}

export interface RenameTermInput {
  slug?: string;
  name?: string;
}

/** `GET /__mock/requests`: how many times each path (with its query string) was requested. */
export interface RequestCounts {
  total: number;
  byPath: Record<string, number>;
}

/** The body of every control error: a 4xx with a plain message. */
export interface ControlError {
  error: string;
}
