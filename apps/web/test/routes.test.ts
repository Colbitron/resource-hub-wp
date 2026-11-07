import { existsSync, readdirSync } from "node:fs";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";

import { isMetadataRouteFile } from "next/dist/lib/metadata/is-metadata-route";
import { describe, expect, it } from "vitest";

import { decidePath } from "../lib/path-decision";
import {
  MAX_PAGE_PATH_LENGTH,
  OWN_ROUTE_PATHS,
  RESERVED_ROOT_SEGMENTS,
  RESERVED_TYPE_SLUGS,
  canonicalSlug,
  isPageNumber,
  isReservedTypeSlug,
  isSlug,
  isTypeSlug,
  libraryPath,
  listingPath,
  pagePath,
  pagePathProblem,
  parsePageSegment,
  parseResourcesSegments,
  resourcePath,
  slugProblem,
  topicListingPath,
  typeListingPath,
  typeSlugProblem,
  typeTopicListingPath,
  validListing,
} from "../lib/routes";

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

/** `pageExtensions` in `next.config.ts`, with the fixtures' on, as Playwright builds the app. */
const PAGE_EXTENSIONS = ["fixture.tsx", "tsx", "ts"];

/** A generated metadata route's served name, where it is not the file's own name. */
const GENERATED_METADATA_NAMES: Record<string, string> = { robots: "robots.txt", manifest: "manifest.webmanifest", sitemap: "sitemap.xml" };

type ServedFile = { readonly file: string; readonly kind: "page" | "route" | "metadata"; readonly segments: readonly string[] };

/**
 * Every file under `dir` (a directory of `app/`) that answers requests
 * itself, with the URL segments it is served at, relative to `dir`: a page,
 * a route handler, or a metadata file in any of its forms, as Next.js's own
 * `isMetadataRouteFile` recognises them (`favicon.ico`, `robots`, `sitemap`,
 * `manifest`, `icon`, `apple-icon`, `opengraph-image`, `twitter-image`,
 * static or generated). A static metadata file is served under its own
 * name, a generated one under its bare name or the name Next.js gives it
 * (`robots.ts` at `robots.txt`). A route group or a parallel-route slot adds
 * no segment, a private folder (`_x`) is not routed, and a dynamic segment
 * comes back as written (`[type]`). `appPath` is `dir`'s own path under
 * `app/` (`/resources`), which Next.js reads to tell a root-only metadata
 * file (`robots`, `manifest`, `favicon.ico`) from a file of that name
 * elsewhere; `skip` names directories of `dir` left out.
 */
function servedFiles(dir: string, skip: readonly string[] = [], appPath = "", segments: readonly string[] = []): ServedFile[] {
  const found: ServedFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = `${appPath}/${entry.name}`;
    if (entry.isDirectory()) {
      if (skip.includes(entry.name) || entry.name.startsWith("_")) {
        continue;
      }
      const routed = /^\(.*\)$|^@/.test(entry.name) ? segments : [...segments, entry.name];
      found.push(...servedFiles(join(dir, entry.name), [], relative, routed));
    } else if (new RegExp(`^(page|route)\\.(${PAGE_EXTENSIONS.join("|").replaceAll(".", "\\.")})$`).test(entry.name)) {
      found.push({ file: relative, kind: entry.name.startsWith("page") ? "page" : "route", segments });
    } else if (isMetadataRouteFile(relative, PAGE_EXTENSIONS, true)) {
      const { name, ext } = parse(entry.name);
      const generated = PAGE_EXTENSIONS.some((extension) => entry.name.endsWith(`.${extension}`));
      const served = generated ? (GENERATED_METADATA_NAMES[name] ?? name) : `${name}${ext}`;
      found.push({ file: relative, kind: "metadata", segments: [...segments, served] });
    }
  }
  return found;
}

describe("reserved type slugs", () => {
  it("are topic and page", () => {
    expect(RESERVED_TYPE_SLUGS).toEqual(["topic", "page"]);
    expect(isReservedTypeSlug("topic")).toBe(true);
    expect(isReservedTypeSlug("page")).toBe(true);
    expect(isReservedTypeSlug("webinar")).toBe(false);
    expect(isReservedTypeSlug("Topic")).toBe(false);
  });
});

