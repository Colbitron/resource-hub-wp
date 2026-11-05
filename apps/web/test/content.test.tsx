import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MAX_DEPTH, renderContent, type RenderBlock, type RenderContentOptions } from "../lib/content/render";
import type { CmsUrls } from "../lib/urls";

const CMS: CmsUrls = {
  cmsOrigins: ["https://cms.example"],
  uploadsBase: "https://cms.example/wp-content/uploads",
};

const UPLOAD = "https://cms.example/wp-content/uploads/2026/11/photo.jpg";

function render(html: string, options?: RenderContentOptions, cms: CmsUrls = CMS): string {
  return renderToStaticMarkup(<>{renderContent(html, cms, options)}</>);
}

const MARKER =
  '<div class="wp-block-resource-hub-related-resources rh-related" data-rh-block="related-resources" data-count="3" data-topic="headless-delivery" data-topic-id="9" data-exclude="15">' +
  "<h2>More on Headless delivery</h2>" +
  '<ul><li><a href="https://cms.example/resources/webinar/example/">Example</a></li></ul></div>';

describe("links", () => {
  it("strips the CMS origin from links, whatever the case of the host and with a trailing dot", () => {
    for (const href of [
      "https://cms.example/resources/webinar/example/",
      "HTTPS://CMS.EXAMPLE/resources/webinar/example/",
      "https://cms.example./resources/webinar/example/",
      "http://cms.example/resources/webinar/example/",
      "//cms.example/resources/webinar/example/",
      "https://cms.example:443/resources/webinar/example/",
    ]) {
      const output = render(`<p><a href="${href}">Example</a></p>`);
      expect(output, href).toBe('<p><a href="/resources/webinar/example/">Example</a></p>');
    }
  });

  it("keeps the query and hash of a CMS link", () => {
    expect(render('<a href="https://cms.example/resources/?x=1#top">x</a>')).toBe(
      '<a href="/resources/?x=1#top">x</a>',
    );
  });

  it("maps a link to an upload to /media/", () => {
    expect(render(`<a href="${UPLOAD.replace(".jpg", ".pdf")}?v=2">Download</a>`)).toBe(
      '<a href="/media/2026/11/photo.pdf?v=2">Download</a>',
    );
  });

  it("keeps external, relative, mailto and tel links as they are", () => {
    for (const href of [
      "https://example.com/page",
      "https://evilcms.example/page",
      "https://cms.example.evil/page",
      "/resources/",
      "mailto:someone@example.com",
      "tel:+15555551234",
    ]) {
      expect(render(`<a href="${href}">x</a>`), href).toBe(`<a href="${href}">x</a>`);
    }
  });

  it("adds rel=noopener noreferrer to a link that opens a new tab, keeping its known rel tokens", () => {
    expect(render('<a href="https://example.com/" target="_blank">x</a>')).toBe(
      '<a href="https://example.com/" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(render('<a href="https://example.com/" target="_blank" rel="nofollow ugc bogus">x</a>')).toBe(
      '<a href="https://example.com/" target="_blank" rel="nofollow ugc noopener noreferrer">x</a>',
    );
    expect(render('<a href="https://example.com/" target="frame">x</a>')).toBe(
      '<a href="https://example.com/">x</a>',
    );
  });

  it("drops a link's href when the rewrite would still name a CMS host", () => {
    expect(render('<a href="https://cms.example:8443/resources/">x</a>')).toBe("<a>x</a>");
    expect(render('<a href="https://user:pw@cms.example/resources/">x</a>')).toBe(
      '<a href="/resources/">x</a>',
    );
  });

  it("strips a subdirectory install's base and a separate media host", () => {
    const cms: CmsUrls = {
      cmsOrigins: ["https://example.com/blog", "https://media.example"],
      uploadsBase: "https://media.example/wp-content/uploads",
    };
    expect(render('<a href="https://example.com/blog/resources/">x</a>', undefined, cms)).toBe(
      '<a href="/resources/">x</a>',
    );
    expect(render('<a href="https://media.example/wp-content/uploads/a.pdf">x</a>', undefined, cms)).toBe(
      '<a href="/media/a.pdf">x</a>',
    );
    expect(render('<a href="https://example.com/shop/">x</a>', undefined, cms)).toBe(
      '<a href="https://example.com/shop/">x</a>',
    );
  });
});

