import { domainToUnicode } from "node:url";

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
 * reaches the page through this field. Anything that is not http(s)
 * (`javascript:`, `mailto:`) gives no link either: the plugin never stores
 * one, and the front end does not rely on that.
 *
 * `label` is what the link shows: the host, in Unicode, for a link to
 * another site, and the file name for a `/media/…` upload, so a reader knows
 * where a click goes before taking it. `external` is true for a link off this
 * site, which the page marks with `rel="noopener noreferrer"`.
 *
 * Pure apart from `node:url`, so the unit tests run it without Next.js.
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

function hostname(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? withoutTrailing(url.hostname, ".") : null;
  } catch {
    return null;
  }
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
  if (trimmed === "" || hostname(trimmed) === null) {
    return null;
  }
  const href = rewriteHref(trimmed, cms);
  if (href.startsWith("/")) {
    if (!isFrontEndPath(href)) {
      return null;
    }
    return { href, label: href.startsWith("/media/") ? fileName(href) : href, external: false };
  }
  const host = hostname(href);
  if (host === null) {
    return null;
  }
  const cmsHosts = [...cms.cmsOrigins, cms.uploadsBase].map(hostname);
  if (cmsHosts.includes(host)) {
    return null;
  }
  return { href, label: domainToUnicode(host), external: true };
}