describe("isSlug", () => {
  it("accepts WordPress slugs, percent-encoded ones included", () => {
    expect(isSlug("example")).toBe(true);
    expect(isSlug("core-web-vitals-2026")).toBe(true);
    expect(isSlug("%e6%97%a5%e6%9c%ac")).toBe(true);
    expect(isSlug("日本")).toBe(true);
    expect(isSlug("topic")).toBe(true);
  });

  it("rejects what the schema rejects: empty, slash, whitespace, over 200 characters", () => {
    expect(isSlug("")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("a b")).toBe(false);
    expect(isSlug("a\tb")).toBe(false);
    expect(isSlug("a".repeat(200))).toBe(true);
    expect(isSlug("a".repeat(201))).toBe(false);
  });

  it("checks the schema's 200, in code points, before the encoded length", () => {
    // Any slug over 200 code points is also over 200 encoded, so the
    // schema's own rule shows only in which message comes back.
    expect(isSlug("😀".repeat(16))).toBe(true);
    expect(slugProblem("😀".repeat(201))).toBe("must be at most 200 characters");
    expect(slugProblem("😀".repeat(100))).toMatch(/once percent-encoded/);
  });

  it("also caps the canonical, percent-encoded form at 200 characters, as WordPress stores it", () => {
    // 22 日 encode to 198 characters; 23 to 207, though they are 23 code points.
    expect(isSlug("日".repeat(22) + "ab")).toBe(true);
    expect(isSlug("日".repeat(22) + "abc")).toBe(false);
    expect(isSlug("日".repeat(23))).toBe(false);
    // 200 日 are within the schema's 200 code points but 1,800 characters encoded.
    expect(isSlug("日".repeat(200))).toBe(false);
    expect(isSlug("😀".repeat(200))).toBe(false);
    // The already-encoded form is counted as it is.
    expect(isSlug(`${"%e6%97%a5".repeat(22)}ab`)).toBe(true);
    expect(isSlug(`${"%e6%97%a5".repeat(22)}abc`)).toBe(false);
    expect(() => canonicalSlug("日".repeat(23))).toThrow(RangeError);
  });

  it("rejects dot segments and malformed Unicode", () => {
    for (const dots of [".", "..", "%2e", "%2E%2e", ".%2e"]) {
      expect(isSlug(dots)).toBe(false);
    }
    expect(isSlug("...")).toBe(true);
    expect(isSlug("a\ud800b")).toBe(false);
  });
});

describe("isTypeSlug", () => {
  it("is a slug that is not reserved", () => {
    expect(isTypeSlug("webinar")).toBe(true);
    expect(isTypeSlug("topic")).toBe(false);
    expect(isTypeSlug("page")).toBe(false);
    expect(isTypeSlug("")).toBe(false);
    expect(isTypeSlug("a/b")).toBe(false);
  });

  it("rejects the reserved words in any case, since the canonical form lower-cases them", () => {
    for (const value of ["Topic", "TOPIC", "Page", "pAgE"]) {
      expect(isTypeSlug(value), value).toBe(false);
      expect(typeSlugProblem(value), value).toMatch(/reserved/);
      expect(() => typeListingPath(value), value).toThrow(RangeError);
    }
    expect(isSlug("Topic")).toBe(true);
    expect(topicListingPath("Topic")).toBe("/resources/topic/topic/");
  });

  it("rejects the reserved words percent-encoded, as escapes of letters Next.js decodes, before the reserved check", () => {
    for (const value of ["%74opic", "%54OPIC", "%74%6f%70%69%63", "%70AGE", "pag%65", "P%41GE"]) {
      expect(isTypeSlug(value), value).toBe(false);
      expect(typeSlugProblem(value), value).toMatch(/Next\.js decodes in params/);
      expect(() => typeListingPath(value), value).toThrow(RangeError);
      // Not a slug of any kind, so not a topic either.
      expect(isSlug(value), value).toBe(false);
      expect(() => topicListingPath(value), value).toThrow(RangeError);
    }
  });

  it("decodes only once and leaves escapes that cannot spell a reserved word", () => {
    for (const value of ["%2574opic", "%e6%97%a5", "%ff", "topic%", "%7"]) {
      expect(typeSlugProblem(value), value).toBeNull();
    }
  });
});

