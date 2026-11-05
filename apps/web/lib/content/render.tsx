import "server-only";

import parse, {
  domToReact,
  Element,
  Text,
  type DOMNode,
  type HTMLReactParserOptions,
} from "html-react-parser";
import Image from "next/image";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

import { isSlug } from "../routes";
import { mediaPath, parseSrcset, rewriteHref, stripCmsOrigin, withoutTrailing, type CmsUrls } from "../urls";

/**
 * The one server-side pass over a resource's `content.rendered` (ADRs 0036,
 * 0037, 0040 and 0047). WordPress hands the front end HTML that editors
 * wrote, with the CMS's absolute URLs in it; this turns it into React nodes
 * that show nothing of the CMS and run nothing of the editor's.
 *
 * `html-react-parser` parses the string once and calls `replace` for every
 * node, parents first, before it renders anything of its own. `replace`
 * returns a new element for every element node, built from an allow-list of
 * elements and attributes with each attribute value checked, or nothing. The
 * parser's own rendering is reached only by text nodes, which React escapes.
 * Nothing here uses `dangerouslySetInnerHTML`, so no fragment of the input
 * reaches the page as markup; that is what makes a sanitiser inside `replace`
 * sound. The output is never serialised and parsed again, so the mutation
 * tricks that defeat string sanitisers do not apply.
 *
 * In that one pass:
 *
 * - Links: `href` is rewritten with `rewriteHref`, so links to uploads become
 *   `/media/…`, links on the CMS become root-relative and other links stay.
 *   A link with `target="_blank"` gets `rel="noopener noreferrer"`.
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
 * - Sanitising: only the elements in `ALLOWED_ELEMENTS` are rendered, with
 *   the attributes in `GLOBAL_ATTRIBUTES` and the per-element lists below,
 *   each value checked. `style` and every `on*` attribute are dropped
 *   everywhere. `href`, `src`, `srcset` and `cite` may be `http`, `https`,
 *   `mailto`, `tel` or relative, judged on the URL as a browser parses it, so
 *   case, surrounding spaces, tabs and newlines in the scheme, and entities
 *   (decoded by the parser) make no difference. The elements in
 *   `DROPPED_WITH_CONTENT` go with everything inside them; any other
 *   element not on the list is unwrapped, and its children are kept and go
 *   through the same checks. Every `id` gets the prefix `c-`, and so does a
 *   same-page `#fragment` link, so no `id` in a body can clobber a global or
 *   an element the page's own scripts look up (`<div id="TURBOPACK">`).
 * - The block marker: `<div data-rh-block="related-resources">` with its
 *   `data-*` attributes is parsed and validated and handed to `renderBlock`
 *   with the wrapper's own rendering as the fallback. The default renders
 *   the fallback; slice 4 plugs in `<RelatedResources>`. An invalid marker
 *   renders the fallback and `renderBlock` is not called.
 * - Embeds: an `<iframe>`, `<video>` or `<audio>` becomes a link to its
 *   `src`, and an embed block whose wrapper still holds the raw URL as text
 *   (the oEmbed was not resolved) becomes a link to that URL.
 * - Depth: a body nested more than `MAX_DEPTH` elements deep renders as
 *   plain text (`textOnly`). `mayNestDeeperThan` keeps a body far deeper
 *   than that from the parser, which slows down quadratically with depth;
 *   the pass counts the depth exactly as it descends. Any error inside the
 *   parse or the pass (`html-react-parser` recurses once per level and runs
 *   out of stack at about 2,000) also gives the plain-text rendering, so a
 *   body never makes the page fail.
 *
 * No regular expression here backtracks more than linearly on its input.
 *
 * Server only: it imports `next/image` and runs in Server Components.
 */

/** The related-resources marker, parsed and validated (ADR 0037). */
export interface RelatedBlockProps {
  /** `data-count`, 1 to 10. */
  readonly count: number;
  /** `data-topic`, the topic's current slug, which names the `topic:{slug}` tag. */
  readonly topic: string;
  /** `data-topic-id`, the term ID for the `resource_topic` REST filter. */
  readonly topicId: number;
  /** `data-exclude`, the ID of the post the block sits in. */
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
}

/**
 * `sizes` for a content image rendered through `next/image`. The content
 * column is `--rh-measure` (65ch in the shared tokens), about 40rem of text
 * at the system font, and `sizes` cannot read a CSS variable, so it is
 * written out, rounded up: a larger estimate fetches a few more bytes, a
 * smaller one a blurrier image.
 */
const CONTENT_SIZES = "(max-width: 40rem) 100vw, 40rem";

