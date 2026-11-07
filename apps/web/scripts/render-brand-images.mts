/**
 * Renders the brand images the app ships as metadata files
 * (`packages/ui/DESIGN.md`, "Brand"), and checks that the committed ones are
 * still what a fresh render draws:
 *
 * - `app/apple-icon.png`: 180×180, the mark on the paper surface, no
 *   transparency, since iOS draws a black square behind any.
 * - `app/icon.png` and `app/favicon.ico`: the mark alone at 32×32 on a
 *   transparent background, for a browser or crawler that reads no SVG icon
 *   and for the `/favicon.ico` some still ask for unprompted; the ICO holds
 *   that same PNG as its one image (a PNG-in-ICO, which every browser that
 *   reads an ICO decodes).
 * - `app/opengraph-image.png`: 1200×630, the mark, "Resource Hub" and
 *   "Published by Colbination" on the paper surface, for the light contexts
 *   share cards are shown in.
 *
 * All are drawn from the one copy of the mark, `app/icon.svg`, and the share
 * image is set in the site's own Figtree file, `packages/ui/fonts/`; the
 * colours are read from `tokens.css`, the light side of each `light-dark()`
 * pair, so the images follow the tokens. They are drawn by Chromium inside
 * the same digest-pinned Playwright image the screenshot gate uses
 * (`e2e/browser-container.mts`), so a laptop and CI draw the same pixels.
 *
 *   node scripts/render-brand-images.mts           render and write the files
 *   node scripts/render-brand-images.mts --check   render in memory and compare
 *
 * `pnpm brand:images` is the first; run it after changing the mark, the
 * tokens or the words, look at the images, and commit them with the change.
 * `--check` decodes each fresh render and the committed file and compares
 * their pixels, failing with the file's name and what to run when more than
 * a few differ; `e2e/screenshots.mts` runs the same check against its own
 * container on every screenshot run (`pnpm web:test:screenshots`, CI's
 * screenshot step), so a stale image fails the gate rather than shipping.
 * Docker must be running; only the container this script starts is stopped.
 *
 * The images are committed rather than generated at request time with
 * `next/og` because Satori cannot read the woff2 file the site serves, so a
 * generated image would need a second copy of Figtree in TTF or OTF beside a
 * second copy of its licence, a ~500 KB rendering bundle in the deployment,
 * and a route of its own under the trailing-slash rule, for an image whose
 * words never change. The trade-off is that this script is run by hand
 * (and the check catches forgetting to), and that a share image per
 * resource is not possible this way; the day one is wanted, the TTF and
 * `next/og` are the path, and this file says where to start.
 */

import { chromium, type Browser, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserContainer, LAUNCH_HEADERS } from "../e2e/browser-container.mts";

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

// No background on the document: an opaque image paints its own, and a
// transparent one is captured with `omitBackground`.
const STYLE = `
  @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${FONT}) format("woff2"); font-weight: 300 900; }
  html, body { margin: 0; }
  body { color: ${ink}; font-family: Figtree, sans-serif; }
  svg { display: block; }
`;

interface Rendering {
  /** The PNG's path under the app; the ICO, when there is one, wraps this same PNG. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** A transparent background (RGBA), or the paper surface with no alpha channel (RGB). */
  readonly transparent: boolean;
  /**
   * How many pixels of a fresh render may differ from the committed file in
   * any channel before `--check` fails: room for anti-aliasing at an edge
   * landing a pixel apart between amd64 emulation on a laptop and CI's
   * native amd64, as in the screenshot gate (`e2e/README.md`), and far under
   * what a change of colour, word or shape moves.
   */
  readonly maxDiffPixels: number;
  readonly html: string;
}

