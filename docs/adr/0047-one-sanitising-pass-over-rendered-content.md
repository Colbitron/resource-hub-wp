---
status: accepted
date: 2026-11-05
---

# One server-side pass sanitises `content.rendered` and rewrites its URLs

A resource's body arrives as `content.rendered`: HTML that editors wrote, with the CMS's absolute URLs in it. [ADR 0040](0040-the-cms-url-never-reaches-the-browser.md) says one parse pass owns every rewrite in it; [ADR 0036](0036-cms-links-are-made-relative.md) and [ADR 0037](0037-block-marker-swapped-for-a-server-component.md) say what two of them are. This records the pass as built, in `apps/web/lib/content/render.tsx`, and the decisions it took that those ADRs did not.

## The single pass

`html-react-parser` parses the string once and calls `replace` for every node, parents first, before it renders anything of its own. The pass returns a new element for every element node, built from an allow-list, or nothing; text is left to the parser, which hands it to React as a string. React escapes text and attribute values, and nothing uses `dangerouslySetInnerHTML`, so no fragment of the input reaches the page as markup. Links, images, the sanitising, the block marker and embeds are all decided in that one `replace`, in `renderContent(html, cmsUrls(), { renderBlock })`.

## An allow-list sanitiser, because kses is not a guard

WordPress filters post content with kses, but editors and administrators have `unfiltered_html`, so any of them can save a `<script>`, an `onerror` or a `javascript:` link, and `content.rendered` carries it to the front end as is. The front end treats the body as untrusted and keeps only what it recognises:

- Elements: `h1` to `h6`, `p`, `br`, `hr`, `wbr`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `a`, `img`, `figure`, `figcaption`, `blockquote`, `q`, `cite`, `code`, `pre`, `kbd`, `samp`, `var`, `table`, `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, `em`, `strong`, `b`, `i`, `u`, `s`, `del`, `ins`, `sub`, `sup`, `small`, `mark`, `abbr`, `time`, `details`, `summary`, `div`, `span`.
- Attributes on any of them: `class` (tokens of letters, digits, `-` and `_`), `id`, `title`, `lang`, `dir`. Per element: `href`, `target` (`_blank` only) and `rel` (known tokens) on `a`; `src`, `srcset`, `sizes`, `alt`, `width`, `height` on `img`; `colspan`, `rowspan` and `scope` on cells; `start` and `reversed` on `ol`; `cite` on `blockquote` and `q`; `datetime` on `time`; `open` on `details`. Every value is checked against a pattern or a set. `style` and every `on*` attribute are never read.
- URL attributes (`href`, `src`, `srcset`, `cite`) may be `http`, `https`, `mailto`, `tel` or relative, judged on the URL as the WHATWG parser reads it, so case, surrounding spaces, tabs and newlines in the scheme make no difference, and entities are already decoded by the HTML parser. Anything else (`javascript:`, `data:`, `vbscript:`) is dropped.
- `script`, `style`, `noscript`, `template`, `object`, `embed`, `svg`, `math`, forms and their controls, `base`, `meta`, `link`, `head`, `title`, `canvas`, `dialog` and the obsolete raw-text elements are dropped with everything inside them. Any other element the list does not name is unwrapped: its children are kept and go through the same checks.
- Duplicate attributes keep the first, as a browser does, so `HREF="javascript:…" href="/ok"` loses its link rather than keeping the safe-looking one. Comments, the doctype and processing instructions render nothing.
- Every `id` is rendered with the prefix `c-`, and a same-page link to `#name` becomes `#c-name` to match. Browsers expose an element with an `id` as a global of that name, so `<div id="TURBOPACK">` or `id="webpackChunk_N_E"` in a body would replace the object Next.js's bootstrap script reads (DOM clobbering); nothing the page runs looks up a name starting with `c-`. No `aria-*`, `for` or `headers` attribute is allowed, so nothing else refers to an `id`.

The sanitiser is written inside `replace` rather than taken from a library. The allow-list is a few dozen names and a dozen patterns, short enough for the line-by-line read this file gets; a library (`sanitize-html`, DOMPurify on jsdom) would sanitise the string first and parse it again, a second pass with its own configuration to keep in step with this one, and its output would still need every rewrite here applied on top. Writing it here also keeps the invariant that makes the approach sound visible in one place: the parser renders nothing itself, the output is never serialised and re-parsed, so the mutation tricks that defeat string sanitisers do not apply. The test suite runs the pass over sixty-odd injection vectors and over the captured fixture.

## Depth has a limit, and a body never makes the page fail

