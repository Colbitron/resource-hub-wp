import { describe, expect, it } from "vitest";

import { canonicalPath, canonicalResourcesPath, isResourcesPath } from "../lib/canonical-path";
import { canonicalSlug, listingPath, pagePath, RESERVED_ROOT_SEGMENTS, resourcePath, slugProblem } from "../lib/routes";

describe("isResourcesPath", () => {
  it("is /resources and anything under it", () => {
    expect(isResourcesPath("/resources")).toBe(true);
    expect(isResourcesPath("/resources/")).toBe(true);
    expect(isResourcesPath("/resources/webinar/")).toBe(true);
  });

  it("is lower case only, the one form the library's routes match", () => {
    expect(isResourcesPath("/Resources/")).toBe(false);
    expect(isResourcesPath("/RESOURCES")).toBe(false);
  });

  it("is not another path that starts the same way", () => {
    expect(isResourcesPath("/resourcesx/")).toBe(false);
    expect(isResourcesPath("/resource/")).toBe(false);
    expect(isResourcesPath("/")).toBe(false);
    expect(isResourcesPath("/api/revalidate/")).toBe(false);
  });
});

describe("canonicalResourcesPath", () => {
  it("is null for a path outside /resources: the library's rule on its own, canonicalPath covers the rest", () => {
    expect(canonicalResourcesPath("/")).toBeNull();
    expect(canonicalResourcesPath("/About/page/1/")).toBeNull();
    expect(canonicalResourcesPath("/resourcesX/")).toBeNull();
    expect(canonicalResourcesPath("/Resources/Webinar/")).toBeNull();
  });

  it("is null for a canonical listing or resource path", () => {
    for (const path of [
      "/resources/",
      "/resources/page/2/",
      "/resources/webinar/",
      "/resources/webinar/page/12/",
      "/resources/topic/accessibility/",
      "/resources/topic/accessibility/page/2/",
      "/resources/webinar/topic/accessibility/",
      "/resources/webinar/topic/accessibility/page/3/",
      "/resources/webinar/alt-text-at-scale/",
      "/resources/topic/%e6%97%a5/",
    ]) {
      expect(canonicalResourcesPath(path), path).toBeNull();
    }
  });

  it("lower-cases ASCII letters in every segment after resources", () => {
    expect(canonicalResourcesPath("/resources/Webinar/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/Topic/Accessibility/")).toBe("/resources/topic/accessibility/");
    expect(canonicalResourcesPath("/resources/WEBINAR/Alt-Text-At-Scale/")).toBe("/resources/webinar/alt-text-at-scale/");
    expect(canonicalResourcesPath("/resources/webinar/Page/2/")).toBe("/resources/webinar/page/2/");
  });

  it("leaves percent escapes as sent, their hex case included", () => {
    expect(canonicalResourcesPath("/resources/topic/%E6%97%A5/")).toBeNull();
    expect(canonicalResourcesPath("/resources/topic/%e6%97%A5/")).toBeNull();
    expect(canonicalResourcesPath("/resources/Topic/%E6%97%A5/")).toBe("/resources/topic/%E6%97%A5/");
    expect(canonicalResourcesPath("/resources/topic/a%20B/")).toBe("/resources/topic/a%20b/");
    expect(canonicalResourcesPath("/resources/topic/%2F/")).toBeNull();
  });

  it("decodes an escape of an unreserved character, as Next.js does in params, and then lower-cases it", () => {
    expect(canonicalResourcesPath("/resources/%57ebinar/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/%77ebinar/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/case%2Dstudy/")).toBe("/resources/case-study/");
    expect(canonicalResourcesPath("/resources/a%7Eb/")).toBe("/resources/a~b/");
  });

  it("decodes ! * ' ( ) as well, the rest of the set Next.js decodes in params", () => {
    expect(canonicalResourcesPath("/resources/topic/it%27s/")).toBe("/resources/topic/it's/");
    expect(canonicalResourcesPath("/resources/topic/now%21/")).toBe("/resources/topic/now!/");
    expect(canonicalResourcesPath("/resources/topic/%28draft%29/")).toBe("/resources/topic/(draft)/");
    expect(canonicalResourcesPath("/resources/webinar/topic/a%2ab/page/2/")).toBe("/resources/webinar/topic/a*b/page/2/");
    expect(canonicalResourcesPath("/resources/webinar/topic/a%2Ab/page/2/")).toBe("/resources/webinar/topic/a*b/page/2/");
    expect(canonicalResourcesPath("/resources/%27%21%28%29%2a/page/1/")).toBe("/resources/'!()*/");
    expect(canonicalResourcesPath("/resources/Topic/It%27S/")).toBe("/resources/topic/it's/");
  });

  it("decodes exactly the escapes slugProblem refuses, for every printable ASCII byte", () => {
    for (let byte = 0x20; byte <= 0x7e; byte += 1) {
      for (const hex of [byte.toString(16).toUpperCase(), byte.toString(16).toLowerCase()]) {
        const escaped = `a%${hex.padStart(2, "0")}b`;
        const decoded = canonicalResourcesPath(`/resources/topic/${escaped}/`) !== null;
        // An escape the proxy decodes is one a stored slug may never hold, and only those.
        expect(decoded, escaped).toBe(slugProblem(escaped) !== null);
      }
    }
  });

  it("leaves an escaped dot segment as sent, so it never produces one", () => {
    expect(canonicalResourcesPath("/resources/%2e/")).toBeNull();
    expect(canonicalResourcesPath("/resources/%2E%2e/")).toBeNull();
    expect(canonicalResourcesPath("/resources/a%2Eb/")).toBe("/resources/a.b/");
  });

  it("does not decode an escape twice", () => {
    // `%25` is a literal `%`, so `%2541` is `%41` once decoded, never `A`.
    expect(canonicalResourcesPath("/resources/%2541/")).toBeNull();
  });

  it("leaves a segment with a malformed escape as sent, so a stray % never pairs with a decoded escape", () => {
    // Before: `%4%41` went to `%4a` and then to `j`, two hops.
    expect(canonicalResourcesPath("/resources/x/%4%41/")).toBeNull();
    expect(canonicalResourcesPath("/resources/x/%4%%%33%34%31/")).toBeNull();
    expect(canonicalResourcesPath("/resources/topic/A%zz/")).toBeNull();
    expect(canonicalResourcesPath("/resources/topic/a%/")).toBeNull();
    // Only that segment: the others are still canonicalised, in the same hop.
    expect(canonicalResourcesPath("/resources/Topic/%4%41/page/1/")).toBe("/resources/topic/%4%41/");
  });

  it("drops a trailing /page/1/ from any listing", () => {
    expect(canonicalResourcesPath("/resources/page/1/")).toBe("/resources/");
    expect(canonicalResourcesPath("/resources/webinar/page/1/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/topic/accessibility/page/1/")).toBe("/resources/topic/accessibility/");
    expect(canonicalResourcesPath("/resources/webinar/topic/accessibility/page/1/")).toBe(
      "/resources/webinar/topic/accessibility/",
    );
  });

  it("drops one trailing /page/1/ only when no second one would follow, so it is never two hops", () => {
    expect(canonicalResourcesPath("/resources/page/1/page/1/")).toBeNull();
    expect(canonicalResourcesPath("/resources/Page/1/page/1/")).toBe("/resources/page/1/page/1/");
    expect(canonicalResourcesPath("/resources/topic/page/page/1/")).toBe("/resources/topic/page/");
  });

  it("applies both rules in one step", () => {
    expect(canonicalResourcesPath("/resources/Webinar/Page/1/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/Topic/A11y/PAGE/1/")).toBe("/resources/topic/a11y/");
  });

  it("leaves other page segments to the route, which answers 404", () => {
    for (const path of ["/resources/page/0/", "/resources/page/01/", "/resources/page/1.5/", "/resources/page/x/", "/resources/page/-1/"]) {
      expect(canonicalResourcesPath(path), path).toBeNull();
    }
    expect(canonicalResourcesPath("/resources/page/")).toBeNull();
    expect(canonicalResourcesPath("/resources/topic/")).toBeNull();
  });

  it("keeps the trailing slash as given", () => {
    expect(canonicalResourcesPath("/resources/Webinar")).toBe("/resources/webinar");
    expect(canonicalResourcesPath("/resources/Topic")).toBe("/resources/topic");
  });

  it("is idempotent: a canonical result is canonical", () => {
    for (const path of [
      "/resources/Webinar/Page/1/",
      "/resources/%57ebinar/Topic/A%20B/",
      "/resources/Topic/%E6%97%A5/page/1/",
      "/resources/case%2Dstudy/Slug%2Dhere/",
    ]) {
      const canonical = canonicalResourcesPath(path);
      expect(canonical, path).not.toBeNull();
      expect(canonicalResourcesPath(canonical as string), path).toBeNull();
    }
  });

  it("is a fixed point and never a redirect to itself, for every escaped byte in every position", () => {
    const templates = [
      (x: string) => `/resources/${x}/`,
      (x: string) => `/resources/${x}/page/1/`,
      (x: string) => `/resources/topic/${x}/`,
      (x: string) => `/resources/webinar/topic/${x}/page/1/`,
      (x: string) => `/resources/webinar/${x}/`,
      (x: string) => `/resources/${x}/Page/%31/`,
      (x: string) => `/resources/Topic/${x}/`,
      (x: string) => `/resources/page/1/${x}/page/1/`,
      (x: string) => `/resources/${x}`,
    ];
    const pieces = [
      "", "A", "page", "1", "%2e", "%2E%2e", "%2541", "%E6%97%a5",
      // Malformed escapes: a stray `%` must never pair with a decoded escape
      // into a new one (`%4%41` was `%4a`, then `j`; the last a 4-hop chain).
      "%", "%4", "%zz", "%g1", "A%", "%%", "%4%41", "%%34%31", "%4%%34%31", "%4%%%33%34%31",
    ];
    const hexDigits = "0123456789abcdefABCDEF";
    /** An escape of `character` in Next.js's decoded set, so the old code decoded it. */
    const escapeOf = (character: string) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
    for (let byte = 0x20; byte <= 0x7e; byte += 1) {
      for (const hex of [byte.toString(16).toUpperCase(), byte.toString(16).toLowerCase()]) {
        // As sent, and as a stray `%` and the first digit before an escape of the second.
        pieces.push(`%${hex}`, `x%${hex}Y`, `%${hex[0]}${escapeOf(hex[1])}`);
      }
    }
    for (const first of hexDigits) {
      for (const second of hexDigits) {
        // `%` then two escapes that decode to two hex digits.
        pieces.push(`%${escapeOf(first)}${escapeOf(second)}`, `X%${first}${escapeOf(second)}`);
      }
    }
    for (const template of templates) {
      for (const piece of pieces) {
        // As the proxy receives it: a URL parser has already removed dot segments.
        const path = new URL(template(piece), "http://localhost").pathname;
        const canonical = canonicalResourcesPath(path);
        if (canonical === null) {
          continue;
        }
        // Not to itself, as sent and as a URL parser reads the Location back.
        expect(canonical, path).not.toBe(path);
        const received = new URL(canonical, "http://localhost").pathname;
        expect(received, path).toBe(canonical);
        // And one hop: the canonical form is canonical.
        expect(canonicalResourcesPath(canonical), `${path} -> ${canonical}`).toBeNull();
      }
    }
  });

  it("agrees with the path builders: every built path is canonical", () => {
    const slugs = ["webinar", "case-study", "日", "%e6%97%a5", "a-b_c.d~e", "x!$&'()*+,;=:@y"];
    for (const type of ["webinar", "case-study"]) {
      for (const slug of slugs) {
        expect(canonicalResourcesPath(resourcePath(type, slug))).toBeNull();
        expect(canonicalResourcesPath(listingPath({ type, topic: slug }, 2))).toBeNull();
        expect(canonicalResourcesPath(listingPath({ topic: slug }))).toBeNull();
      }
    }
    // And a slug upper-cased in a URL comes back to its canonical form.
    for (const slug of ["Webinar", "Case-Study", "%E6%97%A5"]) {
      const path = `/resources/topic/${slug}/`;
      const expected = `/resources/topic/${canonicalSlug(slug)}/`;
      const canonical = canonicalResourcesPath(path) ?? path;
      // Hex case is left alone by the proxy and ignored by the page, so compare without it.
      expect(canonical.toLowerCase()).toBe(expected);
    }
  });
});

