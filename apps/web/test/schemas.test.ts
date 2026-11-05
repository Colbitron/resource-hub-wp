import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { isSlug, isTypeSlug } from "../lib/routes";
import { slugSchema, typeSlugSchema } from "../lib/wp/schemas/common";
import { parsePaginationHeaders } from "../lib/wp/schemas/pagination";
import { resolveResponseSchema, resolveResponseSchemaStrict } from "../lib/wp/schemas/resolve";
import {
  hasWpTaxonomy,
  wpResourceListSchema,
  wpResourceSchema,
  wpTermListSchema,
  wpTermSchema,
} from "../lib/wp/schemas/rest";
import {
  revalidateRequestSchema,
  revalidateRequestSchemaStrict,
  revalidateResponseErrorSchema,
  revalidateResponseOkSchema,
} from "../lib/wp/schemas/revalidate";
import { wpErrorSchema } from "../lib/wp/schemas/wp-error";

/**
 * Proves the hand-written Zod schemas against the same fixtures the JSON
 * Schemas are tested with (ADR 0010): every valid fixture in
 * `packages/ui/fixtures/valid/` parses and every invalid one is rejected. The
 * conformance runs use the strict mirrors, which reject unknown keys as the
 * JSON Schemas do; the readers the data layer parses with differ only there
 * (ADR 0010, amended 2026-11-05). Then it parses the core REST payloads
 * captured from a real WordPress.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const contractFixtures = path.resolve(here, "../../../packages/ui/fixtures");
const wpFixtures = path.join(here, "fixtures/wp");

/** Contract schemas by fixture prefix, the schema file name without `.schema.json`. */
const contractSchemas: Record<string, z.ZodType> = {
  "revalidate-request": revalidateRequestSchemaStrict,
  "revalidate-response-ok": revalidateResponseOkSchema,
  "revalidate-response-error": revalidateResponseErrorSchema,
  "resolve-response": resolveResponseSchemaStrict,
  "wp-error": wpErrorSchema,
};

/**
 * For some invalid fixtures, the path of every issue the rejection must
 * report, so the fixture is rejected for the reason its name gives and not
 * for some incidental mistake in it.
 */
const expectedIssuePaths: Record<string, (string | number)[][]> = {
  "resolve-response.extra-top-level-property.json": [[]],
  "resolve-response.reserved-type.json": [["type"]],
  "revalidate-request.duplicate-topics.json": [["events", 0, "topics"]],
  "revalidate-request.extra-key-in-previous.json": [["events", 0, "previous"]],
  "revalidate-request.previous-on-publish.json": [["events", 0, "previous"]],
  "revalidate-request.reserved-type-in-previous.json": [["events", 0, "previous", "types", 0]],
  "revalidate-request.reserved-type-term-previous-slug.json": [["events", 0, "previous", "slug"]],
  "revalidate-request.string-id.json": [["events", 0, "id"]],
  "revalidate-request.term-null-previous-on-update.json": [["events", 0, "previous"]],
  "revalidate-request.term-unknown-taxonomy.json": [["events", 0, "taxonomy"]],
  "revalidate-request.two-hundred-one-character-slug.json": [["events", 0, "slug"]],
  "revalidate-request.wrong-version.json": [["version"]],
  "revalidate-response-ok.protocol-relative-path.json": [["revalidated", 0]],
  "wp-error.string-status.json": [["data", "status"]],
};

/** The path of every issue in a failed parse, or `[]` when it succeeded. */
function issuePaths(result: { error?: z.ZodError }): PropertyKey[][] {
  return (result.error?.issues ?? []).map((issue) => issue.path);
}

/** Contract schemas the front end does not read yet: the related route is slice 4. */
const notYetImplemented = new Set(["related-response"]);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function fixtures(kind: "valid" | "invalid"): { name: string; key: string; data: unknown }[] {
  const dir = path.join(contractFixtures, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      key: name.slice(0, name.indexOf(".")),
      data: readJson(path.join(dir, name)),
    }));
}

