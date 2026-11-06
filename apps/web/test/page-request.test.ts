import { describe, expect, it } from "vitest";

import { decidePageRequest, type PageRequestOptions } from "../lib/page-request";
import { canonicalSlug, isPageSegment, pagePath } from "../lib/routes";
import type { PageLookup } from "../lib/wp/schemas/page";
import type { WpPage } from "../lib/wp/schemas/rest";

/**
 * The decision for `/` and `/{segments}/` (ADR 0051) without Next.js: which
 * requests never reach the CMS, when a request renders, redirects or is a
 * 404, and that a redirect's target is a fixed point.
 */

function page(id: number, slug: string): WpPage {
  return {
    id,
    slug,
    link: `https://cms.example/${slug}/`,
    parent: 0,
    date_gmt: "2026-11-01T09:00:00",
    modified_gmt: "2026-11-01T09:00:00",
    title: { rendered: slug },
    content: { rendered: "<p>Body</p>", protected: false },
    excerpt: { rendered: "" },
  };
}

/** A CMS with the given pages at the given paths; `lookups` records every path asked. */
function cms(pages: Record<string, PageLookup>, lookups: string[] = [], reads: number[] = []): PageRequestOptions {
  const byId = new Map(Object.values(pages).map((lookup) => [lookup.id, page(lookup.id, lookup.path)]));
  return {
    lookupPage: async (path) => {
      lookups.push(path);
      return pages[path] ?? null;
    },
    getPageById: async (id) => {
      reads.push(id);
      return byId.get(id) ?? null;
    },
  };
}

const SITE: Record<string, PageLookup> = {
  "/": { id: 12, path: "/" },
  "/home/": { id: 12, path: "/" },
  "/about/": { id: 13, path: "/about/" },
  "/about/team/": { id: 14, path: "/about/team/" },
  // The page's parent moved: the plugin answers the old path with the current one.
  "/about/contact/": { id: 15, path: "/company/contact/" },
  "/company/contact/": { id: 15, path: "/company/contact/" },
  "/%e6%97%a5/": { id: 16, path: "/%e6%97%a5/" },
};

describe("decidePageRequest", () => {
  it("renders the front page at / and the welcome page when there is none", async () => {
    const lookups: string[] = [];
    expect(await decidePageRequest([], cms(SITE, lookups))).toMatchObject({ kind: "render", path: "/" });
    expect(lookups).toEqual(["/"]);
    expect(await decidePageRequest([], cms({}))).toEqual({ kind: "welcome" });
  });

  it("renders a nested page at its canonical path", async () => {
    const decision = await decidePageRequest(["about", "team"], cms(SITE));
    expect(decision).toMatchObject({ kind: "render", path: "/about/team/" });
    expect(decision.kind === "render" && decision.page.id).toBe(14);
  });

  it("redirects the front page's own slug to /", async () => {
    expect(await decidePageRequest(["home"], cms(SITE))).toEqual({ kind: "redirect", path: "/" });
  });

  it("redirects an upper-case letter to the lower-case path, and the hex case of an escape counts as canonical", async () => {
    expect(await decidePageRequest(["About", "team"], cms(SITE))).toEqual({ kind: "redirect", path: "/about/team/" });
    expect(await decidePageRequest(["%E6%97%A5"], cms(SITE))).toMatchObject({ kind: "render", path: "/%e6%97%a5/" });
  });

  it("redirects a moved page's old path to its current one", async () => {
    expect(await decidePageRequest(["about", "contact"], cms(SITE))).toEqual({ kind: "redirect", path: "/company/contact/" });
    expect(await decidePageRequest(["company", "contact"], cms(SITE))).toMatchObject({ kind: "render", path: "/company/contact/" });
  });

  it("is a 404 for a path the CMS does not know, after one lookup", async () => {
    const lookups: string[] = [];
    expect(await decidePageRequest(["nowhere"], cms(SITE, lookups))).toEqual({ kind: "not-found" });
    expect(lookups).toEqual(["/nowhere/"]);
  });

  it("is a 404 without a request for a reserved first segment, a dot or a non-slug", async () => {
    const lookups: string[] = [];
    for (const segments of [
      ["api"],
      ["api", "revalidate"],
      ["media", "2026", "x.png"],
      ["_next", "static"],
      ["Resources"],
      ["favicon.ico"],
      ["robots.txt"],
      ["about", "team.html"],
      [".."],
      ["a b"],
      [""],
      ["case%2dstudy"],
    ]) {
      expect(await decidePageRequest(segments, cms(SITE, lookups)), segments.join("/")).toEqual({ kind: "not-found" });
    }
    expect(lookups).toEqual([]);
  });

  it("is a 404, or the welcome page at the root, when the page is gone between the lookup and the read", async () => {
    const options: PageRequestOptions = {
      lookupPage: async (path) => (path === "/" ? { id: 12, path: "/" } : { id: 13, path: "/about/" }),
      getPageById: async () => null,
    };
    expect(await decidePageRequest([], options)).toEqual({ kind: "welcome" });
    expect(await decidePageRequest(["about"], options)).toEqual({ kind: "not-found" });
  });

  it("is a 404 rather than a redirect when the CMS answers a path the front end cannot serve", async () => {
    const options: PageRequestOptions = {
      lookupPage: async () => ({ id: 13, path: "/about/team.html/" }),
      getPageById: async () => null,
    };
    expect(await decidePageRequest(["about"], options)).toEqual({ kind: "not-found" });
  });

  it("never redirects a canonical path to itself: every redirect's target renders or is a 404", async () => {
    // A generated CMS: each slug in its stored form, and requests for it in every form a URL can take.
    const slugs = ["about", "team", "%e6%97%a5%e6%9c%ac", "a-b_c~d", "caf%c3%a9", "x(1)"];
    const pages: Record<string, PageLookup> = {};
    let id = 100;
    for (const first of slugs) {
      pages[`/${first}/`] = { id: id++, path: `/${first}/` };
      for (const second of slugs) {
        pages[`/${first}/${second}/`] = { id: id++, path: `/${first}/${second}/` };
      }
    }
    const requests = (slug: string) => [slug, slug.toUpperCase(), slug.replace(/%[0-9a-f]{2}/g, (e) => e.toUpperCase())];
    for (const first of slugs) {
      for (const second of slugs) {
        for (const a of requests(first)) {
          for (const b of requests(second)) {
            const segments = [a, b].filter(isPageSegment);
            if (segments.length !== 2) continue;
            const decision = await decidePageRequest(segments, cms(pages));
            if (decision.kind === "redirect") {
              const target = decision.path;
              expect(target).toBe(pagePath([canonicalSlug(a), canonicalSlug(b)]));
              const again = await decidePageRequest(target.slice(1, -1).split("/"), cms(pages));
              expect(again.kind, `${a}/${b} -> ${target}`).toBe("render");
            }
          }
        }
      }
    }
  });
});
