/**
 * Rewrites for the CMS URLs in rendered HTML (ADRs 0036 and 0040): links on
 * the CMS become root-relative, and uploads become `/media/…`, which
 * `next.config.ts` rewrites to the CMS's uploads directory one to one.
 *
 * The HTML pass in `content.rendered` uses one function per attribute:
 *
 * - `<a href>`: `rewriteHref`, which tries `mediaPath`'s mapping first, so a
 *   link to an upload (a PDF, say) becomes `/media/…` instead of a
 *   `/wp-content/uploads/…` path the front end does not serve, and
 *   `stripCmsOrigin` second. It keeps the query and hash.
 * - `<img src>` and featured images for `next/image`: `mediaPath`.
 * - `srcset`: `rewriteSrcset`.
 *
 * Image sources lose their query (`?ver=…`, `?w=…`): `next.config.ts`'s
 * `localPatterns` has `search: ""`, so `next/image` would refuse a `/media/`
 * source with one, and WordPress gives each upload its own file name, so the
 * query never chose a different file. Links keep theirs.
 *
 * Each function reads a URL the way a browser would before deciding whether
 * it names the CMS: leading and trailing spaces and control characters are
 * stripped, tabs and newlines inside are removed, a backslash counts as a
 * slash, and `//host/…` is a URL on `host`. The host is compared after the
 * URL parser has normalised it (lowercase, punycode, default port dropped)
 * and after every trailing dot is dropped from each side, so
 * `HTTPS://CMS.EXAMPLE:443/`, `https://cms.example./` and
 * `https://cms.example../` are the CMS and
 * `cms.example.evil`, `evilcms.example` and `cms.example@evil.example` are
 * not. `http` and `https` on the CMS host both count as the CMS, since either
 * would show its address. A URL that does not name the CMS is returned
 * unchanged.
 *
 * A configured CMS URL may carry the path WordPress is installed in
 * (`https://example.com/blog`), as `WP_MEDIA_ORIGIN` may (ADR 0040). Links are
 * then the CMS only under that path, which is stripped with the origin; a URL
 * on the same host outside it is another site's and is left alone. Each
 * configured URL is parsed once and remembered, not once per link.
 *
 * These are rewrites, not sanitizers: `javascript:` and other schemes are
 * never treated as the CMS and pass through as they came. Filtering what
 * editors may put in a body is WordPress's job.
 *
 * No regular expression here can backtrack more than linearly on its input:
 * trailing runs are trimmed with `withoutTrailing`, a loop, because a pattern
 * such as `/,+$/` is quadratic on a long run that does not reach the end.
 *
 * Pure: no Next.js, `server-only` or Zod import.
 */

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SCHEME_RELATIVE = /^[/\\]{2}/;
const ROOT_RELATIVE = /^[/\\](?![/\\])/;

/** The base a scheme-relative URL is resolved against: the front end is served over https. */
const RESOLVE_BASE = "https://front-end.invalid/";

/**
 * `value` without any run of `character` at its end. A loop, not
 * `value.replace(/x+$/, "")`: that pattern retries the run from every
 * position when something other than `x` follows it, which is quadratic.
 */
export function withoutTrailing(value: string, character: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === character) end--;
  return value.slice(0, end);
}

function isTrimmable(code: number): boolean {
  return code <= 0x20;
}

/** What the URL parser does to a value before parsing: trim C0 controls and spaces, drop tabs and newlines. */
function browserClean(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isTrimmable(value.charCodeAt(start))) start++;
  while (end > start && isTrimmable(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end).replace(/[\t\n\r]/g, "");
}

