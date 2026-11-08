import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderSearch } from "../components/HeaderSearch";
import { HeaderSearchBar } from "../components/HeaderSearchBar";
import { SearchForm } from "../components/SearchForm";
import { isSearchPagePath, SEARCH_PATH } from "../lib/routes";
import { HEADER_SEARCH_INPUT_ID, SEARCH_INPUT_ID } from "../lib/search-field";

const pathname = vi.hoisted(() => ({ current: "/resources/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

/**
 * The header's search control (`components/HeaderSearch.tsx`) as the server
 * renders it, which is what a reader without JavaScript gets and what
 * hydration starts from: a plain link to `/search/` named "Search" with a
 * decorative icon, and on the search page a link to that page's own field;
 * never a button, an `aria-expanded` or the bar, which exist only on the
 * client. The bar's form (`HeaderSearchBar`) is the search page's own
 * `SearchForm` with an ID of its own, so the two fields never share one.
 * What the button does in a browser (opening, focus, Escape, closing on
 * focus or a press outside, submitting) is `e2e/header-search.spec.ts`.
 */

beforeEach(() => {
  pathname.current = "/resources/";
});

/** The attributes of the first `<tag …>` in `markup`; the unit tests run without a DOM. */
function attributes(markup: string, tag: string): Record<string, string> {
  const match = markup.match(new RegExp(`<${tag}((?:\\s+[a-zA-Z-]+(?:="[^"]*")?)*)\\s*/?>`));
  if (match === null) throw new Error(`No <${tag}> in ${markup}`);
  return Object.fromEntries([...match[1].matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]));
}

describe("the header's search control, as the server renders it", () => {
  it("is a plain link to the search page named Search, with a decorative icon, on every other page", () => {
    for (const path of ["/", "/resources/", "/resources/article/taxonomies-versus-meta/", "/welcome/", "/searching/"]) {
      pathname.current = path;
      const markup = renderToStaticMarkup(<HeaderSearch />);
      const link = attributes(markup, "a");
      expect(link.href, path).toBe(SEARCH_PATH);
      expect(link["aria-label"], path).toBe("Search");
      expect(link.class).toBe("rh-header-search__toggle");
      const icon = attributes(markup, "svg");
      expect(icon["aria-hidden"]).toBe("true");
      expect(icon.focusable).toBe("false");
      expect(markup).not.toMatch(/<button|aria-expanded|aria-controls|<form|rh-header-search__panel/);
      expect(markup.startsWith('<div class="rh-header-search">')).toBe(true);
    }
  });

  it("links to the page's own field on the search page, so the header never adds a second form there", () => {
    for (const path of ["/search/", "/search"]) {
      pathname.current = path;
      const markup = renderToStaticMarkup(<HeaderSearch />);
      const link = attributes(markup, "a");
      expect(link.href, path).toBe(`#${SEARCH_INPUT_ID}`);
      expect(link["aria-label"]).toBe("Search");
      expect(markup).not.toMatch(/<button|aria-expanded|<form/);
    }
  });
});

describe("isSearchPagePath", () => {
  it("is true for the search page's path, with or without the trailing slash the client router drops", () => {
    expect(isSearchPagePath("/search/")).toBe(true);
    expect(isSearchPagePath("/search")).toBe(true);
  });

  it("is false for every other path, a path under the search page's and a longer word included", () => {
    for (const path of ["/", "/resources/", "/search/x/", "/searching/", "/Search/", "/resources/search/"]) {
      expect(isSearchPagePath(path), path).toBe(false);
    }
  });
});

describe("the search form's field ID", () => {
  it("is the search page's own by default, which the label names", () => {
    const markup = renderToStaticMarkup(<SearchForm input="" />);
    expect(attributes(markup, "label").for).toBe(SEARCH_INPUT_ID);
    expect(attributes(markup, "input").id).toBe(SEARCH_INPUT_ID);
  });

  it("is the bar's own in the header's bar, the same GET form to the search page with a field named q", () => {
    const markup = renderToStaticMarkup(<HeaderSearchBar />);
    expect(HEADER_SEARCH_INPUT_ID).not.toBe(SEARCH_INPUT_ID);
    const form = attributes(markup, "form");
    expect(form).toMatchObject({ role: "search", action: SEARCH_PATH, method: "get", class: "rh-search" });
    expect(attributes(markup, "label").for).toBe(HEADER_SEARCH_INPUT_ID);
    expect(attributes(markup, "input")).toMatchObject({ id: HEADER_SEARCH_INPUT_ID, type: "search", name: "q", value: "" });
    expect(markup).not.toContain("aria-invalid");
    expect(markup).not.toContain("aria-describedby");
  });
});

describe("the control's stylesheets", () => {
  const require = createRequire(import.meta.url);
  const eager = readFileSync(require.resolve("@colbitron/resource-hub-ui/header-search.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bar = readFileSync(require.resolve("@colbitron/resource-hub-ui/header-search-bar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  // Every page's HTML carries the eager file three times (HeaderSearch's
  // docblock), so the bar's and the open state's rules wait in the lazy one.
  it("keeps the bar and the open state out of the file every page inlines", () => {
    expect(eager).not.toMatch(/__panel|aria-expanded|:has\(|transition/);
    expect(bar).toMatch(/\.rh-header-search__panel\s*\{/);
    expect(bar).toMatch(/\[aria-expanded="true"\]/);
  });

  it("never restyles the shell's header except to anchor the bar to a header that holds the control", () => {
    for (const css of [eager, bar]) {
      const shellSelectors = [...css.matchAll(/([^{}]*\.rh-header(?:__inner)?(?![\w-])[^{}]*)\{/g)].map((m) => m[1].trim());
      expect(shellSelectors.filter((selector) => selector !== ".rh-header:has(.rh-header-search)")).toEqual([]);
    }
  });
});
