/**
 * The canonical form of a public path, decided from the path alone (root
 * `CLAUDE.md`, "Public URLs"; ADRs 0025, 0035, 0049 and 0052). `proxy.ts`
 * sends a request for a non-canonical path a single-hop 308 to the form this
 * module computes, with `Cache-Control: no-store`, before any route runs.
 *
 * Two rules, both functions of the URL alone, so the answer can never be
 * wrong and never changes with the CMS's data:
 *
 * 1. Upper-case ASCII letters outside percent escapes are lower-cased, in
 *    every segment of every path the front end's pages and listings answer:
 *    `/resources/Webinar/` is `/resources/webinar/`, `/About/Team/` is
 *    `/about/team/`, and `/Resources/` is `/resources/`. Every slug the CMS
 *    stores is lower case (`canonicalSlug` in `lib/routes.ts`), so a
 *    lower-cased path is the only one that can be a page's own URL. The
 *    rule covers every script, not ASCII alone: a valid UTF-8 escape
 *    sequence is decoded, taken with the text around it to NFC and lower
 *    case, which is what WordPress's `remove_accents` (with the `intl`
 *    extension) and `mb_strtolower` leave in a stored slug, and encoded
 *    again in lower-case hex, WordPress's form; so `/%D0%94%D0%BE%D0%BC/`
 *    (`Дом`) is `/%d0%b4%d0%be%d0%bc/`, and `/%E6%97%A5/` is `/%e6%97%a5/`.
 *    The proxy sees the path as sent, hex case included, and its target is
 *    what WordPress stores, so the redirect is one hop; the page, which sees
 *    only Next.js's upper-cased hex, still treats either hex case as
 *    canonical (ADR 0049). An invalid sequence (a lone continuation byte,
 *    an overlong form, a surrogate) and an ASCII escape Next.js does not
 *    decode (`%20`, `%2F`) are left exactly as sent. A path differing from a
 *    stored slug only in normalisation form reaches this rule as NFC too; a
 *    CMS without `intl` could store an NFD slug, whose own URL would then
 *    redirect to a 404, which is the one case this rule does not cover.
 *    Repeated slashes (`/about//team/`) collapse to one, though Next.js's own
 *    308 removes them before the proxy runs. An escape of a character Next.js decodes in params
 *    (`DECODED_IN_PARAMS` in `lib/routes.ts`: `encodeURIComponent`'s
 *    unescaped set, so `%57ebinar` and `a%27b` alike) is decoded first, as
 *    Next.js would decode it, and then lower-cased with the rest. The set is
 *    imported rather than copied, so the proxy and `slugProblem` can never
 *    disagree: a stored slug never holds such an escape, so decoding cannot
 *    turn a canonical path into another slug's. None of those characters is
 *    `/`, `%`, `?` or `#`, and none is one a URL serialiser escapes in a
 *    path, so a decoded path keeps its segments and is sent and received
 *    exactly as computed: the proxy can never redirect a path to itself. A
 *    segment holding a `%` that does not begin a well-formed escape (`%4%41`,
 *    `%zz`, a trailing `%`) is left exactly as sent: decoding the escape
 *    after a stray `%` would make a new one (`%4%41` to `%4a`, then `j`),
 *    a chain of hops rather than one. No route can render such a segment, so
 *    it gets the route's 404 or Next.js's 400 with no redirect first.
 *    A path whose first segment is one of the front end's own other than the
 *    library (`api`, `media`, `_next`, in any case) is left alone whatever
 *    its case: the revalidate route, the uploads rewrite (where an upload's
 *    file name may legitimately carry upper-case letters) and the
 *    framework's assets are not pages, and the catch-all answers such a path
 *    with a 404 without a request.
 * 2. A trailing `/page/1/` is dropped from a `/resources/**` path: page 1 of a
 *    listing is the listing's own path (`listingPath` in `lib/routes.ts`), so
 *    `/resources/page/1/` is `/resources/` and
 *    `/resources/webinar/topic/a11y/page/1/` is
 *    `/resources/webinar/topic/a11y/`. `page` is a reserved segment, so the
 *    two segments can only ever mean a page number, whichever listing they
 *    end. Other page segments (`0`, `01`, `1.5`, `x`) are not redirected:
 *    there is no canonical form to send them to, so the route answers 404.
 *    The pair is dropped once and only when what is left does not end in
 *    `page/1` again: `/resources/page/1/page/1/` is no listing, and dropping
 *    one pair would send it to `/resources/page/1/`, a second hop. It is left
 *    to the route's 404, so the computed form is always a fixed point.
 *
 * Why the case rule covers every path and not the library alone (ADR 0035's
 * and ADR 0052's 2026-11-06 amendments): the resource page and the pages
 * catch-all are ISR routes that store what they answer, and Next.js keys the
 * stored entry by the decoded path, which on a case-insensitive file system
 * (macOS, where the suite runs) makes `/About/` and `/about/` one entry, and
 * `/Дом/` and `/дом/` likewise, since APFS folds case in every script and
 * compares normalisation forms as equal.
 * Measured on 16.4.5 under `next start`: with no proxy in front, a request
 * for `/Company/` before any for `/company/` stored the page's 308 to
 * `/company/` under that key, and `/company/` then redirected to itself.
 * What Vercel's cache keys on is unmeasured. So no mixed-case request may
 * reach an ISR route at all: the proxy canonicalises it first, and the
 * pages' own mixed-case branches are a second line that only a request that
 * bypassed the proxy could reach.
 *
 * Everything else about a path, a type or topic that does not exist, a page
 * past the end, a wrong type segment on a resource, a wrong parent on a page,
 * needs data and is decided by the route (`notFound()`, `lib/redirects.ts`
 * or `lib/page-request.ts`). The proxy never reads the data layer.
 *
 * Pure: no Next.js import (and `lib/routes.ts` has none either), so
 * `proxy.ts` and the unit tests share it.
 */