/**
 * How deeply a body may nest before it renders as plain text, counted
 * exactly by the pass (`children`). WordPress's own blocks nest a dozen
 * levels at most (a list in a group in a column in a cover); 256 is far
 * beyond any real body and far below the roughly 2,000 levels of `<div>` at
 * which `html-react-parser` runs out of stack.
 */
export const MAX_DEPTH = 256;

/**
 * The estimate (`mayNestDeeperThan`) past which a body is not parsed at all.
 * Higher than `MAX_DEPTH` because the estimate errs high on markup that
 * leaves elements open (an SVG's `<path/>`s, `<li>`s never closed); low
 * enough that the parser's per-tag work, which grows with the depth, stays
 * small (a megabyte of end tags under 1,000 open elements: about 0.15 s).
 * A body between the two becomes text through the exact check.
 */
const PRESCAN_LIMIT = 1024;

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

/** Schemes a link may use. Relative references resolve to `https:` and pass. */
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** The base relative links resolve against for the scheme check; its host is never the CMS. */
const LINK_BASE = "https://front-end.invalid/";

const CLASS_TOKEN = /^[A-Za-z0-9_-]+$/;
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
  readonly renderBlock: RenderBlock;
  readonly options: HTMLReactParserOptions;
  /** How many elements deep the pass is; checked against `MAX_DEPTH` in `children`. */
  depth: number;
}

const UPLOADS_DIRECTORY = "/wp-content/uploads";

/** `hostname` as the CMS check compares it: one trailing dot dropped. The parser has lower-cased it. */
function hostnameKey(url: URL): string {
  return url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
}

/** `configured`, an entry of `cmsOrigins` or the uploads base, as a `CmsBase`; the uploads directory itself is not part of the prefix. */
function cmsBase(configured: string): CmsBase {
  const url = new URL(configured);
  const path = withoutTrailing(url.pathname, "/");
  const prefix = path.endsWith(UPLOADS_DIRECTORY) ? path.slice(0, -UPLOADS_DIRECTORY.length) : path;
  return { hostname: hostnameKey(url), prefix };
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

/**
 * The `href` to render for `value`, or `undefined` to drop it: the scheme
 * must be one of `LINK_SCHEMES` after browser parsing, and the rewritten
 * link must not still name a CMS host (a port the configuration does not
 * list, say), because the CMS's address never reaches the browser.
 */
function safeHref(value: string, context: Context): string | undefined {
  const url = parseUrl(value, LINK_BASE);
  if (url === null || !LINK_SCHEMES.has(url.protocol)) {
    return undefined;
  }
  const rewritten = rewriteHref(value, context.cms);
  const after = parseUrl(rewritten, LINK_BASE);
  return after === null || namesCms(after, context) ? undefined : rewritten;
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
    candidates.push(descriptors === "" ? source.path : `${source.path} ${descriptors}`);
  }
  return candidates.length === 0 ? undefined : candidates.join(", ");
}

function readAttributes(element: Element): Attributes {
  const attributes = new Map<string, string>();
  for (const [name, value] of Object.entries(element.attribs)) {
    const key = name.toLowerCase();
    if (!attributes.has(key)) {
      attributes.set(key, value);
    }
  }
  return attributes;
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
 * digits, `-` and `_`), `id` (with `ID_PREFIX`), `title`, `lang` and `dir`.
 * Never `style`, and never an `on*` attribute, which are not read at all.
 */