describe("canonicalPath", () => {
  it("is null for the root and for a canonical page path", () => {
    expect(canonicalPath("/")).toBeNull();
    for (const segments of [["about"], ["about", "team"], ["%e6%97%a5"], ["a-b_c~e"], ["resourcesx"], ["apiary"]]) {
      expect(canonicalPath(pagePath(segments)), segments.join("/")).toBeNull();
    }
    expect(canonicalPath("/favicon.ico")).toBeNull();
    expect(canonicalPath("/robots.txt")).toBeNull();
  });

  it("lower-cases ASCII letters in every segment of a page path, and decodes the escapes Next.js decodes", () => {
    expect(canonicalPath("/About/")).toBe("/about/");
    expect(canonicalPath("/About/Team/")).toBe("/about/team/");
    expect(canonicalPath("/%41bout/")).toBe("/about/");
    expect(canonicalPath("/about/%54eam")).toBe("/about/team");
    expect(canonicalPath("/About/%E6%97%A5/")).toBe("/about/%E6%97%A5/");
    expect(canonicalPath("/About/%4%41/")).toBe("/about/%4%41/");
  });

  it("gives a /resources/** path both rules, and brings a capitalised /Resources/ to the library in one hop", () => {
    expect(canonicalPath("/resources/Webinar/Page/1/")).toBe("/resources/webinar/");
    expect(canonicalPath("/Resources/")).toBe("/resources/");
    expect(canonicalPath("/RESOURCES/webinar/")).toBe("/resources/webinar/");
    expect(canonicalPath("/Resources/page/1/")).toBe("/resources/");
    expect(canonicalPath("/Resources/Webinar/Alt-Text/")).toBe("/resources/webinar/alt-text/");
    for (const path of ["/resources/", "/resources/webinar/alt-text-at-scale/", "/resources/topic/a11y/page/2/"]) {
      expect(canonicalPath(path), path).toBe(canonicalResourcesPath(path));
    }
  });

  it("drops /page/1/ only under /resources/, where page is a reserved segment", () => {
    expect(canonicalPath("/about/page/1/")).toBeNull();
    expect(canonicalPath("/About/page/1/")).toBe("/about/page/1/");
  });

  it("leaves the front end's other first segments alone in any case, as the catch-all answers them without a request", () => {
    for (const segment of RESERVED_ROOT_SEGMENTS) {
      if (segment === "resources") continue;
      for (const prefix of [segment, segment.toUpperCase(), segment[0].toUpperCase() + segment.slice(1)]) {
        for (const path of [`/${prefix}/`, `/${prefix}/Revalidate/`, `/${prefix}/2026/11/Diagram.PNG`, `/${prefix}/static/Chunk-A.js`]) {
          expect(canonicalPath(path), path).toBeNull();
        }
      }
    }
  });

  it("is a fixed point: a canonical result is canonical, for every escaped byte in a page path", () => {
    const templates = [(x: string) => `/${x}/`, (x: string) => `/About/${x}/`, (x: string) => `/${x}/Team/`, (x: string) => `/${x}`];
    const pieces = ["A", "api", "API", "%2e", "%2E%2e", "%2541", "%E6%97%a5", "%", "%4", "%zz", "A%", "%4%41", "%%34%31"];
    for (let byte = 0x20; byte <= 0x7e; byte += 1) {
      for (const hex of [byte.toString(16).toUpperCase(), byte.toString(16).toLowerCase()]) {
        pieces.push(`%${hex}`, `x%${hex}Y`);
      }
    }
    for (const template of templates) {
      for (const piece of pieces) {
        const path = new URL(template(piece), "http://localhost").pathname;
        const canonical = canonicalPath(path);
        if (canonical === null) continue;
        expect(canonical, path).not.toBe(path);
        expect(new URL(canonical, "http://localhost").pathname, path).toBe(canonical);
        expect(canonicalPath(canonical), `${path} -> ${canonical}`).toBeNull();
      }
    }
  });
});
