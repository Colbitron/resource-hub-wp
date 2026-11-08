import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { siteIcons } from "../lib/site-icons";

/**
 * The static imports as Turbopack resolves them (`StaticImageData`): the URL
 * of the content-hashed copy under `/_next/static/media/` and the size read
 * from the file. Vite would give a plain string, so they are stood in here;
 * `e2e/brand.spec.ts` checks the real links, URLs and files on the built app.
 */
vi.mock("@/app/icon.png", () => ({
  default: { src: "/_next/static/media/icon.0123abcd.png", width: 32, height: 32 },
}));
vi.mock("@/app/icon.svg", () => ({
  default: { src: "/_next/static/media/icon.4567efgh.svg", width: 32, height: 32 },
}));
vi.mock("@/app/apple-icon.png", () => ({
  default: { src: "/_next/static/media/apple-icon.89abijkl.png", width: 180, height: 180 },
}));

/**
 * The root layout's icon links (`lib/site-icons.ts`) are one literal list,
 * so their order cannot depend on the order the filesystem lists `app/`
 * in, which is what made the file conventions put the SVG before the PNG
 * on an ext4 CI sandbox.
 */
describe("the site's icon links", () => {
  const icons = siteIcons();

  it("are the PNG then the SVG, with the convention's URLs, types and sizes", () => {
    expect(icons.icon).toEqual([
      { url: "/icon.png?icon.0123abcd.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg?icon.4567efgh.svg", sizes: "any", type: "image/svg+xml" },
    ]);
  });

  it("name the apple touch icon, which an explicit list must, or its file-based link is dropped", () => {
    expect(icons.apple).toEqual([{ url: "/apple-icon.png?apple-icon.89abijkl.png", sizes: "180x180", type: "image/png" }]);
  });

  it("leave favicon.ico to Next.js, which puts the root favicon in front of the list itself", () => {
    expect(JSON.stringify(icons)).not.toContain("favicon");
  });

  /**
   * An explicit `icons` replaces every file-based `icon` and `apple` link,
   * nested segments' included, so an icon file this list does not name
   * would be served but never linked. Every file the conventions would
   * pick up anywhere under `app/` (images, and `icon` or `apple-icon`
   * route modules) has to be one the list or Next.js's favicon handles.
   * The expected files are read from the list itself, each link's route
   * without its query, so a new icon file passes only once the list names
   * it, and a link whose file is gone fails too.
   */
  it("cover every icon file under app/, so none is served unlinked, and name no file that is missing", () => {
    const app = fileURLToPath(new URL("../app/", import.meta.url));
    const convention = /^(favicon\.ico|(icon|apple-icon)\d?\.(ico|jpe?g|png|svg|[jt]sx?))$/;
    const files = readdirSync(app, { recursive: true, encoding: "utf8" })
      .filter((path) => convention.test(path.split(/[\\/]/).pop() as string))
      .map((path) => path.split("\\").join("/"))
      .sort();
    const listed = [...icons.icon, ...icons.apple].map((icon) => icon.url.split("?")[0].slice(1));
    expect(files).toEqual([...listed, "favicon.ico"].sort());
  });
});
