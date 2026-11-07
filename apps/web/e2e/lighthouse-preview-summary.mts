/**
 * The pull-request comment `preview-lighthouse.mts` posts: per sampled URL,
 * the median LCP, TBT and CLS over the runs, the LCP element and the bytes
 * of the LCP image, from the raw runs `lhci collect` writes, plus the
 * reason for a URL that could not be measured. Pure, with only
 * `lighthouse-summary.mts` imported, whose `median` is the gate's, so
 * `test/lighthouse-preview-summary.test.ts` checks it without Lighthouse.
 *
 * Lighthouse 13 names the LCP element (`lcp-breakdown-insight`, a node
 * item with the element's opening tag) but no audit names the request that
 * painted it. The image's bytes are found from the node: the first URL of
 * the snippet's `srcset`, or its `src`, matched against the run's
 * `network-requests`. The snippet is serialised HTML, so `&` in a URL is
 * `&amp;` and is decoded first. Lighthouse cuts every attribute value at 75
 * characters, longer than a `next/image` URL's path but shorter than the
 * whole, so a cut URL matches by prefix, and the match counts only when
 * every request it matches is the same image (the same URL but for the
 * optimiser's `w=` width); otherwise the cell says n/a rather than guess.
 * The bytes are read only from the runs whose LCP was the element most
 * runs agreed on, so a row never pairs a text element with an image's bytes.
 */

import { cell, median, type Lhr } from "./lighthouse-summary.mts";

/** Finds the comment on later runs; an HTML comment does not render. */
export const COMMENT_MARKER = "<!-- resource-hub: preview lighthouse -->";

/** The login the workflow's token comments as; only its comments are candidates for the marker. */
export const COMMENT_AUTHOR = "github-actions[bot]";

/** An audit as the comment reads it: a number, or a details list. */
export interface PreviewAudit {
  numericValue?: number;
  details?: { items?: unknown[] };
}

/** The parts of a Lighthouse result the comment reads; a superset of the gate's `Lhr`. */
export interface PreviewLhr extends Lhr {
  finalDisplayedUrl?: string;
  /** The settings the run was made with; `blockedUrlPatterns` are the URLs Chrome was told to block (`null` by default). */
  configSettings?: { blockedUrlPatterns?: string[] | null };
  /** Set when the run failed as a whole; `NO_ERROR` otherwise. */
  runtimeError?: { code: string; message?: string };
  audits: Record<string, PreviewAudit | undefined>;
}

/** One sampled URL's outcome: its runs, or why it has none. */
export interface PreviewResult {
  url: string;
  runs: readonly PreviewLhr[];
  /** Why the URL could not be measured (a warm-up refusal, a Lighthouse failure); `null` when it was. */
  failure: string | null;
}

export interface LcpElement {
  /** The element's lower-case tag name. */
  tag: string;
  /** Lighthouse's label: an image's alt, a text element's text. */
  label: string;
  /** The opening tag, serialised, attribute values cut at 75 characters. */
  snippet: string;
}

interface NodeItem {
  type: "node";
  snippet?: string;
  nodeLabel?: string;
}

interface NetworkItem {
  url: string;
  resourceType?: string;
  transferSize?: number;
  networkRequestTime?: number;
  networkEndTime?: number;
  statusCode?: number;
  protocol?: string;
  finished?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeItem(value: unknown): value is NodeItem {
  return isRecord(value) && value.type === "node";
}

function isNetworkItem(value: unknown): value is NetworkItem {
  return isRecord(value) && typeof value.url === "string";
}

function networkItems(lhr: PreviewLhr): NetworkItem[] {
  return (lhr.audits["network-requests"]?.details?.items ?? []).filter(isNetworkItem);
}

/** The LCP element of one run, or `null` when the run has none (no LCP, or an errored run). */
export function lcpElement(lhr: PreviewLhr): LcpElement | null {
  const items = lhr.audits["lcp-breakdown-insight"]?.details?.items ?? [];
  const node = items.find(isNodeItem);
  if (!node?.snippet) return null;
  const tag = /^<([a-z][\w-]*)/i.exec(node.snippet)?.[1]?.toLowerCase();
  if (!tag) return null;
  return { tag, label: (node.nodeLabel ?? "").trim(), snippet: node.snippet };
}

/** The entities HTML serialisation writes in an attribute value, and the few others a URL could carry. */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&#39;": "'" };

export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|nbsp|lt|gt|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * The image URL the snippet names, as written: the first `srcset`
 * candidate, or `src`, with HTML entities decoded. `cut` says the value
 * ended in Lighthouse's ellipsis, so it is a prefix of the URL.
 */
export function snippetImageUrl(snippet: string): { url: string; cut: boolean } | null {
  const attributes = new Map<string, string>();
  for (const match of snippet.matchAll(/\s(srcset|src)="([^"]*)"/gi)) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2]));
  }
  const srcset = attributes.get("srcset");
  const raw = srcset !== undefined ? srcset.split(",")[0].trim().split(/\s+/)[0] : attributes.get("src");
  if (!raw) return null;
  const cut = raw.endsWith("…");
  const url = cut ? raw.slice(0, -1) : raw;
  return url ? { url, cut } : null;
}

