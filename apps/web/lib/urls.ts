/**
 * Rewrites for the CMS URLs in rendered HTML (ADRs 0036 and 0040): links on
 * the CMS origin become root-relative, and uploads become `/media/…`, which
 * `next.config.ts` rewrites to the CMS's uploads directory one to one.
 *
 * Each function reads a URL the way a browser would before deciding whether
 * it names the CMS: leading and trailing spaces and control characters are
 * stripped, tabs and newlines inside are removed, a backslash counts as a
 * slash, and `//host/…` is a URL on `host`. The host is compared after the
 * URL parser has normalised it (lowercase, punycode, default port dropped),
 * so `HTTPS://CMS.EXAMPLE:443/` is the CMS and `cms.example.evil`,
 * `evilcms.example` and `cms.example@evil.example` are not. `http` and
 * `https` on the CMS host both count as the CMS, since either would show its
 * address. A URL that does not name the CMS is returned unchanged.
 *
 * These are rewrites, not sanitizers: `javascript:` and other schemes are
 * never treated as the CMS and pass through as they came. Filtering what
 * editors may put in a body is WordPress's job.
 *
 * Pure: no Next.js, `server-only` or Zod import.
 */

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SCHEME_RELATIVE = /^[/\\]{2}/;
const ROOT_RELATIVE = /^[/\\](?![/\\])/;

/** The base a scheme-relative URL is resolved against: the front end is served over https. */
const RESOLVE_BASE = "https://front-end.invalid/";

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

/** The normalised host of a configured origin; throws on one that is not an http(s) URL. */
function configuredHost(origin: string): string {
  const url = parse(origin);
  if (url === null) {
    throw new TypeError(`Not an http or https origin: ${JSON.stringify(origin)}`);
  }
  return url.host;
}

/** A path that cannot be read as scheme-relative: leading slashes collapse to one. */
function singleLeadingSlash(pathname: string): string {
  return pathname.replace(/^\/+/, "/");
}

/**
 * `href` without its origin when it is an absolute or scheme-relative URL on
 * one of `cmsOrigins` (each an http(s) origin, such as
 * `https://cms.example`), keeping the path, query and hash; otherwise `href`
 * unchanged. Relative URLs, `#` anchors, `mailto:`, `javascript:` and URLs
 * on other hosts are never touched. The result never starts with `//`, so
 * `https://cms.example//evil.example/` cannot become a link to another host.
 *
 * Throws a `TypeError` if an entry of `cmsOrigins` is not an http(s) URL.
 */
export function stripCmsOrigin(href: string, cmsOrigins: readonly string[]): string {
  const hosts = new Set(cmsOrigins.map(configuredHost));
  const url = parseHostUrl(browserClean(href));
  if (url === null || !hosts.has(url.host)) {
    return href;
  }
  return `${singleLeadingSlash(url.pathname)}${url.search}${url.hash}`;
}

/**
 * The `/media/…` path for a file under the CMS's uploads directory, or
 * `null` when `src` is not one. `uploadsBase` is that directory's URL, such
 * as `https://cms.example/wp-content/uploads`. `src` may be absolute,
 * scheme-relative or root-relative (`/wp-content/uploads/…`, which on the
 * CMS meant the CMS); the query and hash are kept.
 *
 * The parser resolves `..` and `%2e%2e` before the check, so a path that
 * climbs out of the uploads directory is `null`, and so is one with an
 * encoded slash or backslash, which a web server might decode into a new
 * segment. Throws a `TypeError` if `uploadsBase` is not an http(s) URL.
 */
export function mediaPath(src: string, uploadsBase: string): string | null {
  const base = parse(uploadsBase);
  if (base === null) {
    throw new TypeError(`Not an http or https uploads URL: ${JSON.stringify(uploadsBase)}`);
  }
  const cleaned = browserClean(src);
  const url = ROOT_RELATIVE.test(cleaned) ? parse(cleaned, base.origin) : parseHostUrl(cleaned);
  if (url === null || url.host !== base.host) {
    return null;
  }
  const prefix = `${base.pathname.replace(/\/+$/, "")}/`;
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }
  const rest = url.pathname.slice(prefix.length);
  if (rest === "" || rest.startsWith("/") || /%2f|%5c/i.test(rest)) {
    return null;
  }
  return `/media/${rest}${url.search}${url.hash}`;
}

interface SrcsetCandidate {
  url: string;
  descriptors: string;
}

const isSrcsetSpace = (character: string): boolean => /^[ \t\n\f\r]$/.test(character);

/**
 * Splits a `srcset` into candidates as the HTML standard does: a URL is a
 * run of non-space characters (it may contain commas), trailing commas end
 * it, and its descriptors run to the next comma outside parentheses.
 */
function parseSrcset(srcset: string): SrcsetCandidate[] {
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
      url = url.replace(/,+$/, "");
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
 * `/media/…` by `mediaPath`, and every other candidate kept as it was, its
 * descriptors (`2x`, `768w`) kept with it. Candidates are rejoined with
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
