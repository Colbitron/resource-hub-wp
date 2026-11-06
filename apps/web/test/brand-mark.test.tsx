import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandMark } from "../components/Brand";

/**
 * The mark is drawn twice, once as the site's icon (`app/icon.svg`, a file
 * Next.js serves as the favicon and the script that renders the PNGs reads)
 * and once inline in the header (`components/Brand.tsx`), because an inline
 * SVG costs no request and an icon file cannot be inlined. This keeps the
 * two the same drawing: every shape inside the tilted group, with the same
 * geometry and colours, in the same order.
 */

/**
 * The shapes inside the tilted group as a list of elements, each with its
 * attributes: the file writes `<rect … />` and React `<rect …></rect>`, and
 * whitespace differs, so each element is reduced to its tag and attributes.
 */
function shapes(svg: string): string[] {
  const group = svg.match(/<g [^>]*>([\s\S]*?)<\/g>/);
  if (group === null) throw new Error("No tilted group in the SVG");
  return [...group[1].matchAll(/<([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/g)].map(
    (match) => `${match[1]}${match[2].replace(/\s+/g, " ").trimEnd()}`,
  );
}

describe("the brand mark", () => {
  const icon = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
  const inline = renderToStaticMarkup(<BrandMark />);

  it("is the same drawing as app/icon.svg", () => {
    expect(shapes(inline)).toEqual(shapes(icon));
    expect(shapes(icon)).toHaveLength(3);
    expect(inline).toContain('transform="rotate(-6 32 32)"');
    expect(icon).toContain('transform="rotate(-6 32 32)"');
    expect(inline).toContain('viewBox="0 0 64 64"');
  });

  it("is hidden from assistive technology and never a tab stop", () => {
    expect(inline).toContain('aria-hidden="true"');
    expect(inline).toContain('focusable="false"');
    expect(inline).not.toContain("<title");
  });
});
