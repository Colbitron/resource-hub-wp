import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decideResourceRequest, type ResourceRequestOptions } from "../lib/redirects";
import { resourcePath } from "../lib/routes";
import { resourceType } from "../lib/wp/cards";
import type { ResolveResponse } from "../lib/wp/schemas/resolve";
import { wpResourceSchema, type WpResource } from "../lib/wp/schemas/rest";

/**
 * `decideResourceRequest`: every branch of the resource page's redirect
 * decision, with the two lookups stubbed. The resource is the captured one,
 * parsed by the reader schema as the data layer would hand it over.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/wp");
const RAW = JSON.parse(readFileSync(path.join(fixtures, "resource.single.json"), "utf8")) as Record<string, unknown>;

function resource(patch: Record<string, unknown> = {}): WpResource {
  return wpResourceSchema.parse({ ...structuredClone(RAW), ...patch });
}

const SEEDED = resource();
const TYPE = resourceType(SEEDED)?.slug ?? "";
const SLUG = SEEDED.slug;
const CANONICAL = resourcePath(TYPE, SLUG);

/** A resource whose stored slug is percent-encoded, as WordPress stores `日本`. */
const ENCODED_SLUG = "%e6%97%a5%e6%9c%ac";
const ENCODED = resource({ slug: ENCODED_SLUG });

interface Calls {
  bySlug: string[];
  resolve: string[];
}

/** Lookups that answer from `found` (by canonical slug) and `resolved`, and record what they were asked. */
function lookups(
  found: Record<string, WpResource>,
  resolved: Record<string, ResolveResponse> = {},
): ResourceRequestOptions & { calls: Calls } {
  const calls: Calls = { bySlug: [], resolve: [] };
  return {
    calls,
    getResourceBySlug: async (slug) => {
      calls.bySlug.push(slug);
      return found[slug] ?? null;
    },
    resolveSlug: async (slug) => {
      calls.resolve.push(slug);
      return resolved[slug] ?? null;
    },
  };
}

