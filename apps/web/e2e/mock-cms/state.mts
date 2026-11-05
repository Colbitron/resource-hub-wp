import { slugify } from "./sanitize.mts";
import { MEDIA, RESOURCES, SEED_DATE, TERMS, type MediaSeed, type ResourceSeed } from "./seed.mts";
import type {
  CreateResourceInput,
  MediaSummary,
  RenameTermInput,
  RequestCounts,
  ResourceStatus,
  ResourceSummary,
  StateSummary,
  Taxonomy,
  TermSummary,
} from "./types.mts";

/**
 * The mock's in-memory dataset: resources, terms and media as records with
 * term IDs, the mutations the control endpoints expose, and the request
 * counters. Nothing here knows about HTTP or about WordPress's response
 * shapes; `render.ts` turns records into REST objects.
 *
 * Every mutation throws a `MockError` with a 4xx status when its input does
 * not fit the data, so a spec that misuses the mock fails at the control call
 * rather than later and quietly.
 */

export interface ResourceRecord {
  id: number;
  slug: string;
  previousSlugs: string[];
  status: ResourceStatus;
  title: string;
  typeIds: number[];
  topicIds: number[];
  flagIds: number[];
  mediaId: number | null;
  summary: string;
  sourceUrl: string;
  /** `content.rendered` with `{{origin}}` and `{{topic-slug:ID}}` still in it, or `null` for the default body. */
  content: string | null;
  /** `related_picks`: the editor's ordered picks, as post IDs. Read only by the related route. */
  picks: number[];
  date: string;
  modified: string;
}

/** One entry of the related route's `items`. */
export interface RelatedItem {
  id: number;
  source: "pick" | "topic";
}

/** `related_picks` holds at most this many IDs, and the related route's `count` goes no higher (ADR 0020). */
export const MAX_RELATED = 10;

export interface TermRecord {
  id: number;
  taxonomy: Taxonomy;
  slug: string;
  name: string;
  description: string;
}

export type MediaRecord = MediaSeed;

export class MockError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MockError";
    this.status = status;
  }
}

export const TAXONOMIES: readonly Taxonomy[] = ["resource_topic", "resource_type", "resource_flag"];

export function isTaxonomy(value: string): value is Taxonomy {
  return (TAXONOMIES as readonly string[]).includes(value);
}

/** A WordPress `post_date`: `YYYY-MM-DDTHH:MM:SS` in site time, which the mock takes as UTC. */
export function siteTime(at: Date = new Date()): string {
  return at.toISOString().slice(0, 19);
}

