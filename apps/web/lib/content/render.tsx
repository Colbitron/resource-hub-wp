import "server-only";

import parse, {
  Element,
  Text,
  type DOMNode,
  type HTMLReactParserOptions,
} from "html-react-parser";
import { Parser, type ParserOptions } from "htmlparser2";
import Image from "next/image";
import { domainToUnicode } from "node:url";
import { cloneElement, createElement, Fragment, type ReactElement, type ReactNode } from "react";

import { canonicalSlug, isSlug } from "../routes";
import { mediaPath, parseSrcset, rewriteHref, stripCmsOrigin, withoutTrailing, type CmsUrls } from "../urls";

/**
 * The one server-side pass over a resource's `content.rendered` (ADR 0040:
 * one parse pass owns every rewrite). WordPress hands the front end HTML
 * that editors wrote, with the CMS's absolute URLs in it; this turns it into
 * React nodes that show nothing of the CMS and run nothing of the editor's.
 * The defaults still open (external images, the `mailto:`/`tel:` exemption,
 * unwrapping CMS links) are issue #53.
 *
 * `html-react-parser` parses the string once and calls `replace` for every
 * top-level node before it renders anything of its own; below the top level
 * the pass maps each element's children itself (`children`). `replace`
 * returns a new element for every element node, built from an allow-list of
 * elements and attributes with each attribute value checked, or nothing. The
 * parser's own rendering is reached only by top-level text nodes, and the
 * pass renders other text as strings; React escapes both.
 * Nothing here uses `dangerouslySetInnerHTML`, so no fragment of the input
 * reaches the page as markup; that is what makes a sanitiser inside `replace`
 * sound. The output is never serialised and parsed again, so the mutation
 * tricks that defeat string sanitisers do not apply. The sanitiser is
 * written here rather than taken from a library (`sanitize-html`, DOMPurify):
 * a library would sanitise the string first and leave it to be parsed again,
 * a second pass with its own configuration to keep in step with this one,
 * and every rewrite here would still be needed on top.
 *
 * In that one pass:
 *
 * - Links: `href` is rewritten with `rewriteHref`, so links to uploads become
 *   `/media/…`, links on the CMS become root-relative and other links stay.
 *   A CMS link stays a link only when its rewrite is a front-end route or
 *   `/media/…`; any other (`/wp-admin/`, `/wp-json/…`, `/?p=12`) is
 *   unwrapped to its content. A link whose text is its own URL, or a CMS
 *   URL written out (an autolink), shows the rewritten target instead; any
 *   other link keeps its content as written. A `mailto:` or `tel:` link is
 *   kept as written, even when its address is on the CMS's domain: that
 *   address is content the editor chose, not the CMS's URL. A link with
 *   `target="_blank"` gets
 *   `rel="noopener noreferrer"`.
 * - Images: a CMS image, one whose origin equals the uploads directory's and
 *   whose path lies under it, with no user name or password, becomes
 *   `/media/…`; with a width and a height it renders through `next/image`,
 *   otherwise as a lazy `<img>` with its `srcset` rebuilt from the candidates
 *   that are CMS images too. An image on any other host stays a plain lazy
 *   `<img>` by its `src` alone, since it says nothing about the CMS. An image
 *   that names a CMS host but is not a CMS image (`http:` where the CMS is
 *   `https:`, another port, a path outside uploads, credentials in the URL)
 *   is dropped: it cannot be served through `/media/` and showing it would
 *   show the CMS's address.
 * - The CMS host: no attribute this pass renders names it (`mentionsCms`),
 *   except the `href` or `cite` of a `mailto:` or `tel:` URL. An
 *   internationalised host is looked for in its punycode and its Unicode
 *   form. A link whose rewritten `href` still names it, in its query, loses the
 *   query; in its path or hash, it is unwrapped. A `title`, `id` or
 *   `datetime` that names it is dropped, so is a `class` token, and the
 *   words of an `alt` that name it are removed; `checked` drops any other
 *   value that does, as the last step before an element is created. Text
 *   the editor typed is left as written, in `<code>` and elsewhere, because
 *   rewriting it would corrupt code samples and prose about the CMS; only a
 *   link's text is replaced, when it is the link's URL or a CMS URL
 *   (`linkText`). The
 *   plain-text fallback removes CMS origins (`textOnly`).
 * - Sanitising: only the elements in `ALLOWED_ELEMENTS` are rendered, with
 *   the attributes in `GLOBAL_ATTRIBUTES` and the per-element lists below,
 *   each value checked. `style` and every `on*` attribute are dropped
 *   everywhere. `href`, `src`, `srcset` and `cite` may be `http`, `https`,
 *   `mailto`, `tel` or relative, judged on the URL as a browser parses it, so
 *   case, surrounding spaces, tabs and newlines in the scheme, and entities
 *   (decoded by the parser) make no difference. The elements in
 *   `DROPPED_WITH_CONTENT` go with everything inside them; any other
 *   element not on the list is unwrapped, and its children are kept and go
 *   through the same checks. No `class` token may start with `rh-`, the
 *   prefix of the app's own classes, except `rh-related` on the block
 *   marker's wrapper. Every `id` gets the prefix `c-`, and so does a
 *   same-page `#fragment` link, so no `id` in a body can clobber a global or
 *   an element the page's own scripts look up (`<div id="TURBOPACK">`).
 * - The block marker: `<div data-rh-block="related-resources">` with its
 *   `data-*` attributes is parsed and validated and handed to `renderBlock`
 *   with the wrapper's own rendering as the fallback. The default renders
 *   the fallback; slice 4 plugs in `<RelatedResources>`. An invalid marker,
 *   one past the first `MAX_MARKERS` in document order, or one inside an
 *   `<a>` renders the fallback and `renderBlock` is not called; one whose
 *   `renderBlock` throws renders the fallback too. The post ID passed in
 *   `postId` wins over the marker's `data-exclude`.
 * - Embeds: an `<iframe>`, `<video>` or `<audio>` becomes a link to its
 *   `src` (a `<video>` or `<audio>` without one, to its first usable
 *   `<source>`), and an embed block whose wrapper still holds the raw URL as
 *   text (the oEmbed was not resolved) becomes a link to that URL. Inside a
 *   link, where a browser would not nest another, each becomes its text, and
 *   an `<a>` inside an `<a>` is unwrapped.
 * - Tables: every `<table>` renders inside a focusable region that scrolls
 *   sideways, named by its `<caption>` or "Table" (`tableRegion`).
 * - Headings: when the body renders an `<h1>`, every body heading is shown
 *   one level down, capped at `h6`, so the page's own title stays its only
 *   `<h1>` and the body's levels keep their order (`headingName`); a body
 *   with no `<h1>` keeps its levels.
 * - Depth: a body that nests more than `MAX_DEPTH` elements deep renders as
 *   plain text (`textOnly`). `outline` decides it before the parse
 *   that renders, by running htmlparser2 itself over the body and stopping
 *   it at the first element past the limit, so the parser never holds more
 *   than `MAX_DEPTH + 1` open elements and its work per tag stays bounded.
 *   It is the same pinned version as the parser `html-react-parser` uses,
 *   not the same copy: `test/content-parser-version.test.ts` holds the two
 *   together.
 *   Any error inside the parse or the pass also gives the plain-text
 *   rendering, so a body never makes the page fail.
 * - Size: a body longer than `MAX_CONTENT_LENGTH` UTF-16 code units renders
 *   as plain text without reaching the parser, a second line of defence.
 *
 * No regular expression here backtracks more than linearly on its input.
 *
 * Server only: it imports `next/image` and runs in Server Components.
 */

/** The related-resources marker, parsed and validated (`packages/ui/README.md`). */
export interface RelatedBlockProps {
  /** `data-count`, 1 to 10. */
  readonly count: number;
  /** `data-topic`, the topic's current slug, which names the `topic:{slug}` tag. */
  readonly topic: string;
  /** `data-topic-id`, the term ID for the `resource_topic` REST filter. */
  readonly topicId: number;
  /** The ID of the post the block sits in: `postId` when given, else `data-exclude`. */
  readonly exclude: number;
  /** The text of the block's `<h2>`, or `null` when it has none. */
  readonly heading: string | null;
}

/**
 * Renders the related-resources block for a valid marker. `fallback` is the
 * wrapper as this pass renders it: the heading and the `<ul>` of links the
 * CMS put there, with the CMS's URLs rewritten.
 */
export type RenderBlock = (props: RelatedBlockProps, fallback: ReactNode) => ReactNode;

export interface RenderContentOptions {
  /** Defaults to rendering the fallback. */
  readonly renderBlock?: RenderBlock;
  /**
   * The ID of the resource whose body this is. When given, a marker's
   * `data-exclude` is checked against it, and a marker that disagrees still
   * renders, excluding this ID: the block is in this post, whatever its HTML
   * says.
   */
  readonly postId?: number;
}