describe("decideResourceRequest", () => {
  it("has a captured resource with a type and a lower-case slug to test with", () => {
    expect(TYPE).not.toBe("");
    expect(SLUG).toBe(SLUG.toLowerCase());
    expect(SLUG).not.toBe(SLUG.toUpperCase());
  });

  describe("before any lookup", () => {
    it("is a 404 for a reserved type segment, in any case or encoding", async () => {
      for (const type of ["topic", "page", "Topic", "PAGE", "%74opic", "%50age"]) {
        const deps = lookups({ [SLUG]: SEEDED });
        await expect(decideResourceRequest(type, SLUG, deps)).resolves.toEqual({ kind: "not-found" });
        expect(deps.calls).toEqual({ bySlug: [], resolve: [] });
      }
    });

    it("is a 404 for a type segment that is not a slug", async () => {
      for (const type of ["", "..", "%2e%2e", "a".repeat(201)]) {
        const deps = lookups({ [SLUG]: SEEDED });
        await expect(decideResourceRequest(type, SLUG, deps)).resolves.toEqual({ kind: "not-found" });
        expect(deps.calls).toEqual({ bySlug: [], resolve: [] });
      }
    });

    it("is a 404 for a slug segment that is not a slug", async () => {
      for (const slug of ["", ".", "..", "a b", "a".repeat(201), "\uD800"]) {
        const deps = lookups({ [SLUG]: SEEDED });
        await expect(decideResourceRequest(TYPE, slug, deps)).resolves.toEqual({ kind: "not-found" });
        expect(deps.calls).toEqual({ bySlug: [], resolve: [] });
      }
    });
  });

  describe("when the slug is found", () => {
    it("renders at the canonical URL, with the canonical segments, and never asks resolve", async () => {
      const deps = lookups({ [SLUG]: SEEDED });
      await expect(decideResourceRequest(TYPE, SLUG, deps)).resolves.toEqual({
        kind: "render",
        resource: SEEDED,
        type: TYPE,
        slug: SLUG,
      });
      expect(deps.calls).toEqual({ bySlug: [SLUG], resolve: [] });
    });

    it("redirects a wrong type segment to the canonical path, in one step", async () => {
      const deps = lookups({ [SLUG]: SEEDED });
      await expect(decideResourceRequest("podcast", SLUG, deps)).resolves.toEqual({ kind: "redirect", path: CANONICAL });
      expect(deps.calls).toEqual({ bySlug: [SLUG], resolve: [] });
    });

    it("redirects an unknown but valid type segment too: the slug is the identity", async () => {
      const deps = lookups({ [SLUG]: SEEDED });
      await expect(decideResourceRequest("no-such-type", SLUG, deps)).resolves.toEqual({ kind: "redirect", path: CANONICAL });
    });

    it("redirects mixed case in either segment to the lower-case path, looking the slug up in canonical form", async () => {
      const upperType = TYPE.toUpperCase();
      const mixedSlug = SLUG.replace(/^[a-z]/, (letter) => letter.toUpperCase());
      for (const [type, slug] of [
        [upperType, SLUG],
        [TYPE, mixedSlug],
        [upperType, mixedSlug],
        ["PODCAST", mixedSlug],
      ]) {
        const deps = lookups({ [SLUG]: SEEDED });
        await expect(decideResourceRequest(type, slug, deps)).resolves.toEqual({ kind: "redirect", path: CANONICAL });
        expect(deps.calls.bySlug).toEqual([SLUG]);
      }
    });

    it("treats a percent-encoded slug as canonical in either hex case, so the redirect cannot loop", async () => {
      // Next.js hands the page `%E6%97%A5%E6%9C%AC` for both spellings; a page
      // that redirected it to the lower-case form would be redirecting to itself.
      for (const slug of [ENCODED_SLUG, ENCODED_SLUG.toUpperCase()]) {
        const deps = lookups({ [ENCODED_SLUG]: ENCODED });
        await expect(decideResourceRequest(TYPE, slug, deps)).resolves.toEqual({
          kind: "render",
          resource: ENCODED,
          type: TYPE,
          slug: ENCODED_SLUG,
        });
        expect(deps.calls.bySlug).toEqual([ENCODED_SLUG]);
      }
      // The raw characters, should a runtime ever decode them, are the same slug.
      const deps = lookups({ [ENCODED_SLUG]: ENCODED });
      await expect(decideResourceRequest(TYPE, "日本", deps)).resolves.toMatchObject({ kind: "render", slug: ENCODED_SLUG });
    });

    it("still redirects an upper-case letter or a wrong type beside an encoded slug", async () => {
      const target = resourcePath(TYPE, ENCODED_SLUG);
      await expect(
        decideResourceRequest(TYPE.toUpperCase(), ENCODED_SLUG.toUpperCase(), lookups({ [ENCODED_SLUG]: ENCODED })),
      ).resolves.toEqual({ kind: "redirect", path: target });
      await expect(decideResourceRequest("podcast", ENCODED_SLUG, lookups({ [ENCODED_SLUG]: ENCODED }))).resolves.toEqual({
        kind: "redirect",
        path: target,
      });
    });

    it("is a 404 for a resource that has no usable type, because it has no URL", async () => {
      const untyped = resource({ resource_type: [] });
      await expect(decideResourceRequest(TYPE, SLUG, lookups({ [SLUG]: untyped }))).resolves.toEqual({ kind: "not-found" });
    });

    it("builds the redirect with `pathFor` when given", async () => {
      const deps = { ...lookups({ [SLUG]: SEEDED }), pathFor: (type: string, slug: string) => `/fixtures/redirect/${type}/${slug}/` };
      await expect(decideResourceRequest("podcast", SLUG, deps)).resolves.toEqual({
        kind: "redirect",
        path: `/fixtures/redirect/${TYPE}/${SLUG}/`,
      });
    });
  });

  describe("when the slug is not found", () => {
    const OLD = "an-old-slug";
    const resolved: ResolveResponse = { id: SEEDED.id, type: TYPE, slug: SLUG };

    it("asks resolve once, with the canonical slug, and redirects an old slug to the canonical path", async () => {
      const deps = lookups({}, { [OLD]: resolved });
      await expect(decideResourceRequest(TYPE, OLD, deps)).resolves.toEqual({ kind: "redirect", path: CANONICAL });
      expect(deps.calls).toEqual({ bySlug: [OLD], resolve: [OLD] });
    });

    it("redirects an old slug under a wrong type or in mixed case to the one canonical path", async () => {
      await expect(decideResourceRequest("podcast", OLD, lookups({}, { [OLD]: resolved }))).resolves.toEqual({
        kind: "redirect",
        path: CANONICAL,
      });
      const deps = lookups({}, { [OLD]: resolved });
      await expect(decideResourceRequest(TYPE, "An-Old-Slug", deps)).resolves.toEqual({ kind: "redirect", path: CANONICAL });
      expect(deps.calls.resolve).toEqual([OLD]);
    });

    it("is a 404 on a resolve miss", async () => {
      const deps = lookups({});
      await expect(decideResourceRequest(TYPE, OLD, deps)).resolves.toEqual({ kind: "not-found" });
      expect(deps.calls).toEqual({ bySlug: [OLD], resolve: [OLD] });
    });

    it("is a 404 rather than a redirect to itself when resolve names the URL that was asked for", async () => {
      // The slug lookup's cached miss is stale next to resolve's answer; a
      // self-redirect would loop until an event clears the miss.
      const deps = lookups({}, { [SLUG]: resolved });
      await expect(decideResourceRequest(TYPE, SLUG, deps)).resolves.toEqual({ kind: "not-found" });
      // In mixed case it is one hop to the canonical URL, which then 404s rather than loops.
      await expect(decideResourceRequest(TYPE.toUpperCase(), SLUG, lookups({}, { [SLUG]: resolved }))).resolves.toEqual({
        kind: "redirect",
        path: CANONICAL,
      });
    });

    it("is a 404 when resolve answers with a type that cannot be a path segment", async () => {
      const deps = lookups({}, { [OLD]: { ...resolved, type: "topic" } });
      await expect(decideResourceRequest(TYPE, OLD, deps)).resolves.toEqual({ kind: "not-found" });
    });
  });
});