function daysBefore(date: string, days: number): string {
  const at = new Date(`${date}Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return siteTime(at);
}

export class MockState {
  resources: ResourceRecord[] = [];
  terms: TermRecord[] = [];
  media: MediaRecord[] = [];
  private counts = new Map<string, number>();

  constructor() {
    this.reset();
  }

  /** Back to the seed, counters included. */
  reset(): void {
    this.terms = TERMS.map((term) => ({ ...term }));
    this.media = MEDIA.map((item) => ({ ...item, sizes: { ...item.sizes } }));
    this.resources = RESOURCES.map((seed, index) => this.fromSeed(seed, daysBefore(SEED_DATE, index)));
    this.resetRequests();
  }

  private fromSeed(seed: ResourceSeed, date: string): ResourceRecord {
    return {
      id: seed.id,
      slug: seed.slug,
      previousSlugs: [],
      status: seed.status,
      title: seed.title,
      typeIds: [this.requireTerm("resource_type", seed.type).id],
      topicIds: seed.topics.map((slug) => this.requireTerm("resource_topic", slug).id),
      flagIds: seed.featured ? [this.requireTerm("resource_flag", "featured").id] : [],
      mediaId: seed.mediaId,
      summary: seed.summary,
      sourceUrl: seed.sourceUrl,
      content: seed.content,
      picks: [...seed.picks],
      date,
      modified: date,
    };
  }

  // --- Reads ---------------------------------------------------------------

  /** Published resources, newest first, then by ID descending: core's default order. */
  published(): ResourceRecord[] {
    return this.resources
      .filter((resource) => resource.status === "publish")
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }

  resource(id: number): ResourceRecord | undefined {
    return this.resources.find((resource) => resource.id === id);
  }

  publishedBySlug(slug: string): ResourceRecord | undefined {
    return this.published().find((resource) => resource.slug === slug);
  }

  publishedByOldSlug(slug: string): ResourceRecord | undefined {
    return this.published().find((resource) => resource.previousSlugs.includes(slug));
  }

  /** Terms of one taxonomy by name, as the REST default `orderby=name` lists them. */
  termsOf(taxonomy: Taxonomy): TermRecord[] {
    return this.terms
      .filter((term) => term.taxonomy === taxonomy)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }

  term(taxonomy: Taxonomy, id: number): TermRecord | undefined {
    return this.terms.find((term) => term.taxonomy === taxonomy && term.id === id);
  }

  termBySlug(taxonomy: Taxonomy, slug: string): TermRecord | undefined {
    return this.terms.find((term) => term.taxonomy === taxonomy && term.slug === slug);
  }

  private requireTerm(taxonomy: Taxonomy, slug: string): TermRecord {
    const term = this.termBySlug(taxonomy, slug);
    if (!term) throw new MockError(422, `No ${taxonomy} term has the slug "${slug}".`);
    return term;
  }

  /** The IDs of a resource's terms in one taxonomy. */
  termIds(resource: ResourceRecord, taxonomy: Taxonomy): number[] {
    switch (taxonomy) {
      case "resource_type":
        return resource.typeIds;
      case "resource_topic":
        return resource.topicIds;
      case "resource_flag":
        return resource.flagIds;
    }
  }

  /** Published resources carrying the term: the REST `count`. */
  termCount(term: TermRecord): number {
    return this.published().filter((resource) => this.termIds(resource, term.taxonomy).includes(term.id)).length;
  }

  mediaItem(id: number): MediaRecord | undefined {
    return this.media.find((item) => item.id === id);
  }

  /**
   * The related route's merge (ADRs 0020, 0030): the source's picks in order,
   * skipping any that is not published; then, when the source has topics, the
   * newest published resources sharing one; never the source itself, never an
   * ID twice (a pick that would also be fill stays a pick), at most `count`.
   */
  related(source: ResourceRecord, count: number): RelatedItem[] {
    const items: RelatedItem[] = [];
    const seen = new Set([source.id]);
    const add = (resource: ResourceRecord, why: RelatedItem["source"]) => {
      if (items.length >= count || seen.has(resource.id) || resource.status !== "publish") return;
      seen.add(resource.id);
      items.push({ id: resource.id, source: why });
    };
    for (const id of source.picks) {
      const pick = this.resource(id);
      if (pick) add(pick, "pick");
    }
    if (source.topicIds.length > 0) {
      for (const candidate of this.published()) {
        if (candidate.topicIds.some((id) => source.topicIds.includes(id))) add(candidate, "topic");
      }
    }
    return items;
  }

  // --- Mutations -----------------------------------------------------------

  private requireResource(id: number): ResourceRecord {
    const resource = this.resource(id);
    if (!resource) throw new MockError(404, `No resource has the ID ${id}.`);
    return resource;
  }

  /**
   * Moves `modified` strictly forward. `siteTime()` has one-second resolution, so two
   * changes inside the same second would otherwise leave it unchanged; a test that a
   * change bumps `modified` must see it move every time.
   */
  private touch(resource: ResourceRecord): void {
    const now = siteTime();
    if (now > resource.modified) {
      resource.modified = now;
      return;
    }
    const next = new Date(`${resource.modified}Z`);
    next.setUTCSeconds(next.getUTCSeconds() + 1);
    resource.modified = siteTime(next);
  }

  private assertSlugFree(slug: string, except?: number): void {
    if (slug === "") throw new MockError(422, "The slug must not be empty.");
    if (slug !== slugify(slug)) throw new MockError(422, `"${slug}" is not a sanitized slug; use "${slugify(slug)}".`);
    const taken = this.resources.find((resource) => resource.slug === slug && resource.id !== except);
    if (taken) throw new MockError(409, `The slug "${slug}" belongs to resource ${taken.id}.`);
  }

  /** Changes the slug and records the old one, as WordPress writes `_wp_old_slug`. */
  renameSlug(id: number, slug: string): ResourceRecord {
    const resource = this.requireResource(id);
    this.assertSlugFree(slug, id);
    if (slug === resource.slug) return resource;
    resource.previousSlugs = [...resource.previousSlugs.filter((old) => old !== slug), resource.slug];
    resource.slug = slug;
    this.touch(resource);
    return resource;
  }

  /** Changes the title, as an editor's save does; the slug stays, as WordPress keeps it. */
  setTitle(id: number, title: string): ResourceRecord {
    const resource = this.requireResource(id);
    if (title.trim() === "") throw new MockError(422, "The title must not be empty.");
    resource.title = title;
    this.touch(resource);
    return resource;
  }

  setType(id: number, typeSlug: string): ResourceRecord {
    const resource = this.requireResource(id);
    resource.typeIds = [this.requireTerm("resource_type", typeSlug).id];
    this.touch(resource);
    return resource;
  }

  setTopics(id: number, topicSlugs: string[]): ResourceRecord {
    const resource = this.requireResource(id);
    resource.topicIds = [...new Set(topicSlugs.map((slug) => this.requireTerm("resource_topic", slug).id))];
    this.touch(resource);
    return resource;
  }

  /**
   * Replaces the picks, sanitized as the plugin sanitizes `related_picks`:
   * duplicates and the resource itself dropped, capped at 10. Unlike the
   * plugin, an ID no resource has is refused, so a spec's typo fails here.
   */
  setPicks(id: number, picks: number[]): ResourceRecord {
    const resource = this.requireResource(id);
    const unknown = picks.find((pick) => !this.resource(pick));
    if (unknown !== undefined) throw new MockError(422, `No resource has the ID ${unknown}.`);
    resource.picks = [...new Set(picks)].filter((pick) => pick !== id).slice(0, MAX_RELATED);
    this.touch(resource);
    return resource;
  }

  setStatus(id: number, status: ResourceStatus): ResourceRecord {
    const resource = this.requireResource(id);
    resource.status = status;
    this.touch(resource);
    return resource;
  }

  createResource(input: CreateResourceInput): ResourceRecord {
    if (typeof input.title !== "string" || input.title.trim() === "") {
      throw new MockError(422, "A title is needed.");
    }
    const slug = input.slug ?? slugify(input.title);
    this.assertSlugFree(slug);
    if (input.mediaId != null && !this.mediaItem(input.mediaId)) {
      throw new MockError(422, `No media item has the ID ${input.mediaId}.`);
    }
    const now = siteTime();
    const resource: ResourceRecord = {
      id: this.nextId(),
      slug,
      previousSlugs: [],
      status: "publish",
      title: input.title,
      typeIds: [this.requireTerm("resource_type", input.type).id],
      topicIds: [...new Set((input.topics ?? []).map((topic) => this.requireTerm("resource_topic", topic).id))],
      flagIds: input.featured ? [this.requireTerm("resource_flag", "featured").id] : [],
      mediaId: input.mediaId ?? null,
      summary: input.summary ?? "",
      sourceUrl: input.sourceUrl ?? "",
      content: input.content ?? null,
      picks: [],
      date: now,
      modified: now,
    };
    this.resources.push(resource);
    return resource;
  }

  private nextId(): number {
    const ids = [...this.resources.map((r) => r.id), ...this.terms.map((t) => t.id), ...this.media.map((m) => m.id)];
    return Math.max(0, ...ids) + 1;
  }

  renameTerm(taxonomy: Taxonomy, id: number, patch: RenameTermInput): TermRecord {
    const term = this.term(taxonomy, id);
    if (!term) throw new MockError(404, `No ${taxonomy} term has the ID ${id}.`);
    if (patch.slug !== undefined) {
      if (patch.slug !== slugify(patch.slug) || patch.slug === "") {
        throw new MockError(422, `"${patch.slug}" is not a sanitized slug.`);
      }
      const taken = this.termBySlug(taxonomy, patch.slug);
      if (taken && taken.id !== id) throw new MockError(409, `The slug "${patch.slug}" belongs to term ${taken.id}.`);
      term.slug = patch.slug;
    }
    if (patch.name !== undefined) {
      if (patch.name.trim() === "") throw new MockError(422, "The name must not be empty.");
      term.name = patch.name;
    }
    return term;
  }

  /** Removes the term and takes it off every resource, as `wp_delete_term()` does. */
  deleteTerm(taxonomy: Taxonomy, id: number): void {
    const term = this.term(taxonomy, id);
    if (!term) throw new MockError(404, `No ${taxonomy} term has the ID ${id}.`);
    this.terms = this.terms.filter((candidate) => candidate !== term);
    for (const resource of this.resources) {
      const ids = this.termIds(resource, taxonomy);
      const index = ids.indexOf(id);
      if (index !== -1) ids.splice(index, 1);
    }
  }

  // --- Request counters ------------------------------------------------------

  /** Counts one request by its path and query string, as the front end sent it. */
  count(pathWithQuery: string): void {
    this.counts.set(pathWithQuery, (this.counts.get(pathWithQuery) ?? 0) + 1);
  }

  requests(): RequestCounts {
    const byPath = Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const total = [...this.counts.values()].reduce((sum, n) => sum + n, 0);
    return { total, byPath };
  }

  resetRequests(): void {
    this.counts.clear();
  }

  // --- Summaries for the control API -------------------------------------------

  summarise(resource: ResourceRecord): ResourceSummary {
    const type = resource.typeIds.map((id) => this.term("resource_type", id)?.slug).find((slug) => slug !== undefined);
    return {
      id: resource.id,
      slug: resource.slug,
      previousSlugs: [...resource.previousSlugs],
      status: resource.status,
      title: resource.title,
      type: type ?? null,
      topics: resource.topicIds.map((id) => this.term("resource_topic", id)?.slug).filter((s): s is string => s !== undefined),
      featured: resource.flagIds.some((id) => this.term("resource_flag", id)?.slug === "featured"),
      mediaId: resource.mediaId,
      picks: [...resource.picks],
      date: resource.date,
      modified: resource.modified,
    };
  }

  summariseTerm(term: TermRecord): TermSummary {
    return { id: term.id, taxonomy: term.taxonomy, slug: term.slug, name: term.name, count: this.termCount(term) };
  }

  summary(origin: string): StateSummary {
    const media: MediaSummary[] = this.media.map((item) => ({
      id: item.id,
      file: item.file,
      mime: item.mime,
      width: item.width,
      height: item.height,
    }));
    return {
      origin,
      resources: this.resources.map((resource) => this.summarise(resource)),
      terms: this.terms.map((term) => this.summariseTerm(term)),
      media,
    };
  }
}
