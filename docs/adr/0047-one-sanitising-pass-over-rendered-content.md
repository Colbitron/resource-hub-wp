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
- Duplicate attributes keep the first, as a browser does, so `HREF="javascript:…" href="/ok"` loses its link rather than keeping the safe-looking one. htmlparser2 does this itself (it lower-cases each name and stores only the first), and a test pins it. Comments, the doctype and processing instructions render nothing.
- Every `id` is rendered with the prefix `c-`, and a same-page link to `#name` becomes `#c-name` to match. Browsers expose an element with an `id` as a global of that name, so `<div id="TURBOPACK">` or `id="webpackChunk_N_E"` in a body would replace the object Next.js's bootstrap script reads (DOM clobbering); nothing the page runs looks up a name starting with `c-`. No `aria-*`, `for` or `headers` attribute is allowed, so nothing else refers to an `id`.

The sanitiser is written inside `replace` rather than taken from a library. The allow-list is a few dozen names and a dozen patterns, short enough for the line-by-line read this file gets; a library (`sanitize-html`, DOMPurify on jsdom) would sanitise the string first and parse it again, a second pass with its own configuration to keep in step with this one, and its output would still need every rewrite here applied on top. Writing it here also keeps the invariant that makes the approach sound visible in one place: the parser renders nothing itself, the output is never serialised and re-parsed, so the mutation tricks that defeat string sanitisers do not apply. The test suite runs the pass over sixty-odd injection vectors, pins the exact output of each one whose output is short, checks that content after each vector still renders, and runs the captured fixture.

## Depth has a limit, and a body never makes the page fail

A body nested more than 256 elements deep renders as plain text: every tag, comment and declaration removed, the content of `<script>`, `<style>` and the other raw-text elements left out, common entities decoded. WordPress's own blocks nest a dozen levels at most, so the limit is far beyond real content, and far below the depths that break the libraries: `html-react-parser` recurses once per level and throws a `RangeError` at about 2,000 nested `<div>`s, and htmlparser2's stack handling is quadratic in depth (a megabyte of nested `<div>`s, 200,000 levels, takes about five seconds to parse).

