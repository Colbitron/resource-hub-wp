import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Next.js's own encoder for tags, used here to prove a tag built by lib/tags.ts
// is the form Next.js stores and compares. An internal module: if an upgrade
// moves it, this import fails loudly rather than the check going quiet.
import { encodeHeaderSafe } from "next/dist/server/lib/encode-header-safe";
import { describe, expect, it } from "vitest";

import type { ListingFilter } from "../lib/routes";
import {
  RESOURCES_TAG,
  TERMS_TAG,
  eventsToInvalidations,
  listingTags,
  resolveTags,
  resourceFetchTags,
  resourceTag,
  taxonomyListTags,
  termLookupTags,
  topicTag,
  typeTag,
  type ResourceEvent,
  type ResourceState,
  type RevalidationEvent,
  type TermEvent,
  type TermState,
} from "../lib/tags";
import {
  resourceEventSchema,
  revalidateRequestSchema,
  termEventSchema,
} from "../lib/wp/schemas/revalidate";

const REST = "https://cms.example/wp-json/wp/v2/resources/";

interface ResourceInput {
  readonly event: ResourceEvent["event"];
  readonly id?: number;
  readonly slug?: string;
  readonly rest_url?: string;
  readonly types?: readonly [string];
  readonly topics?: readonly string[];
  readonly previous?: ResourceState | null;
}

/** A resource event, parsed by the route's reader schema so every test input is schema-valid. */
function resource(overrides: ResourceInput): ResourceEvent {
  return resourceEventSchema.parse({
    type: "resource",
    id: 123,
    slug: "example",
    rest_url: `${REST}123`,
    types: ["webinar"],
    topics: ["performance"],
    previous: null,
    ...overrides,
  });
}

interface TermInput {
  readonly event: TermEvent["event"];
  readonly taxonomy: TermEvent["taxonomy"];
  readonly id?: number;
  readonly slug?: string;
  readonly name?: string;
  readonly previous?: TermState | null;
}

/** A term event, parsed by the route's reader schema so every test input is schema-valid. */
function term(overrides: TermInput): TermEvent {
  return termEventSchema.parse({
    type: "term",
    id: 45,
    slug: "performance",
    name: "Performance",
    previous: null,
    ...overrides,
  });
}

describe("tag builders", () => {
  it("build the five tags", () => {
    expect(RESOURCES_TAG).toBe("resources");
    expect(TERMS_TAG).toBe("terms");
    expect(resourceTag("example")).toBe("resource:example");
    expect(topicTag("performance")).toBe("topic:performance");
    expect(typeTag("webinar")).toBe("type:webinar");
  });

  it("throw on a slug the schema rejects", () => {
    expect(() => resourceTag("")).toThrow(RangeError);
    expect(() => topicTag("a b")).toThrow(RangeError);
    expect(() => typeTag("a/b")).toThrow(RangeError);
  });

  it("give raw, upper-case and lower-case slugs one tag, in WordPress's lower-case hex", () => {
    for (const slug of ["日", "%E6%97%A5", "%e6%97%a5"]) {
      expect(resourceTag(slug)).toBe("resource:%e6%97%a5");
      expect(topicTag(slug)).toBe("topic:%e6%97%a5");
      expect(typeTag(slug)).toBe("type:%e6%97%a5");
    }
  });

  it("build tags Next.js's encodeHeaderSafe leaves unchanged, so they match what it stores", () => {
    for (const slug of ["日", "%E6%97%A5", "%e6%97%a5", "\u{1F600}", "a?b#c", "100%", "example"]) {
      for (const tag of [resourceTag(slug), topicTag(slug), typeTag(slug)]) {
        expect(encodeHeaderSafe(tag), slug).toBe(tag);
      }
    }
    // The bug this prevents: Next.js encodes a raw tag in upper-case hex.
    expect(encodeHeaderSafe("resource:日")).toBe("resource:%E6%97%A5");
  });

  it("stay within Next.js's 256-character tag limit for a 200-character slug", () => {
    const ascii = "a".repeat(200);
    // A WordPress-stored non-ASCII slug at the column's width: 22 characters, 198 bytes encoded.
    const encoded = `${"%e6%97%a5".repeat(22)}ab`;
    expect(encoded).toHaveLength(200);
    for (const slug of [ascii, encoded]) {
      for (const tag of [resourceTag(slug), topicTag(slug), typeTag(slug)]) {
        expect(tag.length, tag).toBeLessThanOrEqual(256);
      }
    }
  });

  it("throw on a reserved type slug", () => {
    expect(() => typeTag("topic")).toThrow(RangeError);
    expect(() => typeTag("page")).toThrow(RangeError);
    expect(topicTag("topic")).toBe("topic:topic");
  });
});