/** A deep copy, so a test can change a fixture without touching another test's. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("contract fixtures", () => {
  const valid = fixtures("valid");
  const invalid = fixtures("invalid");

  it("every fixture names a schema that is implemented or listed as not yet", () => {
    for (const { name, key } of [...valid, ...invalid]) {
      expect(
        key in contractSchemas || notYetImplemented.has(key),
        `${name} names ${key}, which has no Zod schema`,
      ).toBe(true);
    }
  });

  it("every fixture with expected issue paths exists", () => {
    const names = new Set(invalid.map((fixture) => fixture.name));
    for (const name of Object.keys(expectedIssuePaths)) {
      expect(names.has(name), `${name} is not an invalid fixture`).toBe(true);
    }
  });

  it("every implemented schema has a valid and an invalid fixture", () => {
    for (const key of Object.keys(contractSchemas)) {
      expect(valid.some((fixture) => fixture.key === key), `${key} has no valid fixture`).toBe(
        true,
      );
      expect(
        invalid.some((fixture) => fixture.key === key),
        `${key} has no invalid fixture`,
      ).toBe(true);
    }
  });

  describe("valid", () => {
    for (const { name, key, data } of valid) {
      const schema = contractSchemas[key];
      if (schema === undefined) {
        it.skip(`${name} (not yet implemented)`, () => {});
        continue;
      }
      it(`${name} parses`, () => {
        const result = schema.safeParse(data);
        expect(result.error?.issues ?? []).toEqual([]);
      });
    }
  });

  describe("invalid", () => {
    for (const { name, key, data } of invalid) {
      const schema = contractSchemas[key];
      if (schema === undefined) {
        it.skip(`${name} (not yet implemented)`, () => {});
        continue;
      }
      it(`${name} is rejected`, () => {
        const result = schema.safeParse(data);
        expect(result.success).toBe(false);
        const paths = expectedIssuePaths[name];
        if (paths !== undefined) {
          expect(issuePaths(result)).toEqual(paths);
        }
      });
    }
  });
});

describe("revalidate request", () => {
  const twentyFive = readJson(
    path.join(contractFixtures, "valid/revalidate-request.twenty-five-events.json"),
  ) as { version: 1; events: unknown[] };

  /** The first event of the 25-event fixture with `rest_url` replaced. */
  function withRestUrl(restUrl: string) {
    const body = clone(twentyFive);
    body.events = [{ ...(body.events[0] as object), rest_url: restUrl }];
    return body;
  }

  it("rejects a batch of 26 events", () => {
    const body = clone(twentyFive);
    body.events.push({ ...(body.events[0] as object), id: 26 });
    expect(body.events).toHaveLength(26);
    const result = revalidateRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["events"]);
  });

  it("narrows previous to non-null on an update", () => {
    const body = revalidateRequestSchema.parse(
      readJson(path.join(contractFixtures, "valid/revalidate-request.update-type-change.json")),
    );
    const event = body.events[0];
    if (event?.type === "resource" && event.event === "update") {
      // Type-checks only because the union says previous is set on update.
      expect(event.previous.types[0]).toBe("webinar");
    } else {
      throw new Error("expected a resource update");
    }
  });

  it("allows topic and page as a resource_topic term's slug", () => {
    const body = {
      version: 1,
      events: [
        {
          type: "term",
          taxonomy: "resource_topic",
          event: "update",
          id: 3,
          slug: "page",
          name: "Page",
          previous: { slug: "topic", name: "Topic" },
        },
      ],
    };
    expect(revalidateRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a reserved word as a resource_type term's slug in any case or percent-encoded, as isTypeSlug does", () => {
    const term = (slug: string, previousSlug = "webinar") => ({
      version: 1,
      events: [
        {
          type: "term",
          taxonomy: "resource_type",
          event: "update",
          id: 5,
          slug,
          name: "Webinar",
          previous: { slug: previousSlug, name: "Webinar" },
        },
      ],
    });
    for (const slug of ["topic", "Topic", "PAGE", "%74opic", "%54OPIC", "pag%65"]) {
      const current = revalidateRequestSchema.safeParse(term(slug));
      expect(current.success, slug).toBe(false);
      expect(current.error?.issues[0]?.path).toEqual(["events", 0, "slug"]);
      const previous = revalidateRequestSchema.safeParse(term("webinar", slug));
      expect(previous.success, slug).toBe(false);
      expect(previous.error?.issues[0]?.path).toEqual(["events", 0, "previous", "slug"]);
    }
    // Decoded once only: `%2574opic` decodes to `%74opic`, which is not a reserved word.
    expect(revalidateRequestSchema.safeParse(term("%2574opic")).success).toBe(true);
    expect(revalidateRequestSchema.safeParse(term("topics")).success).toBe(true);
  });

  it("rejects an upper-case scheme in rest_url, as the schema's pattern does", () => {
    const result = revalidateRequestSchema.safeParse(
      withRestUrl("HTTPS://cms.example/wp-json/wp/v2/resources/1"),
    );
    expect(issuePaths(result)).toEqual([["events", 0, "rest_url"]]);
  });

  it("rejects a rest_url that format uri rejects but a WHATWG URL parser accepts", () => {
    for (const restUrl of [
      "https://cms.example/wp-json/wp/v2/resources/1 2",
      "https://cms.example/wp-json/wp/v2/resources/1|2",
      "https://cms.example/wp-json/wp/v2/resources/%zz",
      "https://cms.example/wp-json/wp/v2/resources/[1]",
      "https://cms.example/wp-json/wp/v2/resources/1?q=[1]",
      "https://cms.example/wp-json/wp/v2/resources/1#a#b",
      // [ and ] in the userinfo, which the WHATWG parser ends at the last @.
      "https://[a]@cms.example/wp-json/wp/v2/resources/1",
      "https://[::1]@cms.example/wp-json/wp/v2/resources/1",
      // Two @ before an IPv6 host: no authority in RFC 3986.
      "https://a@b@[::1]/wp-json/wp/v2/resources/1",
    ]) {
      const result = revalidateRequestSchema.safeParse(withRestUrl(restUrl));
      expect(issuePaths(result), restUrl).toEqual([["events", 0, "rest_url"]]);
    }
  });

  it("accepts an IPv6 host, with and without userinfo, as format uri does", () => {
    for (const restUrl of [
      "https://[::1]/wp-json/wp/v2/resources/1",
      "https://a@[::1]:8443/wp-json/wp/v2/resources/1",
    ]) {
      const result = revalidateRequestSchema.safeParse(withRestUrl(restUrl));
      expect(result.error?.issues ?? [], restUrl).toEqual([]);
    }
  });

  it("rejects a non-null previous on delete, unpublish and trash", () => {
    const update = readJson(
      path.join(contractFixtures, "valid/revalidate-request.update-type-change.json"),
    ) as { version: 1; events: Record<string, unknown>[] };
    for (const event of ["delete", "unpublish", "trash"]) {
      const body = clone(update);
      body.events[0] = { ...body.events[0], event };
      const result = revalidateRequestSchemaStrict.safeParse(body);
      expect(issuePaths(result), event).toEqual([["events", 0, "previous"]]);
    }
  });

  it("rejects a term update with a null previous", () => {
    const rename = readJson(
      path.join(contractFixtures, "valid/revalidate-request.type-term-rename.json"),
    ) as { version: 1; events: Record<string, unknown>[] };
    const body = clone(rename);
    body.events[0] = { ...body.events[0], previous: null };
    const result = revalidateRequestSchemaStrict.safeParse(body);
    expect(issuePaths(result)).toEqual([["events", 0, "previous"]]);
  });
});

