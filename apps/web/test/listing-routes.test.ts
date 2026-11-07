import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CMS_REVALIDATE_SECONDS } from "../lib/wp/fetch";

/**
 * The eight listing routes keep the segment config ISR rests on: the build
 * never fails for a CMS reason (ADRs 0043 and 0053), and each listing is
 * rendered on its first request and stored (`docs/architecture/caching.md`),
 * except the library and each type's first page, which the build prerenders
 * when the CMS answers (`lib/prerender.ts`). Next.js reads `revalidate`
 * statically, so it has to be a literal in each file and cannot be imported;
 * this test is what keeps those literals equal to the data layer's interval.
 * And a listing stays ISR only while it calls nothing that makes the route
 * dynamic (`connection()`, `headers()`, `cookies()`, `searchParams`) and has
 * a `generateStaticParams` for its dynamic segments: the two prerendered
 * routes call the prerender module's probes, and the other six return `[]`,
 * since topic listings and later pages grow with what editors add.
 */

const LISTING_ROUTES = [
  "app/resources/[[...rest]]/page.tsx",
  "app/resources/page/[n]/page.tsx",
  "app/resources/[type]/page.tsx",
  "app/resources/[type]/page/[n]/page.tsx",
  "app/resources/topic/[topic]/page.tsx",
  "app/resources/topic/[topic]/page/[n]/page.tsx",
  "app/resources/[type]/topic/[topic]/page.tsx",
  "app/resources/[type]/topic/[topic]/page/[n]/page.tsx",
];

/** The listings the build prerenders, through the probe in `lib/prerender.ts` each calls. */
const PRERENDERED: Record<string, string> = {
  "app/resources/[[...rest]]/page.tsx": "libraryParams",
  "app/resources/[type]/page.tsx": "typeListingParams",
};

/** The literal the routes export. */
const ROUTE_REVALIDATE = 3600;

function source(route: string): string {
  return readFileSync(fileURLToPath(new URL(`../${route}`, import.meta.url)), "utf8");
}

/** `code` without its comments, so prose that names an API is not mistaken for a call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the listing routes", () => {
  it("export an interval equal to the data layer's", () => {
    expect(ROUTE_REVALIDATE).toBe(CMS_REVALIDATE_SECONDS);
  });

  for (const route of LISTING_ROUTES) {
    describe(route, () => {
      const code = withoutComments(source(route));

      it(`exports revalidate = ${ROUTE_REVALIDATE} as a literal`, () => {
        const matches = [...code.matchAll(/^export const revalidate = (.+);$/gm)];
        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe(String(ROUTE_REVALIDATE));
      });

      const probe = PRERENDERED[route];
      if (probe === undefined) {
        it("has a generateStaticParams that returns [], since the listing grows with what editors add", () => {
          expect(code).toMatch(/^export function generateStaticParams\(\)[^\n]*\{\s*return \[\];\s*\}/m);
        });
      } else {
        it(`has a generateStaticParams that is the prerender module's ${probe}, which is [] when the CMS does not answer`, () => {
          expect(code).toMatch(new RegExp(`^import \\{ ${probe} \\} from "@/lib/prerender";$`, "m"));
          expect(code).toMatch(new RegExp(`^export function generateStaticParams\\(\\)[^\\n]*\\{\\s*return ${probe}\\(\\);\\s*\\}`, "m"));
        });
      }

      it("calls nothing that makes the route dynamic", () => {
        expect(code).not.toMatch(/\bconnection\s*\(/);
        expect(code).not.toMatch(/\bheaders\s*\(/);
        expect(code).not.toMatch(/\bcookies\s*\(/);
        expect(code).not.toMatch(/\bsearchParams\b/);
      });
    });
  }
});