/**
 * `sizes` for an image in the content column: the body's images here and
 * the resource page's featured image (`components/ResourceArticle.tsx`),
 * one string so the two agree.
 *
 * The column is `--rh-measure`, 65ch in the shared tokens, and `sizes`
 * cannot read a CSS variable or a `ch`, so the width is written out. A `ch`
 * is the advance of "0" in the column's font: in Figtree at the regular
 * weight it is 0.6408 em (10.25 px at 16 px, measured in Chromium on the
 * file in `packages/ui/fonts/`), so 65ch is 41.65rem, rounded up to 42rem.
 * Below that plus the shell's two gutters, 44rem, the column is the
 * viewport less the gutters, `--rh-space-4` (1rem) a side in `shell.css`,
 * written out for the same reason. The rule is that `sizes` never
 * understates the rendered width: a larger estimate fetches a few more
 * bytes, a smaller one a blurrier image. The resource page's spec measures
 * the featured image against this value at 1280 and 360 px, so a change to
 * the measure, the typeface or the gutter fails there until this string
 * follows.
 *
 * The gutter is written `calc(-2rem + 100vw)`, not `calc(100vw - 2rem)`,
 * which a browser reads the same. `next/image` lists every configured width
 * in the srcset, 15 of them, unless it finds a `vw` in `sizes`, which it
 * looks for with `/(^|\s)(1?\d?\d)vw/` (`getWidths` in Next.js's
 * `get-img-props`): the number must start the string or follow whitespace,
 * so `(100vw` hides it. Found, the smallest `vw` drops the widths under that
 * share of the smallest device size, 640, so `100vw` leaves the eight device
 * sizes. The seven it drops, 32 to 384, are narrower than any phone's column
 * at a density of 2 or more, so no phone picked one, and they are in the
 * HTML several times over (the `<img>`, the preload link, the RSC payload):
 * on the harness's build they were 1,987 bytes of the long-form resource's
 * HTML, 103 once gzipped, from a first round trip with little room to spare
 * (`apps/web/README.md`, "Images"). `test/content.test.tsx` pins the eight.
 */
export const CONTENT_SIZES = "(max-width: 44rem) calc(-2rem + 100vw), 42rem";

/**
 * How many elements deep a body may nest before it renders as plain text:
 * the most elements htmlparser2 holds open at once, which is the depth of
 * the tree it builds. Void elements (`<br>`, `<img>`) never open a level, so
 * 256 nested `<div>`s with a `<br>` inside render and 257 do not. WordPress's
 * own blocks nest a dozen levels at most (a list in a group in a column in a
 * cover); 256 is far beyond any real body and far below the roughly 2,000
 * levels at which `html-react-parser`, which recurses once per level, runs
 * out of stack.
 */
export const MAX_DEPTH = 256;

/**
 * The longest body, in UTF-16 code units (`html.length`, 512 Ki), that goes
 * to the parser; a longer one renders as plain text (`textOnly`). The depth
 * pre-pass is what bounds the parser's work per tag; this bounds the number
 * of tags, so it is a second line of defence that holds whatever the markup.
 * Code units rather than bytes because `length` costs nothing and is what
 * the parser's work scales with; the longest real resource body is a few
 * tens of kilobytes. A body renders once per revalidation before ISR caches
 * it, and only editors write one.
 */
export const MAX_CONTENT_LENGTH = 512 * 1024;

/**
 * The prefix every `id` in a body gets. Browsers expose an element with an
 * `id` as a global of that name, so an editor's `<div id="TURBOPACK">` or
 * `id="webpackChunk_N_E"` would replace the object Next.js's bootstrap
 * script reads (DOM clobbering). Neither Next.js nor this app looks up a
 * name that starts with `c-`. Same-page `#fragment` links get the prefix too, so
 * they still reach their target; no `aria-*` or `for` attribute is allowed,
 * so nothing else refers to an `id`.
 */
const ID_PREFIX = "c-";

/**
 * The most related-resources blocks one body renders. Each costs the server
 * a related-route call and a resources fetch; a resource needs one, and
 * five leaves room. Markers past it render their fallback, the CMS's own
 * list of links, as an invalid marker does.
 */
export const MAX_MARKERS = 5;

/** Elements that render, by name, after their attributes are filtered. */
const ALLOWED_ELEMENTS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "wbr",
  "ul", "ol", "li", "dl", "dt", "dd",
  "a",
  "img", "figure", "figcaption",
  "blockquote", "q", "cite",
  "code", "pre", "kbd", "samp", "var",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
  "em", "strong", "b", "i", "u", "s", "del", "ins", "sub", "sup", "small", "mark", "abbr", "time",
  "details", "summary",
  "div", "span",
]);

/** Elements that have no children. */
const VOID_ELEMENTS = new Set(["br", "hr", "wbr", "img"]);

/**
 * Elements dropped with everything inside them: anything that runs, loads,
 * submits, restyles or re-parses, and the foreign-content elements whose
 * children an HTML parser reads differently from a browser. `<iframe>`,
 * `<video>` and `<audio>` are not here: they become links (see `mediaLink`).
 */
const DROPPED_WITH_CONTENT = new Set([
  "script", "style", "noscript", "template",
  "object", "embed", "applet", "frame", "frameset", "noframes", "noembed",
  "svg", "math",
  "form", "input", "button", "select", "option", "optgroup", "textarea", "datalist", "output",
  "base", "meta", "link", "head", "title",
  "canvas", "dialog", "slot", "portal",
  "xmp", "plaintext", "listing",
]);

/** Elements that become a link to their `src`. */
const LINKED_MEDIA = new Set(["iframe", "video", "audio"]);

/**
 * Elements whose content the pass never renders: the dropped ones, and the
 * linked media, whose children are fallback for a browser that cannot play
 * them. An `<h1>` inside one of them is not an `<h1>` of the body
 * (`outline`), and their text is no part of a name read from the body
 * (`renderedText`).
 */
const UNRENDERED_CONTENT: ReadonlySet<string> = new Set([...DROPPED_WITH_CONTENT, ...LINKED_MEDIA]);