describe("readers drop unknown keys; strict mirrors reject them", () => {
  type Body = { [key: string]: unknown; events: Record<string, unknown>[] };
  const resourceUpdate = readJson(
    path.join(contractFixtures, "valid/revalidate-request.update-type-change.json"),
  ) as Body;
  const termUpdate = readJson(
    path.join(contractFixtures, "valid/revalidate-request.type-term-rename.json"),
  ) as Body;

  const cases: { level: string; body: Body; add: (body: Body) => void; at: PropertyKey[] }[] = [
    { level: "the body", body: resourceUpdate, add: (body) => (body.added = 1), at: [] },
    {
      level: "a resource event",
      body: resourceUpdate,
      add: (body) => (body.events[0]!.added = 1),
      at: ["events", 0],
    },
    {
      level: "a resource event's previous",
      body: resourceUpdate,
      add: (body) => ((body.events[0]!.previous as Record<string, unknown>).added = 1),
      at: ["events", 0, "previous"],
    },
    {
      level: "a term event",
      body: termUpdate,
      add: (body) => (body.events[0]!.added = 1),
      at: ["events", 0],
    },
    {
      level: "a term event's previous",
      body: termUpdate,
      add: (body) => ((body.events[0]!.previous as Record<string, unknown>).added = 1),
      at: ["events", 0, "previous"],
    },
  ];

  for (const { level, body, add, at } of cases) {
    it(`an extra key on ${level}`, () => {
      const extended = clone(body);
      add(extended);
      // The reader parses it to exactly what the body without the key parses to.
      expect(revalidateRequestSchema.parse(extended)).toEqual(revalidateRequestSchema.parse(body));
      const strict = revalidateRequestSchemaStrict.safeParse(extended);
      expect(issuePaths(strict)).toEqual([at]);
      expect(strict.error?.issues[0]).toMatchObject({ code: "unrecognized_keys", keys: ["added"] });
    });
  }

  it("still holds a known key to the strict rules", () => {
    const extended = clone(resourceUpdate);
    extended.added = 1;
    extended.events[0]!.slug = "has space";
    expect(issuePaths(revalidateRequestSchema.safeParse(extended))).toEqual([
      ["events", 0, "slug"],
    ]);
  });

  it("an extra key on the resolve response", () => {
    const renamed = readJson(path.join(contractFixtures, "valid/resolve-response.renamed.json"));
    const extended = { ...(renamed as object), added: 1 };
    expect(resolveResponseSchema.parse(extended)).toEqual(resolveResponseSchema.parse(renamed));
    expect(issuePaths(resolveResponseSchemaStrict.safeParse(extended))).toEqual([[]]);
  });
});

