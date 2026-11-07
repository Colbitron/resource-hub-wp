/**
 * The pull-request comment `preview-lighthouse.mts` posts: per sampled URL,
 * the median LCP, TBT and CLS over the runs, the LCP element and the bytes
 * of the LCP image, from the raw runs `lhci collect` writes. Pure, with
 * only `lighthouse-summary.mts` imported, whose `median` is the gate's, so
 * `test/lighthouse-preview-summary.test.ts` checks it without Lighthouse.
 *
 * Lighthouse 13 names the LCP element (`lcp-breakdown-insight`, a node
 * item with the element's opening tag) but no audit names the request that
 * painted it. The image's bytes are found from the node: the first URL of
 * the snippet's `srcset`, or its `src`, matched against the run's
 * `network-requests`. Lighthouse cuts every attribute value at 75
 * characters, longer than a `next/image` URL's path but shorter than the
 * whole, so a cut URL matches by prefix, and the match counts only when
 * every request it matches is the same image (the same URL but for the
 * optimiser's `w=` width); otherwise the cell says n/a rather than guess.
 */

import { cell, median, type Lhr } from "./lighthouse-summary.mts";

/** Finds the comment on later runs; an HTML comment does not render. */
export const COMMENT_MARKER = "<!-- resource-hub: preview lighthouse -->";

/** An audit as the comment reads it: a number, or a details list. */
export interface PreviewAudit {
  numericValue?: number;
  details?: { items?: unknown[] };
}

/** The parts of a Lighthouse result the comment reads; a superset of the gate's `Lhr`. */
export interface PreviewLhr extends Lhr {
  finalDisplayedUrl?: string;
  /** Set when the run failed as a whole; `NO_ERROR` otherwise. */
  runtimeError?: { code: string; message?: string };
  audits: Record<string, PreviewAudit | undefined>;
}

export interface LcpElement {
  /** The element's lower-case tag name. */
  tag: string;
  /** Lighthouse's label: an image's alt, a text element's text. */
  label: string;
  /** The opening tag, attribute values cut at 75 characters. */
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
  networkEndTime?: number;
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

/** The LCP element of one run, or `null` when the run has none (no LCP, or an errored run). */
export function lcpElement(lhr: PreviewLhr): LcpElement | null {
  const items = lhr.audits["lcp-breakdown-insight"]?.details?.items ?? [];
  const node = items.find(isNodeItem);
  if (!node?.snippet) return null;
  const tag = /^<([a-z][\w-]*)/i.exec(node.snippet)?.[1]?.toLowerCase();
  if (!tag) return null;
  return { tag, label: (node.nodeLabel ?? "").trim(), snippet: node.snippet };
}

/**
 * The image URL the snippet names, as written: the first `srcset`
 * candidate, or `src`. `cut` says the value ended in Lighthouse's ellipsis,
 * so it is a prefix of the URL.
 */
export function snippetImageUrl(snippet: string): { url: string; cut: boolean } | null {
  const attributes = new Map<string, string>();
  for (const match of snippet.matchAll(/\s(srcset|src)="([^"]*)"/gi)) {
    attributes.set(match[1].toLowerCase(), match[2]);
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
  const items = lhr.audits["network-requests"]?.details?.items ?? [];
  const images = items.filter(
    (item): item is NetworkItem & { transferSize: number } =>
      isNetworkItem(item) &&
      item.resourceType === "Image" &&
      typeof item.transferSize === "number" &&
      (wanted.cut ? item.url.startsWith(target) : item.url === target),
  );
  if (images.length === 0) return null;
  if (new Set(images.map((item) => imageSource(item.url))).size > 1) return null;
  // The first to finish is the one painted, as Lighthouse's own LCP record picks it.
  return [...images].sort((a, b) => (a.networkEndTime ?? 0) - (b.networkEndTime ?? 0))[0].transferSize;
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
  imageBytes: number | null;
  tbt: number | null;
  cls: number | null;
  /** The runtime error's code when every run errored. */
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

/** One row per URL, in the order first seen, from every run. */
export function previewRows(runs: readonly PreviewLhr[]): PreviewRow[] {
  const byUrl = new Map<string, PreviewLhr[]>();
  for (const lhr of runs) {
    byUrl.set(lhr.requestedUrl, [...(byUrl.get(lhr.requestedUrl) ?? []), lhr]);
  }
  const rows: PreviewRow[] = [];
  for (const [url, lhrs] of byUrl) {
    const errored = lhrs.filter((lhr) => lhr.runtimeError && lhr.runtimeError.code !== "NO_ERROR");
    const measured = lhrs.filter((lhr) => !errored.includes(lhr));
    const pick = (read: (lhr: PreviewLhr) => number | null | undefined) =>
      median(measured.map(read).filter((value): value is number => typeof value === "number"));
    const elements = measured.map(lcpElement).filter((element): element is LcpElement => element !== null);
    rows.push({
      path: pathOf(url),
      runs: measured.length,
      lcp: pick((lhr) => lhr.audits["largest-contentful-paint"]?.numericValue),
      element: mostCommon(elements.map(describeElement)) ?? "n/a",
      imageBytes: pick(lcpImageBytes),
      tbt: pick((lhr) => lhr.audits["total-blocking-time"]?.numericValue),
      cls: pick((lhr) => lhr.audits["cumulative-layout-shift"]?.numericValue),
      error: measured.length === 0 && errored.length > 0 ? (errored[0].runtimeError?.code ?? "error") : null,
    });
  }
  return rows;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const whole = (value: number) => String(Math.round(value));
const thousands = (value: number) => whole(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The rows as a Markdown table. */
export function previewTable(rows: readonly PreviewRow[]): string {
  const lines = [
    "| URL | Runs | LCP (ms) | LCP element | LCP image (bytes) | TBT (ms) | CLS |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    if (row.error !== null) {
      lines.push(`| ${row.path} | 0 | error: \`${row.error}\` | | | | |`);
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
  runs: readonly PreviewLhr[];
  /** Why the measurement failed, when it did; the rows measured before it are still shown. */
  failure: string | null;
}

/** The whole comment body, led by the marker that finds it again. */
export function previewComment(report: PreviewReport): string {
  const rows = previewRows(report.runs);
  const parts = [
    COMMENT_MARKER,
    `### Lighthouse on the Vercel preview (mobile, median of ${report.runsPerUrl})`,
    `Preview: ${report.previewUrl} · Commit: ${report.sha ? `\`${report.sha}\`` : "n/a"}`,
  ];
  if (report.failure !== null) {
    parts.push(`**Lighthouse could not measure this preview.** ${report.failure}`);
  }
  if (rows.length > 0) parts.push(previewTable(rows));
  parts.push(
    "Lab numbers from the preview, which reads the hosted CMS, at the blocking gate's settings; informational, never a required check. The gate's own numbers come from `next start` and the mock CMS (`apps/web/e2e/README.md`, “The design gates”).",
  );
  return `${parts.join("\n\n")}\n`;
}

/** The id of the comment carrying the marker, or `null` when none does. */
export function findStickyComment(comments: readonly { id: number; body?: string | null }[], marker = COMMENT_MARKER): number | null {
  return comments.find((comment) => comment.body?.includes(marker))?.id ?? null;
}
