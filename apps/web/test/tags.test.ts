import { describe, expect, it } from "vitest";

import {
  RESOURCES_TAG,
  eventsToInvalidations,
  resourceTag,
  topicTag,
  typeTag,
  type ResourceEvent,
  type ResourceState,
  type RevalidationEvent,
  type TermEvent,
  type TermState,
} from "../lib/tags";
import { resourceEventSchema, termEventSchema } from "../lib/wp/schemas/revalidate";

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
  it("build the four tags", () => {
    expect(RESOURCES_TAG).toBe("resources");
    expect(resourceTag("example")).toBe("resource:example");
    expect(topicTag("performance")).toBe("topic:performance");
    expect(typeTag("webinar")).toBe("type:webinar");
  });

  it("throw on a slug the schema rejects", () => {
    expect(() => resourceTag("")).toThrow(RangeError);
    expect(() => topicTag("a b")).toThrow(RangeError);
    expect(() => typeTag("a/b")).toThrow(RangeError);
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
      tags: ["resources", "topic:performance", "topic:web-performance"],
      paths: ["/resources/topic/performance/", "/resources/topic/web-performance/"],
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
      tags: ["resources", "type:online-event", "type:webinar"],
      paths: ["/resources/online-event/", "/resources/webinar/"],
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
      tags: ["resources", "topic:performance"],
      paths: ["/resources/topic/performance/"],
    });
  });

  it("covers a term delete", () => {
    expect(
      eventsToInvalidations([term({ taxonomy: "resource_topic", event: "delete" })]),
    ).toEqual({
      tags: ["resources", "topic:performance"],
      paths: ["/resources/topic/performance/"],
    });
    expect(
      eventsToInvalidations([
        term({ taxonomy: "resource_type", event: "delete", slug: "webinar", name: "Webinar" }),
      ]),
    ).toEqual({
      tags: ["resources", "type:webinar"],
      paths: ["/resources/webinar/"],
    });
  });

  it("covers a term create like any other term event", () => {
    expect(
      eventsToInvalidations([
        term({ taxonomy: "resource_topic", event: "create", slug: "security", name: "Security" }),
      ]),
    ).toEqual({
      tags: ["resources", "topic:security"],
      paths: ["/resources/topic/security/"],
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

  it("throws on a slug the schema would have rejected", () => {
    const invalid = { ...resource({ event: "publish" }), types: ["page"] } as ResourceEvent;
    expect(() => eventsToInvalidations([invalid])).toThrow(RangeError);
  });
});