describe("slug length", () => {
  it("counts code points for the schema's 200, as JSON Schema's maxLength does", () => {
    // Each U+1F600 is one code point and two UTF-16 code units.
    expect(slugSchema.safeParse("\u{1F600}".repeat(16)).success).toBe(true);
    expect(slugSchema.safeParse("\u{1F600}".repeat(201)).error?.issues[0]?.message).toBe(
      "must be at most 200 characters",
    );
    expect(slugSchema.safeParse("a".repeat(200)).success).toBe(true);
    expect(slugSchema.safeParse("a".repeat(201)).success).toBe(false);
  });

  it("also caps the percent-encoded form at 200, which the JSON Schema does not", () => {
    // Both are within the schema's 200 code points; encoded, 1,800 and 2,400 characters.
    for (const value of ["日".repeat(200), "\u{1F600}".repeat(200)]) {
      expect(slugSchema.safeParse(value).error?.issues[0]?.message, value).toMatch(
        /once percent-encoded/,
      );
    }
    expect(slugSchema.safeParse("日".repeat(22) + "ab").success).toBe(true);
    expect(slugSchema.safeParse("日".repeat(23)).success).toBe(false);
  });
});

describe("slug rule", () => {
  const samples = [
    "example",
    "%e6%97%a5",
    "%E6%97%A5",
    "日本",
    "\u{1F600}",
    "topic",
    "page",
    "a?b#c",
    "100%",
    "",
    "a b",
    "a/b",
    "a".repeat(200),
    "a".repeat(201),
    "日".repeat(22) + "ab",
    "日".repeat(23),
    "日".repeat(200),
    "Topic",
    "PAGE",
    "ABC",
    ".",
    "..",
    "%2e",
    "%2E%2e",
    "\ud800",
    "a\udc00b",
  ];

  it("is the route predicates' rule, so the schema and the builders never disagree", () => {
    for (const value of samples) {
      expect(slugSchema.safeParse(value).success, JSON.stringify(value)).toBe(isSlug(value));
      expect(typeSlugSchema.safeParse(value).success, JSON.stringify(value)).toBe(
        isTypeSlug(value),
      );
    }
  });

  it("rejects a lone surrogate, a dot segment and an over-long encoded form, which the JSON Schema allows", () => {
    for (const value of ["\ud800", ".", "..", "%2e", "日".repeat(200)]) {
      expect(slugSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("reports one issue for each bad slug", () => {
    for (const value of ["", "a b", "a".repeat(201), "\ud800", "."]) {
      expect(slugSchema.safeParse(value).error?.issues, JSON.stringify(value)).toHaveLength(1);
    }
    expect(typeSlugSchema.safeParse("topic").error?.issues).toHaveLength(1);
    expect(typeSlugSchema.safeParse("Topic").error?.issues).toHaveLength(1);
  });
});

describe("core REST fixtures captured from WordPress", () => {
  const list = readJson(path.join(wpFixtures, "resources.list.json"));
  const single = readJson(path.join(wpFixtures, "resource.single.json"));

  it("parses the resource collection with _embed", () => {
    const resources = wpResourceListSchema.parse(list);
    expect(resources).toHaveLength(2);
    const [withImage, withoutImage] = resources;
    expect(withImage?._embedded["wp:featuredmedia"][0]).toMatchObject({
      source_url: "https://cms.example/wp-content/uploads/2026/11/w-logo-blue.png",
      media_details: { width: 80, height: 80, sizes: {} },
    });
    expect(withoutImage?._embedded["wp:featuredmedia"]).toEqual([]);
  });

  it("parses a single resource and keeps only the fields it names", () => {
    const resource = wpResourceSchema.parse(single);
    expect(resource.slug).toBe("a-field-guide-to-revalidation");
    expect(resource.resource_type).toHaveLength(1);
    expect(resource._embedded["wp:term"].flat().map((term) => term.taxonomy)).toContain(
      "resource_type",
    );
    expect(resource).not.toHaveProperty("class_list");
    expect(resource).not.toHaveProperty("_links");
    expect(resource.meta).not.toHaveProperty("footnotes");
  });

  it("parses each taxonomy's term list", () => {
    for (const taxonomy of ["resource_topic", "resource_type", "resource_flag"]) {
      const terms = wpTermListSchema.parse(
        readJson(path.join(wpFixtures, `${taxonomy}.list.json`)),
      );
      expect(terms.length).toBeGreaterThan(0);
      expect(terms.every((term) => term.taxonomy === taxonomy)).toBe(true);
    }
  });

  it("rejects a resource missing its slug", () => {
    const resource = clone(single) as Record<string, unknown>;
    delete resource.slug;
    const result = wpResourceSchema.safeParse(resource);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["slug"]);
  });

  it("parses a published resource with no terms, which core embeds no wp:term for", () => {
    const resource = clone(single) as Record<string, unknown> & {
      _embedded: Record<string, unknown>;
    };
    resource.resource_type = [];
    resource.resource_topic = [];
    resource.resource_flag = [];
    delete resource._embedded["wp:term"];
    const parsed = wpResourceSchema.parse(resource);
    expect(parsed._embedded["wp:term"]).toEqual([]);
    expect(parsed._embedded["wp:featuredmedia"]).toHaveLength(1);
  });

  it("parses a resource with nothing embedded, which core sends without _embedded", () => {
    const resource = clone(single) as Record<string, unknown>;
    resource.resource_type = [];
    resource.resource_topic = [];
    resource.resource_flag = [];
    resource.featured_media = 0;
    delete resource._embedded;
    const parsed = wpResourceSchema.parse(resource);
    expect(parsed._embedded).toEqual({ "wp:term": [], "wp:featuredmedia": [] });
  });

  it("gives every parse its own defaulted and caught arrays", () => {
    const bare = clone(single) as Record<string, unknown>;
    delete bare._embedded;
    const first = wpResourceSchema.parse(bare);
    first._embedded["wp:term"].push([]);
    first._embedded["wp:featuredmedia"].push(null);
    const second = wpResourceSchema.parse(bare);
    expect(second._embedded).toEqual({ "wp:term": [], "wp:featuredmedia": [] });
    expect(second._embedded["wp:term"]).not.toBe(first._embedded["wp:term"]);

    const caught = clone(single) as { _embedded: Record<string, unknown> };
    caught._embedded["wp:featuredmedia"] = { id: 16 };
    wpResourceSchema.parse(caught)._embedded["wp:featuredmedia"].push(null);
    expect(wpResourceSchema.parse(caught)._embedded["wp:featuredmedia"]).toEqual([]);

    const svg = withFeaturedMedia({ ...media, media_details: {} });
    const firstImage = wpResourceSchema.parse(svg)._embedded["wp:featuredmedia"][0];
    firstImage!.media_details.sizes.thumbnail = {
      source_url: media.source_url as string,
      width: 1,
      height: 1,
    };
    const secondImage = wpResourceSchema.parse(svg)._embedded["wp:featuredmedia"][0];
    expect(secondImage?.media_details.sizes).toEqual({});
  });

  /** The single resource with its one featured-media entry replaced. */
  function withFeaturedMedia(entry: unknown) {
    const resource = clone(single) as { _embedded: Record<string, unknown> };
    resource._embedded["wp:featuredmedia"] = [entry];
    return resource;
  }

  const media = (
    (single as { _embedded: Record<string, unknown> })._embedded["wp:featuredmedia"] as Record<
      string,
      unknown
    >[]
  )[0]!;

  it("parses an image without dimensions, as core sends an SVG, leaving width and height unset", () => {
    const parsed = wpResourceSchema.parse(withFeaturedMedia({ ...media, media_details: {} }));
    const image = parsed._embedded["wp:featuredmedia"][0];
    expect(image?.media_details).toEqual({ sizes: {} });
    expect(image?.source_url).toBe(media.source_url);
  });

  it("turns a featured image core could not embed, sent as its error, into no image", () => {
    const parsed = wpResourceSchema.parse(
      withFeaturedMedia({
        code: "rest_forbidden",
        message: "Sorry, you are not allowed to do that.",
        data: { status: 401 },
      }),
    );
    expect(parsed._embedded["wp:featuredmedia"]).toEqual([null]);
  });

  it("turns an unusable featured image into no image instead of failing the resource", () => {
    for (const entry of [
      { ...media, source_url: 42 },
      { ...media, media_details: { width: 0, height: 80 } },
      { ...media, media_details: { sizes: { thumbnail: { source_url: "/relative" } } } },
      "not an object",
    ]) {
      const result = wpResourceSchema.safeParse(withFeaturedMedia(entry));
      expect(result.error?.issues ?? []).toEqual([]);
      expect(result.data?._embedded["wp:featuredmedia"]).toEqual([null]);
    }
    const notAnArray = clone(single) as { _embedded: Record<string, unknown> };
    notAnArray._embedded["wp:featuredmedia"] = { id: 16 };
    expect(wpResourceSchema.parse(notAnArray)._embedded["wp:featuredmedia"]).toEqual([]);
  });

  it("drops embedded terms from a taxonomy another plugin attaches, even malformed ones", () => {
    const resource = clone(single) as { _embedded: { "wp:term": unknown[][] } };
    resource._embedded["wp:term"].push([
      { id: 99, name: "Spring", slug: "spring", taxonomy: "season" },
      { id: 100, name: "", slug: "Not A Slug!", taxonomy: "season" },
      { id: "101", taxonomy: 7 },
      "not an object",
      null,
    ]);
    const result = wpResourceSchema.safeParse(resource);
    expect(result.error?.issues ?? []).toEqual([]);
    const terms = result.data!._embedded["wp:term"].flat();
    expect(terms.map((term) => term.id)).toEqual([9, 11, 4, 2]);
    expect(terms.every((term) => hasWpTaxonomy(term))).toBe(true);
  });

  it("still rejects a malformed term of a known taxonomy", () => {
    const resource = clone(single) as { _embedded: { "wp:term": Record<string, unknown>[][] } };
    const [first] = resource._embedded["wp:term"];
    first![0] = { ...first![0], slug: "Not A Slug!" };
    expect(issuePaths(wpResourceSchema.safeParse(resource))).toEqual([
      ["_embedded", "wp:term", 0, 0, "slug"],
    ]);
  });

  it("narrows only objects whose taxonomy is one of the three", () => {
    for (const taxonomy of ["resource_topic", "resource_type", "resource_flag"]) {
      expect(hasWpTaxonomy({ taxonomy }), taxonomy).toBe(true);
    }
    for (const value of [{ taxonomy: "season" }, { taxonomy: 7 }, {}, null, "resource_topic"]) {
      expect(hasWpTaxonomy(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("rejects a date or modified with a trailing Z, which WordPress never writes", () => {
    for (const key of ["date", "modified"]) {
      const resource = { ...(single as object), [key]: "2026-11-05T09:31:32Z" };
      expect(issuePaths(wpResourceSchema.safeParse(resource)), key).toEqual([[key]]);
    }
  });

  it("rejects a term whose slug is not a string", () => {
    const [term] = readJson(path.join(wpFixtures, "resource_topic.list.json")) as Record<
      string,
      unknown
    >[];
    const result = wpTermSchema.safeParse({ ...term, slug: 42 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["slug"]);
  });
});

describe("parsePaginationHeaders", () => {
  it("reads the captured headers", () => {
    const captured = readJson(path.join(wpFixtures, "resources.list.headers.json")) as Record<
      string,
      string
    >;
    expect(parsePaginationHeaders(new Headers(captured))).toEqual({ total: 12, totalPages: 6 });
  });

  it("reads the headers case-insensitively", () => {
    const headers = new Headers({ "x-wp-total": "0", "x-wp-totalpages": "0" });
    expect(parsePaginationHeaders(headers)).toEqual({ total: 0, totalPages: 0 });
  });

  it("names a header that is missing or not a number", () => {
    /** The issue paths of the ZodError `headers` throws. */
    function thrownPaths(headers: Record<string, string>): PropertyKey[][] {
      try {
        parsePaginationHeaders(new Headers(headers));
      } catch (error) {
        return (error as z.ZodError).issues.map((issue) => issue.path);
      }
      throw new Error("expected parsePaginationHeaders to throw");
    }
    expect(thrownPaths({ "X-WP-Total": "12" })).toEqual([["X-WP-TotalPages"]]);
    expect(thrownPaths({ "X-WP-Total": "twelve", "X-WP-TotalPages": "6" })).toEqual([
      ["X-WP-Total"],
    ]);
    expect(thrownPaths({ "X-WP-Total": "-1", "X-WP-TotalPages": "6" })).toEqual([["X-WP-Total"]]);
  });
});
