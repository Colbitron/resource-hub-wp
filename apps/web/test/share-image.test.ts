import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SHARE_IMAGE } from "../lib/share-image";

/**
 * The static import as Next.js resolves it (`StaticImageData`): the URL of
 * the content-hashed copy under `/_next/static/media/`, and the size read
 * from the file. Vite would give a plain string, so the import is stood in
 * here; `e2e/brand.spec.ts` checks the real URL on the built app.
 */
vi.mock("@/app/opengraph-image.png", () => ({
  default: { src: "/_next/static/media/opengraph-image.0123abcd.png", width: 1200, height: 630 },
}));

/**
 * `DEFAULT_SHARE_IMAGE` describes `app/opengraph-image.png` to the routes
 * that write their own `openGraph`; this keeps it true to the file and to
 * the alt text the file-based tag carries (`app/opengraph-image.alt.txt`).
 */
describe("the default share image entry", () => {
  const png = readFileSync(new URL("../app/opengraph-image.png", import.meta.url));
  const alt = readFileSync(new URL("../app/opengraph-image.alt.txt", import.meta.url), "utf8").trim();

  it("is a 1200 by 630 PNG with no alpha channel, from its IHDR chunk", () => {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 1200, height: 630 });
    // RGB without an alpha channel: the paper surface, never transparent.
    expect(png[25]).toBe(2);
  });

  it("takes its URL and size from the static import, so the URL is the content-hashed one", () => {
    expect(DEFAULT_SHARE_IMAGE).toMatchObject({
      url: "/_next/static/media/opengraph-image.0123abcd.png",
      type: "image/png",
      width: 1200,
      height: 630,
    });
  });

  it("has the alt text of the file-based tag", () => {
    expect(DEFAULT_SHARE_IMAGE.alt).toBe(alt);
  });
});
