import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decideResourceRequest, type ResourceRequestOptions } from "../lib/redirects";
import { canonicalSlug, isSlug, resourcePath } from "../lib/routes";
import { resourceType } from "../lib/wp/cards";
import { resolveResponseSchema, type ResolveResponse } from "../lib/wp/schemas/resolve";
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

/**
 * The property behind "a redirect cannot loop": whatever a request asks for
 * and whatever schema-valid data the CMS holds, a redirect's target, sent
 * back through Next.js as a browser would send it, renders or is a 404 and
 * never redirects again, given the CMS answers the same both times.
 *
 * Inputs are built from fragments chosen to break it: escapes of characters
 * Next.js decodes in params (`%2d`, `%41`, `%27`, `%2a`), escapes it keeps (`%2F`,
 * `%25`, `%5c`) in either hex case, raw CJK and an astral character, `?` and
 * `#`, which must be encoded, and `Topic` and `page`, which are reserved as
 * types in any case. Slugs the reader schemas refuse never reach the
 * decision, as the data layer would throw on them; the test counts them.
 *
 * The one precondition is WordPress's: no two current slugs are equal in
 * canonical form. Three CMS models answer the lookups: exact (a slug matches its canonical
 * form, as WordPress's `post_name` match does), lenient (it also matches
 * once the escapes Next.js decodes are decoded on both sides, the
 * lookup the reviewer's `case%2dstudy` loop needed), and stale (every slug
 * lookup is a cached miss, so only resolve answers).
 */
