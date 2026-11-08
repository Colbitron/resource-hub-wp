/**
 * Renders one featured image per seeded resource, plus a contact sheet.
 *
 * The images are abstract, text-free cards in the visual language of the
 * owner's LinkedIn post cards: paper background, soft overlapping palette
 * orbs, the five-dot row, a warm panel with its line and soft shadow, a lemon
 * hand-drawn squiggle, and one motif in the resource type's accent colour so
 * the type reads at a glance in a card grid.
 *
 * Everything is laid out in the LinkedIn cards' own CSS units on a 1200×630
 * viewport and screenshotted at device scale 2, so the PNG is 2400×1260: twice
 * the Open Graph size, and under WordPress's 2560 px big-image threshold.
 *
 * Randomness is a PRNG seeded by the resource slug: the same slug always gives
 * the same file. The slugs and types come from the plugin's Seeder, so a change
 * there fails this script rather than silently drifting.
 *
 * Usage: node tools/featured-images/generate.mts [--out DIR]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import accentTable from "../../packages/ui/type-accents.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The browser comes from the front end's own Playwright install, resolved from
 * `apps/web`, so this tool adds no dependency and no lockfile change: a root
 * `@playwright/test` entry re-resolves peers across the plugin's packages.
 */
function loadPlaywright(): typeof import("@playwright/test") {
  try {
    return createRequire(path.join(ROOT, "apps/web/package.json"))("@playwright/test");
  } catch {
    throw new Error("Could not load @playwright/test from apps/web; run pnpm install at the repository root first.");
  }
}
const { chromium } = loadPlaywright();
const SEEDER = path.join(ROOT, "wp-content/plugins/resource-hub-wp/src/Seed/Seeder.php");
const DEFAULT_OUT = path.join(ROOT, "artifacts/featured-images");

/** CSS viewport; the PNG is this at device scale 2. */
const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2;

/** Warn above this and refuse above the hard ceiling (LinkedIn's 5 MB). */
const SOFT_LIMIT_BYTES = 1_000_000;
const HARD_LIMIT_BYTES = 5_000_000;

/** The light-scheme palette of the LinkedIn cards. */
const PALETTE = {
  coral: "#ee6358",
  cobalt: "#4056d6",
  lemon: "#efc34a",
  mint: "#1fa97d",
  grape: "#9d78e0",
} as const;
type Accent = keyof typeof PALETTE;

const PAPER = "#f6f4ef";
const SURFACE = "#fcfbf8";
const LINE = "rgb(30 28 34 / 0.12)";
const WARM = "#f0eadf";
const WARM_LINE = "rgb(120 100 60 / 0.22)";
const SHADOW = "0 10px 30px -18px rgb(30 28 34 / 0.3)";

/**
 * Which accent marks each resource type, keyed by slug, built from the shared
 * table, `packages/ui/type-accents.json`, the one file the front end and the
 * plugin read too. The table is keyed by term ID; the seeder's types are
 * slugs, so this keys its rows by their slug. readCatalogue() fails the run
 * on a row whose accent is not in PALETTE, and on a table and a seeder that
 * disagree on the types.
 */
const TYPE_ACCENTS: Readonly<Record<string, Accent>> = Object.fromEntries(
  accentTable.types.map((row) => [row.slug, row.accent as Accent]),
);

/**
 * A second palette colour each type may show sparingly in one orb, chosen so
 * the pair sits well together and the accent still dominates.
 */
const COMPANIONS: Readonly<Record<Accent, Accent>> = {
  mint: "lemon",
  grape: "coral",
  coral: "lemon",
  lemon: "coral",
  cobalt: "mint",
};

/** Orb opacity ceilings per colour: the dark accents need less to read the same. */
const ORB_OPACITY: Readonly<Record<Accent, readonly [number, number]>> = {
  coral: [0.14, 0.26],
  cobalt: [0.1, 0.2],
  lemon: [0.2, 0.36],
  mint: [0.12, 0.24],
  grape: [0.12, 0.22],
};

interface Resource {
  readonly slug: string;
  readonly type: string;
}

