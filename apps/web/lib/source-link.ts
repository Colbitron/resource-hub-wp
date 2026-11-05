import { rewriteHref, withoutTrailing, type CmsUrls } from "./urls";

/**
 * What the resource page shows for `meta.source_url`, the place the resource
 * itself lives (a PDF, a recording, a page on another site): the link to
 * render, or `null` for none.
 *
 * The plugin stores either an http(s) URL or the empty string, and an editor
 * may point it anywhere, the CMS included. The page's rule is the HTML
 * pass's rule for links (ADRs 0036, 0040, 0047): the URL goes through
 * `rewriteHref`, so an upload on the CMS becomes `/media/…` and a CMS page
 * becomes root-relative; a CMS URL whose rewrite is not a path the front end
 * serves (`/wp-admin/`, `/wp-login.php`, a theme page, which the CMS answers
 * anonymous visitors with a 404 anyway) gives no link, and so does an
 * absolute URL that still names a configured CMS host after the rewrite (a
 * port the configuration does not list). The CMS's address therefore never
 * reaches the page through this field. Anything that is not an absolute
 * http(s) URL (`javascript:`, `data:`, `mailto:`, a protocol-relative
 * `//host/…`) gives no link either: the plugin never stores one, and the
 * front end does not rely on that. Nor does a URL with userinfo
 * (`https://user@host/`), which the HTML pass's image trust rule refuses too:
 * the part before the `@` can pose as a host.
 *
 * A CMS link to a front-end page gets the trailing slash every public URL
 * has (`https://cms.example/resources` becomes `/resources/`), so the click
 * does not cost a 308 from `trailingSlash: true`.
 *
 * `label` is what the link shows: for a link to another site, its host as
 * the URL parser normalises it, in ASCII (punycode for an internationalised
 * name, so `аpple.example` with a Cyrillic "а" shows as
 * `xn--pple-43d.example` and cannot pass for a Latin name), with a port that
 * is not the scheme's default; for a `/media/…` upload, the file name; for a
 * front-end page, its path. A reader knows where a click goes before taking
 * it. `external` is true for a link off this site, which the page marks with
 * `rel="noopener noreferrer"`.
 *
 * Pure, so the unit tests run it without Next.js.
 */
export interface SourceLink {
  readonly href: string;
  readonly label: string;
  readonly external: boolean;
}

/** The front-end paths a rewritten CMS link may point at; the same set the HTML pass keeps (`isFrontEndPath`). */
function isFrontEndPath(path: string): boolean {
  return path === "/resources" || path.startsWith("/resources/") || path.startsWith("/media/");
}

/** `value` parsed as an absolute http(s) URL, or `null`. A protocol-relative `//host/…` has no base here, so it is `null`. */
function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function hostname(value: string): string | null {
  const url = httpUrl(value);
  return url === null ? null : withoutTrailing(url.hostname, ".");
}

/** `path` with a trailing slash on its path part, before any query or hash. */
function withTrailingSlash(path: string): string {
  const end = path.search(/[?#]/);
  const pathPart = end === -1 ? path : path.slice(0, end);
  const rest = end === -1 ? "" : path.slice(end);
  return pathPart.endsWith("/") ? path : `${pathPart}/${rest}`;
}

/** The last path segment of a `/media/…` path, decoded, or the path itself when that fails. */
function fileName(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0];
  const last = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last) || withoutQuery;
  } catch {
    return last;
  }
}

/** The link for `sourceUrl` under the rules above, or `null` for none. */
export function sourceLink(sourceUrl: string, cms: CmsUrls): SourceLink | null {
  const trimmed = sourceUrl.trim();
  const parsed = trimmed === "" ? null : httpUrl(trimmed);
  if (parsed === null || parsed.username !== "" || parsed.password !== "") {
    return null;
  }
  const rewritten = rewriteHref(trimmed, cms);
  if (rewritten.startsWith("/")) {
    if (!isFrontEndPath(rewritten.split(/[?#]/, 1)[0])) {
      return null;
    }
    if (rewritten.startsWith("/media/")) {
      return { href: rewritten, label: fileName(rewritten), external: false };
    }
    const href = withTrailingSlash(rewritten);
    return { href, label: href, external: false };
  }
  const url = httpUrl(rewritten);
  if (url === null) {
    return null;
  }
  const host = withoutTrailing(url.hostname, ".");
  const cmsHosts = [...cms.cmsOrigins, cms.uploadsBase].map(hostname);
  if (cmsHosts.includes(host)) {
    return null;
  }
  // `url.port` is empty for the scheme's default port, so only another port is shown.
  return { href: rewritten, label: url.port === "" ? host : `${host}:${url.port}`, external: true };
}