describe("isPageNumber", () => {
  it("accepts safe integers from 1", () => {
    expect(isPageNumber(1)).toBe(true);
    expect(isPageNumber(2)).toBe(true);
    expect(isPageNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects zero, negatives, fractions, NaN, Infinity and unsafe integers", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isPageNumber(bad)).toBe(false);
    }
  });
});

describe("parsePageSegment", () => {
  it("reads canonical page numbers from 2", () => {
    expect(parsePageSegment("2")).toBe(2);
    expect(parsePageSegment("10")).toBe(10);
    expect(parsePageSegment(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects page 1, which is the listing's own path", () => {
    expect(parsePageSegment("1")).toBeNull();
  });

  it("rejects every non-canonical or bad form", () => {
    for (const bad of [
      "",
      "0",
      "00",
      "02",
      "-2",
      "+2",
      "2.0",
      "1e3",
      "0x10",
      " 2",
      "2 ",
      "two",
      "٢",
      "9007199254740992",
      "99999999999999999999",
    ]) {
      expect(parsePageSegment(bad), bad).toBeNull();
    }
  });
});

describe("listing paths", () => {
  it("builds the library", () => {
    expect(libraryPath()).toBe("/resources/");
    expect(listingPath()).toBe("/resources/");
    expect(listingPath({})).toBe("/resources/");
  });

  it("builds a type listing", () => {
    expect(typeListingPath("webinar")).toBe("/resources/webinar/");
    expect(listingPath({ type: "webinar" })).toBe("/resources/webinar/");
  });

  it("builds a topic listing", () => {
    expect(topicListingPath("performance")).toBe("/resources/topic/performance/");
    expect(listingPath({ topic: "performance" })).toBe("/resources/topic/performance/");
  });

  it("allows topic slugs that are reserved words for types", () => {
    expect(topicListingPath("topic")).toBe("/resources/topic/topic/");
    expect(topicListingPath("page")).toBe("/resources/topic/page/");
  });

  it("builds a type plus topic listing", () => {
    expect(typeTopicListingPath("webinar", "performance")).toBe(
      "/resources/webinar/topic/performance/",
    );
    expect(listingPath({ type: "webinar", topic: "performance" })).toBe(
      "/resources/webinar/topic/performance/",
    );
  });

  it("adds page/{n}/ from page 2, and nothing for page 1", () => {
    expect(libraryPath(1)).toBe("/resources/");
    expect(libraryPath(2)).toBe("/resources/page/2/");
    expect(typeListingPath("webinar", 3)).toBe("/resources/webinar/page/3/");
    expect(topicListingPath("performance", 4)).toBe("/resources/topic/performance/page/4/");
    expect(typeTopicListingPath("webinar", "performance", 5)).toBe(
      "/resources/webinar/topic/performance/page/5/",
    );
  });

  it("throws on a bad page number", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => libraryPath(bad)).toThrow(RangeError);
    }
  });

  it("throws on a reserved or invalid type slug", () => {
    expect(() => typeListingPath("topic")).toThrow(RangeError);
    expect(() => typeListingPath("page")).toThrow(RangeError);
    expect(() => typeTopicListingPath("page", "performance")).toThrow(RangeError);
    expect(() => typeListingPath("")).toThrow(RangeError);
    expect(() => typeListingPath("a/b")).toThrow(RangeError);
    expect(() => typeListingPath("..")).toThrow(RangeError);
  });

  it("throws on an invalid topic slug", () => {
    expect(() => topicListingPath("")).toThrow(RangeError);
    expect(() => topicListingPath("a b")).toThrow(RangeError);
  });
});