/* ---------------------------------------------------------------- seeder */

/**
 * Reads the catalogue from Seeder.php. Fails loudly on anything unexpected,
 * because an image with no post or a post with no image is worse than no run.
 */
async function readCatalogue(): Promise<Resource[]> {
  const source = await readFile(SEEDER, "utf8");

  const typesBlock = source.match(/public const TYPES = array\(([\s\S]*?)\);/);
  if (!typesBlock) throw new Error(`Could not find the TYPES constant in ${SEEDER}`);
  const seederTypes = [...typesBlock[1].matchAll(/'([a-z-]+)'\s*=>/g)].map((m) => m[1]);
  for (const [type, accent] of Object.entries(TYPE_ACCENTS)) {
    if (!Object.hasOwn(PALETTE, accent)) {
      throw new Error(`packages/ui/type-accents.json gives "${type}" the accent "${accent}", which PALETTE does not have.`);
    }
  }
  for (const type of seederTypes) {
    if (!(type in TYPE_ACCENTS)) {
      throw new Error(
        `Seeder type "${type}" has no row in packages/ui/type-accents.json; add its row there before generating.`,
      );
    }
  }
  for (const type of Object.keys(TYPE_ACCENTS)) {
    if (!seederTypes.includes(type)) {
      throw new Error(
        `packages/ui/type-accents.json has a row for "${type}" but the seeder's TYPES does not; one of the two is stale.`,
      );
    }
  }

  const catalogueBlock = source.match(/private const CATALOGUE = array\(([\s\S]*?)\n\t\);/);
  if (!catalogueBlock) throw new Error(`Could not find the CATALOGUE constant in ${SEEDER}`);

  const entries = catalogueBlock[1].split(/\barray\(\s*(?='slug')/).slice(1);
  const resources: Resource[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const slug = entry.match(/'slug'\s*=>\s*'([^']+)'/)?.[1];
    const type = entry.match(/'type'\s*=>\s*'([^']+)'/)?.[1];
    if (!slug || !type) throw new Error(`A catalogue entry lacks a slug or a type:\n${entry.slice(0, 200)}`);
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Unexpected slug "${slug}" in the seeder.`);
    if (seen.has(slug)) throw new Error(`Duplicate slug "${slug}" in the seeder.`);
    if (!seederTypes.includes(type)) throw new Error(`Entry "${slug}" has type "${type}", which TYPES does not list.`);
    seen.add(slug);
    resources.push({ slug, type });
  }
  if (resources.length === 0) throw new Error("The seeder's catalogue parsed as empty.");
  return resources;
}

/* ------------------------------------------------------------------ prng */

/** FNV-1a over the slug, then mulberry32: small, deterministic, good enough for layout. */
function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (const char of seed) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  /** Uniform in [min, max). */
  between(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

function makeRng(seed: string): Rng {
  const next = seededRandom(seed);
  return {
    between: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (probability) => next() < probability,
  };
}

/* ---------------------------------------------------------------- layout */

const round = (n: number) => Math.round(n * 100) / 100;

interface Panel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The warm panel: the composition's weight, kept inside the centre square
 * (x 285 to 915) with a margin, so the square preview crop never cuts it.
 */
function layoutPanel(rng: Rng): Panel {
  const w = rng.int(470, 550);
  const h = rng.int(320, 370);
  const cx = 600 + rng.between(-36, 36);
  const cy = 328 + rng.between(-10, 10);
  return { x: round(cx - w / 2), y: round(cy - h / 2), w, h };
}

interface Orb {
  readonly x: number;
  readonly y: number;
  readonly d: number;
  readonly color: Accent;
  readonly opacity: number;
}

/**
 * Four to six orbs: one large anchored to one side of the panel, one medium on
 * the other, a medium low, and one or two small ones high. They sit behind the
 * panel and may run off the canvas, so both crops still show a cluster, and
 * the wide 1.91:1 sides are never bare.
 */
function layoutOrbs(rng: Rng, panel: Panel, accent: Accent): Orb[] {
  const orbs: Orb[] = [];
  const side = rng.pick([-1, 1] as const);
  const [lo, hi] = ORB_OPACITY[accent];
  const opacity = (scale = 1) => round(rng.between(lo, hi) * scale);

  const big = rng.int(400, 520);
  orbs.push({
    x: round(side > 0 ? panel.x + panel.w - rng.between(120, 220) : panel.x - big + rng.between(120, 220)),
    y: round(rng.between(120, 260)),
    d: big,
    color: accent,
    opacity: opacity(),
  });

  const medium = rng.int(240, 320);
  orbs.push({
    x: round(side > 0 ? panel.x - medium + rng.between(60, 150) : panel.x + panel.w - rng.between(60, 150)),
    y: round(rng.between(40, 200)),
    d: medium,
    color: accent,
    opacity: opacity(),
  });

  const low = rng.int(220, 300);
  const companion = rng.chance(0.6);
  orbs.push({
    x: round(panel.x + rng.between(-40, panel.w - low + 40)),
    y: round(panel.y + panel.h - rng.between(80, 140)),
    d: low,
    color: companion ? COMPANIONS[accent] : accent,
    opacity: companion ? round(rng.between(...ORB_OPACITY[COMPANIONS[accent]])) : opacity(),
  });

  const smallCount = rng.int(1, 2);
  for (let i = 0; i < smallCount; i += 1) {
    const d = rng.int(90, 150);
    const onSide = i === 0 ? -side : side;
    orbs.push({
      x: round(onSide > 0 ? panel.x + panel.w + rng.between(-30, 160) : panel.x - d - rng.between(-30, 160)),
      y: round(rng.between(20, 110) + i * 220),
      d,
      color: accent,
      opacity: opacity(1.15),
    });
  }

  return orbs;
}

/* ---------------------------------------------------------------- motifs */

/** The lemon squiggle under a highlighted word on the LinkedIn cards. */
function squiggle(x: number, y: number, w: number): string {
  return `<svg class="squiggle" style="left:${x}px;top:${y}px;width:${w}px" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="M2 8 C 30 2, 52 11, 82 6 S 138 3, 162 7 S 190 9, 198 5"/></svg>`;
}

const PAD_X = 44;
const PAD_Y = 40;
/** The eyebrow dot row sits this far above the panel, left-aligned with it, as on the cards. */
const DOTS_ABOVE = 34;

interface MotifBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function motifBox(panel: Panel): MotifBox {
  return { x: PAD_X, y: PAD_Y, w: panel.w - PAD_X * 2, h: panel.h - PAD_Y * 2 };
}

type MotifRenderer = (rng: Rng, box: MotifBox, color: string) => string;

/** Article: a heading bar and a few paler lines of a paragraph, the squiggle under the heading. */
const article: MotifRenderer = (rng, box, color) => {
  const lines = rng.int(4, 5);
  const headH = 30;
  const lineH = 20;
  const gap = 18;
  const parts: string[] = [];
  const total = headH + gap + 14 + lines * (lineH + gap) - gap;
  let y = round(box.y + (box.h - total) / 2);
  const headW = round(box.w * rng.between(0.58, 0.8));
  parts.push(`<i class="bar" style="left:${box.x}px;top:${y}px;width:${headW}px;height:${headH}px;background:${color}"></i>`);
  parts.push(squiggle(box.x - 2, y + headH + 2, round(headW * rng.between(0.45, 0.7))));
  y += headH + gap + 14;
  for (let i = 0; i < lines; i += 1) {
    const last = i === lines - 1;
    const w = round(box.w * (last ? rng.between(0.3, 0.55) : rng.between(0.7, 1)));
    const opacity = rng.pick([0.3, 0.36, 0.42]);
    parts.push(`<i class="bar" style="left:${box.x}px;top:${y}px;width:${w}px;height:${lineH}px;background:${color};opacity:${opacity}"></i>`);
    y += lineH + gap;
  }
  return parts.join("");
};

/** Ebook: a stack of two or three portrait covers, the front one solid with a spine line. */
const ebook: MotifRenderer = (rng, box, color) => {
  const count = rng.int(2, 3);
  const w = rng.int(184, 204);
  const h = rng.int(228, 248);
  const step = rng.int(18, 24);
  const dir = rng.pick([-1, 1] as const);
  const cx = box.x + box.w / 2 + rng.between(-60, 60);
  const stackH = h + step * 0.8 * (count - 1);
  const baseY = round(box.y + (box.h - stackH) / 2 + step * 0.8 * (count - 1) - 8);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const front = i === count - 1;
    const back = count - 1 - i;
    const x = round(cx - w / 2 - dir * step * back);
    const y = round(baseY - step * back * 0.8);
    const opacity = front ? 1 : back === 1 ? 0.5 : 0.28;
    parts.push(`<i class="cover" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${color};opacity:${opacity}"></i>`);
    if (front) {
      parts.push(`<i class="spine" style="left:${x + 24}px;top:${y}px;height:${h}px"></i>`);
    }
  }
  parts.push(squiggle(round(cx - w / 2 + 10), round(baseY + h + 12), round(w * 0.7)));
  return parts.join("");
};