import { DECODED_IN_PARAMS, isReservedRootSegment } from "./routes";

const LIBRARY_PREFIX = "/resources";

/** A run of percent escapes, or a run of upper-case ASCII letters outside one. */
const ESCAPES_OR_UPPER = /(?:%[0-9A-Fa-f]{2})+|[A-Z]+/g;

/** A `%` that does not begin a well-formed escape. */
const MALFORMED_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

/** Decodes one UTF-8 sequence, or throws on an invalid, overlong or surrogate one. */
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** How many bytes a UTF-8 sequence with this lead byte has, or 0 for a byte that cannot lead one. */
function sequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

/**
 * `text` as WordPress stores it in a slug, as far as case and form go: NFC,
 * then lower-cased, then NFC again, repeated until it no longer changes.
 * `sanitize_title_with_dashes` applies `mb_strtolower` to a UTF-8 title, and
 * `remove_accents` before it normalises NFD to NFC when PHP's `intl`
 * extension is loaded, so a stored slug is NFC and lower case in every
 * script; a request in another form is a miss for WordPress, and this makes
 * it one URL. JavaScript's `toLowerCase` is the full Unicode mapping, as
 * `mb_strtolower` is; the loop covers the few characters whose lower-case
 * form composes differently, so the result is a fixed point.
 */