function parse(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** An absolute or scheme-relative http(s) URL, parsed; `null` for a relative reference or anything else. */
function parseHostUrl(cleaned: string): URL | null {
  if (!SCHEME.test(cleaned) && !SCHEME_RELATIVE.test(cleaned)) {
    return null;
  }
  return parse(cleaned, RESOLVE_BASE);
}

/** A URL's host as the CMS check compares it: every trailing dot dropped, the port kept when not the default. */
function hostKey(url: URL): string {
  const hostname = withoutTrailing(url.hostname, ".");
  return url.port === "" ? hostname : `${hostname}:${url.port}`;
}

/** A configured CMS or uploads URL, parsed: its host key and its path without trailing slashes. */
interface ConfiguredBase {
  readonly hostKey: string;
  /** `""` for an origin, `/blog` for a subdirectory install. */
  readonly prefix: string;
}

/** Configured URLs parsed so far. They come from configuration, so there are few; the cap is a backstop. */
const configuredBases = new Map<string, ConfiguredBase>();
const MAX_CONFIGURED_BASES = 64;

/** `value` parsed as a configured base, once; throws a `TypeError` on one that is not an http(s) URL. */
function configuredBase(value: string, kind: string): ConfiguredBase {
  const known = configuredBases.get(value);
  if (known !== undefined) {
    return known;
  }
  const url = parse(value);
  if (url === null) {
    throw new TypeError(`Not an http or https ${kind}: ${JSON.stringify(value)}`);
  }
  const base = { hostKey: hostKey(url), prefix: withoutTrailing(url.pathname, "/") };
  if (configuredBases.size >= MAX_CONFIGURED_BASES) {
    configuredBases.clear();
  }
  configuredBases.set(value, base);
  return base;
}

/** A path that cannot be read as scheme-relative: leading slashes collapse to one. */
function singleLeadingSlash(pathname: string): string {
  return pathname.replace(/^\/+/, "/");
}

/** `pathname` with `prefix` removed when it lies under it (`/blog` or `/blog/…`), else `null`. */
function underPrefix(pathname: string, prefix: string): string | null {
  if (prefix === "") {
    return pathname;
  }
  if (pathname === prefix) {
    return "/";
  }
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null;
}

function stripWithBases(href: string, bases: readonly ConfiguredBase[]): string {
  const url = parseHostUrl(browserClean(href));
  if (url === null) {
    return href;
  }
  const key = hostKey(url);
  let match: { prefix: string; rest: string } | null = null;
  for (const base of bases) {
    if (base.hostKey !== key || (match !== null && base.prefix.length <= match.prefix.length)) {
      continue;
    }
    const rest = underPrefix(url.pathname, base.prefix);
    if (rest !== null) {
      match = { prefix: base.prefix, rest };
    }
  }
  if (match === null) {
    return href;
  }
  return `${singleLeadingSlash(match.rest)}${url.search}${url.hash}`;
}

/**
 * `href` without the CMS's origin, and without the path WordPress is
 * installed in when the configured URL has one, when it is an absolute or
 * scheme-relative URL under one of `cmsOrigins`; otherwise `href` unchanged.
 * Each entry is an http(s) URL: an origin such as `https://cms.example`, or
 * a subdirectory install such as `https://example.com/blog`, where
 * `https://example.com/blog/resources/` becomes `/resources/` and
 * `https://example.com/shop/` is left alone. When several entries match, the
 * longest path wins. The path, query and hash are kept. Relative URLs, `#`
 * anchors, `mailto:`, `javascript:` and URLs on other hosts are never
 * touched. The result never starts with `//`, so
 * `https://cms.example//evil.example/` cannot become a link to another host.
 *
 * For `<a href>` in rendered HTML use `rewriteHref`, which maps uploads too.
 * Throws a `TypeError` if an entry of `cmsOrigins` is not an http(s) URL.
 */
export function stripCmsOrigin(href: string, cmsOrigins: readonly string[]): string {
  return stripWithBases(
    href,
    cmsOrigins.map((origin) => configuredBase(origin, "CMS URL")),
  );
}

function uploadsPath(src: string, base: ConfiguredBase, uploadsBase: string, keepQuery: boolean): string | null {
  const cleaned = browserClean(src);
  const url = ROOT_RELATIVE.test(cleaned) ? parse(cleaned, uploadsBase) : parseHostUrl(cleaned);
  if (url === null || hostKey(url) !== base.hostKey) {
    return null;
  }
  const prefix = `${base.prefix}/`;
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  const rest = url.pathname.slice(prefix.length);
  if (rest === "" || rest.startsWith("/") || /%2f|%5c/i.test(rest)) {
    return null;
  }
  return `/media/${rest}${keepQuery ? url.search : ""}${url.hash}`;
}

/**
 * The `/media/…` path for an image under the CMS's uploads directory, or
 * `null` when `src` is not one. `uploadsBase` is that directory's URL, such
 * as `https://cms.example/wp-content/uploads`. `src` may be absolute,
 * scheme-relative or root-relative (`/wp-content/uploads/…`, which on the
 * CMS meant the CMS). The hash is kept and the query dropped, because
 * `next/image` refuses a `/media/` source with one (see above).
 *
 * The parser resolves `..` and `%2e%2e` before the check, so a path that
 * climbs out of the uploads directory is `null`, and so is one with an
 * encoded slash or backslash, which a web server might decode into a new
 * segment. Throws a `TypeError` if `uploadsBase` is not an http(s) URL.
 */
export function mediaPath(src: string, uploadsBase: string): string | null {
  return uploadsPath(src, configuredBase(uploadsBase, "uploads URL"), uploadsBase, false);
}

/** What `rewriteHref` needs to know about the CMS. */
export interface CmsUrls {
  /** As for `stripCmsOrigin`. */
  readonly cmsOrigins: readonly string[];
  /** As for `mediaPath`. */
  readonly uploadsBase: string;
}

/**
 * An `<a href>` from rendered HTML, rewritten: `/media/…` when it names a
 * file under the uploads directory (as `mediaPath` decides, but keeping the
 * query), otherwise `stripCmsOrigin`'s result, otherwise unchanged. The HTML
 * pass must use this for links, never `stripCmsOrigin` alone, which would
 * turn an upload link into `/wp-content/uploads/…`, a 404 on the front end.
 * Throws a `TypeError` if a configured URL is not an http(s) URL.
 */
export function rewriteHref(href: string, { cmsOrigins, uploadsBase }: CmsUrls): string {
  const bases = cmsOrigins.map((origin) => configuredBase(origin, "CMS URL"));
  const media = uploadsPath(href, configuredBase(uploadsBase, "uploads URL"), uploadsBase, true);
  return media ?? stripWithBases(href, bases);
}

/** One candidate of a `srcset`: its URL and its descriptors (`2x`, `768w`), normalised to single spaces. */
export interface SrcsetCandidate {
  url: string;
  descriptors: string;
}

/** The HTML standard's ASCII whitespace: space, tab, newline, form feed, carriage return. */
const isSrcsetSpace = (character: string): boolean =>
  character === " " || character === "\t" || character === "\n" || character === "\f" || character === "\r";

/**
 * Splits a `srcset` into candidates as the HTML standard does: a URL is a
 * run of non-space characters (it may contain commas), trailing commas end
 * it, and its descriptors run to the next comma outside parentheses. The
 * HTML pass uses it to check each candidate on its own before rebuilding
 * the attribute; `rewriteSrcset` is the rewrite-only form. Linear in the
 * length of `srcset`: every character is looked at a bounded number of times.
 */
export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let position = 0;
  while (position < srcset.length) {
    while (
      position < srcset.length &&
      (isSrcsetSpace(srcset[position]) || srcset[position] === ",")
    ) {
      position++;
    }
    if (position >= srcset.length) {
      break;
    }
    const urlStart = position;
    while (position < srcset.length && !isSrcsetSpace(srcset[position])) {
      position++;
    }
    let url = srcset.slice(urlStart, position);
    let descriptors = "";
    if (url.endsWith(",")) {
      url = withoutTrailing(url, ",");
    } else {
      const descriptorStart = position;
      let depth = 0;
      while (position < srcset.length) {
        const character = srcset[position];
        if (character === "(") {
          depth++;
        } else if (character === ")" && depth > 0) {
          depth--;
        } else if (character === "," && depth === 0) {
          break;
        }
        position++;
      }
      descriptors = srcset.slice(descriptorStart, position).trim().replace(/\s+/g, " ");
    }
    candidates.push({ url, descriptors });
  }
  return candidates;
}

/**
 * `srcset` with every candidate under the uploads directory rewritten to
 * `/media/…` by `mediaPath`, its query dropped, and every other candidate
 * kept as it was, its descriptors (`2x`, `768w`) kept with it. Candidates are rejoined with
 * `, `.
 */
export function rewriteSrcset(srcset: string, uploadsBase: string): string {
  return parseSrcset(srcset)
    .map(({ url, descriptors }) => {
      const rewritten = mediaPath(url, uploadsBase) ?? url;
      return descriptors === "" ? rewritten : `${rewritten} ${descriptors}`;
    })
    .join(", ");
}