describe("a redirect's target is a fixed point", () => {
  /**
   * Next.js 16.4.5's `params` normalisation of one segment, as measured on `next start` with
   * `a%XXb` for every byte 0x20-0x7e (`docs/architecture/caching.md`): an escape of a character
   * `encodeURIComponent` leaves alone (`A-Z a-z 0-9 - _ . ! ~ * ' ( )`) is decoded, and every
   * other escape's hex is upper-cased.
   */
  function nextParam(wire: string): string {
    return wire.replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
      const char = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      return /^[A-Za-z0-9\-_.!~*'()]$/.test(char) ? char : escape.toUpperCase();
    });
  }

  /** mulberry32: a small seeded PRNG, so a failure reproduces. */
  function prng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FRAGMENTS = [
    "a", "b", "z", "0", "7", "-", "_", "~", ".", "case", "study",
    "%2d", "%2D", "%41", "%61", "%7e", "%2e",
    "%27", "%21", "%28", "%29", "%2a", "%2A",
    "%2F", "%2f", "%25", "%5c", "%5C", "%20", "%3f", "%e6%97%a5", "%E6%97%A5",
    "日", "本", "😀", "?", "#", "\\", "%", "!", "'", "(", ":", "@",
    "Topic", "topic", "page", "PAGE", "%74opic",
  ];

  type Random = () => number;

  function pick<T>(random: Random, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)] as T;
  }

  function compose(random: Random): string {
    const count = 1 + Math.floor(random() * 4);
    return Array.from({ length: count }, () => pick(random, FRAGMENTS)).join("");
  }

  /** How a browser puts `text` in a path: escapes kept, a bare `%` and anything not a `pchar` encoded, and with probability `flip` a letter or a hex digit in the other case. */
  function wire(random: Random, text: string, flip: number): string {
    const encoded = text.replace(/%[0-9A-Fa-f]{2}|%|[^A-Za-z0-9\-._~!$&'()*+,;=:@%]/gu, (match) =>
      match.length === 3 && match.startsWith("%") ? match : encodeURIComponent(match),
    );
    return [...encoded]
      .map((char) => (random() < flip ? (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()) : char))
      .join("");
  }

  /** The captured resource's one `resource_type` term ID, whose embedded term carries the generated type slug. */
  const TYPE_ID = (RAW.resource_type as number[])[0];

  /** The captured resource with another ID, slug and type slug, or `null` when the reader schema refuses it. */
  function cmsResource(id: number, slug: string, type: string): WpResource | null {
    const raw = structuredClone(RAW) as Record<string, unknown> & { _embedded: { "wp:term": { taxonomy: string; id: number; slug: string }[][] } };
    for (const terms of raw._embedded["wp:term"]) {
      for (const term of terms) {
        if (term.taxonomy === "resource_type" && term.id === TYPE_ID) term.slug = type;
      }
    }
    const parsed = wpResourceSchema.safeParse({ ...raw, id, slug });
    return parsed.success && resourceType(parsed.data) !== null ? parsed.data : null;
  }

  function decodeAsNext(slug: string): string {
    return nextParam(slug).toLowerCase();
  }

  type Model = "exact" | "lenient" | "stale";

  interface State {
    resources: WpResource[];
    /** What resolve answers for a slug: `current` entries first, then old slugs, as the route looks a slug up. */
    resolves: { key: string; current: boolean; answer: ResolveResponse }[];
  }

  function cmsFor(state: State, model: Model): ResourceRequestOptions {
    const same = (stored: string, asked: string) =>
      model === "lenient"
        ? decodeAsNext(canonicalSlug(stored)) === decodeAsNext(asked)
        : canonicalSlug(stored) === asked;
    return {
      getResourceBySlug: async (slug) =>
        model === "stale" ? null : (state.resources.find((resource) => same(resource.slug, slug)) ?? null),
      resolveSlug: async (slug) =>
        (state.resolves.find(({ key, current }) => current && same(key, slug)) ??
          state.resolves.find(({ key }) => same(key, slug)))?.answer ?? null,
    };
  }

  /** The two segments of a `/resources/{type}/{slug}/` path. */
  function segments(path: string): [string, string] {
    const match = /^\/resources\/([^/]+)\/([^/]+)\/$/.exec(path);
    if (match === null) throw new Error(`not a resource path: ${path}`);
    return [match[1] as string, match[2] as string];
  }

  it("holds for thousands of generated requests against generated CMS data", async () => {
    const random = prng(0x5eed);
    const tally = { states: 0, refused: 0, decisions: 0, redirects: 0, renders: 0, notFound: 0 };

    for (let round = 0; round < 1000; round += 1) {
      const state: State = { resources: [], resolves: [] };
      // Each request: a type, a slug, and how often the browser flips a letter's case.
      const asked: [string, string, number][] = [];
      const resourceCount = 1 + Math.floor(random() * 3);
      for (let id = 1; id <= resourceCount; id += 1) {
        const slug = compose(random);
        const type = compose(random);
        const old = Array.from({ length: Math.floor(random() * 3) }, () => compose(random));
        const resource = cmsResource(id, slug, type);
        // WordPress's `post_name` is unique and lower case, so no two resources share a canonical slug.
        // Without that, two resources stored as `Topic` and `topic` make a two-hop chain through resolve.
        if (resource !== null && state.resources.some((other) => canonicalSlug(other.slug) === canonicalSlug(slug))) {
          continue;
        }
        if (resource === null) {
          tally.refused += 1;
          continue;
        }
        state.resources.push(resource);
        const resolvedType = resourceType(resource)?.slug as string;
        for (const key of [slug, ...old]) {
          const answer = resolveResponseSchema.safeParse({ id, type: resolvedType, slug });
          if (!isSlug(key) || !answer.success) {
            tally.refused += 1;
            continue;
          }
          state.resolves.push({ key, current: key === slug, answer: answer.data });
        }
        asked.push(
          [type, slug, 0],
          [type, slug, 0.2],
          [compose(random), slug, 0.1],
          ...old.map((oldSlug): [string, string, number] => [pick(random, [type, compose(random)]), oldSlug, 0.1]),
        );
      }
      asked.push([compose(random), compose(random), 0.1]);
      tally.states += 1;

      for (const model of ["exact", "lenient", "stale"] as const) {
        const cms = cmsFor(state, model);
        for (const [type, slug, flip] of asked) {
          const first = await decideResourceRequest(nextParam(wire(random, type, flip)), nextParam(wire(random, slug, flip)), cms);
          tally.decisions += 1;
          if (first.kind !== "redirect") {
            tally[first.kind === "render" ? "renders" : "notFound"] += 1;
            continue;
          }
          tally.redirects += 1;
          const [targetType, targetSlug] = segments(first.path);
          // The target is canonical, so a browser sends it unchanged.
          expect(canonicalSlug(targetType), first.path).toBe(targetType);
          expect(canonicalSlug(targetSlug), first.path).toBe(targetSlug);
          const second = await decideResourceRequest(nextParam(targetType), nextParam(targetSlug), cms);
          expect(second.kind, `${model}: ${JSON.stringify([type, slug])} -> ${first.path} -> ${JSON.stringify(second)}`).not.toBe("redirect");
        }
      }
    }

    // The generator reaches every branch, and the schemas refuse a share of the hostile inputs.
    expect(tally.redirects).toBeGreaterThan(1000);
    expect(tally.renders).toBeGreaterThan(1000);
    expect(tally.notFound).toBeGreaterThan(1000);
    expect(tally.refused).toBeGreaterThan(100);
  });

  it("models Next.js's normalisation as measured", () => {
    expect(nextParam("%41bc")).toBe("Abc");
    expect(nextParam("foo%2Dbar")).toBe("foo-bar");
    expect(nextParam("a%2fb")).toBe("a%2Fb");
    expect(nextParam("100%25")).toBe("100%25");
    expect(nextParam("%e6%97%a5")).toBe("%E6%97%A5");
    expect(nextParam("arti%27cle")).toBe("arti'cle");
    expect(nextParam("%21%28%29%2a%2A")).toBe("!()**");
    expect(nextParam("a%22b%3c%3e%60")).toBe("a%22b%3C%3E%60");
  });

  it("refuses a type stored as arti%27cle, so it never reaches a redirect", async () => {
    expect(cmsResource(1, "a-slug", "arti%27cle")).toBeNull();
  });

  it("is a 404, not a loop, for the reviewer's case%2dstudy, which no schema now accepts", async () => {
    expect(cmsResource(1, "case%2dstudy", TYPE)).toBeNull();
    const state: State = { resources: [], resolves: [] };
    await expect(decideResourceRequest(TYPE, nextParam("case%2dstudy"), cmsFor(state, "lenient"))).resolves.toEqual({
      kind: "not-found",
    });
  });
});