describe("resourcePath", () => {
  it("builds /resources/{type}/{slug}/", () => {
    expect(resourcePath("webinar", "example")).toBe("/resources/webinar/example/");
  });

  it("allows resource slugs topic and page, which are only reserved for types", () => {
    expect(resourcePath("webinar", "page")).toBe("/resources/webinar/page/");
    expect(resourcePath("webinar", "topic")).toBe("/resources/webinar/topic/");
  });

  it("throws on a reserved type, or an invalid type or slug", () => {
    expect(() => resourcePath("topic", "example")).toThrow(RangeError);
    expect(() => resourcePath("page", "example")).toThrow(RangeError);
    expect(() => resourcePath("webinar", "")).toThrow(RangeError);
    expect(() => resourcePath("webinar", "a/b")).toThrow(RangeError);
    expect(() => resourcePath("webinar", ".")).toThrow(RangeError);
  });
});

describe("segment encoding", () => {
  it("keeps WordPress's percent-encoded slugs as they are, never double-encoding", () => {
    expect(resourcePath("webinar", "%e6%97%a5%e6%9c%ac")).toBe(
      "/resources/webinar/%e6%97%a5%e6%9c%ac/",
    );
  });

  it("keeps the characters a path segment allows", () => {
    expect(resourcePath("webinar", "a-b_c.d~e!$&'()*+,;=:@")).toBe(
      "/resources/webinar/a-b_c.d~e!$&'()*+,;=:@/",
    );
  });

  it("escapes characters a path segment does not allow", () => {
    expect(resourcePath("webinar", "a?b#c")).toBe("/resources/webinar/a%3fb%23c/");
    expect(resourcePath("webinar", "100%")).toBe("/resources/webinar/100%25/");
    expect(resourcePath("webinar", "%zz")).toBe("/resources/webinar/%25zz/");
    expect(resourcePath("webinar", "a\\b")).toBe("/resources/webinar/a%5cb/");
    expect(topicListingPath("日本")).toBe("/resources/topic/%e6%97%a5%e6%9c%ac/");
  });
});

describe("canonicalSlug", () => {
  const forms = ["日本", "%E6%97%A5%E6%9C%AC", "%e6%97%a5%e6%9c%ac", "日%E6%9c%Ac"];

  it("gives raw, upper-case and lower-case input one form, WordPress's lower-case hex", () => {
    for (const form of forms) {
      expect(canonicalSlug(form), form).toBe("%e6%97%a5%e6%9c%ac");
    }
  });

  it("makes every builder give identical paths for every form", () => {
    for (const form of forms) {
      expect(resourcePath("webinar", form)).toBe("/resources/webinar/%e6%97%a5%e6%9c%ac/");
      expect(resourcePath(form, "example")).toBe("/resources/%e6%97%a5%e6%9c%ac/example/");
      expect(typeListingPath(form, 2)).toBe("/resources/%e6%97%a5%e6%9c%ac/page/2/");
      expect(topicListingPath(form)).toBe("/resources/topic/%e6%97%a5%e6%9c%ac/");
      expect(typeTopicListingPath(form, form)).toBe(
        "/resources/%e6%97%a5%e6%9c%ac/topic/%e6%97%a5%e6%9c%ac/",
      );
    }
  });

  it("is idempotent", () => {
    for (const value of [...forms, "a?b#c", "100%", "%zz", "a\\b", "\u{1F600}", "example"]) {
      const once = canonicalSlug(value);
      expect(canonicalSlug(once), value).toBe(once);
    }
  });

  it("encodes a character outside the BMP whole, in lower case", () => {
    expect(canonicalSlug("\u{1F600}")).toBe("%f0%9f%98%80");
  });

  it("leaves the characters a segment allows alone, apart from lower-casing letters", () => {
    expect(canonicalSlug("example-slug_1.0~!$&'()*+,;=:@")).toBe("example-slug_1.0~!$&'()*+,;=:@");
    expect(canonicalSlug("Example-Slug_1.0~")).toBe("example-slug_1.0~");
  });

  it("lower-cases ASCII letters, as WordPress's slugs are, so ABC and abc are one form", () => {
    for (const form of ["ABC", "Abc", "abc"]) {
      expect(canonicalSlug(form), form).toBe("abc");
      expect(resourcePath("Webinar", form), form).toBe("/resources/webinar/abc/");
      expect(topicListingPath(form), form).toBe("/resources/topic/abc/");
    }
    expect(canonicalSlug("Caf%C3%A9-%E6%97%A5")).toBe("caf%c3%a9-%e6%97%a5");
  });

  it("round-trips a non-ASCII slug through a path", () => {
    const path = resourcePath("webinar", "日本-guide");
    expect(path).toBe("/resources/webinar/%e6%97%a5%e6%9c%ac-guide/");
    expect(decodeURIComponent(path)).toBe("/resources/webinar/日本-guide/");
    expect(new URL(path, "https://front-end.example").pathname).toBe(path);
    expect(resourcePath("webinar", decodeURIComponent("%e6%97%a5%e6%9c%ac-guide"))).toBe(path);
  });

  it("validates before normalising: a lone surrogate is a RangeError, not a URIError", () => {
    expect(() => canonicalSlug("\ud800")).toThrow(RangeError);
    expect(() => canonicalSlug("a\udc00")).toThrow(RangeError);
    expect(() => canonicalSlug("")).toThrow(RangeError);
    expect(() => canonicalSlug("%2e")).toThrow(RangeError);
  });
});