function globalProps(attributes: Attributes): Props {
  const props: Props = {};
  const classes = tokens(attributes.get("class"), (token) => CLASS_TOKEN.test(token));
  if (classes.length > 0) {
    props.className = classes.join(" ");
  }
  const id = matching(attributes.get("id"), ID_VALUE);
  if (id !== undefined) {
    props.id = `${ID_PREFIX}${id}`;
  }
  const title = attributes.get("title");
  if (title !== undefined && title !== "") {
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

/** `<a>`: `href` through `safeHref` and `prefixFragment`, `target` only as `_blank`, `rel` from known tokens, plus `noopener noreferrer` for `_blank`. */
function linkProps(attributes: Attributes, context: Context): Props {
  const props = globalProps(attributes);
  const href = attributes.get("href");
  const safe = href === undefined ? undefined : safeHref(href, context);
  if (safe !== undefined) {
    props.href = prefixFragment(safe);
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
  return props;
}

/** The attributes an allowed element renders with, by name. */
function elementProps(name: string, attributes: Attributes, context: Context): Props {
  const props = globalProps(attributes);
  switch (name) {
    case "a":
      return linkProps(attributes, context);
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

/** Thrown by `children` past `MAX_DEPTH`; `renderContent` renders the body as text. */
class TooDeep extends RangeError {}

/** `node`'s children through the same pass, one level deeper; past `MAX_DEPTH` it throws `TooDeep`. */
function children(node: Element, context: Context): ReactNode {
  if (context.depth >= MAX_DEPTH) {
    throw new TooDeep(`the body nests more than ${MAX_DEPTH} elements deep`);
  }
  context.depth++;
  const result = domToReact(node.children as DOMNode[], context.options);
  context.depth--;
  return result;
}

/** The text inside `node`, as a browser's `textContent` would give it. */
function textOf(node: Element): string {
  return node.children
    .map((child) => (child instanceof Text ? child.data : child instanceof Element ? textOf(child) : ""))
    .join("");
}

/** A link to a URL, for embeds and media: `text` defaults to the rewritten URL. */
function linkTo(href: string, text?: string): ReactElement {
  return createElement("a", { href, rel: "noopener noreferrer" }, text ?? href);
}

/**
 * `<img>` by the image trust rule. `next/image` only for a CMS image with a
 * width and a height, which it needs to reserve the space (ADR 0039); a CMS
 * image without them is a plain lazy `<img>` with its `srcset` and `sizes`;
 * an external image is a plain lazy `<img>` by its `src` alone, sending no
 * referrer to the other host.
 */
function image(attributes: Attributes, context: Context): ReactElement {
  const src = attributes.get("src");
  const source = src === undefined ? null : classifyImage(src, context);
  if (source === null) {
    return EMPTY;
  }
  const props = globalProps(attributes);
  props.alt = attributes.get("alt") ?? "";
  const width = matching(attributes.get("width"), DIMENSION);
  const height = matching(attributes.get("height"), DIMENSION);
  if (source.kind === "external") {
    if (width !== undefined) props.width = width;
    if (height !== undefined) props.height = height;
    return createElement("img", { ...props, src: source.href, loading: "lazy", referrerPolicy: "no-referrer" });
  }
  if (width !== undefined && height !== undefined) {
    return createElement(Image, {
      ...props,
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
  return createElement("img", { ...props, src: source.path, loading: "lazy" });
}

/** An `<iframe>`, `<video>` or `<audio>` as a link to its `src`, titled by its `title` when it has one. */
function mediaLink(attributes: Attributes, context: Context): ReactElement {
  const src = attributes.get("src");
  const href = src === undefined ? undefined : safeHref(src, context);
  if (href === undefined) {
    return EMPTY;
  }
  const title = attributes.get("title")?.trim();
  return linkTo(href, title === undefined || title === "" ? undefined : title);
}

/**
 * An embed block's wrapper (`<div class="wp-block-embed__wrapper">`) whose
 * only content is the embed's URL as text, which is what WordPress leaves
 * when no oEmbed provider answered: the URL becomes a link. Any other
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
  const href = safeHref(value, context);
  return createElement("div", globalProps(attributes), href === undefined ? null : linkTo(href));
}

/** The marker's attributes, validated; `null` when any is missing or out of range. */
function markerProps(node: Element, attributes: Attributes): RelatedBlockProps | null {
  const count = matching(attributes.get("data-count"), POSITIVE_INTEGER);
  const topic = attributes.get("data-topic");
  const topicId = matching(attributes.get("data-topic-id"), POSITIVE_INTEGER);
  const exclude = matching(attributes.get("data-exclude"), POSITIVE_INTEGER);
  if (count === undefined || topic === undefined || topicId === undefined || exclude === undefined) {
    return null;
  }
  const countValue = Number(count);
  if (countValue < 1 || countValue > 10 || !isSlug(topic)) {
    return null;
  }
  const topicIdValue = Number(topicId);
  const excludeValue = Number(exclude);
  if (!Number.isSafeInteger(topicIdValue) || !Number.isSafeInteger(excludeValue)) {
    return null;
  }
  const headingNode = node.children.find((child) => child instanceof Element && child.name.toLowerCase() === "h2");
  const heading = headingNode instanceof Element ? textOf(headingNode).trim() : "";
  return {
    count: countValue,
    topic,
    topicId: topicIdValue,
    exclude: excludeValue,
    heading: heading === "" ? null : heading,
  };
}

/**
 * The block marker (ADR 0037). The fallback is the wrapper with its `class`
 * and its children through the pass; the `data-*` attributes are read here
 * and never rendered, so the marker stays on the server.
 */
function marker(node: Element, attributes: Attributes, context: Context): ReactElement {
  const fallback = createElement("div", globalProps(attributes), children(node, context));
  const props = markerProps(node, attributes);
  return props === null ? fallback : createElement(Fragment, null, context.renderBlock(props, fallback));
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
    return mediaLink(attributes, context);
  }
  if (DROPPED_WITH_CONTENT.has(name)) {
    return EMPTY;
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
  const props = elementProps(name, attributes, context);
  return VOID_ELEMENTS.has(name)
    ? createElement(name, props)
    : createElement(name, props, children(node, context));
}

const defaultRenderBlock: RenderBlock = (_props, fallback) => fallback;

/**
 * The void elements as htmlparser2 knows them in HTML mode: they never open
 * a level. `image`, which it reads as `img` outside SVG, is not here, so the
 * count errs high on it.
 */
const PARSER_VOID_ELEMENTS = new Set([
  "area", "base", "basefont", "br", "col", "command", "embed", "frame", "hr", "img",
  "input", "isindex", "keygen", "link", "meta", "param", "source", "track", "wbr",
]);

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
 * True when `html` may nest more than `limit` elements deep, decided in one
 * pass over the string before the parser sees it. htmlparser2 slows down
 * quadratically with depth (200,000 nested `<div>`s, a megabyte, take about
 * five seconds), so a body this flags is never parsed.
 *
 * It counts open elements by name: a start tag that is not void opens one,
 * and an end tag closes one of its name when one is open. It does not keep
 * their order, so an end tag closes one element here where the parser
 * closes the matching element and everything opened inside it, and an
 * element the parser closes by implication (an open `<p>` when a `<div>`
 * starts, the last `<li>` at `</ul>`, a `<path/>` in an `<svg>`) stays
 * counted. Both only make the count higher than the parser's depth. It sees
 * every start tag the parser sees, and more (tags inside comments, attribute
 * values and `<script>`), which also only raises it. What can lower it is an
 * end tag the parser does not read as one (`<!--</div>-->`), by one each:
 * markup written that way can reach the parser deeply nested, which cost
 * about 0.6 s per megabyte at worst when measured (`<b x="</b>">` repeated),
 * and the exact check in `children` and the `try` in `renderContent` then
 * render it as text.
 *
 * Constant work per tag, so linear in the length of `html`.
 */
function mayNestDeeperThan(html: string, limit: number): boolean {
  const open = new Map<string, number>();
  let depth = 0;
  for (let position = html.indexOf("<"); position !== -1; position = html.indexOf("<", position + 1)) {
    const tag = tagAt(html, position);
    if (tag === null || PARSER_VOID_ELEMENTS.has(tag.name)) {
      continue;
    }
    const count = open.get(tag.name) ?? 0;
    if (!tag.closing) {
      open.set(tag.name, count + 1);
      depth++;
      if (depth > limit) {
        return true;
      }
    } else if (count > 0) {
      open.set(tag.name, count - 1);
      depth--;
    }
  }
  return false;
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
 */
function textOnly(html: string): string {
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
  return decodeBasicEntities(parts.join("")).replace(/\s+/g, " ").trim();
}

/**
 * `html`, a resource's `content.rendered`, as React nodes, with every rewrite
 * and check above applied. `cms` comes from `cmsUrls()` in `lib/env.ts`.
 *
 * Throws a `TypeError` if a configured URL is not an http(s) URL. Never
 * throws because of the HTML: a body nested deeper than `MAX_DEPTH`, or one
 * the parse or the pass fails on, renders as `textOnly(html)`, plain text
 * with no markup, and the reason is logged on the server.
 */
export function renderContent(html: string, cms: CmsUrls, options: RenderContentOptions = {}): ReactNode {
  // Parse the configured URLs before the `try`, so a bad configuration
  // throws its TypeError instead of quietly turning every body into text.
  stripCmsOrigin("", cms.cmsOrigins);
  mediaPath("", cms.uploadsBase);
  const context: Context = {
    cms,
    uploadsOrigin: new URL(cms.uploadsBase).origin,
    cmsBases: [...cms.cmsOrigins, cms.uploadsBase].map(cmsBase),
    renderBlock: options.renderBlock ?? defaultRenderBlock,
    options: {
      // Lower-case names and first-occurrence-wins for duplicates, as a
      // browser reads attributes, so `HREF` and `href` are one attribute.
      htmlparser2: { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
      replace: (node) => replaceNode(node, context),
    },
    depth: 0,
  };
  if (mayNestDeeperThan(html, PRESCAN_LIMIT)) {
    console.warn(`renderContent: the body nests more than ${MAX_DEPTH} elements deep; rendering it as text`);
    return textOnly(html);
  }
  try {
    return parse(html, context.options);
  } catch (error) {
    if (error instanceof TooDeep) {
      console.warn(`renderContent: ${error.message}; rendering it as text`);
    } else {
      console.error("renderContent: the body could not be rendered; rendering it as text", error);
    }
    return textOnly(html);
  }
}