describe("eventsToInvalidations", () => {
  it("covers a publish with previous null", () => {
    expect(
      eventsToInvalidations([
        resource({ event: "publish", topics: ["performance", "accessibility"] }),
      ]),
    ).toEqual({
      tags: [
        "resource:example",
        "resources",
        "topic:accessibility",
        "topic:performance",
        "type:webinar",
      ],
      paths: [
        "/resources/",
        "/resources/topic/accessibility/",
        "/resources/topic/performance/",
        "/resources/webinar/",
        "/resources/webinar/example/",
        "/resources/webinar/topic/accessibility/",
        "/resources/webinar/topic/performance/",
      ],
    });
  });

  it("covers a resource with no topics", () => {
    expect(eventsToInvalidations([resource({ event: "publish", topics: [] })])).toEqual({
      tags: ["resource:example", "resources", "type:webinar"],
      paths: ["/resources/", "/resources/webinar/", "/resources/webinar/example/"],
    });
  });

  it("covers both states of an update that changes slug, type and topic", () => {
    expect(
      eventsToInvalidations([
        resource({
          event: "update",
          slug: "new-example",
          types: ["podcast"],
          topics: ["accessibility"],
          previous: { slug: "old-example", types: ["webinar"], topics: ["performance"] },
        }),
      ]),
    ).toEqual({
      tags: [
        "resource:new-example",
        "resource:old-example",
        "resources",
        "topic:accessibility",
        "topic:performance",
        "type:podcast",
        "type:webinar",
      ],
      paths: [
        "/resources/",
        "/resources/podcast/",
        "/resources/podcast/new-example/",
        "/resources/podcast/topic/accessibility/",
        "/resources/topic/accessibility/",
        "/resources/topic/performance/",
        "/resources/webinar/",
        "/resources/webinar/old-example/",
        "/resources/webinar/topic/performance/",
      ],
    });
  });

  it("covers only the pre-request state of a trash that followed an update in the same request", () => {
    // ADR 0014: the hook renamed the resource to renamed-example and then
    // trashed it; the merged event carries the state from before the request
    // at the top level, and previous is null. renamed-example was never
    // public, so nothing names it.
    const result = eventsToInvalidations([
      resource({
        event: "trash",
        slug: "original-example",
        types: ["webinar"],
        topics: ["performance"],
        previous: null,
      }),
    ]);
    expect(result).toEqual({
      tags: ["resource:original-example", "resources", "topic:performance", "type:webinar"],
      paths: [
        "/resources/",
        "/resources/topic/performance/",
        "/resources/webinar/",
        "/resources/webinar/original-example/",
        "/resources/webinar/topic/performance/",
      ],
    });
    expect(result.tags.join(" ")).not.toContain("renamed");
  });

  it("gives remove events the same invalidations as refresh events", () => {
    const refresh = eventsToInvalidations([resource({ event: "publish" })]);
    for (const event of ["unpublish", "trash", "delete"] as const) {
      expect(eventsToInvalidations([resource({ event })])).toEqual(refresh);
    }
  });

  it("covers an update whose previous.types stands in the current type (ADR 0016)", () => {
    expect(
      eventsToInvalidations([
        resource({
          event: "update",
          slug: "example",
          types: ["webinar"],
          topics: ["performance"],
          previous: { slug: "draft-example", types: ["webinar"], topics: ["accessibility"] },
        }),
      ]),
    ).toEqual({
      tags: [
        "resource:draft-example",
        "resource:example",
        "resources",
        "topic:accessibility",
        "topic:performance",
        "type:webinar",
      ],
      paths: [
        "/resources/",
        "/resources/topic/accessibility/",
        "/resources/topic/performance/",
        "/resources/webinar/",
        "/resources/webinar/draft-example/",
        "/resources/webinar/example/",
        "/resources/webinar/topic/accessibility/",
        "/resources/webinar/topic/performance/",
      ],
    });
  });

  it("covers the current and previous slug of a renamed topic", () => {
    expect(
      eventsToInvalidations([
        term({
          taxonomy: "resource_topic",
          event: "update",
          slug: "web-performance",
          name: "Web performance",
          previous: { slug: "performance", name: "Performance" },
        }),
      ]),
    ).toEqual({
      tags: ["resources", "terms", "topic:performance", "topic:web-performance"],
      paths: ["/resources/", "/resources/topic/performance/", "/resources/topic/web-performance/"],
    });
  });

  it("covers the current and previous slug of a renamed type", () => {
    expect(
      eventsToInvalidations([
        term({
          taxonomy: "resource_type",
          event: "update",
          slug: "online-event",
          name: "Online event",
          previous: { slug: "webinar", name: "Webinar" },
        }),
      ]),
    ).toEqual({
      tags: ["resources", "terms", "type:online-event", "type:webinar"],
      paths: ["/resources/", "/resources/online-event/", "/resources/webinar/"],
    });
  });

  it("covers a term name change that keeps the slug", () => {
    expect(
      eventsToInvalidations([
        term({
          taxonomy: "resource_topic",
          event: "update",
          name: "Speed",
          previous: { slug: "performance", name: "Performance" },
        }),
      ]),
    ).toEqual({
      tags: ["resources", "terms", "topic:performance"],
      paths: ["/resources/", "/resources/topic/performance/"],
    });
  });

  it("covers a term delete", () => {
    expect(
      eventsToInvalidations([term({ taxonomy: "resource_topic", event: "delete" })]),
    ).toEqual({
      tags: ["resources", "terms", "topic:performance"],
      paths: ["/resources/", "/resources/topic/performance/"],
    });
    expect(
      eventsToInvalidations([
        term({ taxonomy: "resource_type", event: "delete", slug: "webinar", name: "Webinar" }),
      ]),
    ).toEqual({
      tags: ["resources", "terms", "type:webinar"],
      paths: ["/resources/", "/resources/webinar/"],
    });
  });

  it("covers a term create like any other term event", () => {
    expect(
      eventsToInvalidations([
        term({ taxonomy: "resource_topic", event: "create", slug: "security", name: "Security" }),
      ]),
    ).toEqual({
      tags: ["resources", "terms", "topic:security"],
      paths: ["/resources/", "/resources/topic/security/"],
    });
  });

  it("returns nothing for no events", () => {
    expect(eventsToInvalidations([])).toEqual({ tags: [], paths: [] });
  });

  it("deduplicates and sorts across a full 25-event batch", () => {
    const events: RevalidationEvent[] = [];
    for (let i = 1; i <= 23; i++) {
      events.push(
        resource({
          event: i % 2 === 0 ? "update" : "publish",
          id: i,
          slug: `resource-${String(i).padStart(2, "0")}`,
          rest_url: `${REST}${i}`,
          previous:
            i % 2 === 0
              ? {
                  slug: `resource-${String(i).padStart(2, "0")}`,
                  types: ["webinar"],
                  topics: ["accessibility"],
                }
              : null,
        }),
      );
    }
    events.push(
      term({ taxonomy: "resource_topic", event: "update", previous: { slug: "performance", name: "Old" } }),
      term({ taxonomy: "resource_type", event: "create", id: 46, slug: "webinar", name: "Webinar" }),
    );
    expect(events).toHaveLength(25);

    const { tags, paths } = eventsToInvalidations(events);
    const slugs = Array.from({ length: 23 }, (_, i) => `resource-${String(i + 1).padStart(2, "0")}`);

    expect(tags).toEqual([
      ...slugs.map((slug) => `resource:${slug}`),
      "resources",
      "terms",
      "topic:accessibility",
      "topic:performance",
      "type:webinar",
    ]);
    expect(paths).toEqual([
      "/resources/",
      "/resources/topic/accessibility/",
      "/resources/topic/performance/",
      "/resources/webinar/",
      ...slugs.map((slug) => `/resources/webinar/${slug}/`),
      "/resources/webinar/topic/accessibility/",
      "/resources/webinar/topic/performance/",
    ]);
    expect(new Set(tags).size).toBe(tags.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect([...tags].sort()).toEqual(tags);
    expect([...paths].sort()).toEqual(paths);
  });

  it("ends every path with a slash and never starts one with //", () => {
    const { paths } = eventsToInvalidations([
      resource({
        event: "update",
        previous: { slug: "old", types: ["podcast"], topics: ["a", "b"] },
      }),
    ]);
    for (const path of paths) {
      expect(path).toMatch(/^\/(?!\/)\S*\/$/);
    }
  });

  it("throws a RangeError on an event that is type-correct but schema-invalid", () => {
    // Both values typecheck as a ResourceEvent; the schema rejects both.
    const reserved = { ...resource({ event: "publish" }), types: ["page"] } as ResourceEvent;
    const loneSurrogate: ResourceEvent = { ...resource({ event: "publish" }), slug: "\ud800" };
    expect(resourceEventSchema.safeParse(loneSurrogate).success).toBe(false);
    expect(() => eventsToInvalidations([reserved])).toThrow(RangeError);
    expect(() => eventsToInvalidations([loneSurrogate])).toThrow(RangeError);
    const loneTerm: TermEvent = {
      ...term({ taxonomy: "resource_topic", event: "create" }),
      slug: "\udfff",
    };
    expect(() => eventsToInvalidations([loneTerm])).toThrow(RangeError);
  });

  it("never throws on a batch the route's schema accepts: every valid contract fixture", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const valid = path.resolve(here, "../../../packages/ui/fixtures/valid");
    const files = readdirSync(valid).filter((file) => file.startsWith("revalidate-request."));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const body = revalidateRequestSchema.parse(
        JSON.parse(readFileSync(path.join(valid, file), "utf8")),
      );
      expect(() => eventsToInvalidations(body.events), file).not.toThrow();
    }
  });

  it("covers a type change that keeps a topic", () => {
    expect(
      eventsToInvalidations([
        resource({
          event: "update",
          types: ["podcast"],
          topics: ["performance"],
          previous: { slug: "example", types: ["webinar"], topics: ["performance"] },
        }),
      ]),
    ).toEqual({
      tags: ["resource:example", "resources", "topic:performance", "type:podcast", "type:webinar"],
      paths: [
        "/resources/",
        "/resources/podcast/",
        "/resources/podcast/example/",
        "/resources/podcast/topic/performance/",
        "/resources/topic/performance/",
        "/resources/webinar/",
        "/resources/webinar/example/",
        "/resources/webinar/topic/performance/",
      ],
    });
  });

  it("round-trips a non-ASCII slug: the event's tag and path are the page's", () => {
    // WordPress sends the slug as it stores it; the page gets it from its URL,
    // raw or encoded depending on the caller. All give one tag and one path.
    const { tags, paths } = eventsToInvalidations([
      resource({ event: "publish", slug: "%e6%97%a5%e6%9c%ac", topics: ["%e6%97%a5"] }),
    ]);
    for (const slug of ["日本", "%E6%97%A5%E6%9C%AC", "%e6%97%a5%e6%9c%ac"]) {
      expect(tags).toContain(resourceFetchTags("webinar", slug)[0]);
    }
    expect(tags).toContain(listingTags({ topic: "日" })[0]);
    expect(paths).toContain("/resources/webinar/%e6%97%a5%e6%9c%ac/");
    expect(paths).toContain("/resources/topic/%e6%97%a5/");
    expect(paths.map((p) => decodeURIComponent(p))).toContain("/resources/webinar/日本/");
  });
});