/** Schemes a link may use. Relative references resolve to `https:` and pass. */
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Schemes whose URL is an address the editor wrote, never a URL of the CMS:
 * a `mailto:` or `tel:` link is exempt from the "names the CMS" unwrap, so
 * `mailto:info@example.com` stays a link on a CMS at `example.com`. Without
 * it every contact link on an apex-domain CMS would lose its link. The
 * default chosen while the project owner was away on 2026-11-05, pending
 * their review (issue #53).
 */
const CONTACT_SCHEMES = new Set(["mailto:", "tel:"]);

/** The URL attributes a `mailto:` or `tel:` value may keep although it names the CMS (`CONTACT_SCHEMES`). */
const CONTACT_PROPS = new Set(["href", "cite"]);

/** The base relative links resolve against for the scheme check; its host is never the CMS. */
const LINK_BASE = "https://front-end.invalid/";
const LINK_ORIGIN = new URL(LINK_BASE).origin;

const CLASS_TOKEN = /^[A-Za-z0-9_-]+$/;
/**
 * The prefix of the app's own classes (`rh-card__link`, whose `::after` is
 * `inset: 0`; `rh-skip`): a body could use them to restyle the page around
 * it, so no content class may start with it, in any case.
 */
const APP_CLASS_PREFIX = "rh-";
/** The block marker's wrapper's own class, in the contract (`packages/ui/README.md`): the one app class content may carry, and the one the fallback always gets. */
const MARKER_CLASS = "rh-related";
const MARKER_CLASSES: ReadonlySet<string> = new Set([MARKER_CLASS]);
const NO_CLASSES: ReadonlySet<string> = new Set();
const ID_VALUE = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const LANG_VALUE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const DIR_VALUES = new Set(["ltr", "rtl", "auto"]);
const REL_TOKENS = new Set(["noopener", "noreferrer", "nofollow", "ugc", "sponsored", "external"]);
const SCOPE_VALUES = new Set(["row", "col", "rowgroup", "colgroup"]);
/** A pixel dimension as WordPress writes it: 1 to 99999. */
const DIMENSION = /^[1-9][0-9]{0,4}$/;
const SPAN = /^[1-9][0-9]{0,2}$/;
const LIST_START = /^-?[0-9]{1,6}$/;
const DATETIME = /^[0-9A-Za-z:+.\- ]{1,40}$/;
/** A `sizes` value: media queries, lengths and `auto`. */
const SIZES = /^[A-Za-z0-9\s(),:.%-]{1,200}$/;
/**
 * A `srcset` descriptor: a width (`768w`), a density (`2x`, `1.5x`, `.5x`),
 * or none. Written so no two parts can match the same digits: the earlier
 * `[0-9]*\.?[0-9]+x` split a run of digits between its two quantifiers in
 * every possible way before failing, which is quadratic.
 */
const DESCRIPTOR = /^(?:[1-9][0-9]*w|(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)x)?$/;
/** A positive integer, as the marker's IDs and count are written. */
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

const EMPTY = createElement(Fragment);

/** Attributes by lower-case name, first occurrence winning, as a browser reads them. */
type Attributes = ReadonlyMap<string, string>;

type Props = Record<string, unknown>;

/** A configured CMS base: its host name and the path WordPress is installed in (`""` for an origin). */
interface CmsBase {
  readonly hostname: string;
  readonly prefix: string;
}

/** What the pass knows about the CMS, computed once per render. */
interface Context {
  readonly cms: CmsUrls;
  /** The uploads directory's origin, which a CMS image's origin must equal. */
  readonly uploadsOrigin: string;
  /** Every configured base: an image or link on one of them is the CMS's. */
  readonly cmsBases: readonly CmsBase[];
  /** Each base as text names it, `cms.example` or `example.com/blog`, lower-cased, for `mentionsCms` (`cmsNamesOf`). */
  readonly cmsNames: readonly string[];
  readonly renderBlock: RenderBlock;
  readonly options: HTMLReactParserOptions;
  readonly postId: number | undefined;
  /** How many markers have been handed to `renderBlock`; checked against `MAX_MARKERS`. */
  markers: number;
  /** How many `<a>` elements the pass is inside; see `insideLink`. */
  links: number;
  /**
   * True when the body renders an `<h1>`: every body heading is then shown
   * one level down (`headingName`), so the page keeps its own `<h1>` as the
   * only one and the body's headings keep their order. Set from the
   * pre-pass (`outline`) before the parse that renders.
   */
  demoteHeadings: boolean;
  /**
   * The label each `<figure>`'s `<figcaption>` gives the tables directly
   * inside it (`figcaptionLabel`), read once per figure, so a figure
   * holding many tables is not searched once for each.
   */
  readonly figureLabels: Map<Element, string>;
}

const UPLOADS_DIRECTORY = "/wp-content/uploads";

/** `hostname` as the CMS check compares it: every trailing dot dropped (`cms.example..`). The parser has lower-cased it. */
function hostnameKey(url: URL): string {
  return withoutTrailing(url.hostname, ".");
}

/** `configured`, an entry of `cmsOrigins` or the uploads base, as a `CmsBase`; the uploads directory itself is not part of the prefix. */
function cmsBase(configured: string): CmsBase {
  const url = new URL(configured);
  const path = withoutTrailing(url.pathname, "/");
  const prefix = path.endsWith(UPLOADS_DIRECTORY) ? path.slice(0, -UPLOADS_DIRECTORY.length) : path;
  return { hostname: hostnameKey(url), prefix };
}

/**
 * Each base as text names it, lower-cased: `cms.example`, or
 * `example.com/blog` on a subdirectory install. An internationalised host is
 * named in both its forms, since `URL` gives the punycode one
 * (`xn--mnchen-3ya.example`) and an editor types the Unicode one
 * (`münchen.example`).
 */
function cmsNamesOf(bases: readonly CmsBase[]): string[] {
  const names = new Set<string>();
  for (const { hostname, prefix } of bases) {
    for (const host of [hostname, domainToUnicode(hostname)]) {
      if (host !== "") {
        names.add(`${host}${prefix}`.toLowerCase());
      }
    }
  }
  return [...names];
}

function underPrefix(pathname: string, prefix: string): boolean {
  return prefix === "" || pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** `value` parsed as a browser would, against `base`; `null` when it does not parse. */
function parseUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isHttp(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * True when `url` names the CMS: an http(s) URL on a configured host, under
 * the path WordPress is installed in when there is one, whatever its scheme,
 * port or credentials. On a subdirectory install (`example.com/blog`) the
 * rest of `example.com` is another site, as in `stripCmsOrigin`.
 */
function namesCms(url: URL, context: Context): boolean {
  if (!isHttp(url)) {
    return false;
  }
  const hostname = hostnameKey(url);
  return context.cmsBases.some(
    (base) => base.hostname === hostname && underPrefix(url.pathname, base.prefix),
  );
}

const HYPHEN = 0x2d;
const DOT = 0x2e;
const COLON = 0x3a;

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a);
}

/**
 * `text` with ASCII letters lower-cased and nothing else changed, so its
 * indices are `text`'s. The non-ASCII letters of a CMS name (an
 * internationalised host's Unicode form) therefore match only as written,
 * in lower case, which is the form `domainToUnicode` gives.
 */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

function isHexDigit(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66) || (code >= 0x41 && code <= 0x46);
}

/** True when `text` has a percent-encoded character (`%2F`) ending just before `index`. */
function afterPercentEscape(text: string, index: number): boolean {
  return text.charCodeAt(index - 3) === 0x25 && isHexDigit(text.charCodeAt(index - 2)) && isHexDigit(text.charCodeAt(index - 1));
}

/**
 * True when `name` at `start`…`end` of `text` is a whole host, not part of
 * a longer one: not preceded by a letter, digit or `-` (`evilcms.example`,
 * `my-cms.example`) unless they end a percent escape (`%2Fcms.example`),
 * and not followed by one or by `.` and one (`cms.examples`,
 * `cms.example-2`, `cms.example.org`). Any other character (`/`, `:`, `@`,
 * `%`, `.` at the end, a space) ends it.
 */
function atLabelBoundary(text: string, start: number, end: number): boolean {
  const before = text.charCodeAt(start - 1);
  const after = text.charCodeAt(end);
  return (
    ((!isAsciiAlphanumeric(before) && before !== HYPHEN) || afterPercentEscape(text, start)) &&
    !isAsciiAlphanumeric(after) &&
    after !== HYPHEN &&
    !(after === DOT && isAsciiAlphanumeric(text.charCodeAt(end + 1)))
  );
}

/** Where `name` next stands as a whole host in `lower` (`asciiLower`'s result), from `from`; `-1` when nowhere. */
function nextMention(lower: string, name: string, from: number): number {
  for (let at = lower.indexOf(name, from); at !== -1; at = lower.indexOf(name, at + 1)) {
    if (atLabelBoundary(lower, at, at + name.length)) {
      return at;
    }
  }
  return -1;
}

/**
 * True when `text` names the CMS: contains one of its names, a host or host
 * and install path, in any case, as a whole host (`atLabelBoundary`), so
 * `cms.example.org` does not name `cms.example`.
 */
function mentionsCms(text: string, context: Context): boolean {
  const lower = asciiLower(text);
  return context.cmsNames.some((name) => nextMention(lower, name, 0) !== -1);
}

/**
 * `text` without its CMS origins: each place it names the CMS right after
 * `//`, with the `//`, the `http:` or `https:` before it and the port after
 * it, removed, so `https://cms.example/resources/x/` becomes `/resources/x/`
 * as a rewritten link would. A mention without `//` (`editor@cms.example`)
 * is left for `withoutCmsMentions`. One pass per name, linear in the length
 * of `text`.
 */
function withoutCmsOrigins(text: string, context: Context): string {
  let result = text;
  for (const name of context.cmsNames) {
    const lower = asciiLower(result);
    const parts: string[] = [];
    let position = 0;
    let at = nextMention(lower, name, 0);
    while (at !== -1) {
      let end = at + name.length;
      if (!lower.startsWith("//", at - 2)) {
        at = nextMention(lower, name, end);
        continue;
      }
      let start = at - 2;
      if (lower.startsWith("https:", start - 6)) start -= 6;
      else if (lower.startsWith("http:", start - 5)) start -= 5;
      if (lower.charCodeAt(end) === COLON) {
        let digits = end + 1;
        while (digits < lower.length && lower.charCodeAt(digits) >= 0x30 && lower.charCodeAt(digits) <= 0x39) digits++;
        if (digits > end + 1) end = digits;
      }
      parts.push(result.slice(position, Math.max(start, position)));
      position = end;
      at = nextMention(lower, name, end);
    }
    parts.push(result.slice(position));
    result = parts.join("");
  }
  return result;
}

/** `text` without the words, split at whitespace, that name the CMS; unchanged when none does. */
function withoutCmsMentions(text: string, context: Context): string {
  if (!mentionsCms(text, context)) {
    return text;
  }
  return text
    .split(/\s+/)
    .filter((word) => word !== "" && !mentionsCms(word, context))
    .join(" ");
}

