import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_SHARE_IMAGE } from "../lib/share-image";

/**
 * `DEFAULT_SHARE_IMAGE` describes `app/opengraph-image.png` to the routes
 * that write their own `openGraph`; this keeps it true to the file and to
 * the alt text the file-based tag carries (`app/opengraph-image.alt.txt`).
 */
describe("the default share image entry", () => {
  const png = readFileSync(new URL("../app/opengraph-image.png", import.meta.url));
  const alt = readFileSync(new URL("../app/opengraph-image.alt.txt", import.meta.url), "utf8").trim();

  it("has the PNG's size, from its IHDR chunk", () => {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({
      width: DEFAULT_SHARE_IMAGE.width,
      height: DEFAULT_SHARE_IMAGE.height,
    });
    // RGB without an alpha channel: the paper surface, never transparent.
    expect(png[25]).toBe(2);
  });

  it("has the alt text of the file-based tag, and the file's own route as its URL", () => {
    expect(DEFAULT_SHARE_IMAGE.alt).toBe(alt);
    expect(DEFAULT_SHARE_IMAGE.url).toBe("/opengraph-image.png");
  });
});