describe("slugProblem", () => {
  it("names what is wrong, and is null for a slug", () => {
    expect(slugProblem("example")).toBeNull();
    expect(slugProblem("")).toMatch(/empty/);
    expect(slugProblem("a b")).toMatch(/slash or whitespace/);
    expect(slugProblem("\ud800")).toMatch(/well-formed/);
    expect(slugProblem("a".repeat(201))).toMatch(/200/);
    expect(slugProblem("日".repeat(23))).toMatch(/200 characters once percent-encoded/);
    expect(slugProblem("..")).toMatch(/\.\./);
    expect(typeSlugProblem("page")).toMatch(/reserved/);
    expect(typeSlugProblem("webinar")).toBeNull();
  });

  it("rejects a percent escape of any character Next.js decodes in params, in either hex case", () => {
    // `-`, `A`, `~`, `'`, `*`: Next.js hands a page `a-b`, `Abc`, `x~y`, `arti'cle` and `a*b`, so the slug's own URL
    // would name another slug. The set is `encodeURIComponent`'s unescaped set, as measured on Next.js 16.4.5.
    for (const [value, escape] of [
      ["a%2db", "%2d"],
      ["a%2Db", "%2D"],
      ["%41bc", "%41"],
      ["%61bc", "%61"],
      ["x%7ey", "%7e"],
      ["x%7Ey", "%7E"],
      ["v%30", "%30"],
      ["a%5fb", "%5f"],
      ["a%2eb", "%2e"],
      ["%e6%97%a5-%5A", "%5A"],
      ["arti%27cle", "%27"],
      ["a%21b", "%21"],
      ["a%28b", "%28"],
      ["a%29b", "%29"],
      ["a%2ab", "%2a"],
      ["a%2Ab", "%2A"],
    ]) {
      expect(slugProblem(value), value).toBe(
        `must not percent-encode a character Next.js decodes in params (${escape}), as it does A-Z a-z 0-9 - _ . ! ~ * ' ( ) before a page sees it`,
      );
      expect(isSlug(value), value).toBe(false);
      expect(isTypeSlug(value), value).toBe(false);
      expect(() => canonicalSlug(value), value).toThrow(RangeError);
      expect(() => resourcePath("webinar", value), value).toThrow(RangeError);
      expect(() => resourcePath(value, "example"), value).toThrow(RangeError);
    }
  });

  it("keeps escapes of every other byte, which Next.js leaves encoded", () => {
    for (const value of ["a%2fb", "a%2Fb", "100%25", "a%5cb", "a%20b", "a%3fb", "a%23b", "%e6%97%a5", "%E6%97%A5", "a%22b", "a%26b", "a%2cb", "a%3db", "a%40b", "a%60b", "%ff"]) {
      expect(slugProblem(value), value).toBeNull();
    }
  });

  it("decides every ASCII escape by the measured set: encodeURIComponent's unescaped characters only", () => {
    for (let byte = 0x20; byte <= 0x7e; byte += 1) {
      const char = String.fromCharCode(byte);
      const decoded = encodeURIComponent(char) === char;
      for (const hex of [byte.toString(16).padStart(2, "0"), byte.toString(16).toUpperCase().padStart(2, "0")]) {
        const value = `a%${hex}b`;
        expect(slugProblem(value) === null, value).toBe(!decoded);
      }
    }
  });
});