describe("images", () => {
  it("renders a sized CMS image through next/image from its /media/ path", () => {
    const output = render(`<img src="${UPLOAD}?w=1024" alt="A photo" width="1024" height="683" class="wp-image-16">`);
    expect(output).toContain('data-nimg="1"');
    expect(output).toContain('width="1024"');
    expect(output).toContain('height="683"');
    expect(output).toContain('alt="A photo"');
    expect(output).toContain('class="wp-image-16"');
    expect(output).toContain('sizes="(max-width: 40rem) 100vw, 40rem"');
    expect(output).toContain("url=%2Fmedia%2F2026%2F11%2Fphoto.jpg&amp;w=");
    expect(output).not.toContain("cms.example");
    expect(output).not.toContain("w=1024&");
  });

  it("renders an unsized CMS image as a plain lazy img with src and srcset rewritten", () => {
    const srcset = `${UPLOAD} 1024w, https://cms.example/wp-content/uploads/2026/11/photo-300x200.jpg 300w`;
    const output = render(`<img src="${UPLOAD}" srcset="${srcset}" sizes="(max-width: 1024px) 100vw, 1024px" alt="">`);
    expect(output).toBe(
      '<img alt="" srcSet="/media/2026/11/photo.jpg 1024w, /media/2026/11/photo-300x200.jpg 300w" sizes="(max-width: 1024px) 100vw, 1024px" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });

  it("uses next/image only when both dimensions are present", () => {
    expect(render(`<img src="${UPLOAD}" width="1024" alt="">`)).not.toContain("data-nimg");
    expect(render(`<img src="${UPLOAD}" height="683" alt="">`)).not.toContain("data-nimg");
    expect(render(`<img src="${UPLOAD}" width="0" height="683" alt="">`)).not.toContain("data-nimg");
    expect(render(`<img src="${UPLOAD}" width="1024" height="683" alt="">`)).toContain("data-nimg");
  });

  it("accepts a root-relative or scheme-relative upload as a CMS image", () => {
    expect(render('<img src="/wp-content/uploads/2026/11/photo.jpg" alt="">')).toBe(
      '<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
    expect(render('<img src="//cms.example/wp-content/uploads/2026/11/photo.jpg" alt="">')).toBe(
      '<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });

  it("keeps an image on another host as a plain lazy img by its src alone", () => {
    const output = render(
      '<img src="https://images.example/a.jpg" srcset="https://images.example/a-2x.jpg 2x" width="10" height="10" alt="Elsewhere">',
    );
    expect(output).toBe(
      '<img alt="Elsewhere" width="10" height="10" src="https://images.example/a.jpg" loading="lazy" referrerPolicy="no-referrer"/>',
    );
  });

  it("drops a CMS-host image that is not a trusted upload: http where the CMS is https, credentials, another port, outside uploads", () => {
    for (const src of [
      "http://cms.example/wp-content/uploads/2026/11/photo.jpg",
      "https://user@cms.example/wp-content/uploads/2026/11/photo.jpg",
      "https://user:pw@cms.example/wp-content/uploads/2026/11/photo.jpg",
      "https://cms.example:8443/wp-content/uploads/2026/11/photo.jpg",
      "https://cms.example/wp-includes/images/a.png",
      "https://cms.example/wp-content/uploads/../../wp-includes/a.png",
      "https://cms.example/wp-content/uploads/a%2f..%2fb.png",
      "/other.png",
    ]) {
      expect(render(`<p><img src="${src}" alt=""></p>`), src).toBe("<p></p>");
    }
  });

  it("drops an off-host image with credentials and one whose URL is not http(s)", () => {
    expect(render('<p><img src="https://user@images.example/a.jpg" alt=""></p>')).toBe("<p></p>");
    expect(render('<p><img src="ftp://images.example/a.jpg" alt=""></p>')).toBe("<p></p>");
    expect(render("<p><img alt=\"\"></p>")).toBe("<p></p>");
  });

  it("keeps only the srcset candidates that are CMS uploads, and no srcset when none is", () => {
    const srcset = `${UPLOAD} 1024w, https://images.example/a.jpg 300w, http://cms.example/wp-content/uploads/b.jpg 2x`;
    expect(render(`<img src="${UPLOAD}" srcset="${srcset}" alt="">`)).toBe(
      '<img alt="" srcSet="/media/2026/11/photo.jpg 1024w" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
    expect(render(`<img src="${UPLOAD}" srcset="https://images.example/a.jpg 2x" sizes="100vw" alt="">`)).toBe(
      '<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });

  it("treats http uploads as CMS images when the CMS is configured over http", () => {
    const cms: CmsUrls = {
      cmsOrigins: ["http://localhost:8888"],
      uploadsBase: "http://localhost:8888/wp-content/uploads",
    };
    expect(render('<img src="http://localhost:8888/wp-content/uploads/a.jpg" alt="">', undefined, cms)).toBe(
      '<img alt="" src="/media/a.jpg" loading="lazy"/>',
    );
  });
});

const XSS_VECTORS: string[] = [
  "<script>alert(1)</script>",
  '<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>',
  "<img src=x onerror=alert(1)>",
  '<img src="x" ONERROR="alert(1)">',
  '<IMG SRC="javascript:alert(1)">',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="  javascript:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="java\nscript:alert(1)">x</a>',
  '<a href="java\r\nscript:alert(1)">x</a>',
  '<a href="\u0001javascript:alert(1)">x</a>',
  '<a href="&#106;&#97;&#118;&#97;script:alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href="&#0000106avascript:alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<a href="jav&#x0A;ascript:alert(1)">x</a>',
  '<a href="javascript&colon;alert(1)">x</a>',
  '<a href="javascript://%0aalert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="javascript:alert(1)" href="/ok">x</a>',
  '<a HREF="javascript:alert(1)" href="/ok">x</a>',
  '<a href="/ok" onclick="alert(1)">x</a>',
  '<a href="/ok" style="background:url(javascript:alert(1))">x</a>',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=">',
  `<img src="${UPLOAD}" srcset="javascript:alert(1) 1x">`,
  `<img src="${UPLOAD}" srcset="${UPLOAD} 1x, javascript:alert(1) 2x">`,
  `<img src="${UPLOAD}" alt="" width="10" height="10" onload="alert(1)">`,
  "<svg onload=alert(1)></svg>",
  "<svg><script>alert(1)</script></svg>",
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"></use></svg>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<math href="javascript:alert(1)">x</math>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  "<noscript><script>alert(1)</script></noscript>",
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  "<style>body{background:url(javascript:alert(1))}</style>",
  '<style>@import "https://evil.example/x.css";</style>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<p onmouseover="alert(1)">x</p>',
  '<p ONMOUSEOVER="alert(1)">x</p>',
  "<details open ontoggle=alert(1)><summary>x</summary></details>",
  '<form action="javascript:alert(1)"><input type="submit" value="go"></form>',
  '<button onclick="alert(1)">x</button>',
  '<base href="javascript:alert(1)//">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  "<template><script>alert(1)</script></template>",
  '<video><source onerror="alert(1)" src="x"></video>',
  '<video src="javascript:alert(1)"></video>',
  '<audio src="x" onerror="alert(1)"></audio>',
  '<xss id="x" tabindex="1" onfocus="alert(1)"></xss>',
  '<p id="__proto__" class="a&quot; onmouseover=&quot;alert(1)">x</p>',
  '<a href="/ok" rel="noopener" target="_blank" onmouseover="alert(1)">x</a>',
  "<![CDATA[<script>alert(1)</script>]]>",
  "<!--<script>alert(1)</script>-->",
  "<?php echo 'x'; ?>",
  '<blockquote cite="javascript:alert(1)">x</blockquote>',
  '<q cite="data:text/html,<script>alert(1)</script>">x</q>',
  '<marquee onstart="alert(1)">x</marquee>',
  '<body onload="alert(1)"><p>x</p></body>',
  '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">x</a>',
];

const DANGEROUS_ELEMENT =
  /<(script|style|iframe|object|embed|svg|math|form|input|button|base|meta|link|template|noscript|video|audio|source|xss|marquee|body|use|text)\b/i;

describe("sanitising", () => {
  it.each(XSS_VECTORS)("removes the dangerous parts of %s", (vector) => {
    const output = render(vector);
    expect(output).not.toMatch(DANGEROUS_ELEMENT);
    expect(output).not.toMatch(/javascript/i);
    expect(output).not.toMatch(/vbscript/i);
    expect(output).not.toMatch(/data:/i);
    expect(output).not.toMatch(/\son[a-z]+=/i);
    // next/image sets `style="color:transparent"` of its own; no other style survives.
    expect(output.replace('style="color:transparent"', "")).not.toMatch(/style=/i);
    expect(output).not.toContain("alert");
    expect(output).not.toContain("srcdoc");
    expect(output).not.toContain("<!");
    expect(output).not.toContain("<?");
  });

  it("runs at least 25 vectors", () => {
    expect(XSS_VECTORS.length).toBeGreaterThanOrEqual(25);
  });

  it("keeps the first of two attributes with the same name, as a browser does", () => {
    expect(render('<a href="/ok" HREF="javascript:alert(1)">x</a>')).toBe('<a href="/ok">x</a>');
    expect(render('<a HREF="javascript:alert(1)" href="/ok">x</a>')).toBe("<a>x</a>");
  });

  it("escapes text and attribute values instead of trusting them", () => {
    expect(render("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 1 &lt; 2</p>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 1 &lt; 2</p>",
    );
    expect(render('<p title="&quot; onmouseover=&quot;alert(1)">x</p>')).toBe(
      '<p title="&quot; onmouseover=&quot;alert(1)">x</p>',
    );
  });

  it("renders the allowed elements with their allowed attributes", () => {
    const html =
      '<h2 id="intro" class="has-text-align-center">Intro</h2>' +
      '<p lang="fr" dir="ltr" title="T">Bonjour</p>' +
      '<ol start="3" reversed><li>a</li></ol>' +
      '<table><thead><tr><th scope="col" colspan="2">H</th></tr></thead><tbody><tr><td rowspan="2">c</td></tr></tbody></table>' +
      '<blockquote cite="https://example.com/q"><p>q</p></blockquote>' +
      '<time datetime="2026-11-05">today</time>' +
      "<details open><summary>s</summary>d</details>" +
      "<pre><code>x &lt; y</code></pre><hr><br><abbr title=\"Hypertext\">HT</abbr>";
    expect(render(html)).toBe(
      '<h2 class="has-text-align-center" id="c-intro">Intro</h2>' +
        '<p title="T" lang="fr" dir="ltr">Bonjour</p>' +
        '<ol start="3" reversed="">' +
        "<li>a</li></ol>" +
        '<table><thead><tr><th colSpan="2" scope="col">H</th></tr></thead><tbody><tr><td rowSpan="2">c</td></tr></tbody></table>' +
        '<blockquote cite="https://example.com/q"><p>q</p></blockquote>' +
        '<time dateTime="2026-11-05">today</time>' +
        '<details open=""><summary>s</summary>d</details>' +
        '<pre><code>x &lt; y</code></pre><hr/><br/><abbr title="Hypertext">HT</abbr>',
    );
  });

  it("drops attribute values that fail their check", () => {
    expect(render('<p id="1bad" class="ok bad!tok" lang="x-" dir="up">x</p>')).toBe('<p class="ok">x</p>');
    expect(render('<td colspan="0" rowspan="1000">x</td>')).toBe("<td>x</td>");
    expect(render('<th scope="anything">x</th>')).toBe("<th>x</th>");
  });

  it("unwraps an element it does not know and keeps its children", () => {
    expect(render('<section class="x"><p>a</p></section><font color="red">b</font><center>c</center>')).toBe(
      "<p>a</p>bc",
    );
  });

  it("drops comments, the doctype and whitespace between table rows", () => {
    expect(render("<!DOCTYPE html><!-- note --><p>x</p>")).toBe("<p>x</p>");
    expect(render("<table>\n  <tbody>\n    <tr><td>x</td></tr>\n  </tbody>\n</table>")).toBe(
      "<table><tbody><tr><td>x</td></tr></tbody></table>",
    );
  });

  it("renders nothing for an empty body", () => {
    expect(render("")).toBe("");
  });
});

describe("the block marker", () => {
  it("parses and validates the marker and hands it to renderBlock with the fallback", () => {
    const renderBlock = vi.fn<RenderBlock>((props) => <aside data-testid="related">{props.topic}</aside>);
    const output = render(`<p>before</p>${MARKER}<p>after</p>`, { renderBlock });
    expect(renderBlock).toHaveBeenCalledTimes(1);
    const [props, fallback] = renderBlock.mock.calls[0] ?? [];
    expect(props).toEqual({
      count: 3,
      topic: "headless-delivery",
      topicId: 9,
      exclude: 15,
      heading: "More on Headless delivery",
    });
    expect(renderToStaticMarkup(<>{fallback}</>)).toBe(
      '<div class="wp-block-resource-hub-related-resources rh-related"><h2>More on Headless delivery</h2><ul><li><a href="/resources/webinar/example/">Example</a></li></ul></div>',
    );
    expect(output).toBe('<p>before</p><aside data-testid="related">headless-delivery</aside><p>after</p>');
  });

  it("renders the fallback by default, without the marker attributes", () => {
    const output = render(MARKER);
    expect(output).toBe(
      '<div class="wp-block-resource-hub-related-resources rh-related"><h2>More on Headless delivery</h2><ul><li><a href="/resources/webinar/example/">Example</a></li></ul></div>',
    );
    expect(output).not.toContain("data-");
  });

  it("renders the fallback and skips renderBlock for an invalid marker", () => {
    const renderBlock = vi.fn<RenderBlock>(() => <aside>never</aside>);
    const invalid = [
      ["data-count", "0"],
      ["data-count", "11"],
      ["data-count", "3.5"],
      ["data-count", ""],
      ["data-topic", ""],
      ["data-topic", "has space"],
      ["data-topic", "has/slash"],
      ["data-topic", ".."],
      ["data-topic-id", "0"],
      ["data-topic-id", "x"],
      ["data-exclude", "-1"],
    ] as const;
    for (const [name, value] of invalid) {
      const html = MARKER.replace(new RegExp(`${name}="[^"]*"`), `${name}="${value}"`);
      const output = render(html, { renderBlock });
      expect(output, `${name}=${value}`).toContain("<h2>More on Headless delivery</h2>");
      expect(output, `${name}=${value}`).not.toContain("data-");
    }
    for (const name of ["data-count", "data-topic", "data-topic-id", "data-exclude"]) {
      const html = MARKER.replace(new RegExp(` ${name}="[^"]*"`), "");
      expect(render(html, { renderBlock }), `${name} missing`).toContain("<h2>More on Headless delivery</h2>");
    }
    expect(renderBlock).not.toHaveBeenCalled();
  });

  it("gives a null heading when the block has no h2", () => {
    const renderBlock = vi.fn<RenderBlock>(() => null);
    render(MARKER.replace("<h2>More on Headless delivery</h2>", ""), { renderBlock });
    expect(renderBlock.mock.calls[0]?.[0].heading).toBeNull();
  });
});

describe("embeds and media", () => {
  it("turns an embed block's iframe into a link titled by the iframe", () => {
    const html =
      '<figure class="wp-block-embed is-type-video is-provider-youtube"><div class="wp-block-embed__wrapper">' +
      '<iframe title="A talk" width="500" height="281" src="https://www.youtube.com/embed/abc?feature=oembed" frameborder="0" allowfullscreen></iframe>' +
      "</div><figcaption>Cap</figcaption></figure>";
    expect(render(html)).toBe(
      '<figure class="wp-block-embed is-type-video is-provider-youtube"><div class="wp-block-embed__wrapper">' +
        '<a href="https://www.youtube.com/embed/abc?feature=oembed" rel="noopener noreferrer">A talk</a>' +
        "</div><figcaption>Cap</figcaption></figure>",
    );
  });

  it("turns an embed block's raw URL into a link", () => {
    const html =
      '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\nhttps://example.com/talk\n</div></figure>';
    expect(render(html)).toBe(
      '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><a href="https://example.com/talk" rel="noopener noreferrer">https://example.com/talk</a></div></figure>',
    );
  });

  it("links a CMS embed by its rewritten URL, so the CMS host shows nowhere", () => {
    const html =
      '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://cms.example/resources/webinar/example/</div></figure>';
    expect(render(html)).toBe(
      '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><a href="/resources/webinar/example/" rel="noopener noreferrer">/resources/webinar/example/</a></div></figure>',
    );
  });

  it("turns a video block into a link to the upload", () => {
    const html = `<figure class="wp-block-video"><video controls src="${UPLOAD.replace(".jpg", ".mp4")}"></video></figure>`;
    expect(render(html)).toBe(
      '<figure class="wp-block-video"><a href="/media/2026/11/photo.mp4" rel="noopener noreferrer">/media/2026/11/photo.mp4</a></figure>',
    );
  });

  it("drops an iframe without a usable src", () => {
    expect(render('<p><iframe></iframe><iframe src="javascript:alert(1)"></iframe></p>')).toBe("<p></p>");
  });
});

describe("the CMS origin never reaches the output", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/wp/resource.single.json", import.meta.url), "utf8"),
  ) as { content: { rendered: string }; link: string };

  const added =
    `<p><a href="${fixture.link}">Permalink</a> and <a href="https://cms.example/wp-json/wp/v2/resources/15">REST</a>.</p>` +
    `<figure class="wp-block-image size-large"><a href="${UPLOAD}"><img src="${UPLOAD}" alt="" class="wp-image-16" width="1024" height="683" srcset="${UPLOAD} 1024w, https://cms.example/wp-content/uploads/2026/11/photo-300x200.jpg 300w" sizes="(max-width: 1024px) 100vw, 1024px"></a><figcaption>Photo</figcaption></figure>` +
    `<figure class="wp-block-image"><img src="https://cms.example/wp-content/uploads/2026/11/plain.png" alt="Plain" srcset="https://cms.example/wp-content/uploads/2026/11/plain.png 1x"></figure>` +
    '<p><img src="http://cms.example/wp-content/uploads/2026/11/old.png" alt="Old"> <img src="https://cms.example@evil.example/a.png" alt="Phish"></p>' +
    '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><iframe src="https://cms.example/resources/webinar/example/embed/#?secret=abc" title="Embedded"></iframe></div></figure>' +
    `<figure class="wp-block-video"><video src="${UPLOAD.replace(".jpg", ".mp4")}"></video></figure>` +
    '<blockquote cite="https://cms.example/resources/webinar/example/">Quote</blockquote>' +
    '<a href="https://cms.example/wp-content/uploads/2026/11/brief.pdf" target="_blank">Brief</a>' +
    MARKER;

  it("renders the fixture plus every kind of CMS URL without the CMS host", () => {
    const output = render(fixture.content.rendered + added);
    expect(output).not.toMatch(/cms\.example/i);
    expect(output).not.toContain("wp-content");
    expect(output).toContain('href="/resources/ebook/a-field-guide-to-revalidation/"');
    // A REST link is a CMS link like any other: made relative (a 404 here), never left absolute.
    expect(output).toContain('href="/wp-json/wp/v2/resources/15"');
    expect(output).toContain('href="/media/2026/11/photo.jpg"');
    expect(output).toContain('data-nimg="1"');
    expect(output).toContain('srcSet="/media/2026/11/plain.png 1x"');
    expect(output).not.toContain('alt="Old"');
    expect(output).not.toContain('alt="Phish"');
    expect(output).toContain('href="/resources/webinar/example/embed/#?secret=abc"');
    expect(output).toContain('href="/media/2026/11/brief.pdf" target="_blank" rel="noopener noreferrer"');
    expect(output).toContain('<p class="wp-block-paragraph">A field guide to revalidation');
  });

  it("renders the fixture plus the same cases without the host when the CMS is a subdirectory install with a media host", () => {
    const cms: CmsUrls = {
      cmsOrigins: ["https://example.com/blog"],
      uploadsBase: "https://media.example/wp-content/uploads",
    };
    const html = added
      .replaceAll("https://cms.example/wp-content/uploads", "https://media.example/wp-content/uploads")
      .replaceAll("http://cms.example/wp-content/uploads", "http://media.example/wp-content/uploads")
      .replaceAll("https://cms.example/", "https://example.com/blog/")
      .replaceAll("https://cms.example@", "https://media.example@");
    const output = render(fixture.content.rendered.replaceAll("https://cms.example/", "https://example.com/blog/") + html, undefined, cms);
    expect(output).not.toMatch(/media\.example/i);
    expect(output).not.toContain("example.com/blog");
    expect(output).toContain('href="/media/2026/11/photo.jpg"');
    expect(output).toContain('href="/resources/webinar/example/embed/#?secret=abc"');
  });
});

describe("ids", () => {
  it("prefixes every id with c-, so no id can clobber a global the page's scripts read", () => {
    expect(render('<div id="TURBOPACK">x</div>')).toBe('<div id="c-TURBOPACK">x</div>');
    expect(render('<span id="webpackChunk_N_E">x</span>')).toBe('<span id="c-webpackChunk_N_E">x</span>');
    expect(render(`<img id="hero" src="${UPLOAD}" alt="">`)).toBe(
      '<img id="c-hero" alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });

  it("prefixes a same-page #fragment link to match, so a back-to-top link still reaches its heading", () => {
    expect(render('<h2 id="top">Top</h2><p>…</p><p><a href="#top">Back to top</a></p>')).toBe(
      '<h2 id="c-top">Top</h2><p>…</p><p><a href="#c-top">Back to top</a></p>',
    );
    expect(render('<a href=" #section-2 ">x</a>')).toBe('<a href="#c-section-2">x</a>');
  });

  it("leaves other fragments alone: an empty one, one no content id could have, and one on another page", () => {
    for (const href of ["#", "#1bad", "#__next", "/resources/#top", "https://example.com/#top"]) {
      expect(render(`<a href="${href}">x</a>`), href).toBe(`<a href="${href}">x</a>`);
    }
  });
});

describe("linear time on hostile attribute values", () => {
  const SECOND = 1000;

  it("splits a 1 MB comma-heavy srcset in under a second", () => {
    // A run of commas between two non-commas and a trailing comma made the old `/,+$/` quadratic.
    const srcset = `a${",".repeat(1_000_000)}a,`;
    const start = performance.now();
    const output = render(`<img src="${UPLOAD}" srcset="${srcset}" alt="">`);
    expect(performance.now() - start).toBeLessThan(SECOND);
    expect(output).toBe('<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>');
  });

  it("checks a 1 MB srcset descriptor in under a second", () => {
    // A long run of digits that is not a descriptor made the old `[0-9]*\.?[0-9]+x` quadratic.
    const srcset = `${UPLOAD} ${"1".repeat(1_000_000)}y`;
    const start = performance.now();
    const output = render(`<img src="${UPLOAD}" srcset="${srcset}" alt="">`);
    expect(performance.now() - start).toBeLessThan(SECOND);
    expect(output).toBe('<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>');
  });

  it("keeps a srcset candidate only with a width, a density or no descriptor", () => {
    const upload = (name: string) => `https://cms.example/wp-content/uploads/${name}.jpg`;
    const kept = ["768w", "2x", "1.5x", ".5x", "0.75x", ""];
    const dropped = ["0w", "768W", "1.x", "x", "-1x", "1e3w", "768w 2x", "2x 768w", "100h"];
    const srcset = [...kept, ...dropped].map((descriptor, index) => `${upload(`c${index}`)} ${descriptor}`.trim()).join(", ");
    expect(render(`<img src="${UPLOAD}" srcset="${srcset}" alt="">`)).toBe(
      '<img alt="" srcSet="/media/c0.jpg 768w, /media/c1.jpg 2x, /media/c2.jpg 1.5x, /media/c3.jpg .5x, /media/c4.jpg 0.75x, /media/c5.jpg" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });
});

describe("deep nesting", () => {
  function nested(depth: number, open = "<div>", close = "</div>", inner = "<p>Deep &amp; down</p>"): string {
    return open.repeat(depth) + inner + close.repeat(depth);
  }

  function quietly<T>(run: () => T): { result: T; warned: number; errored: number } {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      return { result: run(), warned: warn.mock.calls.length, errored: error.mock.calls.length };
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  }

  it("renders a body just inside the limit as markup", () => {
    const depth = MAX_DEPTH - 1; // the paragraph inside is one level more
    const { result, warned } = quietly(() => render(nested(depth)));
    expect(warned).toBe(0);
    expect(result).toBe(nested(depth, "<div>", "</div>", "<p>Deep &amp; down</p>"));
  });

  it.each([300, 2_000, 20_000])("renders %i nested divs as plain text, without throwing", (depth) => {
    const { result, warned } = quietly(() => render(nested(depth)));
    expect(warned).toBe(1);
    expect(result).toBe("Deep &amp; down");
  });

  it("drops 300 nested svgs without descending into them, so the rest still renders as markup", () => {
    const { result, warned } = quietly(() => render(`<p>Before</p>${nested(300, "<svg>", "</svg>", "<text>x</text>")}`));
    expect(warned).toBe(0);
    expect(result).toBe("<p>Before</p>");
  });

  it.each([2_000, 20_000])("renders %i nested svgs as plain text, without throwing", (depth) => {
    const { result, warned } = quietly(() => render(`<p>Before</p>${nested(depth, "<svg>", "</svg>", "<text>x</text>")}`));
    expect(warned).toBe(1);
    expect(result).toBe("Before x");
  });

  it("does not count void elements, self-closing SVG children or closed siblings as depth", () => {
    const html =
      "<p>a<br>b<img src=x alt=''><wbr></p>".repeat(MAX_DEPTH + 1) +
      `<svg>${"<path d='M0 0'/>".repeat(MAX_DEPTH + 1)}</svg>` +
      "<ul><li>x</li></ul>".repeat(MAX_DEPTH + 1);
    const { result, warned } = quietly(() => render(html));
    expect(warned).toBe(0);
    expect(result).toContain("<p>a<br/>b<wbr/></p>");
    expect(result).toContain("<ul><li>x</li></ul>");
  });

  it("catches depth the pre-scan cannot see (end tags hidden in comments) in the pass or its try", () => {
    for (const depth of [300, 20_000]) {
      const { result, warned, errored } = quietly(() => render(`${"<div><!--</div>-->".repeat(depth)}<p>Hidden</p>`));
      expect(warned + errored, String(depth)).toBe(1);
      expect(result, String(depth)).toBe("Hidden");
    }
  });

  it("renders the body as plain text when the pass throws", () => {
    const renderBlock: RenderBlock = () => {
      throw new Error("boom");
    };
    const { result, errored } = quietly(() => render(`<p>Before</p>${MARKER}`, { renderBlock }));
    expect(errored).toBe(1);
    expect(result).toBe("Before More on Headless delivery Example");
  });

  it("leaves script and style content, comments and tags out of the plain text, and decodes common entities", () => {
    const body =
      "<h2>Title</h2><!-- a <b>comment</b> --><p>Caf&#233; &amp; <strong>bold</strong>, done&#8217;s &hellip; 1 &lt; 2</p>" +
      "<script>if (a < b) alert(1)</script><style>p { color: red }</style><p>End</p>";
    const { result } = quietly(() => render(nested(MAX_DEPTH + 1, "<div>", "</div>", body)));
    expect(result).toBe("Title Café &amp; bold, done’s &amp;hellip; 1 &lt; 2 End");
  });

  it("still throws a TypeError for a bad configuration rather than rendering text", () => {
    expect(() => renderContent("<p>x</p>", { cmsOrigins: ["ftp://cms.example"], uploadsBase: CMS.uploadsBase })).toThrow(TypeError);
    expect(() => renderContent("<p>x</p>", { cmsOrigins: CMS.cmsOrigins, uploadsBase: "not a url" })).toThrow(TypeError);
  });
});