/** Webinar: a surface screen with a play disc, and a progress line under it. */
const webinar: MotifRenderer = (rng, box, color) => {
  const w = rng.int(280, 330);
  const h = round(w * 0.58);
  const x = round(box.x + (box.w - w) / 2 + rng.between(-40, 40));
  const y = round(box.y + (box.h - (h + 26 + 6)) / 2 - 6);
  const r = rng.int(32, 38);
  const discX = round(x + w / 2);
  const discY = round(y + h / 2);
  const tri = 0.56 * r;
  const triangle = `${round(discX - tri * 0.42)},${round(discY - tri * 0.62)} ${round(discX + tri * 0.62)},${discY} ${round(discX - tri * 0.42)},${round(discY + tri * 0.62)}`;
  const trackY = y + h + 26;
  const trackW = round(w * 0.86);
  const trackX = round(x + (w - trackW) / 2);
  const played = round(trackW * rng.between(0.28, 0.7));
  return [
    `<i class="screen" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></i>`,
    `<svg class="play" style="left:0;top:0;width:1200px;height:630px" viewBox="0 0 1200 630" aria-hidden="true"><circle cx="${discX}" cy="${discY}" r="${r}" fill="${color}"/><polygon points="${triangle}" fill="${SURFACE}"/></svg>`,
    `<i class="track" style="left:${trackX}px;top:${trackY}px;width:${trackW}px;background:${color};opacity:0.28"></i>`,
    `<i class="track" style="left:${trackX}px;top:${trackY}px;width:${played}px;background:${color}"></i>`,
    `<i class="knob" style="left:${round(trackX + played - 7)}px;top:${trackY - 5}px;background:${color}"></i>`,
    squiggle(round(x + rng.between(0, w * 0.4)), trackY + 22, round(w * rng.between(0.3, 0.45))),
  ].join("");
};