describe("pagePathProblem", () => {
  it("is null for the root and for segments a page path can have", () => {
    for (const segments of [[], ["about"], ["about", "team"], ["resourcesx"], ["apiary"], ["%e6%97%a5"], ["a%20b"], ["-"]]) {
      expect(pagePathProblem(segments), segments.join("/")).toBeNull();
    }
  });

  it("names a segment that cannot be one, in the words of pageSegmentProblem", () => {
    expect(pagePathProblem(["about", "team.html"])).toContain("must not contain a dot");
    expect(pagePathProblem(["favicon.ico"])).toContain('"favicon.ico"');
    expect(pagePathProblem(["a".repeat(201)])).toContain("at most 200 characters");
    expect(pagePathProblem(["case%2dstudy"])).toContain("percent-encode");
    expect(pagePathProblem([".."])).toContain("URL parsers collapse");
    expect(pagePathProblem(["a b"])).toContain("whitespace");
    expect(pagePathProblem([""])).toContain("empty");
  });

  it("names a reserved first segment, in any case, and only as the first", () => {
    for (const segment of RESERVED_ROOT_SEGMENTS) {
      expect(pagePathProblem([segment]), segment).toContain("front end's own routes");
      expect(pagePathProblem([segment.toUpperCase(), "x"]), segment).toContain("front end's own routes");
      expect(pagePathProblem(["about", segment]), segment).toBeNull();
    }
  });

  it("names a path over the plugin's cap, and not one at it", () => {
    const segment = "a".repeat(200);
    const over = Array.from({ length: 10 }, () => segment);
    expect(pagePath(over).length).toBe(MAX_PAGE_PATH_LENGTH + 1);
    expect(pagePathProblem(over)).toContain(`${MAX_PAGE_PATH_LENGTH}`);
    const at = [...over.slice(0, 9), "b".repeat(199)];
    expect(pagePath(at).length).toBe(MAX_PAGE_PATH_LENGTH);
    expect(pagePathProblem(at)).toBeNull();
  });

  it("checks the segments before the reserved word and the cap, so the builders only ever see valid segments", () => {
    expect(pagePathProblem(["api", "x.y"])).toContain("dot");
    expect(() => pagePathProblem([".."])).not.toThrow();
    expect(() => pagePathProblem(["api", ".."])).not.toThrow();
  });
});