function canonicalCharacters(text: string): string {
  let current = text;
  for (let round = 0; round < 4; round += 1) {
    const next = current.normalize("NFC").toLowerCase().normalize("NFC");
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * `text` with every non-ASCII character percent-encoded in lower-case hex,
 * as WordPress encodes a slug, and so every ASCII character a URL parser
 * would encode in a path (a control, a space, `"`, `#`, `%`, `<`, `>`, `?`,
 * a backtick, `{`, `}`, DEL): none arrives raw in a path, but a
 * normalisation can produce one (U+1FEF, a Greek varia, composes to a
 * backtick), and a target the parser would rewrite is not a fixed point.
 * Every other ASCII character is left as is.
 */
function encodeForPath(text: string): string {
  return text.replace(/[^\x21\x24\x26-\x3b\x3d\x40-\x5f\x61-\x7a\x7c\x7e]+/g, (run) => encodeURIComponent(run).toLowerCase().replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`));
}

/**
 * A run of escapes in canonical form. Each escape is one of three things.
 * An escape of a character Next.js decodes in params (`DECODED_IN_PARAMS`)
 * is decoded, as Next.js would. A valid UTF-8 sequence of two to four
 * escapes is decoded to its character, which joins the text around it for
 * `canonicalCharacters` and comes back encoded in lower-case hex, so `Дом`
 * becomes `дом` as WordPress stores it and `%E6%97%A5` becomes `%e6%97%a5`;
 * an invalid sequence (a lone continuation byte, an overlong form, a
 * surrogate, a truncated sequence) is left as sent. Any other escape (`%20`,
 * `%2F`, `%25`) is left exactly as sent, hex case included. The pieces are
 * returned as text to canonicalise and escapes to keep, in order.
 */
function splitEscapes(run: string): { text?: string; keep?: string }[] {
  const escapes = run.match(/%[0-9A-Fa-f]{2}/g) ?? [];
  const bytes = escapes.map((escape) => Number.parseInt(escape.slice(1), 16));
  const pieces: { text?: string; keep?: string }[] = [];
  for (let index = 0; index < bytes.length; ) {
    const byte = bytes[index];
    if (byte < 0x80) {
      const character = String.fromCharCode(byte);
      pieces.push(DECODED_IN_PARAMS.test(character) ? { text: character } : { keep: escapes[index] });
      index += 1;
      continue;
    }
    const length = sequenceLength(byte);
    let decoded: string | null = null;
    if (length > 0 && index + length <= bytes.length) {
      try {
        decoded = utf8.decode(Uint8Array.from(bytes.slice(index, index + length)));
      } catch {
        decoded = null;
      }
    }
    if (decoded === null) {
      pieces.push({ keep: escapes[index] });
      index += 1;
    } else {
      pieces.push({ text: decoded });
      index += length;
    }
  }
  return pieces;
}

/**
 * `segment` in canonical form: every escape of a character in
 * `DECODED_IN_PARAMS` decoded, once; every valid multi-byte escape sequence
 * decoded; the text that results, with the raw characters around it, taken
 * to NFC and lower case (`canonicalCharacters`), ASCII and the other scripts
 * alike; and every non-ASCII character encoded again in lower-case hex.
 * Escapes that are neither (`%2F`, an invalid byte) keep their bytes and
 * their hex case, and are a boundary the normalisation does not cross. A
 * segment with a malformed escape is returned as sent, so a decoded escape
 * can never pair with a stray `%`.
 */
function canonicalSegment(segment: string): string {
  if (MALFORMED_ESCAPE.test(segment)) {
    return segment;
  }
  // Text to canonicalise, interleaved with escapes to keep as sent.
  const pieces: { text?: string; keep?: string }[] = [];
  let last = 0;
  for (const match of segment.matchAll(ESCAPES_OR_UPPER)) {
    pieces.push({ text: segment.slice(last, match.index) });
    pieces.push(...(match[0].startsWith("%") ? splitEscapes(match[0]) : [{ text: match[0] }]));
    last = match.index + match[0].length;
  }
  pieces.push({ text: segment.slice(last) });
  let canonical = "";
  let text = "";
  for (const piece of [...pieces, { keep: "" }]) {
    if (piece.text !== undefined) {
      text += piece.text;
      continue;
    }
    canonical += encodeForPath(canonicalCharacters(text)) + piece.keep;
    text = "";
  }
  // `%2e` or `%2e%2e` alone is a dot segment to a URL parser, which removes it
  // before the proxy sees the path; decoding one here would only make a path
  // that a parser rewrites, so it is left as sent.
  return canonical === "." || canonical === ".." ? segment : canonical;
}

/** True when canonical `segments` are a listing's path with a trailing `page/1`. */
function endsInPageOne(segments: readonly string[]): boolean {
  return segments.length >= 3 && segments.at(-2) === "page" && segments.at(-1) === "1";
}

/**
 * True when `pathname` is `/resources` or under it, with `resources` in lower
 * case, which is the one form the library's routes match.
 */
export function isResourcesPath(pathname: string): boolean {
  const next = pathname.charAt(LIBRARY_PREFIX.length);
  return pathname.startsWith(LIBRARY_PREFIX) && (next === "" || next === "/");
}

/**
 * The segments of `pathname` in canonical form under rule 1, and under rule 2
 * when they are a `/resources/**` path.
 */
function canonicalSegments(pathname: string): string[] {
  const segments = pathname.split("/").filter((segment) => segment !== "").map(canonicalSegment);
  if (segments[0] === "resources" && endsInPageOne(segments) && !endsInPageOne(segments.slice(0, -2))) {
    segments.splice(-2, 2);
  }
  return segments;
}

/** `segments` joined back into a path, with the trailing slash kept as `pathname` had it. */
function joinPath(segments: readonly string[], pathname: string): string {
  const trailingSlash = pathname.endsWith("/");
  return `/${segments.join("/")}${trailingSlash && segments.length > 0 ? "/" : ""}`;
}

/**
 * The canonical form of `pathname` under the two rules above, or `null` when
 * `pathname` is already canonical or is not a `/resources/**` path: the
 * library's rule on its own. The trailing slash is kept as given:
 * `trailingSlash: true` adds a missing one with its own redirect before the
 * proxy runs. The query string is not part of the path and is the caller's
 * to keep.
 */
export function canonicalResourcesPath(pathname: string): string | null {
  if (!isResourcesPath(pathname)) {
    return null;
  }
  const canonical = joinPath(canonicalSegments(pathname), pathname);
  return canonical === pathname ? null : canonical;
}

/**
 * The canonical form of any public path, or `null` when `pathname` is
 * already canonical or is one the proxy leaves alone: the root, and a path
 * under `api`, `media` or `_next` in any case. A `/resources/**` path gets
 * both rules, every other path rule 1, and a capitalised `/Resources/…`
 * becomes `/resources/…` in the same hop. The trailing slash and the query
 * string are handled as for `canonicalResourcesPath`.
 */
export function canonicalPath(pathname: string): string | null {
  const segments = canonicalSegments(pathname);
  if (segments.length === 0 || (isReservedRootSegment(segments[0]) && segments[0] !== "resources")) {
    return null;
  }
  const canonical = joinPath(segments, pathname);
  return canonical === pathname ? null : canonical;
}