const RENDERINGS: readonly Rendering[] = [
  {
    file: "app/apple-icon.png",
    width: 180,
    height: 180,
    transparent: false,
    maxDiffPixels: 10,
    // The mark fills the square with a margin of about a tenth; iOS rounds the corners itself.
    html: `<div style="width:180px;height:180px;display:flex;align-items:center;justify-content:center;background:${surface}">
      <div style="width:148px;height:148px">${MARK}</div>
    </div>`,
  },
  {
    file: "app/icon.png",
    width: 32,
    height: 32,
    transparent: true,
    maxDiffPixels: 4,
    // The mark alone, edge to edge: its own drawing leaves the margin, as the SVG icon does.
    html: `<div style="width:32px;height:32px">${MARK}</div>`,
  },
  {
    file: "app/opengraph-image.png",
    width: 1200,
    height: 630,
    transparent: false,
    maxDiffPixels: 50,
    // The lockup at share-card size: the mark, the wordmark as a heading and the publisher as a muted line.
    html: `<div style="width:1200px;height:630px;display:flex;align-items:center;gap:64px;padding:0 96px;box-sizing:border-box;background:${surface}">
      <div style="width:200px;height:200px;flex:none">${MARK}</div>
      <div style="display:flex;flex-direction:column;gap:16px;white-space:nowrap">
        <div style="font-size:96px;font-weight:700;letter-spacing:-0.02em;line-height:1.1">Resource Hub</div>
        <div style="font-size:40px;font-weight:500;color:${muted};line-height:1.25">Published by Colbination</div>
      </div>
    </div>`,
  },
];

/** The ICO file, holding `app/icon.png`'s render as its one image. */
const FAVICON = { file: "app/favicon.ico", from: "app/icon.png" } as const;

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/** An ICO with one 32-bit image stored as PNG, which ICO allows since Windows Vista and every browser reads. */
export function pngToIco(png: Buffer): Buffer {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width > 256 || height > 256) throw new Error(`An ICO image is at most 256 px a side; this PNG is ${width}×${height}.`);
  const header = Buffer.alloc(ICO_HEADER_BYTES + ICO_ENTRY_BYTES);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1: an icon (2 would be a cursor)
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(width % 256, 6); // 0 means 256
  header.writeUInt8(height % 256, 7);
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(ICO_HEADER_BYTES + ICO_ENTRY_BYTES, 18);
  return Buffer.concat([header, png]);
}

/** The PNG inside an ICO written by `pngToIco`; throws, saying why, for anything else. */
export function icoPng(ico: Buffer): Buffer {
  if (ico.length < ICO_HEADER_BYTES + ICO_ENTRY_BYTES || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
    throw new Error("it is not an ICO file");
  }
  if (ico.readUInt16LE(4) !== 1) throw new Error(`it holds ${ico.readUInt16LE(4)} images, not one`);
  const size = ico.readUInt32LE(14);
  const offset = ico.readUInt32LE(18);
  const png = ico.subarray(offset, offset + size);
  if (png.length !== size || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("its image is not a PNG");
  }
  return png;
}