/**
 * True for a rewrite the front end serves: root-relative, and `/` without a
 * query, `/resources` and everything under it, or `/media/…`. WordPress's
 * other paths (`/wp-admin/`, `/wp-login.php`, `/wp-json/…`, `/xmlrpc.php`,
 * `/feed/`, `/wp-content/…` outside uploads, `/?p=12`) are 404s here.
 */
function isFrontEndPath(url: URL): boolean {
  if (url.origin !== LINK_ORIGIN) {
    return false;
  }
  const path = url.pathname;
  return (
    (path === "/" && url.search === "") ||
    path === "/resources" ||
    path.startsWith("/resources/") ||
    path.startsWith("/media/")
  );
}

/**
 * What a URL attribute (`href`, `cite`, an embed's `src`) becomes:
 *
 * - `keep`: rendered as `href`, which is `value` rewritten by `rewriteHref`,
 *   without its query when the query names the CMS
 *   (`/resources/?u=https://cms.example/wp-admin/` becomes `/resources/`).
 *   It never names the CMS.
 * - `unwrap`: a CMS URL whose rewrite is not a front-end route
 *   (`isFrontEndPath`), so there is nothing to link to, or any URL whose
 *   path or hash names the CMS after the rewrite (`mailto:editor@cms.example`,
 *   `/resources/#cms.example`); a link keeps its content and loses the
 *   element. A `mailto:` or `tel:` URL is never unwrapped for naming the CMS
 *   (`CONTACT_SCHEMES`).
 *   `text` is the rewrite, for a link whose own text must be replaced, or
 *   `""` when the rewrite still names the CMS.
 * - `drop`: a URL that does not parse or whose scheme is not one of
 *   `LINK_SCHEMES`, judged after browser parsing.
 */
type LinkTarget =
  | { readonly kind: "keep"; readonly href: string }
  | { readonly kind: "unwrap"; readonly text: string }
  | { readonly kind: "drop" };

const DROP: LinkTarget = { kind: "drop" };

function linkTarget(value: string, context: Context): LinkTarget {
  const url = parseUrl(value, LINK_BASE);
  if (url === null || !LINK_SCHEMES.has(url.protocol)) {
    return DROP;
  }
  const rewritten = rewriteHref(value, context.cms);
  const after = parseUrl(rewritten, LINK_BASE);
  if (after === null) {
    return DROP;
  }
  if (CONTACT_SCHEMES.has(url.protocol)) {
    return { kind: "keep", href: rewritten };
  }
  const isCmsLink = namesCms(url, context) || namesCms(after, context);
  if (isCmsLink && !isFrontEndPath(after)) {
    return { kind: "unwrap", text: mentionsCms(rewritten, context) ? "" : rewritten };
  }
  const href = mentionsCms(rewritten, context) ? withoutQuery(rewritten) : rewritten;
  return mentionsCms(href, context) ? { kind: "unwrap", text: "" } : { kind: "keep", href };
}

/** `href` without its query, its path and hash kept: the query runs from the first `?` to the first `#` after it. */
function withoutQuery(href: string): string {
  const query = href.indexOf("?");
  const hash = href.indexOf("#");
  if (query === -1 || (hash !== -1 && hash < query)) {
    return href;
  }
  return href.slice(0, query) + (hash === -1 ? "" : href.slice(hash));
}

/** True when `value` parses as a `mailto:` or `tel:` URL. */
function isContactUrl(value: string): boolean {
  const url = parseUrl(value, LINK_BASE);
  return url !== null && CONTACT_SCHEMES.has(url.protocol);
}

/** The `href` to render for `value` where nothing but a link will do (`cite`, embeds): `linkTarget`'s `keep`, or `undefined`. */
function safeHref(value: string, context: Context): string | undefined {
  const target = linkTarget(value, context);
  return target.kind === "keep" ? target.href : undefined;
}

type ImageSource =
  | { readonly kind: "upload"; readonly path: string }
  | { readonly kind: "external"; readonly href: string };

/**
 * The image trust rule. `value` is read relative to the uploads directory,
 * because on the CMS that is what a root-relative `/wp-content/uploads/…`
 * meant. An `upload` is an image whose origin equals the uploads directory's
 * and whose path lies under it, with no user name or password: it is served
 * through `/media/…`. An `external` image is on a host that is not the
 * CMS's: it is shown from where it is. `null` is dropped: a URL that does
 * not parse or is not http(s), one with credentials, or one on a CMS host
 * that is not an upload.
 */
function classifyImage(value: string, context: Context): ImageSource | null {
  const url = parseUrl(value, context.cms.uploadsBase);
  if (url === null || !isHttp(url) || url.username !== "" || url.password !== "") {
    return null;
  }
  const path = mediaPath(value, context.cms.uploadsBase);
  if (path !== null && url.origin === context.uploadsOrigin) {
    return { kind: "upload", path };
  }
  return namesCms(url, context) ? null : { kind: "external", href: url.href };
}

/** `srcset` rebuilt from the candidates that are CMS images, or `undefined` when none is. */
function uploadSrcset(srcset: string | undefined, context: Context): string | undefined {
  if (srcset === undefined) {
    return undefined;
  }
  const candidates: string[] = [];
  for (const { url, descriptors } of parseSrcset(srcset)) {
    const source = classifyImage(url, context);
    if (source === null || source.kind !== "upload" || !DESCRIPTOR.test(descriptors)) {
      continue;
    }
    if (!mentionsCms(source.path, context)) {
      candidates.push(descriptors === "" ? source.path : `${source.path} ${descriptors}`);
    }
  }
  return candidates.length === 0 ? undefined : candidates.join(", ");
}

/**
 * `element`'s attributes. htmlparser2 has already made them what a browser
 * reads: with `lowerCaseAttributeNames` it lower-cases each name before
 * storing it, and it stores a name only when it is not stored yet, so the
 * first of `HREF="javascript:…" href="/ok"` wins, as in a browser. A test
 * pins that behaviour, so a parser upgrade that changed it would fail.
 */
function readAttributes(element: Element): Attributes {
  return new Map(Object.entries(element.attribs));
}

function tokens(value: string | undefined, allowed: (token: string) => boolean): string[] {
  return value === undefined ? [] : value.split(/\s+/).filter((token) => token !== "" && allowed(token));
}

function matching(value: string | undefined, pattern: RegExp): string | undefined {
  return value !== undefined && pattern.test(value) ? value : undefined;
}

function oneOf(value: string | undefined, values: ReadonlySet<string>): string | undefined {
  return value !== undefined && values.has(value) ? value : undefined;
}

function hasClass(attributes: Attributes, name: string): boolean {
  return tokens(attributes.get("class"), (token) => token === name).length > 0;
}

/**
 * The attributes any allowed element keeps: `class` (tokens of letters,
 * digits, `-` and `_`, none starting with `APP_CLASS_PREFIX` unless it is in
 * `appClasses`), `id` (with `ID_PREFIX`), `title`, `lang` and `dir`, each
 * without a value or token that names the CMS. Never `style`, and never an
 * `on*` attribute, which are not read at all.
 */
function globalProps(attributes: Attributes, context: Context, appClasses: ReadonlySet<string> = NO_CLASSES): Props {
  const props: Props = {};
  const classes = tokens(
    attributes.get("class"),
    (token) =>
      CLASS_TOKEN.test(token) &&
      (!token.toLowerCase().startsWith(APP_CLASS_PREFIX) || appClasses.has(token)) &&
      !mentionsCms(token, context),
  );
  if (classes.length > 0) {
    props.className = classes.join(" ");
  }
  // Checked before the prefix, which would hide a name at its start (`c-cms.example`).
  const id = matching(attributes.get("id"), ID_VALUE);
  if (id !== undefined && !mentionsCms(id, context)) {
    props.id = `${ID_PREFIX}${id}`;
  }
  const title = attributes.get("title");
  if (title !== undefined && title !== "" && !mentionsCms(title, context)) {
    props.title = title;
  }
  const lang = matching(attributes.get("lang"), LANG_VALUE);
  if (lang !== undefined) {
    props.lang = lang;
  }
  const dir = oneOf(attributes.get("dir"), DIR_VALUES);
  if (dir !== undefined) {
    props.dir = dir;
  }
  return props;
}

/**
 * A same-page link to `#name`, where `name` could be a content `id`, as
 * `#c-name` to match `globalProps`; any other `href` unchanged.
 */
function prefixFragment(href: string): string {
  const value = href.trim();
  const name = value.slice(1);
  return value.startsWith("#") && ID_VALUE.test(name) ? `#${ID_PREFIX}${name}` : href;
}

/**
 * True when `text` is a CMS URL written out, as an autolink shows one: an
 * absolute http(s) URL, with no space in it, that `namesCms`.
 */