describe("fetch tags (ADR 0046)", () => {
  it("tag every listing page with its filter's tags and terms", () => {
    expect(listingTags()).toEqual(["resources", "terms"]);
    expect(listingTags({ type: "webinar" })).toEqual(["type:webinar", "terms"]);
    expect(listingTags({ topic: "performance" })).toEqual(["topic:performance", "terms"]);
    expect(listingTags({ type: "webinar", topic: "performance" })).toEqual([
      "type:webinar",
      "topic:performance",
      "terms",
    ]);
  });

  it("tag a resource fetch with its slug, the URL's type segment and terms", () => {
    expect(resourceFetchTags("webinar", "example")).toEqual([
      "resource:example",
      "type:webinar",
      "terms",
    ]);
  });

  it("tag a term lookup with the term's own tag only", () => {
    expect(termLookupTags("resource_topic", "page")).toEqual(["topic:page"]);
    expect(termLookupTags("resource_type", "webinar")).toEqual(["type:webinar"]);
    expect(() => termLookupTags("resource_type", "page")).toThrow(RangeError);
  });

  it("tag resolve with resources and the filter bar's taxonomy lists with terms", () => {
    expect(resolveTags()).toEqual(["resources"]);
    expect(taxonomyListTags()).toEqual(["terms"]);
  });
});