/** The URL without the optimiser's width, so two widths of one image compare equal. */
function imageSource(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.replace(/\/$/, "") === "/_next/image") parsed.searchParams.delete("w");
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * The transfer size of the LCP image in one run, or `null` when the LCP is
 * not an image, the request cannot be told apart, or the run has none.
 */
export function lcpImageBytes(lhr: PreviewLhr): number | null {
  const element = lcpElement(lhr);
  if (!element || element.tag !== "img") return null;
  const wanted = snippetImageUrl(element.snippet);
  if (!wanted) return null;
  let target: string;
  try {
    target = new URL(wanted.url, lhr.finalDisplayedUrl ?? lhr.requestedUrl).href;
  } catch {
    return null;
  }
  const images = networkItems(lhr).filter(
    (item): item is NetworkItem & { transferSize: number } =>
      item.resourceType === "Image" &&
      typeof item.transferSize === "number" &&
      (wanted.cut ? item.url.startsWith(target) : item.url === target),
  );
  if (images.length === 0) return null;
  if (new Set(images.map((item) => imageSource(item.url))).size > 1) return null;
  // The first to finish is the one painted, as Lighthouse's own LCP record picks it.
  return [...images].sort((a, b) => (a.networkEndTime ?? 0) - (b.networkEndTime ?? 0))[0].transferSize;
}

/**
 * A `blockedUrlPatterns` entry as a regular expression: `*` matches
 * anything, the rest is literal, and the whole URL must match. Chrome's
 * own matching (`Network.setBlockedURLs`) is an unanchored substring match
 * with implicit stars, so this is narrower than Chrome's and fails closed:
 * a URL Chrome blocked that this does not match still counts as foreign.
 */