function isCmsUrlText(text: string, context: Context): boolean {
  if (text === "" || /\s/.test(text)) {
    return false;
  }
  try {
    return namesCms(new URL(text), context);
  } catch {
    return false;
  }
}

/**
 * The text a link shows in place of its content, or `null` to keep its
 * content as it is. Only an autolink's content is replaced: a link whose
 * text, trimmed, is its `href` as written (WordPress turns a pasted URL into
 * `<a href="u">u</a>`) or a CMS URL written out (`isCmsUrlText`) shows its
 * rewritten target, when there is one that does not name the CMS; when
 * there is none (the `href` was dropped, or its rewrite still names the
 * CMS), its content stays. Any other content is the editor's and stays as
 * written, markup included, even when it names the CMS, so
 * `<a href="https://cms.example/wp-admin/"><b>bold</b> cms.example</a>` is
 * unwrapped to its content rather than flattened to text.
 */
function linkText(node: Element, href: string | undefined, target: LinkTarget | undefined, context: Context): string | null {
  if (href === undefined) {
    return null;
  }
  const text = textOf(node).trim();
  if (text !== href.trim() && !isCmsUrlText(text, context)) {
    return null;
  }
  const shown = target?.kind === "keep" ? target.href : target?.kind === "unwrap" ? target.text : "";
  return shown === "" || shown === text || mentionsCms(shown, context) ? null : shown;
}

/**
 * `<a>`. Its `href` goes through `linkTarget`: kept, with `prefixFragment`;
 * unwrapped, so only its content renders; or dropped from an `<a>` that
 * stays. `target` only as `_blank`, `rel` from known tokens, plus
 * `noopener noreferrer` for `_blank`. Its text may be replaced (`linkText`).
 * An `<a>` inside another is unwrapped, as a browser would not nest them.
 */
function link(node: Element, attributes: Attributes, context: Context): ReactElement {
  if (insideLink(context)) {
    return createElement(Fragment, null, linkChildren(node, context));
  }
  const href = attributes.get("href");
  const target = href === undefined ? undefined : linkTarget(href, context);
  const content = linkText(node, href, target, context) ?? linkChildren(node, context);
  if (target?.kind === "unwrap") {
    return createElement(Fragment, null, content);
  }
  const props = globalProps(attributes, context);
  if (target?.kind === "keep") {
    props.href = prefixFragment(target.href);
  }
  const rel = new Set(tokens(attributes.get("rel"), (token) => REL_TOKENS.has(token.toLowerCase())).map((token) => token.toLowerCase()));
  if (attributes.get("target") === "_blank") {
    props.target = "_blank";
    rel.add("noopener");
    rel.add("noreferrer");
  }
  if (rel.size > 0) {
    props.rel = [...rel].join(" ");
  }
  return createElement("a", checked(props, context), content);
}

/**
 * `props` without any string value that names the CMS: the last step before
 * an element of the body is created, so no attribute the pass renders names
 * it, except the `href` or `cite` of a `mailto:` or `tel:` URL
 * (`CONTACT_SCHEMES`). The rules above catch each known case first, with a better result (a
 * query dropped, a word removed); this catches what they do not foresee, a
 * `datetime` or `sizes` that names it, say.
 */
function checked(props: Props, context: Context): Props {
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === "string" && mentionsCms(value, context) && !(CONTACT_PROPS.has(name) && isContactUrl(value))) {
      delete props[name];
    }
  }
  return props;
}

/** The attributes an allowed element renders with, by name. */
function elementProps(name: string, attributes: Attributes, context: Context): Props {
  const props = globalProps(attributes, context);
  switch (name) {
    case "td":
    case "th": {
      const colSpan = matching(attributes.get("colspan"), SPAN);
      const rowSpan = matching(attributes.get("rowspan"), SPAN);
      const scope = name === "th" ? oneOf(attributes.get("scope"), SCOPE_VALUES) : undefined;
      if (colSpan !== undefined) props.colSpan = colSpan;
      if (rowSpan !== undefined) props.rowSpan = rowSpan;
      if (scope !== undefined) props.scope = scope;
      return props;
    }
    case "ol": {
      const start = matching(attributes.get("start"), LIST_START);
      if (start !== undefined) props.start = start;
      if (attributes.has("reversed")) props.reversed = true;
      return props;
    }
    case "blockquote":
    case "q": {
      const cite = attributes.get("cite");
      const safe = cite === undefined ? undefined : safeHref(cite, context);
      if (safe !== undefined) props.cite = safe;
      return props;
    }
    case "time": {
      const dateTime = matching(attributes.get("datetime"), DATETIME);
      if (dateTime !== undefined) props.dateTime = dateTime;
      return props;
    }
    case "details":
      if (attributes.has("open")) props.open = true;
      return props;
    default:
      return props;
  }
}

/**
 * Parents in which whitespace-only text is dropped, as `domToReact` drops it:
 * React rejects text in them, and a browser would move it out.
 */
const NO_TEXT_CHILDREN = new Set(["tr", "tbody", "thead", "tfoot", "colgroup", "table", "head", "html", "frameset"]);

/**
 * `node`'s children through the same pass: text as strings, every other node
 * through `replaceNode`, keyed by position when there are several, as
 * `domToReact` does. Not `domToReact` itself, which first resets the
 * prototype of every node in the subtree it is given (`normalizeDOMNodes`):
 * called once per level, that cost the depth times the size of the body
 * (about a second for 170,000 elements under 255 levels). `parse` has
 * already done it for the whole tree, once, before the first `replace`. The
 * tree is at most `MAX_DEPTH` elements deep, as `outline` checked on
 * the same parser version with the same options, so this recursion is bounded.
 */
function children(node: Element, context: Context): ReactNode {
  const nodes = node.children;
  const keyed = nodes.length > 1;
  const rendered: ReactNode[] = [];
  nodes.forEach((child, index) => {
    if (child instanceof Text) {
      if (child.data.trim() !== "" || !NO_TEXT_CHILDREN.has(node.name)) {
        rendered.push(child.data);
      }
      return;
    }
    const element = replaceNode(child as DOMNode, context);
    if (element !== undefined) {
      rendered.push(keyed ? cloneElement(element, { key: element.key ?? index }) : element);
    }
  });
  return rendered.length === 1 ? rendered[0] : rendered;
}

/**
 * The text inside `node`: a browser's `textContent` without the elements in
 * `DROPPED_WITH_CONTENT`, so the text of `<a><script>…</script>u</a>` is
 * `u`. For `linkText`; a name read from the body uses `renderedText`.
 */
function textOf(node: Element): string {
  return node.children
    .map((child) => {
      if (child instanceof Text) {
        return child.data;
      }
      return child instanceof Element && !DROPPED_WITH_CONTENT.has(child.name.toLowerCase()) ? textOf(child) : "";
    })
    .join("");
}

/**
 * The text of a name the pass reads from the body (a table's label, the
 * block's heading): `textOf`, but also without the fallback text inside
 * `<iframe>`, `<video>` and `<audio>`, which the pass renders as a link, not
 * as that text (`UNRENDERED_CONTENT`), so the label of
 * `<caption><video>no support</video>Z</caption>` is `Z`. The walk stops
 * once it holds `limit` characters or has visited `limit` nodes, so a name
 * costs at most about `limit` however much `node` holds, text or empty
 * elements; `truncated` says it stopped there. `linkText` keeps `textOf`:
 * media fallback in a link keeps the link's text from matching its `href`,
 * which keeps the link's content as written.
 */
function renderedText(node: Element, limit = Infinity): { text: string; truncated: boolean } {
  const parts: string[] = [];
  let length = 0;
  let visited = 0;
  const walk = (element: Element): boolean => {
    for (const child of element.children) {
      if (++visited > limit) {
        return false;
      }
      if (child instanceof Text) {
        parts.push(child.data);
        length += child.data.length;
        if (length >= limit) {
          return false;
        }
      } else if (child instanceof Element && !UNRENDERED_CONTENT.has(child.name.toLowerCase()) && !walk(child)) {
        return false;
      }
    }
    return true;
  };
  const complete = walk(node);
  const text = parts.join("");
  return complete ? { text, truncated: false } : { text: text.slice(0, limit), truncated: true };
}

/**
 * True when the pass is inside an `<a>`, rendered or unwrapped, where a
 * browser would not nest another link. A count the pass keeps as it descends
 * (`linkChildren`), not a walk up the parents, which cost the depth for
 * every link.
 */
function insideLink(context: Context): boolean {
  return context.links > 0;
}

/** `children` of an `<a>`, counted as inside a link. */
function linkChildren(node: Element, context: Context): ReactNode {
  context.links++;
  try {
    return children(node, context);
  } finally {
    context.links--;
  }
}