describe("the tagging rule: every page a change shows on shares a tag with its invalidations", () => {
  const states: ResourceState[] = [
    { slug: "example", types: ["webinar"], topics: ["performance"] },
    { slug: "no-topics", types: ["podcast"], topics: [] },
    { slug: "many", types: ["guide"], topics: ["performance", "accessibility", "security"] },
    { slug: "%e6%97%a5%e6%9c%ac", types: ["%e8%a8%98"], topics: ["%e6%97%a5", "page", "topic"] },
  ];

  /** Every listing a resource in `state` appears on, as the filters a page fetches with. */
  function listingsOf(state: ResourceState): ListingFilter[] {
    const [type] = state.types;
    return [
      {},
      { type },
      ...state.topics.map((topic) => ({ topic })),
      ...state.topics.map((topic) => ({ type, topic })),
    ];
  }

  /** Every resource event that concerns `state`, as its current or its previous state. */
  function eventsOn(state: ResourceState): ResourceEvent[] {
    const other: ResourceState = { slug: "elsewhere", types: ["other"], topics: ["unrelated"] };
    return [
      ...(["publish", "unpublish", "trash", "delete"] as const).map((event) =>
        resource({ event, ...state }),
      ),
      resource({ event: "update", ...state, previous: state }),
      resource({ event: "update", ...state, previous: other }),
      resource({ event: "update", ...other, previous: state }),
    ];
  }

  function shares(fetchTags: readonly string[], invalidated: readonly string[]): boolean {
    return fetchTags.some((tag) => invalidated.includes(tag));
  }

  it("holds for resource events, on every listing and the resource's own page", () => {
    for (const state of states) {
      for (const event of eventsOn(state)) {
        const { tags } = eventsToInvalidations([event]);
        for (const filter of listingsOf(state)) {
          expect(shares(listingTags(filter), tags), `${event.event} ${JSON.stringify(filter)}`).toBe(
            true,
          );
        }
        expect(shares(resourceFetchTags(state.types[0], state.slug), tags)).toBe(true);
        expect(shares(resolveTags(), tags)).toBe(true);
      }
    }
  });

  it("holds for term events, on every page that shows a term", () => {
    const events: TermEvent[] = [
      term({ taxonomy: "resource_topic", event: "create" }),
      term({ taxonomy: "resource_topic", event: "delete" }),
      term({
        taxonomy: "resource_topic",
        event: "update",
        previous: { slug: "old", name: "Old" },
      }),
      term({
        taxonomy: "resource_type",
        event: "update",
        slug: "online-event",
        name: "Online event",
        previous: { slug: "webinar", name: "Webinar" },
      }),
    ];
    for (const event of events) {
      const { tags, paths } = eventsToInvalidations([event]);
      expect(paths).toContain("/resources/");
      for (const state of states) {
        for (const filter of listingsOf(state)) {
          expect(shares(listingTags(filter), tags)).toBe(true);
        }
        expect(shares(resourceFetchTags(state.types[0], state.slug), tags)).toBe(true);
      }
      expect(shares(taxonomyListTags(), tags)).toBe(true);
      expect(shares(resolveTags(), tags)).toBe(true);
    }
  });

  it("clears a cached term miss with the term's create", () => {
    const { tags } = eventsToInvalidations([
      term({ taxonomy: "resource_topic", event: "create", slug: "new-topic", name: "New" }),
    ]);
    expect(shares(termLookupTags("resource_topic", "new-topic"), tags)).toBe(true);
  });

  it("does not let a resource event clear terms", () => {
    for (const state of states) {
      for (const event of eventsOn(state)) {
        expect(eventsToInvalidations([event]).tags).not.toContain(TERMS_TAG);
      }
    }
  });
});
