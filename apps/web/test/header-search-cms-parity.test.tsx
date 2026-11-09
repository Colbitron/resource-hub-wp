import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HeaderSearchBar } from "../components/HeaderSearchBar";
import { HeaderSearchIcon } from "../components/HeaderSearchIcon";
import { SEARCH_PATH } from "../lib/routes";
import { HEADER_SEARCH_INPUT_ID, SEARCH_INPUT_ID } from "../lib/search-field";

vi.mock("next/navigation", () => ({
  usePathname: () => "/resources/",
}));

/**
 * The CMS theme's header search control is its own script,
 * `wp-content/themes/resource-hub/js/header-search.js`, since the contract
 * package shares CSS and markup but no JavaScript (`packages/ui/DESIGN.md`).
 * The server markup both sides start from is the contract's
 * `header-search.html` fixture (`markup-parity.test.tsx`); what the script
 * then builds in the browser must be what `HeaderSearch` builds after
 * hydration, so this holds the script's literals to the front end's: the
 * panel's id (`PANEL_ID` in `components/HeaderSearch.tsx`), the bar's field
 * id and the search page's field id (`lib/search-field.ts`), the icon's two
 * drawings (`HeaderSearchIcon`, closed and open), and the bar's markup, the
 * front end's `HeaderSearchBar` byte for byte but for the two things the CMS
 * writes differently by design: the form's `action`, set from the script's
 * data once the markup is in the document, and the field's name, core's `s`
 * for the front end's `q`. A change to either side fails here until the other
 * follows. The behaviour (open, close, focus, Escape, the lazy stylesheets) is
 * the plugin's `theme-header-search.spec.js`, as the front end's is
 * `e2e/header-search.spec.ts`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.resolve(here, "../../../wp-content/themes/resource-hub/js/header-search.js"), "utf8");
const headerSearch = readFileSync(path.resolve(here, "../components/HeaderSearch.tsx"), "utf8");
const headerPart = readFileSync(path.resolve(here, "../../../wp-content/themes/resource-hub/parts/header.html"), "utf8");

/** The one string literal a `const NAME = '…'` declaration holds, in either quote and any layout. */
function constant(source: string, name: string): string {
  const match = source.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(['"])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`));
  expect(match, `declares ${name}`).not.toBeNull();
  return match![2]!;
}

/** The inside of the first `<svg>` in `markup`. */
function svgInner(markup: string): string {
  const match = markup.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("the CMS theme's header search script keeps the front end's constants", () => {
  it("controls a panel with the front end's id", () => {
    expect(constant(script, "PANEL_ID")).toBe(constant(headerSearch, "PANEL_ID"));
    expect(script).toMatch(/setAttribute\(\s*'aria-controls',\s*PANEL_ID\s*\)/);
  });

  it("gives the bar's field and the page's field the front end's ids", () => {
    expect(constant(script, "INPUT_ID")).toBe(HEADER_SEARCH_INPUT_ID);
    expect(constant(script, "PAGE_INPUT_ID")).toBe(SEARCH_INPUT_ID);
    expect(HEADER_SEARCH_INPUT_ID).not.toBe(SEARCH_INPUT_ID);
  });

  it("draws the front end's two icons", () => {
    expect(constant(script, "ICON_SEARCH")).toBe(svgInner(renderToStaticMarkup(<HeaderSearchIcon />)));
    expect(constant(script, "ICON_CLOSE")).toBe(svgInner(renderToStaticMarkup(<HeaderSearchIcon open />)));
  });

  it("names the control Search, as the front end's button and link are named", () => {
    expect(script).toMatch(/setAttribute\(\s*'aria-label',\s*'Search'\s*\)/);
  });

  it("links to the front end's search path without JavaScript", () => {
    expect(headerPart).toContain(`class="rh-header-search__toggle" href="${SEARCH_PATH}"`);
  });
});

describe("the CMS theme's header search script builds the front end's bar", () => {
  it("writes HeaderSearchBar's markup, with the action left for the script's data and the field named s", () => {
    const frontEnd = renderToStaticMarkup(<HeaderSearchBar />);
    expect(frontEnd).toContain(`action="${SEARCH_PATH}"`);
    expect(frontEnd).toContain('name="q"');
    // React writes `enterKeyHint` as given, which the HTML parser reads as the script's lower-case `enterkeyhint`.
    const expected = frontEnd
      .replace(`action="${SEARCH_PATH}"`, 'action=""')
      .replace('name="q"', 'name="s"')
      .replace(/ ([A-Za-z][\w:.-]*)="/g, (_, name: string) => ` ${name.toLowerCase()}="`);
    expect(constant(script, "BAR_HTML")).toBe(expected);
    // The one `s` and the one empty action are those two, and the script sets the action from its data.
    expect(constant(script, "BAR_HTML").match(/name="/g)).toHaveLength(1);
    expect(script).toMatch(/setAttribute\(\s*'action',\s*action\s*\)/);
  });

  it("writes no other HTML than that string", () => {
    const withoutConstants = script.replace(/\bconst\s+(?:ICON_SEARCH|ICON_CLOSE|BAR_HTML)\s*=\s*'[^']*';/g, "");
    expect(withoutConstants).not.toMatch(/innerHTML\s*=\s*['"`]/);
    expect(withoutConstants).not.toMatch(/insertAdjacentHTML/);
  });
});