/** A link to a URL, for embeds and media: `text` defaults to the rewritten URL. */
function linkTo(href: string, text?: string): ReactElement {
  return createElement("a", { href, rel: "noopener noreferrer" }, text ?? href);
}

/**
 * `<img>` by the image trust rule. `next/image` only for a CMS image with a
 * width and a height, which it needs to reserve the space; a CMS
 * image without them is a plain lazy `<img>` with its `srcset` and `sizes`;
 * an external image is a plain lazy `<img>` by its `src` alone, sending no
 * referrer to the other host.
 */
function image(attributes: Attributes, context: Context): ReactElement {
  const src = attributes.get("src");
  const source = src === undefined ? null : classifyImage(src, context);
  // An image whose own URL names the CMS (`/media/cms.example/a.png`, `?from=cms.example`) cannot render without it.
  if (source === null || mentionsCms(source.kind === "upload" ? source.path : source.href, context)) {
    return EMPTY;
  }
  const props = globalProps(attributes, context);
  props.alt = withoutCmsMentions(attributes.get("alt") ?? "", context);
  const width = matching(attributes.get("width"), DIMENSION);
  const height = matching(attributes.get("height"), DIMENSION);
  if (source.kind === "external") {
    if (width !== undefined) props.width = width;
    if (height !== undefined) props.height = height;
    return createElement("img", checked({ ...props, src: source.href, loading: "lazy", referrerPolicy: "no-referrer" }, context));
  }
  if (width !== undefined && height !== undefined) {
    // `src` and `alt` were checked above; the rest is `CONTENT_SIZES` and numbers.
    return createElement(Image, {
      ...checked(props, context),
      alt: String(props.alt),
      src: source.path,
      width: Number(width),
      height: Number(height),
      sizes: CONTENT_SIZES,
    });
  }
  const srcSet = uploadSrcset(attributes.get("srcset"), context);
  if (srcSet !== undefined) {
    props.srcSet = srcSet;
    const sizes = matching(attributes.get("sizes"), SIZES);
    if (sizes !== undefined) props.sizes = sizes;
  }
  return createElement("img", checked({ ...props, src: source.path, loading: "lazy" }, context));
}

/**
 * The `src` of an `<iframe>`, `<video>` or `<audio>`, or, for one without a
 * `src`, of its first `<source>` child whose `src` makes a link; `null`
 * when there is none.
 */
function mediaSource(node: Element, attributes: Attributes, context: Context): { src: string; href: string } | null {
  const own = attributes.get("src");
  const candidates =
    own !== undefined
      ? [own]
      : node.children.flatMap((child) =>
          child instanceof Element && child.name.toLowerCase() === "source" && child.attribs.src !== undefined
            ? [child.attribs.src]
            : [],
        );
  for (const src of candidates) {
    const href = safeHref(src, context);
    if (href !== undefined) {
      return { src, href };
    }
  }
  return null;
}

/**
 * An `<iframe>`, `<video>` or `<audio>` as a link to its source, by the
 * rule for links: its `title` is the link's text unless it is empty, is the
 * `src` itself or names the CMS, when the rewritten `src` is. Inside a link
 * it is that text alone.
 */
function mediaLink(node: Element, attributes: Attributes, context: Context): ReactElement {
  const source = mediaSource(node, attributes, context);
  if (source === null) {
    return EMPTY;
  }
  const title = attributes.get("title")?.trim() ?? "";
  const text = title !== "" && title !== source.src.trim() && !mentionsCms(title, context) ? title : source.href;
  return insideLink(context) ? createElement(Fragment, null, text) : linkTo(source.href, text);
}

/**
 * An embed block's wrapper (`<div class="wp-block-embed__wrapper">`) whose
 * only content is the embed's URL as text, which is what WordPress leaves
 * when no oEmbed provider answered: the URL becomes a link (its text inside
 * a link, its rewritten path when it is a CMS URL with no route). Any other
 * wrapper renders as a `div`, and an `<iframe>` inside it becomes a link
 * through `mediaLink`.
 */
function embedWrapper(node: Element, attributes: Attributes, context: Context): ReactElement | null {
  const content = node.children.filter((child) => !(child instanceof Text && child.data.trim() === ""));
  if (content.length !== 1 || !(content[0] instanceof Text)) {
    return null;
  }
  const value = content[0].data.trim();
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  const target = linkTarget(value, context);
  let shown: ReactNode = null;
  if (target.kind === "keep") {
    shown = insideLink(context) ? target.href : linkTo(target.href);
  } else if (target.kind === "unwrap") {
    shown = target.text;
  }
  return createElement("div", checked(globalProps(attributes, context), context), shown);
}

/**
 * True for a `data-topic` the routes and tags accept as it is: a slug
 * (`isSlug`) already in the form `canonicalSlug` gives, which is the form
 * WordPress writes, so `topic:{slug}` names the tag the data layer sets.
 */
function isTopicSlug(value: string): boolean {
  return isSlug(value) && canonicalSlug(value) === value;
}

/**
 * The marker's attributes, validated; `null` when any is missing or out of
 * range. `exclude` is `context.postId` when it is given.
 */
function markerProps(node: Element, attributes: Attributes, context: Context): RelatedBlockProps | null {
  const count = matching(attributes.get("data-count"), POSITIVE_INTEGER);
  const topic = attributes.get("data-topic");
  const topicId = matching(attributes.get("data-topic-id"), POSITIVE_INTEGER);
  const exclude = matching(attributes.get("data-exclude"), POSITIVE_INTEGER);
  if (count === undefined || topic === undefined || topicId === undefined || exclude === undefined) {
    return null;
  }
  const countValue = Number(count);
  if (countValue < 1 || countValue > 10 || !isTopicSlug(topic)) {
    return null;
  }
  const topicIdValue = Number(topicId);
  const excludeValue = Number(exclude);
  if (!Number.isSafeInteger(topicIdValue) || !Number.isSafeInteger(excludeValue)) {
    return null;
  }
  const headingNode = node.children.find((child) => child instanceof Element && child.name.toLowerCase() === "h2");
  const heading = headingNode instanceof Element ? renderedText(headingNode).text.trim() : "";
  return {
    count: countValue,
    topic,
    topicId: topicIdValue,
    exclude: context.postId ?? excludeValue,
    heading: heading === "" ? null : heading,
  };
}

/**
 * The block marker, as the contract in `packages/ui/README.md` states it;
 * the plugin's render callback that will emit it is not built yet (issue
 * #50). The fallback is the wrapper with its `class` and its children
 * through the pass; the `data-*` attributes are read here and never
 * rendered, so the marker stays on the server. The wrapper always carries
 * `rh-related`, the class the contract gives it, whether or not the CMS
 * wrote it, so `prose.css` styles the fallback as a small collection
 * whatever the block's markup; the `data-*` attributes are what make it a
 * marker, not the class.
 *
 * Whether `renderBlock` gets the marker is decided, and counted, before its
 * children render, so `MAX_MARKERS` counts in document order: a marker
 * nested inside this one comes after it. A marker inside an `<a>` renders
 * its fallback, since the block renders links and a browser would not nest
 * them. A `renderBlock` that throws renders this block's fallback, logged,
 * and the rest of the body as usual. Only a valid marker that may be handed
 * on has its heading read, so at most `MAX_MARKERS` headings are walked.
 */
function marker(node: Element, attributes: Attributes, context: Context): ReactElement {
  const props = insideLink(context) || context.markers >= MAX_MARKERS ? null : markerProps(node, attributes, context);
  if (props !== null) {
    context.markers++;
  }
  const wrapperProps = globalProps(attributes, context, MARKER_CLASSES);
  // The wrapper always carries the contract's class, once, after any the CMS wrote.
  const classes = typeof wrapperProps.className === "string" ? wrapperProps.className.split(" ") : [];
  wrapperProps.className = (classes.includes(MARKER_CLASS) ? classes : [...classes, MARKER_CLASS]).join(" ");
  const fallback = createElement("div", checked(wrapperProps, context), children(node, context));
  if (props === null) {
    return fallback;
  }
  try {
    return createElement(Fragment, null, context.renderBlock(props, fallback));
  } catch (error) {
    console.error("renderContent: renderBlock failed; rendering the block's fallback", error);
    return fallback;
  }
}

/**
 * Drops the newline right after `<pre>` when the `<pre>` holds a single text
 * node. A browser has already dropped that newline from the CMS's HTML, and
 * React, rendering a `<pre>` whose only child is a string that starts with a
 * newline, writes an extra one for the browser to drop, so without this the
 * page shows a blank first line. With more children React writes the text
 * as it is and the browser drops the newline itself. The tree is this
 * call's own, so the text node is edited in place.
 */
