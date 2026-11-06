/**
 * Renders the two brand PNGs the app ships as metadata files
 * (`packages/ui/DESIGN.md`, "Brand"): the apple touch icon,
 * `app/apple-icon.png` (180×180, the mark on the paper surface, no
 * transparency, since iOS draws a black square behind any), and the default
 * share image, `app/opengraph-image.png` (1200×630: the mark, "Resource Hub"
 * and "Published by Colbination" on the paper surface, for the light contexts
 * share cards are shown in). Both are drawn from the one copy of the mark,
 * `app/icon.svg`, and the share image is set in the site's own Figtree file,
 * `packages/ui/fonts/`, in the browser the gates already use (Playwright's
 * Chromium); the colours are read from `tokens.css`, the light side of each
 * `light-dark()` pair, so the images follow the tokens.
 *
 *   node scripts/render-brand-images.mts
 *
 * Run it after changing the mark, the tokens or the words, look at the two
 * images, and commit them with the change. The images are committed rather
 * than generated at request time with `next/og` because Satori cannot read
 * the woff2 file the site serves, so a generated image would need a second
 * copy of Figtree in TTF or OTF beside a second copy of its licence, a
 * ~500 KB rendering bundle in the deployment, and a route of its own under
 * the trailing-slash rule, for an image whose words never change. The
 * trade-off is that this script is run by hand, and that a share image per
 * resource is not possible this way; the day one is wanted, the TTF and
 * `next/og` are the path, and this file says where to start.
 */

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const MARK = readFileSync(join(APP_DIR, "app/icon.svg"), "utf8");
const FONT = readFileSync(require.resolve("@colbitron/resource-hub-ui/fonts/figtree-latin-wght-normal.woff2")).toString("base64");
const TOKENS = readFileSync(require.resolve("@colbitron/resource-hub-ui/tokens.css"), "utf8");

/** The light side of a `light-dark()` colour token, as the share cards' light contexts show it. */
function lightValue(token: string): string {
  const match = TOKENS.match(new RegExp(`${token}:\\s*light-dark\\(\\s*([^,]+?)\\s*,`));
  if (match === null) throw new Error(`${token} is not a light-dark() token in tokens.css`);
  return match[1];
}

const surface = lightValue("--rh-color-surface");
const ink = lightValue("--rh-color-text");
const muted = lightValue("--rh-color-text-muted");

const STYLE = `
  @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${FONT}) format("woff2"); font-weight: 300 900; }
  html, body { margin: 0; }
  body { background: ${surface}; color: ${ink}; font-family: Figtree, sans-serif; }
  svg { display: block; }
`;

interface Rendering {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly html: string;
}

const RENDERINGS: readonly Rendering[] = [
  {
    file: "app/apple-icon.png",
    width: 180,
    height: 180,
    // The mark fills the square with a margin of about a tenth; iOS rounds the corners itself.
    html: `<div style="width:180px;height:180px;display:flex;align-items:center;justify-content:center">
      <div style="width:148px;height:148px">${MARK}</div>
    </div>`,
  },
  {
    file: "app/opengraph-image.png",
    width: 1200,
    height: 630,
    // The lockup at share-card size: the mark, the wordmark as a heading and the publisher as a muted line.
    html: `<div style="width:1200px;height:630px;display:flex;align-items:center;gap:64px;padding:0 96px;box-sizing:border-box">
      <div style="width:200px;height:200px;flex:none">${MARK}</div>
      <div style="display:flex;flex-direction:column;gap:16px;white-space:nowrap">
        <div style="font-size:96px;font-weight:700;letter-spacing:-0.02em;line-height:1.1">Resource Hub</div>
        <div style="font-size:40px;font-weight:500;color:${muted};line-height:1.25">Published by Colbination</div>
      </div>
    </div>`,
  },
];

const browser = await chromium.launch();
try {
  for (const rendering of RENDERINGS) {
    const page = await browser.newPage({ viewport: { width: rendering.width, height: rendering.height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${rendering.html}</body></html>`);
    // Faces load lazily, when text uses them: ask for this one, then make sure it is there.
    await page.evaluate(() => document.fonts.load("700 16px Figtree").then(() => undefined));
    if (!(await page.evaluate(() => document.fonts.check("700 16px Figtree")))) {
      throw new Error("Figtree did not load; the share image would be drawn in a fallback face.");
    }
    const png = await page.screenshot({
      type: "png",
      omitBackground: false,
      clip: { x: 0, y: 0, width: rendering.width, height: rendering.height },
    });
    writeFileSync(join(APP_DIR, rendering.file), png);
    console.log(`${rendering.file}: ${rendering.width}×${rendering.height}, ${png.length} bytes`);
    await page.close();
  }
} finally {
  await browser.close();
}