/** Podcast: a waveform of rounded bars under a smooth random envelope. */
const podcast: MotifRenderer = (rng, box, color) => {
  const count = rng.int(13, 17);
  const barW = 14;
  const gap = 10;
  const totalW = count * barW + (count - 1) * gap;
  const startX = round(box.x + (box.w - totalW) / 2);
  const midY = box.y + box.h / 2 - 10;
  const maxH = Math.min(170, box.h - 40);
  const phase = rng.between(0, Math.PI * 2);
  const freq = rng.between(0.5, 0.9);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const envelope = 0.5 + 0.5 * Math.sin(phase + i * freq) * Math.sin(t * Math.PI);
    const h = round(26 + (maxH - 26) * Math.max(0.08, envelope * rng.between(0.75, 1)));
    const x = startX + i * (barW + gap);
    const edge = Math.min(t, 1 - t);
    const opacity = edge < 0.12 ? 0.5 : 1;
    parts.push(`<i class="bar" style="left:${x}px;top:${round(midY - h / 2)}px;width:${barW}px;height:${h}px;background:${color};opacity:${opacity}"></i>`);
  }
  parts.push(squiggle(round(startX + totalW * rng.between(0.1, 0.4)), round(midY + maxH / 2 + 14), 160));
  return parts.join("");
};