function blockPattern(pattern: string): RegExp {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

/**
 * Whether the request matches one of the run's own `blockedUrlPatterns`
 * and looks like one Chrome blocked: Lighthouse lists such a request with
 * the record's defaults (status -1, no protocol, no bytes), finished, and
 * ending within a millisecond of starting. The audit does not carry
 * Chrome's error text, and a request that was sent and then reset or
 * timed out has the same defaults, so the duration is what tells them
 * apart: a request to another origin cannot be sent and fail inside a
 * millisecond. Anything else fails closed and counts.
 */
function abortedByBlock(item: NetworkItem, patterns: readonly string[]): boolean {
  if (!patterns.some((pattern) => blockPattern(pattern).test(item.url))) return false;
  if (item.statusCode !== -1 || item.protocol || item.transferSize || item.finished !== true) return false;
  if (typeof item.networkRequestTime !== "number" || typeof item.networkEndTime !== "number") return false;
  const duration = item.networkEndTime - item.networkRequestTime;
  return duration >= 0 && duration < 1;
}

/**
 * The origins, other than the page's own, that the run's requests went to.
 * Lighthouse sends its extra headers on every request the page makes, so
 * a request to another origin carried the bypass secret there. Only
 * network origins count: `data:` URLs (elided by Lighthouse) and the like
 * have none, and neither does a request that matches the run's own
 * `blockedUrlPatterns` and looks blocked (`abortedByBlock`): the one
 * exemption, so the toolbar block in `lighthouserc.preview.cjs` can work.
 * A request that matches a pattern but was answered, or took long enough
 * to have been sent, counts, as does every other foreign request.
 */
export function foreignOrigins(lhr: PreviewLhr, origin: string): string[] {
  const own = new URL(origin).origin;
  const patterns = (lhr.configSettings?.blockedUrlPatterns ?? []).filter((pattern): pattern is string => typeof pattern === "string");
  const found = new Set<string>();
  for (const item of networkItems(lhr)) {
    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    if (parsed.origin === own) continue;
    if (abortedByBlock(item, patterns)) continue;
    found.add(parsed.origin);
  }
  return [...found].sort();
}

/** The element as the table shows it: the tag in code, then the label, cut at 40 characters, when there is one. */
export function describeElement(element: LcpElement): string {
  const label = element.label.replace(/\s+/g, " ").replace(/\|/g, "\\|");
  const shown = label.length > 40 ? `${label.slice(0, 39)}…` : label;
  return shown ? `\`${element.tag}\` “${shown}”` : `\`${element.tag}\``;
}

export interface PreviewRow {
  path: string;
  /** Runs that produced a result; an errored run counts in neither this nor the medians. */
  runs: number;
  lcp: number | null;
  /** The element most runs agreed on, or "n/a". */
  element: string;
  /** The median over the runs whose LCP was that element, or `null`. */
  imageBytes: number | null;
  tbt: number | null;
  cls: number | null;
  /** Why there is no measurement: the URL's failure, or the runtime error's code when every run errored. */
  error: string | null;
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = value;
  }
  return best;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** One row per result, in order. */
export function previewRows(results: readonly PreviewResult[]): PreviewRow[] {
  return results.map((result) => {
    const empty = { path: pathOf(result.url), runs: 0, lcp: null, element: "n/a", imageBytes: null, tbt: null, cls: null };
    if (result.failure !== null) return { ...empty, error: result.failure };
    const errored = result.runs.filter((lhr) => lhr.runtimeError && lhr.runtimeError.code !== "NO_ERROR");
    const measured = result.runs.filter((lhr) => !errored.includes(lhr));
    if (measured.length === 0) {
      return { ...empty, error: errored.length > 0 ? (errored[0].runtimeError?.code ?? "error") : "no runs" };
    }
    const pick = (lhrs: readonly PreviewLhr[], read: (lhr: PreviewLhr) => number | null | undefined) =>
      median(lhrs.map(read).filter((value): value is number => typeof value === "number"));
    const described = measured.map((lhr) => {
      const element = lcpElement(lhr);
      return element === null ? null : describeElement(element);
    });
    const element = mostCommon(described.filter((value): value is string => value !== null));
    const agreeing = measured.filter((_, index) => described[index] === element);
    return {
      ...empty,
      runs: measured.length,
      lcp: pick(measured, (lhr) => lhr.audits["largest-contentful-paint"]?.numericValue),
      element: element ?? "n/a",
      imageBytes: element === null ? null : pick(agreeing, lcpImageBytes),
      tbt: pick(measured, (lhr) => lhr.audits["total-blocking-time"]?.numericValue),
      cls: pick(measured, (lhr) => lhr.audits["cumulative-layout-shift"]?.numericValue),
      error: null,
    };
  });
}

const whole = (value: number) => String(Math.round(value));
const thousands = (value: number) => whole(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A cell's text with the characters that would break the table escaped. */
function text(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/** The rows as a Markdown table. */
export function previewTable(rows: readonly PreviewRow[]): string {
  const lines = [
    "| URL | Runs | LCP (ms) | LCP element | LCP image (bytes) | TBT (ms) | CLS |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    if (row.error !== null) {
      lines.push(`| ${row.path} | 0 | not measured: ${text(row.error)} | | | | |`);
      continue;
    }
    lines.push(
      `| ${row.path} | ${row.runs} | ${cell(row.lcp, whole)} | ${row.element} | ${cell(row.imageBytes, thousands)} | ${cell(row.tbt, whole)} | ${cell(row.cls, (value) => value.toFixed(3))} |`,
    );
  }
  return lines.join("\n");
}

export interface PreviewReport {
  previewUrl: string;
  /** The deployed commit, or `null` when unknown (a local run). */
  sha: string | null;
  runsPerUrl: number;
  results: readonly PreviewResult[];
  /** A failure of the whole run, when there was one; the rows are still shown. */
  failure: string | null;
}

/** The whole comment body, led by the marker that finds it again. */
export function previewComment(report: PreviewReport): string {
  const rows = previewRows(report.results);
  const parts = [
    COMMENT_MARKER,
    `### Lighthouse on the Vercel preview (mobile, median of ${report.runsPerUrl})`,
    `Preview: ${report.previewUrl} · Commit: ${report.sha ? `\`${report.sha}\`` : "n/a"}`,
  ];
  if (report.failure !== null) {
    parts.push(`**Lighthouse could not measure this preview.** ${report.failure}`);
  } else if (rows.some((row) => row.error !== null)) {
    parts.push("**Some URLs could not be measured**; their rows say why.");
  }
  if (rows.length > 0) parts.push(previewTable(rows));
  parts.push(
    "Lab numbers from the preview, which reads the hosted CMS, at the blocking gate's settings; informational, never a required check. The gate's own numbers come from `next start` and the mock CMS (`apps/web/e2e/README.md`, “The design gates”).",
  );
  return `${parts.join("\n\n")}\n`;
}

export interface CommentLike {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
}

/** The id of the author's comment carrying the marker, or `null` when none does. */
export function findStickyComment(comments: readonly CommentLike[], marker = COMMENT_MARKER, author = COMMENT_AUTHOR): number | null {
  return comments.find((comment) => comment.user?.login === author && comment.body?.includes(marker))?.id ?? null;
}
