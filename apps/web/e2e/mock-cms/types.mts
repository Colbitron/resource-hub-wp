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
  /** `related_picks`: the editor's ordered picks, as post IDs, published or not. */
  picks: number[];
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

/** A WordPress page's status, as `post_status`. */
export type PageStatus = "publish" | "draft" | "trash";

/** One page as `GET /__mock/state` summarises it (ADR 0052). */
export interface PageSummary {
  id: number;
  slug: string;
  parent: number;
  status: PageStatus;
  title: string;
  /** The page's public path now: `/` when it is the front page, else its parent chain and slug. */
  path: string;
}

/** Settings > Reading, as the options `show_on_front` and `page_on_front` hold them. */
export interface FrontPageSetting {
  showOnFront: "posts" | "page";
  pageOnFront: number;
}

export interface StateSummary {
  origin: string;
  resources: ResourceSummary[];
  terms: TermSummary[];
  media: MediaSummary[];
  pages: PageSummary[];
  frontPage: FrontPageSetting;
  /** `page_for_posts`: the page that stands in for the posts listing, never served by the front end. */
  pageForPosts: number;
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

/**
 * `GET /__mock/health`: which mock answered. `dir` is the absolute path of the
 * `mock-cms/` directory the process runs from, `build` a SHA-256 of that
 * directory's files as the process read them at start (`identity.mts`), and
 * `pid` its process ID, so a mock reused from another checkout, or from this
 * one before its code changed, can be recognised.
 */
export interface HealthResponse {
  ok: true;
  dir: string;
  build: string;
  pid: number;
  origin: string;
}

/**
 * `POST /__mock/faults`: make the public routes under `path` answer `status`
 * instead of their own answer, after `delayMs` when given; a `delayMs`
 * alone makes them slow but correct. `times` limits it to that many
 * requests. See `faults.mts`.
 */
export interface FaultInput {
  path: string;
  status?: number;
  delayMs?: number;
  times?: number;
}

/** A fault in force, as `GET /__mock/faults` lists it; `remaining` is `null` for no limit. */
export interface FaultSummary {
  path: string;
  status: number | null;
  delayMs: number;
  remaining: number | null;
}

/** The body of every control error: a 4xx with a plain message. */
export interface ControlError {
  error: string;
}

/** `POST /__mock/pages`: a new page, published unless `status` says otherwise. */
export interface CreatePageInput {
  title: string;
  /** Defaults to the title slugified. */
  slug?: string;
  /** The parent page's ID; 0 or absent for a top-level page. */
  parent?: number;
  /** `content.rendered`; `{{origin}}` is replaced with the mock's origin. Default: one paragraph. */
  content?: string;
  excerpt?: string;
  status?: PageStatus;
}

/** `POST /__mock/front-page`: `pageId` sets `show_on_front=page` and `page_on_front`; `null` sets `show_on_front=posts`. */
export interface FrontPageInput {
  pageId: number | null;
}
