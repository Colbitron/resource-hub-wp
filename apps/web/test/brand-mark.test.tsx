import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandMark } from "../components/Brand";

/**
 * The mark's one canonical drawing is `brand/mark.svg` in the shared package
 * (`@colbitron/resource-hub-ui`, `packages/ui/DESIGN.md`, "Brand"). The front
 * end draws it twice more, once as the site's icon (`app/icon.svg`, a file
 * Next.js serves as the favicon and the script that renders the PNGs reads)
 * and once inline in the header (`components/Brand.tsx`), because an inline
 * SVG costs no request and an icon file cannot be inlined. This keeps both
 * the same drawing as the canonical one: every shape inside the tilted
 * group, with the same geometry and colours, in the same order. The CMS
 * theme's inline copy is held to the same file by the plugin's PHPUnit
 * `BrandMarkTest`, with the same reduction.
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
  const require = createRequire(import.meta.url);
  const canonical = readFileSync(require.resolve("@colbitron/resource-hub-ui/brand/mark.svg"), "utf8");
  const icon = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
  const inline = renderToStaticMarkup(<BrandMark />);

  it("is drawn once in the shared package, three shapes in a tilted group", () => {
    expect(shapes(canonical)).toHaveLength(3);
    expect(canonical).toContain('transform="rotate(-6 32 32)"');
    expect(canonical).toContain('viewBox="0 0 64 64"');
  });

  it("app/icon.svg is the canonical drawing", () => {
    expect(shapes(icon)).toEqual(shapes(canonical));
    expect(icon).toContain('transform="rotate(-6 32 32)"');
    expect(icon).toContain('viewBox="0 0 64 64"');
  });

  it("the header's inline mark is the canonical drawing", () => {
    expect(shapes(inline)).toEqual(shapes(canonical));
    expect(inline).toContain('transform="rotate(-6 32 32)"');
    expect(inline).toContain('viewBox="0 0 64 64"');
  });

  it("is hidden from assistive technology and never a tab stop", () => {
    expect(inline).toContain('aria-hidden="true"');
    expect(inline).toContain('focusable="false"');
    expect(inline).not.toContain("<title");
  });
});