function dropLeadingNewline(pre: Element): void {
  const [first] = pre.children;
  if (pre.children.length === 1 && first instanceof Text && first.data.startsWith("\n")) {
    first.data = first.data.slice(1);
  }
}

const HEADING = /^h([1-6])$/;

/**
 * The element name a body element renders as: a heading one level down when
 * the body renders an `<h1>` (`Context.demoteHeadings`), capped at `h6`;
 * any other name unchanged. Every level moves, not just `h1`, so the body's
 * headings keep their order relative to each other: `h1`, `h3`, `h2` become
 * `h2`, `h4`, `h3`. A body without an `<h1>` (WordPress's editor starts its
 * headings at `h2`, under the post's title) is left as written, so its `h2`s
 * stay directly under the page's `<h1>` instead of skipping a level.
 */
function headingName(name: string, context: Context): string {
  const level = context.demoteHeadings ? HEADING.exec(name) : null;
  return level === null ? name : `h${Math.min(Number(level[1]) + 1, 6)}`;
}

/** The scroll region's accessible name when its table has no caption or figure caption with text. */
const TABLE_LABEL = "Table";

/**
 * The most characters a table's scroll region's name has. A
 * caption can hold any amount of text, including a whole nested table, as
 * htmlparser2 nests a `<table>` inside a `<caption>`: without a cap, each of
 * a chain of nested tables named by its caption repeats all its
 * descendants' text, and 500 KB of body becomes 30 MB of HTML.
 */
export const MAX_TABLE_LABEL = 150;

/**
 * How much of a caption's text the label reads (`renderedText`'s limit):
 * room past `MAX_TABLE_LABEL` for the whitespace that collapses and the
 * words naming the CMS that are taken out after the read.
 */
const TABLE_LABEL_READ = 4 * MAX_TABLE_LABEL;

/** The first child of `node` named `name`, as a browser takes a table's caption. */
function firstChild(node: Element, name: string): Element | undefined {
  return node.children.find((child): child is Element => child instanceof Element && child.name.toLowerCase() === name);
}

/** True for the first half of a UTF-16 surrogate pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * `text`, a single-spaced string, cut to at most `limit` characters at the
 * last space within them, with no ellipsis. A first word longer than
 * `limit` is cut at `limit`, never between the halves of a surrogate pair.
 */
function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const space = text.lastIndexOf(" ", limit);
  if (space > 0) {
    return text.slice(0, space);
  }
  return text.slice(0, isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit);
}

/**
 * A caption's text as a label: read to `TABLE_LABEL_READ` characters
 * (`renderedText`, so without the content the pass does not render), without
 * any word that names the CMS, since it renders as an attribute, whitespace
 * collapsed, trimmed and cut to `MAX_TABLE_LABEL` at a word boundary; `""`
 * when nothing is left. A read that stopped at its limit may have stopped
 * inside a word, a CMS host among them (`https://cms.exa`), so that last
 * word is dropped before the CMS's words are looked for.
 */
function labelText(caption: Element, context: Context): string {
  const { text, truncated } = renderedText(caption, TABLE_LABEL_READ);
  const whole = truncated ? text.replace(/\S*$/, "") : text;
  return cutAtWord(withoutCmsMentions(whole, context).replace(/\s+/g, " ").trim(), MAX_TABLE_LABEL);
}

/**
 * The label a `<figure>`'s first `<figcaption>` child gives a table directly
 * inside it (`labelText`), `""` when it has none; cached per figure in
 * `Context.figureLabels`.
 */
function figcaptionLabel(figure: Element, context: Context): string {
  let label = context.figureLabels.get(figure);
  if (label === undefined) {
    const figcaption = firstChild(figure, "figcaption");
    label = figcaption === undefined ? "" : labelText(figcaption, context);
    context.figureLabels.set(figure, label);
  }
  return label;
}

/**
 * The accessible name of a table's scroll region (`labelText`): its own
 * `<caption>` (the first one among its children, as a browser takes it);
 * when that is missing or leaves nothing, the `<figcaption>` of the
 * `<figure>` that is the table's parent, which is how WordPress's table
 * block captions a table (`figure.wp-block-table` with a
 * `figcaption.wp-element-caption`, no `<caption>`); `TABLE_LABEL` when
 * neither leaves any text. A figure caption names only a table directly in
 * the figure, never one deeper down, and a figure with no table names
 * nothing.
 */
function tableLabel(table: Element, context: Context): string {
  const caption = firstChild(table, "caption");
  const own = caption === undefined ? "" : labelText(caption, context);
  if (own !== "") {
    return own;
  }
  const parent = table.parent;
  const fromFigure = parent instanceof Element && parent.name.toLowerCase() === "figure" ? figcaptionLabel(parent, context) : "";
  return fromFigure === "" ? TABLE_LABEL : fromFigure;
}

/**
 * A rendered `<table>` inside a focusable, labelled region that scrolls
 * sideways (`.rh-table-scroll` in `components/resource.css`), so a table too
 * wide for a phone scrolls inside the column instead of widening the page or
 * squeezing its cells. `tabIndex={0}` lets a keyboard reach and scroll it
 * (axe's `scrollable-region-focusable`), and `role="region"` with an
 * `aria-label` names the stop a screen reader lands on. The region is the
 * pass's own markup, not the editor's, so it carries an app class and the
 * ARIA attributes the sanitiser never lets content carry. The table inside a
 * `figure.wp-block-table` is wrapped, not the figure, so the figure's caption
 * stays outside the scrolling box. Inside a link, where a focusable region
 * would be an interactive element in another, the table renders bare.
 */
function tableRegion(node: Element, table: ReactElement, context: Context): ReactElement {
  if (insideLink(context)) {
    return table;
  }
  const props = checked(
    { className: "rh-table-scroll", role: "region", tabIndex: 0, "aria-label": tableLabel(node, context) },
    context,
  );
  props["aria-label"] ??= TABLE_LABEL;
  return createElement("div", props, table);
}

/**
 * `replace` for every node. Text is left to the parser, which hands it to
 * React as a string; every other node is replaced by what this returns,
 * never rendered by the parser, so nothing reaches the output without
 * passing through here.
 */
function replaceNode(node: DOMNode, context: Context): ReactElement | undefined {
  if (node instanceof Text) {
    return undefined;
  }
  if (!(node instanceof Element)) {
    return EMPTY; // comments, doctype, processing instructions
  }
  const name = node.name.toLowerCase();
  const attributes = readAttributes(node);
  if (name === "div" && attributes.get("data-rh-block") === "related-resources") {
    return marker(node, attributes, context);
  }
  if (name === "img") {
    return image(attributes, context);
  }
  if (LINKED_MEDIA.has(name)) {
    return mediaLink(node, attributes, context);
  }
  if (DROPPED_WITH_CONTENT.has(name)) {
    return EMPTY;
  }
  if (name === "a") {
    return link(node, attributes, context);
  }
  if (!ALLOWED_ELEMENTS.has(name)) {
    return createElement(Fragment, null, children(node, context));
  }
  if (name === "div" && hasClass(attributes, "wp-block-embed__wrapper")) {
    const embed = embedWrapper(node, attributes, context);
    if (embed !== null) {
      return embed;
    }
  }
  if (name === "pre") {
    dropLeadingNewline(node);
  }
  const props = checked(elementProps(name, attributes, context), context);
  if (VOID_ELEMENTS.has(name)) {
    return createElement(name, props);
  }
  const element = createElement(headingName(name, context), props, children(node, context));
  return name === "table" ? tableRegion(node, element, context) : element;
}

const defaultRenderBlock: RenderBlock = (_props, fallback) => fallback;

const GREATER_THAN = 0x3e;
const SLASH = 0x2f;
const EXCLAMATION_MARK = 0x21;
const QUESTION_MARK = 0x3f;

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** What ends a tag name for htmlparser2: ASCII whitespace, `/` or `>`. */
function endsTagName(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === SLASH || code === GREATER_THAN;
}

/** The tag at `start` (a `<`): its lower-case name and whether it is an end tag; `null` when `<` starts no tag, as for htmlparser2. */
function tagAt(html: string, start: number): { name: string; closing: boolean } | null {
  const closing = html.charCodeAt(start + 1) === SLASH;
  const nameStart = start + (closing ? 2 : 1);
  if (!isAsciiLetter(html.charCodeAt(nameStart))) {
    return null;
  }
  let nameEnd = nameStart + 1;
  while (nameEnd < html.length && !endsTagName(html.charCodeAt(nameEnd))) nameEnd++;
  return { name: html.slice(nameStart, nameEnd).toLowerCase(), closing };
}