describe("OWN_ROUTE_PATHS", () => {
  it("are the revalidate route and the metadata files, with the trailing slash every route path has and a file path has not", () => {
    expect(OWN_ROUTE_PATHS).toEqual(["/api/revalidate/", "/favicon.ico", "/icon.svg", "/icon.png", "/apple-icon.png", "/opengraph-image.png"]);
  });

  // The proxy runs before every route and before `public/`, so a route or a
  // file it decides as a 404 (a dot in its name, a reserved first segment
  // such as `api`) is never reached, and one it redirects is reached only at
  // another path. This walks what is actually there, so a new
  // `app/robots.ts`, `app/api/health/route.ts` or `public/logo.svg` fails
  // here until `OWN_ROUTE_PATHS` lists it. The two catch-alls are left out:
  // the page catch-all is what the proxy's page rules mirror, and the
  // library's routes are pinned to `parseResourcesSegments` below.
  it("cover every route and metadata file outside the catch-alls, and every public file, so the proxy leaves each one alone", () => {
    const served = servedFiles(APP_DIR, ["[[...path]]", "resources"]).map(({ file, kind, segments }) => {
      const routed = segments.map((segment) => (/^\[.*\]$/.test(segment) ? "sample" : segment));
      // Pages and route handlers end in the slash `trailingSlash: true` gives them; a metadata file is served under its file name.
      return { file, path: kind === "metadata" ? `/${routed.join("/")}` : `/${routed.map((segment) => `${segment}/`).join("")}` };
    });
    const publicDir = fileURLToPath(new URL("../public", import.meta.url));
    if (existsSync(publicDir)) {
      for (const entry of readdirSync(publicDir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) {
          const path = `${entry.parentPath}/${entry.name}`.slice(publicDir.length).split("\\").join("/");
          served.push({ file: `public${path}`, path });
        }
      }
    }
    for (const { file, path } of served) {
      expect(decidePath(path), `${file} is served at ${path}, which the proxy must leave alone: add it to OWN_ROUTE_PATHS, or teach lib/path-decision.ts its shape`).toBeNull();
    }
    const paths = served.map(({ path }) => path);
    for (const path of OWN_ROUTE_PATHS) {
      expect(paths, `${path} is in OWN_ROUTE_PATHS but nothing under app/ serves it`).toContain(path);
    }
  });
});

describe("validListing", () => {
  it("is the filter and the page for segments the listing accepts, page 1 with no page segment", () => {
    expect(validListing({})).toEqual({ filter: {}, page: 1 });
    expect(validListing({ type: "webinar" })).toEqual({ filter: { type: "webinar" }, page: 1 });
    expect(validListing({ topic: "a11y", pageSegment: "12" })).toEqual({ filter: { topic: "a11y" }, page: 12 });
    expect(validListing({ type: "webinar", topic: "%e6%97%a5", pageSegment: "2" })).toEqual({ filter: { type: "webinar", topic: "%e6%97%a5" }, page: 2 });
  });

  it("is null for a type that is reserved or not a slug, a topic that is not a slug, or a page segment that is not a number 2 or more", () => {
    for (const request of [
      { type: "topic" },
      { type: "page" },
      { type: "Topic" },
      { type: "a".repeat(201) },
      { type: "case%2dstudy" },
      { topic: "a".repeat(201) },
      { topic: "case%2dstudy" },
      { pageSegment: "1" },
      { pageSegment: "0" },
      { pageSegment: "01" },
      { pageSegment: "1.5" },
      { pageSegment: "x" },
      { pageSegment: "" },
      { type: "webinar", topic: "a11y", pageSegment: "-2" },
    ]) {
      expect(validListing(request), JSON.stringify(request)).toBeNull();
    }
  });
});

