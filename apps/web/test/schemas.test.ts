import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { slugSchema } from "../lib/wp/schemas/common";
import { parsePaginationHeaders } from "../lib/wp/schemas/pagination";
import { resolveResponseSchema } from "../lib/wp/schemas/resolve";
import {
  wpResourceListSchema,
  wpResourceSchema,
  wpTermListSchema,
  wpTermSchema,
} from "../lib/wp/schemas/rest";
import {
  revalidateRequestSchema,
  revalidateResponseErrorSchema,
  revalidateResponseOkSchema,
} from "../lib/wp/schemas/revalidate";
import { wpErrorSchema } from "../lib/wp/schemas/wp-error";

/**
 * Proves the hand-written Zod schemas against the same fixtures the JSON
 * Schemas are tested with (ADR 0010): every valid fixture in
 * `packages/ui/fixtures/valid/` parses and every invalid one is rejected. Then
 * it parses the core REST payloads captured from a real WordPress.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const contractFixtures = path.resolve(here, "../../../packages/ui/fixtures");
const wpFixtures = path.join(here, "fixtures/wp");

/** Contract schemas by fixture prefix, the schema file name without `.schema.json`. */
const contractSchemas: Record<string, z.ZodType> = {
  "revalidate-request": revalidateRequestSchema,
  "revalidate-response-ok": revalidateResponseOkSchema,
  "revalidate-response-error": revalidateResponseErrorSchema,
  "resolve-response": resolveResponseSchema,
  "wp-error": wpErrorSchema,
};

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
        expect(schema.safeParse(data).success).toBe(false);
      });
    }
  });
});

describe("revalidate request", () => {
  const twentyFive = readJson(
    path.join(contractFixtures, "valid/revalidate-request.twenty-five-events.json"),
  ) as { version: 1; events: unknown[] };

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

  it("rejects an upper-case scheme in rest_url, as the schema's pattern does", () => {
    const body = clone(twentyFive);
    (body.events[0] as { rest_url: string }).rest_url =
      "HTTPS://cms.example/wp-json/wp/v2/resources/1";
    expect(revalidateRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a rest_url that format uri rejects but a WHATWG URL parser accepts", () => {
    for (const restUrl of [
      "https://cms.example/wp-json/wp/v2/resources/1 2",
      "https://cms.example/wp-json/wp/v2/resources/1|2",
      "https://cms.example/wp-json/wp/v2/resources/%zz",
      "https://cms.example/wp-json/wp/v2/resources/[1]",
      "https://cms.example/wp-json/wp/v2/resources/1?q=[1]",
      "https://cms.example/wp-json/wp/v2/resources/1#a#b",
    ]) {
      const body = clone(twentyFive);
      (body.events[0] as { rest_url: string }).rest_url = restUrl;
      expect(revalidateRequestSchema.safeParse(body).success, restUrl).toBe(false);
    }
  });
});

describe("slug length", () => {
  it("counts code points, as JSON Schema's maxLength does", () => {
    // Each U+1F600 is one code point and two UTF-16 code units.
    expect(slugSchema.safeParse("\u{1F600}".repeat(200)).success).toBe(true);
    expect(slugSchema.safeParse("\u{1F600}".repeat(201)).success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(201)).success).toBe(false);
  });
});

describe("core REST fixtures captured from WordPress", () => {
  const list = readJson(path.join(wpFixtures, "resources.list.json"));
  const single = readJson(path.join(wpFixtures, "resource.single.json"));

  it("parses the resource collection with _embed", () => {
    const resources = wpResourceListSchema.parse(list);
    expect(resources).toHaveLength(2);
    const [withImage, withoutImage] = resources;
    expect(withImage?._embedded["wp:featuredmedia"]?.[0]).toMatchObject({
      source_url: "https://cms.example/wp-content/uploads/2026/11/w-logo-blue.png",
      media_details: { width: 80, height: 80 },
    });
    expect(withoutImage?._embedded["wp:featuredmedia"]).toBeUndefined();
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

  it("rejects a resource fetched without _embed", () => {
    const resource = clone(single) as Record<string, unknown>;
    delete resource._embedded;
    expect(wpResourceSchema.safeParse(resource).success).toBe(false);
  });

  it("accepts a featured image core could not embed, as its error", () => {
    const resource = clone(single) as { _embedded: Record<string, unknown> };
    resource._embedded["wp:featuredmedia"] = [
      {
        code: "rest_forbidden",
        message: "Sorry, you are not allowed to do that.",
        data: { status: 401 },
      },
    ];
    const parsed = wpResourceSchema.parse(resource);
    expect(parsed._embedded["wp:featuredmedia"]?.[0]).toHaveProperty("code", "rest_forbidden");
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
    expect(() => parsePaginationHeaders(new Headers({ "X-WP-Total": "12" }))).toThrow(
      /X-WP-TotalPages/,
    );
    expect(() =>
      parsePaginationHeaders(new Headers({ "X-WP-Total": "twelve", "X-WP-TotalPages": "6" })),
    ).toThrow(/X-WP-Total/);
    expect(() =>
      parsePaginationHeaders(new Headers({ "X-WP-Total": "-1", "X-WP-TotalPages": "6" })),
    ).toThrow(/X-WP-Total/);
  });
});