/**
 * The options both parses use, the pre-pass here and `html-react-parser`'s:
 * lower-case names and first-occurrence-wins for duplicates, as a browser
 * reads attributes, so `HREF` and `href` are one attribute.
 */
const PARSER_OPTIONS: ParserOptions = { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true };

/** Thrown by `outline`'s handler to stop the parser at the first element past the limit. */
class TooDeep extends Error {}

/** htmlparser2's `Parser`, with its own judgement of which elements are void made readable. */
class DepthProbe extends Parser {
  isVoid(name: string): boolean {
    return this.isVoidElement(name);
  }
}

/** What the pre-pass learns about a body: whether it nests too deep, and whether it renders an `<h1>`. */
interface Outline {
  readonly tooDeep: boolean;
  readonly hasH1: boolean;
}

/**
 * The pre-pass over `html`: `tooDeep` when htmlparser2, with
 * `PARSER_OPTIONS`, would hold more than `limit` elements open at once while
 * parsing it (the tree `html-react-parser` builds from it would be more than
 * `limit` elements deep), and `hasH1` when an `<h1>` opens outside every
 * element whose content the pass leaves out (`UNRENDERED_CONTENT`), which
 * decides whether the body's headings are demoted (`headingName`). When
 * `tooDeep` is true the parse stopped early and `hasH1` is meaningless: the
 * body renders as plain text.
 *
 * It runs the parser itself, so comments, attribute values, `<script>`,
 * `<textarea>`, CDATA, implied end tags and foreign content are read exactly
 * as in the parse that renders. That is the same version, not the same copy:
 * `html-react-parser` parses with the htmlparser2 that `html-dom-parser`
 * bundles in `lib/node_modules/htmlparser2`, this runs the app's own pinned
 * one, and `test/content-parser-version.test.ts` fails unless the two are
 * the same release; a hand-written scan cannot see end tags the
 * way the parser does, and markup that hid them from one made the parser
 * nest tens of thousands deep. `onopentagname` fires right after the parser
 * pushes an element onto its stack, and `onclosetag` as it pops one, so
 * `depth` is the stack's length; void elements, which the parser never
 * pushes (and reports closed at once), are left out by the parser's own
 * `isVoidElement`. `unrendered` counts the open elements in
 * `UNRENDERED_CONTENT` the same way, so it is the number of them on the
 * stack. The handler throws at the first element past `limit`, so
 * the stack never holds more than `limit + 1`. That bounds the parser's work
 * per tag (it searches the stack for every end tag and shifts it for every
 * start tag), so the pass is linear in the length of `html`. No `onopentag`
 * handler is given, so the parser does not collect attributes.
 */
function outline(html: string, limit: number): Outline {
  let depth = 0;
  let unrendered = 0;
  let hasH1 = false;
  const probe: DepthProbe = new DepthProbe(
    {
      onopentagname(name) {
        if (probe.isVoid(name)) {
          return;
        }
        if (++depth > limit) {
          throw new TooDeep();
        }
        if (UNRENDERED_CONTENT.has(name)) {
          unrendered++;
        } else if (name === "h1" && unrendered === 0) {
          hasH1 = true;
        }
      },
      onclosetag(name) {
        if (probe.isVoid(name)) {
          return;
        }
        depth--;
        if (UNRENDERED_CONTENT.has(name)) {
          unrendered--;
        }
      },
    },
    PARSER_OPTIONS,
  );
  try {
    probe.end(html);
  } catch (error) {
    if (error instanceof TooDeep) {
      return { tooDeep: true, hasH1: false };
    }
    throw error;
  }
  return { tooDeep: false, hasH1 };
}

/** Elements whose content the parser reads as text, not markup; `textOnly` leaves it out. */
const RAW_TEXT_ENDS = new Map(
  ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"].map(
    (name) => [name, new RegExp(`</${name}`, "gi")] as const,
  ),
);

/** Elements that `textOnly` joins to their neighbours without a space, because they sit inside a line of text. */
const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

const BASIC_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

/**
 * `text` with numeric character references and the six entities WordPress
 * writes most decoded; any other named entity stays as written. A code point
 * that is not a Unicode scalar value becomes U+FFFD, as in a browser.
 */
function decodeBasicEntities(text: string): string {
  return text.replace(
    /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g,
    (_match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name !== undefined) {
        return BASIC_ENTITIES[name] ?? "";
      }
      const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? "", 16);
      const scalar = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return scalar ? String.fromCodePoint(code) : "\ufffd";
    },
  );
}

/**
 * `html` as plain text, for a body too deep to parse or one the pass failed
 * on: every tag, comment and declaration removed, the content of `<script>`,
 * `<style>` and the other raw-text elements left out, common entities
 * decoded, and whitespace collapsed to single spaces. One pass with
 * `indexOf`, without the parser, so it is linear however deep the nesting.
 * React escapes the result like any other text.
 *
 * The text cannot tell a link's text from prose, so the CMS is taken out of
 * all of it: its origins are removed (`withoutCmsOrigins`), so an autolink
 * such as `https://cms.example/resources/x/` shows `/resources/x/` as the
 * rendered link would, and then any word that still names it
 * (`editor@cms.example`, `user@cms.example/x`) is removed. Unlike the
 * markup rendering, which leaves the editor's prose as written, the plain
 * text never names the CMS.
 */
function textOnly(html: string, context: Context): string {
  const parts: string[] = [];
  let position = 0;
  while (position < html.length) {
    const start = html.indexOf("<", position);
    if (start === -1) {
      parts.push(html.slice(position));
      break;
    }
    parts.push(html.slice(position, start));
    const tag = tagAt(html, start);
    const next = html.charCodeAt(start + 1);
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      position = end === -1 ? html.length : end + 3;
      parts.push(" ");
    } else if (tag !== null || next === EXCLAMATION_MARK || next === QUESTION_MARK || next === SLASH) {
      const end = html.indexOf(">", start + 1);
      position = end === -1 ? html.length : end + 1;
      const rawEnd = tag !== null && !tag.closing ? RAW_TEXT_ENDS.get(tag.name) : undefined;
      if (rawEnd !== undefined) {
        rawEnd.lastIndex = position;
        position = rawEnd.exec(html)?.index ?? html.length;
      }
      if (tag === null || !INLINE_ELEMENTS.has(tag.name)) {
        parts.push(" ");
      }
    } else {
      parts.push("<");
      position = start + 1;
    }
  }
  const text = withoutCmsOrigins(decodeBasicEntities(parts.join("")), context);
  return withoutCmsMentions(text, context).replace(/\s+/g, " ").trim();
}

/**
 * `html`, a resource's `content.rendered`, as React nodes, with every rewrite
 * and check above applied. `cms` comes from `cmsUrls()` in `lib/env.ts`.
 *
 * Throws a `TypeError` if a configured URL is not an http(s) URL. Never
 * throws because of the HTML: a body longer than `MAX_CONTENT_LENGTH`, one
 * nested deeper than `MAX_DEPTH`, or one the parse or the pass fails on,
 * renders as `textOnly(html)`, plain text with no markup, and the reason is
 * logged on the server.
 */
export function renderContent(html: string, cms: CmsUrls, options: RenderContentOptions = {}): ReactNode {
  // Parse the configured URLs before the `try`, so a bad configuration
  // throws its TypeError instead of quietly turning every body into text.
  stripCmsOrigin("", cms.cmsOrigins);
  mediaPath("", cms.uploadsBase);
  const cmsBases = [...cms.cmsOrigins, cms.uploadsBase].map(cmsBase);
  const context: Context = {
    cms,
    uploadsOrigin: new URL(cms.uploadsBase).origin,
    cmsBases,
    cmsNames: cmsNamesOf(cmsBases),
    renderBlock: options.renderBlock ?? defaultRenderBlock,
    options: {
      htmlparser2: PARSER_OPTIONS,
      replace: (node) => replaceNode(node, context),
    },
    postId: options.postId !== undefined && Number.isSafeInteger(options.postId) && options.postId > 0 ? options.postId : undefined,
    markers: 0,
    links: 0,
    demoteHeadings: false,
    figureLabels: new Map(),
  };
  if (html.length > MAX_CONTENT_LENGTH) {
    console.warn(`renderContent: the body is longer than ${MAX_CONTENT_LENGTH} characters; rendering it as text`);
    return textOnly(html, context);
  }
  try {
    const { tooDeep, hasH1 } = outline(html, MAX_DEPTH);
    if (tooDeep) {
      console.warn(`renderContent: the body nests more than ${MAX_DEPTH} elements deep; rendering it as text`);
      return textOnly(html, context);
    }
    context.demoteHeadings = hasH1;
    return parse(html, context.options);
  } catch (error) {
    console.error("renderContent: the body could not be rendered; rendering it as text", error);
    return textOnly(html, context);
  }
}