describe("parseResourcesSegments", () => {
  it("reads every listing shape back as the route sees it, and a two-segment path as a resource", () => {
    expect(parseResourcesSegments([])).toEqual({ kind: "listing", request: {} });
    expect(parseResourcesSegments(["webinar"])).toEqual({ kind: "listing", request: { type: "webinar" } });
    expect(parseResourcesSegments(["topic", "a11y"])).toEqual({ kind: "listing", request: { topic: "a11y" } });
    expect(parseResourcesSegments(["page", "2"])).toEqual({ kind: "listing", request: { pageSegment: "2" } });
    expect(parseResourcesSegments(["webinar", "example"])).toEqual({ kind: "resource", type: "webinar", slug: "example" });
    expect(parseResourcesSegments(["webinar", "topic", "a11y"])).toEqual({ kind: "listing", request: { type: "webinar", topic: "a11y" } });
    expect(parseResourcesSegments(["webinar", "page", "2"])).toEqual({ kind: "listing", request: { type: "webinar", pageSegment: "2" } });
    expect(parseResourcesSegments(["topic", "a11y", "page", "2"])).toEqual({ kind: "listing", request: { topic: "a11y", pageSegment: "2" } });
    expect(parseResourcesSegments(["webinar", "topic", "a11y", "page", "2"])).toEqual({ kind: "listing", request: { type: "webinar", topic: "a11y", pageSegment: "2" } });
  });

  it("lets a static topic/ or page/ segment win over [type], and hands a reserved word that lands in [type] to the validation", () => {
    expect(parseResourcesSegments(["topic", "x"])).toEqual({ kind: "listing", request: { topic: "x" } });
    expect(parseResourcesSegments(["page", "x"])).toEqual({ kind: "listing", request: { pageSegment: "x" } });
    expect(parseResourcesSegments(["topic"])).toEqual({ kind: "listing", request: { type: "topic" } });
    expect(parseResourcesSegments(["topic", "topic", "x"])).toEqual({ kind: "listing", request: { type: "topic", topic: "x" } });
    expect(parseResourcesSegments(["page", "page", "2"])).toEqual({ kind: "listing", request: { type: "page", pageSegment: "2" } });
    expect(parseResourcesSegments(["webinar", "topic"])).toEqual({ kind: "resource", type: "webinar", slug: "topic" });
  });

  it("is null for a shape no route has", () => {
    for (const segments of [["a", "b", "c"], ["a", "topic", "b", "c"], ["topic", "a", "b", "c"], ["a", "page", "2", "x"], ["a", "topic", "b", "page"], ["a", "b", "c", "d", "e"], ["a", "topic", "b", "page", "2", "x"], ["a", "b", "c", "d", "e", "f", "g"]]) {
      expect(parseResourcesSegments(segments), segments.join("/")).toBeNull();
    }
  });

  it("round-trips every path the builders make", () => {
    for (const type of ["webinar", "%e6%97%a5", "a-b_c~e"]) {
      for (const topic of ["a11y", "%d0%b4%d0%be%d0%bc"]) {
        for (const page of [1, 2, 12]) {
          for (const path of [listingPath({}, page), listingPath({ type }, page), listingPath({ topic }, page), listingPath({ type, topic }, page)]) {
            const parsed = parseResourcesSegments(path.slice("/resources/".length).split("/").filter((segment) => segment !== ""));
            expect(parsed?.kind, path).toBe("listing");
            const valid = parsed?.kind === "listing" ? validListing(parsed.request) : null;
            expect(valid, path).not.toBeNull();
            expect(listingPath(valid!.filter, valid!.page), path).toBe(path);
          }
        }
        const path = resourcePath(type, topic);
        expect(parseResourcesSegments(path.slice("/resources/".length).split("/").filter((segment) => segment !== ""))).toEqual({ kind: "resource", type, slug: topic });
      }
    }
  });

  it("knows every route under app/resources/, a route handler or a metadata file as much as a page, so a new one fails here until the table does", () => {
    const patterns = servedFiles(join(APP_DIR, "resources"), [], "/resources").map(({ segments }) => segments);
    expect(patterns.length, "the nine pages under app/resources/ and nothing else that answers requests: a new route handler or metadata file needs its served path checked against the table").toBe(9);
    const sample: Record<string, string> = { "[type]": "webinar", "[topic]": "a11y", "[slug]": "example", "[n]": "2" };
    for (const pattern of patterns) {
      const segments = pattern.filter((segment) => segment !== "[[...rest]]").map((segment) => sample[segment] ?? segment);
      for (const segment of segments) {
        expect(segment, `${pattern.join("/")}: every dynamic segment of a route under app/resources/ has a sample here`).not.toMatch(/^\[/);
      }
      const parsed = parseResourcesSegments(segments);
      expect(parsed, pattern.join("/")).not.toBeNull();
      if (parsed?.kind === "listing") {
        expect(validListing(parsed.request), pattern.join("/")).not.toBeNull();
      } else if (parsed?.kind === "resource") {
        expect(isTypeSlug(parsed.type) && isSlug(parsed.slug), pattern.join("/")).toBe(true);
      }
    }
  });
});