/** Case study: a bar chart climbing to the right, the last bar solid, on a faint baseline. */
const caseStudy: MotifRenderer = (rng, box, color) => {
  const count = rng.int(5, 7);
  const barW = rng.int(38, 46);
  const gap = 18;
  const totalW = count * barW + (count - 1) * gap;
  const startX = round(box.x + (box.w - totalW) / 2);
  const maxH = Math.min(200, box.h - 40);
  const baseY = round(box.y + (box.h + maxH) / 2 - 10);
  const curve = rng.between(1.2, 2);
  const parts: string[] = [];
  parts.push(`<i class="baseline" style="left:${box.x}px;top:${baseY}px;width:${box.w}px"></i>`);
  for (let i = 0; i < count; i += 1) {
    const t = (i + 1) / count;
    const h = round(28 + (maxH - 28) * Math.pow(t, curve) * rng.between(0.82, 1));
    const x = startX + i * (barW + gap);
    const last = i === count - 1;
    parts.push(`<i class="bar" style="left:${x}px;top:${round(baseY - h)}px;width:${barW}px;height:${h}px;background:${color};opacity:${last ? 1 : 0.36}"></i>`);
  }
  parts.push(squiggle(round(startX + totalW - barW * 2.2), baseY + 10, round(barW * 2.4)));
  return parts.join("");
};

const MOTIFS: Readonly<Record<string, MotifRenderer>> = {
  article,
  ebook,
  webinar,
  podcast,
  "case-study": caseStudy,
};

/* ------------------------------------------------------------------ page */

const STYLE = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
body { position: relative; background: ${PAPER}; }
.orbs i { position: absolute; border-radius: 50%; }
.panel {
	position: absolute;
	background: ${WARM};
	border: 1px solid ${WARM_LINE};
	border-radius: 24px;
	box-shadow: ${SHADOW};
}
.dots { position: absolute; display: flex; gap: 8px; }
.dots i { width: 12px; height: 12px; border-radius: 50%; background: ${PALETTE.coral}; }
.dots i:nth-child(2) { background: ${PALETTE.cobalt}; }
.dots i:nth-child(3) { background: ${PALETTE.lemon}; }
.dots i:nth-child(4) { background: ${PALETTE.mint}; }
.dots i:nth-child(5) { background: ${PALETTE.grape}; }
.motif i, .motif svg { position: absolute; display: block; }
.bar { border-radius: 999px; }
.cover { border-radius: 12px; }
.spine { width: 3px; background: ${WARM}; opacity: 0.7; }
.screen { background: ${SURFACE}; border: 1px solid ${LINE}; border-radius: 16px; box-shadow: ${SHADOW}; }
.play { pointer-events: none; }
.track { height: 6px; border-radius: 999px; }
.knob { width: 16px; height: 16px; border-radius: 50%; }
.baseline { height: 1px; background: ${WARM_LINE}; }
.squiggle { overflow: visible; fill: none; stroke: ${PALETTE.lemon}; stroke-width: 4.5; stroke-linecap: round; height: 12px; }
`;

function renderPage(resource: Resource): string {
  const accent = TYPE_ACCENTS[resource.type];
  const motif = MOTIFS[resource.type];
  if (!accent || !motif) throw new Error(`No accent or motif for type "${resource.type}".`);

  const rng = makeRng(resource.slug);
  const panel = layoutPanel(rng);
  const orbs = layoutOrbs(rng, panel, accent);
  const box = motifBox(panel);

  const orbHtml = orbs
    .map((o) => `<i style="left:${o.x}px;top:${o.y}px;width:${o.d}px;height:${o.d}px;background:${PALETTE[o.color]};opacity:${o.opacity}"></i>`)
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<div class="orbs">${orbHtml}</div>
<div class="dots" style="left:${panel.x + 4}px;top:${panel.y - DOTS_ABOVE}px"><i></i><i></i><i></i><i></i><i></i></div>
<div class="panel" style="left:${panel.x}px;top:${panel.y}px;width:${panel.w}px;height:${panel.h}px">
<div class="motif">${motif(rng, box, PALETTE[accent])}</div>
</div>
</body></html>`;
}