A body nested more than 256 elements deep renders as plain text: every tag, comment and declaration removed, the content of `<script>`, `<style>` and the other raw-text elements left out, common entities decoded. WordPress's own blocks nest a dozen levels at most, so the limit is far beyond real content, and far below the depths that break the libraries: `html-react-parser` recurses once per level and throws a `RangeError` at about 2,000 nested `<div>`s, and htmlparser2's stack handling is quadratic in depth (a megabyte of nested `<div>`s, 200,000 levels, takes about five seconds to parse).

Three layers enforce it. Before parsing, a linear scan counts open elements by name and refuses to parse a body whose count passes 1,024; the count can only err high on markup the parser reads the same way, so honest content is never under-counted, and an end tag hidden from the parser (in a comment or an attribute value) lowers it by at most one, which bounds what crafted markup can make the parser do (about 0.6 s per megabyte at worst, measured). During the pass, the depth is counted exactly as it descends, and past 256 the pass stops. Around both, any error from the parse or the pass renders the plain text instead and is logged on the server. The plain-text rendering is built by a second linear scan, never by the parser, so it is safe on the input that defeated it. Only a misconfigured CMS URL still throws, before the `try`, so configuration errors stay loud.

## The image trust rule

An image is a CMS image only when its URL, read relative to the uploads directory, has the uploads directory's origin exactly (scheme, host and port), lies under its path, and carries no user name or password. Only those become `/media/…`, which `next.config.ts` proxies to the CMS, and only those reach `next/image`, which renders a CMS image that has both a `width` and a `height` (so the space is reserved, [ADR 0039](0039-vercel-image-optimizer.md)) with a `sizes` sized to the content column. A CMS image without both is a plain lazy `<img>` whose `srcset` is rebuilt from the candidates that are CMS images too.

## External images are kept, CMS-host images that are not uploads are dropped

An image on a host that is not the CMS's stays a plain lazy `<img>` by its `src` alone, with `referrerpolicy="no-referrer"`: it says nothing about the CMS, editors do embed the odd third-party image, and dropping it would make the demo look broken for no gain. An image that names a CMS host but is not a CMS image (`http:` where the CMS is `https:`, another port, a path outside the uploads directory, credentials in the URL) is dropped: it cannot be served through `/media/`, and rendering it would put the CMS's address in the page. The same rule drops a link's `href` when the rewrite would still name a CMS host.

## Embeds become links

WordPress renders an embed block as an `<iframe>`, or leaves the raw URL as text when no oEmbed provider answered. The pass turns an `<iframe>`, `<video>` or `<audio>` anywhere into a link to its `src`, titled by the iframe's `title` when it has one, and a raw embed URL into a link to itself. A link degrades gracefully, loads nothing from a third party and needs no allow-list of providers.

## The marker seam

`<div data-rh-block="related-resources">` is found in the same pass. `data-count` (1 to 10), `data-topic` (a slug by the same predicate as `lib/routes.ts`), `data-topic-id` and `data-exclude` (positive integers) are validated and handed, with the text of the block's `<h2>`, to an injectable `renderBlock(props, fallback)`. The fallback is the wrapper as the pass renders it, its class kept and its `data-*` attributes dropped, with the CMS's own heading and list of links rewritten like any other content. The default `renderBlock` returns the fallback; slice 4 plugs in `<RelatedResources>`. An invalid marker renders the fallback without calling `renderBlock`.

## Considered options

- **A sanitising library before the parse.** Rejected above: a second pass to configure, and the rewrites still needed.
- **Trusting kses.** Rejected: `unfiltered_html` makes it no guard for the roles that write resources.
- **Treating `http:` CMS images as CMS images, as `rewriteHref` does for links.** The rewrite would serve them over https anyway. Rejected: the review that set the acceptance criteria asked for origin equality, and the cost is one missing image on content that still has a pre-https URL, which the editor can fix.
- **Dropping external images.** Rejected: they leak nothing and editors use them.
- **Keeping `style`.** Rejected: WordPress's blocks put layout in classes, and inline styles are a channel for CSS injection with no content that needs it.
- **Rendering embeds as iframes from an allow-list of providers.** Rejected for now: third-party frames load scripts the page does not control, and a link is enough for a demo.

## Consequences

- A new kind of element in resource bodies is a change to the allow-list here, with a test; the default for anything unknown is to unwrap it, so content survives and attributes do not.
- The output never contains the CMS's host, and the fixture test asserts it.
- `cmsUrls()` in `lib/env.ts` gives the pass the site base, the media origin and the uploads directory from the environment.
- `parseSrcset` is exported from `lib/urls.ts` so each candidate can be judged on its own. It and every pattern in the pass run in linear time: trailing runs are trimmed with a loop (`withoutTrailing`), because `/,+$/` on a long comma run followed by anything else is quadratic (200 KB took 13.5 s), and the `srcset` descriptor pattern has no two quantifiers that can share digits. The tests hold a megabyte of each to under a second.