Three layers enforce it. Before parsing, a linear scan counts open elements by name and refuses to parse a body whose count passes 1,024; the count can only err high on markup the parser reads the same way, so honest content is never under-counted, and an end tag hidden from the parser (in a comment or an attribute value) lowers it by at most one, which bounds what crafted markup can make the parser do (about 0.6 s per megabyte at worst, measured). That residual risk is capped by size: a body longer than 512 Ki UTF-16 code units (`MAX_CONTENT_LENGTH`, measured as `html.length`, which costs nothing and is what the parser's work scales with) renders as the plain text without reaching the parser, so crafted markup costs at most about 0.3 s per render. A body renders once per revalidation before ISR caches it, and only editors can write one, so that bound is acceptable; real bodies are a few tens of kilobytes. Copying or writing a tokenizer that reads comments, attribute values and raw-text elements exactly as htmlparser2 does was considered and rejected: a second tokenizer to keep in step with the parser, for markup only an editor can save. This cap is the default chosen while the project owner was away on 2026-11-05 and is pending their review. During the pass, the depth is counted exactly as it descends, and past 256 the pass stops. Around both, any error from the parse or the pass renders the plain text instead and is logged on the server. The plain-text rendering is built by a second linear scan, never by the parser, so it is safe on the input that defeated it. Only a misconfigured CMS URL still throws, before the `try`, so configuration errors stay loud.

## The image trust rule

An image is a CMS image only when its URL, read relative to the uploads directory, has the uploads directory's origin exactly (scheme, host and port), lies under its path, and carries no user name or password. Only those become `/media/…`, which `next.config.ts` proxies to the CMS, and only those reach `next/image`, which renders a CMS image that has both a `width` and a `height` (so the space is reserved, [ADR 0039](0039-vercel-image-optimizer.md)) with a `sizes` sized to the content column. A CMS image without both is a plain lazy `<img>` whose `srcset` is rebuilt from the candidates that are CMS images too.

## External images are kept, CMS-host images that are not uploads are dropped

An image on a host that is not the CMS's stays a plain lazy `<img>` by its `src` alone, with `referrerpolicy="no-referrer"`: it says nothing about the CMS, editors do embed the odd third-party image, and dropping it would make the demo look broken for no gain. `no-referrer` removes only the `Referer` header: the reader's IP address, user agent and any cookies for that host still reach a host the editor chose, so an external image is a tracking pixel the editor can place. The stricter option is an allow-list of image hosts whose default is empty (an image on an unlisted host is dropped) together with a Content-Security-Policy `img-src` that says the same to the browser; that choice is the project owner's and is pending. An image that names a CMS host but is not a CMS image (`http:` where the CMS is `https:`, another port, a path outside the uploads directory, credentials in the URL) is dropped: it cannot be served through `/media/`, and rendering it would put the CMS's address in the page.

## CMS links that lead nowhere on the front end are unwrapped

A link on the CMS stays a link only when its rewrite is a route the front end serves: `/` without a query, `/resources` and everything under it, or an upload's `/media/…`. Any other CMS link (`/wp-json/…`, `/wp-admin/`, `/wp-login.php`, `/xmlrpc.php`, `/feed/`, `/wp-content/…` outside uploads, `/?post_type=…&p=…`, or one whose rewrite still names the CMS because of a port the configuration does not list) is unwrapped: the `<a>` goes and its text stays. Made relative, these would be 404s on the front end, and left absolute they would show the CMS's address; neither is a useful link. This is the default chosen while the project owner was away on 2026-11-05 and is pending their review. Relative links the editor wrote are left as written, since they never named the CMS.

## Where the CMS host can still appear

The CMS host never appears in markup the pass generates or in an attribute it rewrites. A link whose text, trimmed, is its own `href` (WordPress turns a pasted URL into `<a href="u">u</a>`) or names the CMS shows the rewritten target instead; when there is none to show, its words that name the CMS are removed. A `title` that names the CMS is dropped, the words of an `alt` that name it are removed, and an iframe's `title` becomes link text by the same rule as a link's text. "Names the CMS" means containing a configured host, or host and install path, in any case. Hosts compare with every trailing dot removed, so `cms.example..` is the CMS.

Editor-typed text is left as written, in a paragraph or in `<code>`: rewriting it would corrupt code samples and prose that discuss the CMS, and an editor who types the address has chosen to publish it.

## Embeds become links

WordPress renders an embed block as an `<iframe>`, or leaves the raw URL as text when no oEmbed provider answered. The pass turns an `<iframe>`, `<video>` or `<audio>` anywhere into a link to its `src` (a `<video>` or `<audio>` without one, to its first `<source>` whose `src` makes a link), titled by its `title` when it has one, and a raw embed URL into a link to itself. Inside a link, where a browser would not nest another, each becomes its text, and an `<a>` inside an `<a>` is unwrapped. A link degrades gracefully, loads nothing from a third party and needs no allow-list of providers.

A `<pre>` whose only child is text loses the newline right after its start tag, as the browser already dropped it from the CMS's HTML and React would otherwise write it back as a blank first line.

## The marker seam

`<div data-rh-block="related-resources">` is found in the same pass. `data-count` (1 to 10), `data-topic` (a slug by `isSlug` in `lib/routes.ts`, and already in the form `canonicalSlug` gives, which is the form WordPress writes, so `topic:{slug}` is the tag the data layer sets), `data-topic-id` and `data-exclude` (positive integers) are validated and handed, with the text of the block's `<h2>` (without the content of dropped elements such as `<script>`), to an injectable `renderBlock(props, fallback)`. The caller passes the resource's ID as `postId`, and it is the one excluded, whatever `data-exclude` says; a marker that disagrees still renders. At most five markers in a body reach `renderBlock`, since each costs the server a related-route call and a fetch; the rest render their fallback. The fallback is the wrapper as the pass renders it, its class kept and its `data-*` attributes dropped, with the CMS's own heading and list of links rewritten like any other content. The default `renderBlock` returns the fallback; slice 4 plugs in `<RelatedResources>`. An invalid marker renders the fallback without calling `renderBlock`.

## Considered options

- **A sanitising library before the parse.** Rejected above: a second pass to configure, and the rewrites still needed.
- **A tokenizer that sees end tags exactly as htmlparser2 does, instead of a size cap.** Rejected: a copy of the parser's tokenizer to keep in step with it; the cap bounds the same worst case in one comparison.
- **Trusting kses.** Rejected: `unfiltered_html` makes it no guard for the roles that write resources.
- **Treating `http:` CMS images as CMS images, as `rewriteHref` does for links.** The rewrite would serve them over https anyway. Rejected: the review that set the acceptance criteria asked for origin equality, and the cost is one missing image on content that still has a pre-https URL, which the editor can fix.
- **Dropping external images.** Not chosen for now: editors use them and `no-referrer` keeps the page's URL from the other host, though not the reader's IP address or user agent (see above). An allow-list with an empty default plus a CSP `img-src` is the stricter option, pending the project owner's choice.
- **Making every CMS link relative, whatever its path.** Rejected for paths the front end does not serve: a relative `/wp-admin/` is a 404, and an absolute one shows the CMS.
- **Rewriting the CMS host in text and `<code>`.** Rejected: it would corrupt code samples, and the text is the editor's.
- **Keeping `style`.** Rejected: WordPress's blocks put layout in classes, and inline styles are a channel for CSS injection with no content that needs it.
- **Rendering embeds as iframes from an allow-list of providers.** Rejected for now: third-party frames load scripts the page does not control, and a link is enough for a demo.

## Consequences

- A new kind of element in resource bodies is a change to the allow-list here, with a test; the default for anything unknown is to unwrap it, so content survives and attributes do not.
- The CMS host never appears in markup the pass generates or in rewritten attributes; editor-typed text is left as written. The fixture test asserts the first half on a body whose text does not name the CMS.
- `cmsUrls()` in `lib/env.ts` gives the pass the site base, the media origin and the uploads directory from the environment.
- `parseSrcset` is exported from `lib/urls.ts` so each candidate can be judged on its own. It and every pattern in the pass run in linear time: trailing runs are trimmed with a loop (`withoutTrailing`), because `/,+$/` on a long comma run followed by anything else is quadratic (200 KB took 13.5 s), and the `srcset` descriptor pattern has no two quantifiers that can share digits. The tests hold 500 KB of each, just under the size cap so it reaches the pass, to under a second.