/* ---------------------------------------------------------- contact sheet */

function renderContactSheet(rows: readonly { resource: Resource; png: Buffer }[]): string {
  const cell = (resource: Resource, src: string) => `
<section>
	<h2>${resource.slug} <small>${resource.type} · ${TYPE_ACCENTS[resource.type]}</small></h2>
	<div class="row">
		<figure><img class="full" src="${src}" alt=""><figcaption>1.91:1 full</figcaption></figure>
		<figure><div class="wide"><img src="${src}" alt=""></div><figcaption>16:9 card crop</figcaption></figure>
		<figure><div class="square"><img src="${src}" alt=""></div><figcaption>1:1 centre crop</figcaption></figure>
	</div>
</section>`;
  const body = rows.map(({ resource, png }) => cell(resource, `data:image/png;base64,${png.toString("base64")}`)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #e9e6df; font: 13px/1.4 system-ui, sans-serif; color: #1e1c22; padding: 24px; width: 1280px; }
h1 { font-size: 18px; margin-bottom: 16px; }
section { margin-bottom: 22px; }
h2 { font-size: 14px; margin-bottom: 8px; }
h2 small { font-weight: 400; color: #5c5962; margin-left: 8px; }
.row { display: flex; gap: 16px; align-items: flex-start; }
figure img { display: block; }
figcaption { font-size: 11px; color: #5c5962; margin-top: 4px; }
.full { width: 480px; height: 252px; }
.wide { width: 448px; height: 252px; overflow: hidden; }
.wide img { width: 100%; height: 100%; object-fit: cover; }
.square { width: 252px; height: 252px; overflow: hidden; }
.square img { width: 100%; height: 100%; object-fit: cover; }
figure > img, .wide, .square { outline: 1px solid rgb(30 28 34 / 0.2); }
</style></head><body><h1>Featured images: full frame, the 16:9 card crop and the square preview crop</h1>${body}</body></html>`;
}

/* ------------------------------------------------------------------ main */

function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") throw new Error("Screenshot is not a PNG.");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outDir = outFlag >= 0 && args[outFlag + 1] ? path.resolve(args[outFlag + 1]) : DEFAULT_OUT;

  const catalogue = await readCatalogue();
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: SCALE,
      colorScheme: "light",
    });
    const page = await context.newPage();

    const rows: { resource: Resource; png: Buffer }[] = [];
    for (const resource of catalogue) {
      await page.setContent(renderPage(resource), { waitUntil: "load" });
      const png = await page.screenshot({ type: "png", fullPage: false });
      const { width, height } = pngSize(png);
      if (width !== WIDTH * SCALE || height !== HEIGHT * SCALE) {
        throw new Error(`${resource.slug}: rendered ${width}×${height}, expected ${WIDTH * SCALE}×${HEIGHT * SCALE}.`);
      }
      if (png.length > HARD_LIMIT_BYTES) {
        throw new Error(`${resource.slug}: ${png.length} bytes is over the ${HARD_LIMIT_BYTES} byte ceiling.`);
      }
      const file = path.join(outDir, `${resource.slug}.png`);
      await writeFile(file, png);
      const note = png.length > SOFT_LIMIT_BYTES ? "  (over the 1 MB target)" : "";
      console.log(`${resource.slug}.png  ${resource.type.padEnd(10)} ${(png.length / 1024).toFixed(0).padStart(4)} KB${note}`);
      rows.push({ resource, png });
    }

    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: 1280, height: 800 });
    await sheet.setContent(renderContactSheet(rows), { waitUntil: "load" });
    const sheetFile = path.join(outDir, "contact-sheet.png");
    await sheet.screenshot({ path: sheetFile, type: "png", fullPage: true, scale: "css" });
    console.log(`contact-sheet.png  ${rows.length} resources`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