async function render(browser: Browser, rendering: Rendering): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: rendering.width, height: rendering.height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${rendering.html}</body></html>`);
    // Faces load lazily, when text uses them: ask for this one, then make sure it is there.
    await page.evaluate(() => document.fonts.load("700 16px Figtree").then(() => undefined));
    if (!(await page.evaluate(() => document.fonts.check("700 16px Figtree")))) {
      throw new Error("Figtree did not load; the share image would be drawn in a fallback face.");
    }
    return await page.screenshot({
      type: "png",
      omitBackground: rendering.transparent,
      clip: { x: 0, y: 0, width: rendering.width, height: rendering.height },
    });
  } finally {
    await page.close();
  }
}

/** Every brand file's bytes as a fresh render draws them, by path under the app. */
export async function renderBrandImages(browser: Browser): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const rendering of RENDERINGS) files.set(rendering.file, await render(browser, rendering));
  files.set(FAVICON.file, pngToIco(files.get(FAVICON.from) as Buffer));
  return files;
}

/** Renders every brand file and writes it into the app. */
export async function writeBrandImages(browser: Browser): Promise<void> {
  for (const [file, bytes] of await renderBrandImages(browser)) {
    writeFileSync(join(APP_DIR, file), bytes);
    console.log(`${file}: ${bytes.length} bytes`);
  }
}

interface PixelDifference {
  readonly width: [number, number];
  readonly height: [number, number];
  /** Pixels whose colour or alpha differs in any channel. */
  readonly differing: number;
  /** The largest difference in one channel, 0 to 255. */
  readonly largest: number;
}

/**
 * Decodes two PNGs in the browser (an image bitmap drawn on a canvas with no
 * colour conversion, so each side's stored values) and counts the pixels
 * that differ, as RGBA. Both sides are decoded the same way, so a difference
 * is in the files, not the decoder.
 */
async function comparePixels(page: Page, fresh: Buffer, committed: Buffer): Promise<PixelDifference> {
  return page.evaluate(
    async ([a, b]) => {
      async function decode(base64: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
        const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        context.drawImage(bitmap, 0, 0);
        return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
      }
      const [x, y] = await Promise.all([decode(a), decode(b)]);
      let differing = 0;
      let largest = 0;
      if (x.width === y.width && x.height === y.height) {
        for (let i = 0; i < x.data.length; i += 4) {
          let pixel = 0;
          for (let c = 0; c < 4; c += 1) pixel = Math.max(pixel, Math.abs(x.data[i + c] - y.data[i + c]));
          if (pixel > 0) differing += 1;
          largest = Math.max(largest, pixel);
        }
      }
      return { width: [x.width, y.width], height: [x.height, y.height], differing, largest } as PixelDifference;
    },
    [fresh.toString("base64"), committed.toString("base64")] as const,
  );
}

/**
 * What is stale among the committed brand files, one plain sentence each,
 * from a fresh render in `browser`; empty when every file matches within its
 * tolerance. Nothing is written.
 */
export async function checkBrandImages(browser: Browser): Promise<string[]> {
  const fresh = await renderBrandImages(browser);
  const problems: string[] = [];
  const page = await browser.newPage();
  try {
    for (const rendering of RENDERINGS) {
      const files = rendering.file === FAVICON.from ? [rendering.file, FAVICON.file] : [rendering.file];
      for (const file of files) {
        const path = join(APP_DIR, file);
        if (!existsSync(path)) {
          problems.push(`${file} is missing.`);
          continue;
        }
        let committed: Buffer = readFileSync(path);
        if (file === FAVICON.file) {
          try {
            committed = icoPng(committed);
          } catch (error) {
            problems.push(`${file} cannot be read: ${error instanceof Error ? error.message : String(error)}.`);
            continue;
          }
        }
        const difference = await comparePixels(page, fresh.get(rendering.file) as Buffer, committed);
        const [freshWidth, committedWidth] = difference.width;
        const [freshHeight, committedHeight] = difference.height;
        if (freshWidth !== committedWidth || freshHeight !== committedHeight) {
          problems.push(`${file} is ${committedWidth}×${committedHeight}, but a fresh render is ${freshWidth}×${freshHeight}.`);
        } else if (difference.differing > rendering.maxDiffPixels) {
          problems.push(
            `${file} differs from a fresh render in ${difference.differing} of ${freshWidth * freshHeight} pixels (at most ${rendering.maxDiffPixels} may), by up to ${difference.largest} in one channel.`,
          );
        } else {
          console.log(`${file}: matches a fresh render (${difference.differing} pixels differ, at most ${rendering.maxDiffPixels} may).`);
        }
      }
    }
  } finally {
    await page.close();
  }
  return problems;
}

/** The message `--check` and the screenshot run end with when a brand file is stale. */
export function staleMessage(problems: readonly string[]): string {
  return [
    "The committed brand images are not what the mark, the tokens and Figtree draw now:",
    ...problems.map((problem) => `  - ${problem}`),
    "Run `pnpm --filter resource-hub-web brand:images`, look at the images, and commit them with the change.",
  ].join("\n");
}

/** Connects a plain client to a browser server started by `BrowserContainer`, with the launch arguments the server needs. */
export function connectToContainer(endpoint: string): Promise<Browser> {
  return chromium.connect(endpoint, { headers: LAUNCH_HEADERS });
}

async function main(check: boolean): Promise<number> {
  const container = new BrowserContainer();
  const stop = () => container.stop();
  process.on("exit", stop);
  for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.on(signal, () => {
      stop();
      process.exit(code);
    });
  }
  try {
    container.start();
    const browser = await connectToContainer(await container.endpoint());
    try {
      if (!check) {
        await writeBrandImages(browser);
        return 0;
      }
      const problems = await checkBrandImages(browser);
      if (problems.length === 0) return 0;
      console.error(staleMessage(problems));
      return 1;
    } finally {
      await browser.close();
    }
  } finally {
    stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) {
    console.error(`Usage: node scripts/render-brand-images.mts [--check] (got ${JSON.stringify(args)}).`);
    process.exit(2);
  }
  let code = 1;
  try {
    code = await main(args.includes("--check"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(code);
}
