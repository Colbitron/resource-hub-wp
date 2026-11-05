import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MAX_CONTENT_LENGTH, MAX_DEPTH, renderContent, type RenderBlock, type RenderContentOptions } from "../lib/content/render";
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

  it("unwraps a CMS link whose rewrite would still name a CMS host, and strips credentials from one that maps", () => {
    expect(render('<p><a href="https://cms.example:8443/resources/">x</a></p>')).toBe("<p>x</p>");
    expect(render('<a href="https://user:pw@cms.example/resources/">x</a>')).toBe(
      '<a href="/resources/">x</a>',
    );
  });

  it("strips a CMS host written with several trailing dots", () => {
    expect(render('<a href="https://cms.example../resources/x/">x</a>')).toBe('<a href="/resources/x/">x</a>');
    expect(render('<a href="HTTPS://CMS.EXAMPLE.../resources/">x</a>')).toBe('<a href="/resources/">x</a>');
    expect(render('<p><img src="https://cms.example../wp-content/uploads/a.jpg" alt=""></p>')).toBe("<p></p>");
  });

  it("unwraps a CMS link that is not a front-end route or an upload, keeping its text", () => {
    for (const path of [
      "/wp-json/wp/v2/resources/15",
      "/wp-admin/",
      "/wp-login.php",
      "/xmlrpc.php",
      "/feed/",
      "/wp-content/plugins/example/readme.txt",
      "/wp-content/uploads/",
      "/?post_type=resource&p=12",
      "/?p=12",
      "/resources/../wp-admin/",
      "/resource/",
    ]) {
      const output = render(`<p><a class="x" href="https://cms.example${path.replaceAll("&", "&amp;")}" target="_blank">Text</a></p>`);
      expect(output, path).toBe("<p>Text</p>");
    }
  });

  it("keeps a CMS link to a front-end route or an upload", () => {
    for (const [href, expected] of [
      ["https://cms.example/", "/"],
      ["https://cms.example/#top", "/#top"],
      ["https://cms.example/resources", "/resources"],
      ["https://cms.example/resources/webinar/x/?a=1#b", "/resources/webinar/x/?a=1#b"],
      ["https://cms.example/wp-content/uploads/a.pdf", "/media/a.pdf"],
    ] as const) {
      expect(render(`<a href="${href}">x</a>`), href).toBe(`<a href="${expected}">x</a>`);
    }
  });

  it("shows the rewritten target as the text of a link whose text is its URL, as WordPress autolinks", () => {
    expect(render('<a href="https://cms.example/resources/x/">https://cms.example/resources/x/</a>')).toBe(
      '<a href="/resources/x/">/resources/x/</a>',
    );
    expect(render('<a href="/wp-content/uploads/a.pdf"> /wp-content/uploads/a.pdf </a>')).toBe(
      '<a href="/media/a.pdf">/media/a.pdf</a>',
    );
    expect(render('<p><a href="https://cms.example/wp-admin/">https://cms.example/wp-admin/</a></p>')).toBe(
      "<p>/wp-admin/</p>",
    );
    expect(render('<a href="https://example.com/a">https://example.com/a</a>')).toBe(
      '<a href="https://example.com/a">https://example.com/a</a>',
    );
    expect(render('<a href="https://example.com/"><strong>https://example.com/</strong></a>')).toBe(
      '<a href="https://example.com/"><strong>https://example.com/</strong></a>',
    );
  });

  it("shows the rewritten target as the text of a link whose text is a CMS URL other than its href", () => {
    expect(render('<a href="https://cms.example/resources/x/?ref=feed">https://cms.example/resources/x/</a>')).toBe(
      '<a href="/resources/x/?ref=feed">/resources/x/?ref=feed</a>',
    );
    expect(render('<p><a href="https://cms.example/wp-admin/">HTTPS://CMS.EXAMPLE/wp-admin/edit.php</a></p>')).toBe(
      "<p>/wp-admin/</p>",
    );
  });

  it("keeps any other link's content as written, markup included, even when it names the CMS", () => {
    expect(render('<a href="https://example.com/">Mirror of cms.example</a>')).toBe(
      '<a href="https://example.com/">Mirror of cms.example</a>',
    );
    expect(render('<a href="javascript:void(0)">Visit CMS.EXAMPLE now</a>')).toBe("<a>Visit CMS.EXAMPLE now</a>");
    expect(render('<p><a href="https://cms.example/wp-admin/"><b>bold</b> cms.example</a></p>')).toBe(
      "<p><b>bold</b> cms.example</p>",
    );
    expect(render('<a href="https://example.com/"><em>See</em> https://cms.example/resources/</a>')).toBe(
      '<a href="https://example.com/"><em>See</em> https://cms.example/resources/</a>',
    );
    // Not a CMS URL: another host, or no scheme.
    expect(render('<a href="https://example.com/">https://www.cms.example/</a>')).toBe(
      '<a href="https://example.com/">https://www.cms.example/</a>',
    );
    expect(render('<a href="https://example.com/">cms.example/resources/</a>')).toBe(
      '<a href="https://example.com/">cms.example/resources/</a>',
    );
  });

  it("keeps a link's own content when there is no target to show", () => {
    expect(render('<a href="javascript:void(0)">cms.example</a>')).toBe("<a>cms.example</a>");
    expect(render('<a href="javascript:void(0)">https://cms.example/resources/</a>')).toBe(
      "<a>https://cms.example/resources/</a>",
    );
    expect(render('<p><a href="https://cms.example:8443/x/">https://cms.example:8443/x/</a></p>')).toBe(
      "<p>https://cms.example:8443/x/</p>",
    );
  });

  it("keeps a mailto or tel link whose address is on the CMS's domain, as the editor wrote it", () => {
    expect(render('<p><a href="mailto:editor@cms.example">editor@cms.example</a></p>')).toBe(
      '<p><a href="mailto:editor@cms.example">editor@cms.example</a></p>',
    );
    expect(render('<a href="mailto:editor@cms.example">mailto:editor@cms.example</a>')).toBe(
      '<a href="mailto:editor@cms.example">mailto:editor@cms.example</a>',
    );
    expect(render('<a href="tel:+15555551234;phone-context=cms.example">Call</a>')).toBe(
      '<a href="tel:+15555551234;phone-context=cms.example">Call</a>',
    );
    expect(render('<blockquote cite="mailto:editor@cms.example">q</blockquote>')).toBe(
      '<blockquote cite="mailto:editor@cms.example">q</blockquote>',
    );
    // Only the URL is exempt: any other attribute that names the CMS is still dropped.
    expect(render('<a href="mailto:editor@cms.example" title="cms.example">Write</a>')).toBe(
      '<a href="mailto:editor@cms.example">Write</a>',
    );
    const apex: CmsUrls = { cmsOrigins: ["https://example.com"], uploadsBase: "https://example.com/wp-content/uploads" };
    expect(render('<p>Write to <a href="mailto:info@example.com">info@example.com</a>.</p>', undefined, apex)).toBe(
      '<p>Write to <a href="mailto:info@example.com">info@example.com</a>.</p>',
    );
    expect(render('<p><a href="mailto:info@example.org">info@example.org</a></p>', undefined, apex)).toBe(
      '<p><a href="mailto:info@example.org">info@example.org</a></p>',
    );
  });

  it("drops the query of an href that names the CMS in it, and unwraps one that names it in its path or hash", () => {
    expect(render('<a href="/resources/?u=https://cms.example/wp-admin/#top">x</a>')).toBe('<a href="/resources/#top">x</a>');
    expect(render('<a href="https://cms.example/resources/?u=https://CMS.EXAMPLE/wp-admin/">x</a>')).toBe(
      '<a href="/resources/">x</a>',
    );
    expect(render('<a href="https://example.com/share?url=https%3A%2F%2Fcms.example%2Fresources%2F">x</a>')).toBe(
      '<a href="https://example.com/share">x</a>',
    );
    expect(render('<a href="https://example.com/share?url=//cms.example/resources/">x</a>')).toBe(
      '<a href="https://example.com/share">x</a>',
    );
    expect(render('<a href="https://example.com/?a=1#?u=cms.example">x</a>')).toBe("x");
    expect(render('<p><a href="/resources/cms.example/">x</a><a href="#cms.example">y</a></p>')).toBe("<p>xy</p>");
    expect(render('<blockquote cite="https://example.com/?from=cms.example">q</blockquote>')).toBe(
      '<blockquote cite="https://example.com/">q</blockquote>',
    );
    expect(render('<iframe src="https://example.com/embed#cms.example" title="T"></iframe>')).toBe("");
  });

  it("names the CMS only as a whole host, so cms.example.org and evilcms.example are other hosts", () => {
    for (const href of [
      "https://cms.example.org/a",
      "https://cms.examples/a",
      "https://cms.example-2.test/a",
      "https://evilcms.example/a",
      "https://my-cms.example/a",
      "/resources/?u=cms.example.org",
    ]) {
      expect(render(`<a href="${href}">x</a>`), href).toBe(`<a href="${href}">x</a>`);
    }
    expect(render('<p title="On cms.example.org">x</p>')).toBe('<p title="On cms.example.org">x</p>');
    for (const title of ["cms.example", "www.cms.example", "cms.example.", "cms.example:8443", "(cms.example)", "CMS.Example/x"]) {
      expect(render(`<p title="${title}">x</p>`), title).toBe("<p>x</p>");
    }
  });

  it("names an internationalised CMS host in its punycode form and its Unicode form", () => {
    const idn: CmsUrls = { cmsOrigins: ["https://münchen.example"], uploadsBase: "https://münchen.example/wp-content/uploads" };
    for (const title of ["münchen.example", "info@münchen.example", "xn--mnchen-3ya.example", "XN--MNCHEN-3YA.EXAMPLE"]) {
      expect(render(`<p title="${title}">x</p>`, undefined, idn), title).toBe("<p>x</p>");
    }
    expect(render('<p title="münchen.example.org">x</p>', undefined, idn)).toBe('<p title="münchen.example.org">x</p>');
    for (const href of ["https://münchen.example/resources/", "https://xn--mnchen-3ya.example/resources/"]) {
      expect(render(`<a href="${href}">${href}</a>`, undefined, idn), href).toBe('<a href="/resources/">/resources/</a>');
    }
  });

  it("drops an id, a datetime, a class token or any other attribute value that names the CMS", () => {
    expect(render('<p id="cms.example" class="a cms-example b">x</p>')).toBe('<p class="a cms-example b">x</p>');
    expect(render('<time datetime="cms.example">t</time>')).toBe("<time>t</time>");
    expect(render(`<img src="${UPLOAD}" srcset="${UPLOAD} 1x" sizes="(max-width: 1px) cms.example" alt="">`)).toBe(
      '<img alt="" srcSet="/media/2026/11/photo.jpg 1x" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
    const local: CmsUrls = { cmsOrigins: ["http://localhost:8888"], uploadsBase: "http://localhost:8888/wp-content/uploads" };
    expect(render('<p class="a localhost b" lang="en">x</p>', undefined, local)).toBe('<p class="a b" lang="en">x</p>');
  });

  it("drops an image whose own URL names the CMS, and such srcset candidates", () => {
    expect(render('<p><img src="https://cms.example/wp-content/uploads/cms.example/a.png" alt=""></p>')).toBe("<p></p>");
    expect(render('<p><img src="https://images.example/a.png?from=cms.example" alt=""></p>')).toBe("<p></p>");
    expect(render(`<img src="${UPLOAD}" srcset="https://cms.example/wp-content/uploads/cms.example/b.png 2x" alt="">`)).toBe(
      '<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });

  it("leaves text and code the editor typed as written, even when it names the CMS", () => {
    const html = "<p>Log in at https://cms.example/wp-admin/ to edit.</p><pre><code>curl https://cms.example/wp-json/</code></pre>";
    expect(render(html)).toBe(html);
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

/**
 * Injection vectors and what each renders as, exactly. `null` marks the one
 * whose output is next/image's long markup; the negative checks below cover
 * it with the rest.
 */
const XSS_CASES: ReadonlyArray<readonly [vector: string, expected: string | null]> = [
  ["<script>alert(1)</script>", ""],
  ['<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>', ""],
  ["<img src=x onerror=alert(1)>", ""],
  ['<img src="x" ONERROR="alert(1)">', ""],
  ['<IMG SRC="javascript:alert(1)">', ""],
  ['<a href="javascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="JaVaScRiPt:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="  javascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="java\tscript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="java\nscript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="java\r\nscript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="\u0001javascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="&#106;&#97;&#118;&#97;script:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="&#x6A;avascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="&#0000106avascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="jav&#x09;ascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="jav&#x0A;ascript:alert(1)">x</a>', "<a>x</a>"],
  ['<a href="javascript&colon;alert(1)">x</a>', "<a>x</a>"],
  ['<a href="javascript://%0aalert(1)">x</a>', "<a>x</a>"],
  ['<a href="vbscript:msgbox(1)">x</a>', "<a>x</a>"],
  ['<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', "<a>x</a>"],
  ['<a href="javascript:alert(1)" href="/ok">x</a>', "<a>x</a>"],
  ['<a HREF="javascript:alert(1)" href="/ok">x</a>', "<a>x</a>"],
  ['<a href="/ok" onclick="alert(1)">x</a>', '<a href="/ok">x</a>'],
  ['<a href="/ok" style="background:url(javascript:alert(1))">x</a>', '<a href="/ok">x</a>'],
  ['<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=">', ""],
  [`<img src="${UPLOAD}" srcset="javascript:alert(1) 1x">`, '<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>'],
  [`<img src="${UPLOAD}" srcset="${UPLOAD} 1x, javascript:alert(1) 2x">`, '<img alt="" srcSet="/media/2026/11/photo.jpg 1x" src="/media/2026/11/photo.jpg" loading="lazy"/>'],
  [`<img src="${UPLOAD}" alt="" width="10" height="10" onload="alert(1)">`, null],
  ["<svg onload=alert(1)></svg>", ""],
  ["<svg><script>alert(1)</script></svg>", ""],
  ['<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', ""],
  ['<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"></use></svg>', ""],
  ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', ""],
  ['<math href="javascript:alert(1)">x</math>', ""],
  ['<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>', ""],
  ["<noscript><script>alert(1)</script></noscript>", ""],
  ['<iframe src="javascript:alert(1)"></iframe>', ""],
  ['<iframe srcdoc="<script>alert(1)</script>"></iframe>', ""],
  ['<object data="javascript:alert(1)"></object>', ""],
  ['<embed src="javascript:alert(1)">', ""],
  ["<style>body{background:url(javascript:alert(1))}</style>", ""],
  ['<style>@import "https://evil.example/x.css";</style>', ""],
  ['<div style="background:url(javascript:alert(1))">x</div>', "<div>x</div>"],
  ['<p onmouseover="alert(1)">x</p>', "<p>x</p>"],
  ['<p ONMOUSEOVER="alert(1)">x</p>', "<p>x</p>"],
  ["<details open ontoggle=alert(1)><summary>x</summary></details>", '<details open=""><summary>x</summary></details>'],
  ['<form action="javascript:alert(1)"><input type="submit" value="go"></form>', ""],
  ['<button onclick="alert(1)">x</button>', ""],
  ['<base href="javascript:alert(1)//">', ""],
  ['<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', ""],
  ['<link rel="stylesheet" href="https://evil.example/x.css">', ""],
  ["<template><script>alert(1)</script></template>", ""],
  ['<video><source onerror="alert(1)" src="x"></video>', '<a href="x" rel="noopener noreferrer">x</a>'],
  ['<video src="javascript:alert(1)"></video>', ""],
  ['<audio src="x" onerror="alert(1)"></audio>', '<a href="x" rel="noopener noreferrer">x</a>'],
  ['<xss id="x" tabindex="1" onfocus="alert(1)"></xss>', ""],
  ['<p id="__proto__" class="a&quot; onmouseover=&quot;alert(1)">x</p>', "<p>x</p>"],
  ['<a href="/ok" rel="noopener" target="_blank" onmouseover="alert(1)">x</a>', '<a href="/ok" target="_blank" rel="noopener noreferrer">x</a>'],
  ["<![CDATA[<script>alert(1)</script>]]>", ""],
  ["<!--<script>alert(1)</script>-->", ""],
  ["<?php echo 'x'; ?>", ""],
  ['<blockquote cite="javascript:alert(1)">x</blockquote>', "<blockquote>x</blockquote>"],
  ['<q cite="data:text/html,<script>alert(1)</script>">x</q>', "<q>x</q>"],
  ['<marquee onstart="alert(1)">x</marquee>', "x"],
  ['<body onload="alert(1)"><p>x</p></body>', "<p>x</p>"],
  ['<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">x</a>', "<a>x</a>"],
];

const XSS_VECTORS = XSS_CASES.map(([vector]) => vector);

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
    // The vector leaves the content after it alone, so the checks above cannot pass on an empty render.
    expect(render(`${vector}<p>benign</p>`)).toContain("<p>benign</p>");
  });

  it.each(XSS_CASES.filter((entry): entry is readonly [string, string] => entry[1] !== null))(
    "renders %s exactly as %j",
    (vector, expected) => {
      expect(render(vector)).toBe(expected);
    },
  );

  it("runs at least 25 vectors and pins the exact output of at least 15", () => {
    expect(XSS_VECTORS.length).toBeGreaterThanOrEqual(25);
    expect(XSS_CASES.filter(([, expected]) => expected !== null).length).toBeGreaterThanOrEqual(15);
  });

  it("renders benign content as markup, never as nothing", () => {
    const cases = [
      ["<p>Hello <strong>world</strong></p>", "<p>Hello <strong>world</strong></p>"],
      ["<h2>Heading</h2><ul><li>One</li><li>Two</li></ul>", "<h2>Heading</h2><ul><li>One</li><li>Two</li></ul>"],
      ['<figure class="wp-block-quote"><blockquote><p>Q</p><cite>A</cite></blockquote></figure>', '<figure class="wp-block-quote"><blockquote><p>Q</p><cite>A</cite></blockquote></figure>'],
      ["Plain text", "Plain text"],
    ] as const;
    for (const [html, expected] of cases) {
      const output = render(html);
      expect(output, html).not.toBe("");
      expect(output, html).toBe(expected);
    }
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
        '<div class="rh-table-scroll" role="region" tabindex="0" aria-label="Table">' +
        '<table><thead><tr><th colSpan="2" scope="col">H</th></tr></thead><tbody><tr><td rowSpan="2">c</td></tr></tbody></table></div>' +
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

  it("drops class tokens that start with rh-, the app's own prefix, except rh-related on the marker's wrapper", () => {
    expect(render('<a href="/resources/" class="rh-card__link wp-x RH-skip">x</a>')).toBe('<a class="wp-x" href="/resources/">x</a>');
    expect(render('<p class="rh-related rh-shell">x</p>')).toBe("<p>x</p>");
    expect(render(MARKER.replace('class="wp-block-resource-hub-related-resources rh-related"', 'class="rh-related rh-card"'))).toContain(
      '<div class="rh-related"><h2>',
    );
  });

  it("unwraps an element it does not know and keeps its children", () => {
    expect(render('<section class="x"><p>a</p></section><font color="red">b</font><center>c</center>')).toBe(
      "<p>a</p>bc",
    );
  });

  it("drops comments, the doctype and whitespace between table rows", () => {
    expect(render("<!DOCTYPE html><!-- note --><p>x</p>")).toBe("<p>x</p>");
    expect(render("<table>\n  <tbody>\n    <tr><td>x</td></tr>\n  </tbody>\n</table>")).toBe(
      '<div class="rh-table-scroll" role="region" tabindex="0" aria-label="Table"><table><tbody><tr><td>x</td></tr></tbody></table></div>',
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
      ["data-topic", "%E6%97%A5"],
      ["data-topic", "日"],
      ["data-topic", "a?b"],
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

  it("accepts a topic slug already in the canonical form WordPress writes", () => {
    const renderBlock = vi.fn<RenderBlock>(() => null);
    render(MARKER.replace('data-topic="headless-delivery"', 'data-topic="%e6%97%a5"'), { renderBlock });
    expect(renderBlock.mock.calls[0]?.[0].topic).toBe("%e6%97%a5");
  });

  it("leaves dropped elements out of the heading text", () => {
    const renderBlock = vi.fn<RenderBlock>(() => null);
    render(MARKER.replace("<h2>More on Headless delivery</h2>", "<h2><script>alert(1)</script>Head<style>p{}</style><em>ing</em></h2>"), {
      renderBlock,
    });
    expect(renderBlock.mock.calls[0]?.[0].heading).toBe("Heading");
  });

  it(`hands at most the first five markers to renderBlock and renders the rest as their fallback`, () => {
    const renderBlock = vi.fn<RenderBlock>(() => <aside>related</aside>);
    const output = render(MARKER.repeat(7), { renderBlock });
    expect(renderBlock).toHaveBeenCalledTimes(5);
    expect(output.match(/<aside>related<\/aside>/g)).toHaveLength(5);
    expect(output.match(/<h2>More on Headless delivery<\/h2>/g)).toHaveLength(2);
  });

  function markerFor(topic: string, inner = ""): string {
    return MARKER.replace('data-topic="headless-delivery"', `data-topic="${topic}"`).replace("</ul></div>", `</ul>${inner}</div>`);
  }

  it("counts the five markers in document order, an outer marker before the ones nested in it", () => {
    const renderBlock = vi.fn<RenderBlock>((props) => <aside>{props.topic}</aside>);
    const inner = ["b", "c", "d", "e", "f"].map((topic) => markerFor(topic)).join("");
    const output = render(markerFor("a", inner), { renderBlock });
    expect(renderBlock.mock.calls.map(([props]) => props.topic).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(output.startsWith("<aside>a</aside>")).toBe(true);
  });

  it("renders the fallback for a marker inside a link, so the block's links are not nested in it", () => {
    const renderBlock = vi.fn<RenderBlock>(() => <aside>never</aside>);
    const output = render(`<a href="/resources/">${MARKER}</a>`, { renderBlock });
    expect(renderBlock).not.toHaveBeenCalled();
    expect(output).toBe(
      '<a href="/resources/"><div class="wp-block-resource-hub-related-resources rh-related"><h2>More on Headless delivery</h2><ul><li>Example</li></ul></div></a>',
    );
  });

  it("renders a block's fallback when renderBlock throws, and the rest of the body as markup", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let calls = 0;
      const renderBlock: RenderBlock = (props) => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return <aside>{props.topic}</aside>;
      };
      const output = render(`<p>Before</p>${markerFor("a")}${markerFor("b")}`, { renderBlock });
      expect(error).toHaveBeenCalledTimes(1);
      expect(output).toBe(
        '<p>Before</p><div class="wp-block-resource-hub-related-resources rh-related"><h2>More on Headless delivery</h2><ul><li><a href="/resources/webinar/example/">Example</a></li></ul></div><aside>b</aside>',
      );
    } finally {
      error.mockRestore();
    }
  });

  it("excludes the post ID passed in, whatever data-exclude says", () => {
    const renderBlock = vi.fn<RenderBlock>(() => null);
    render(MARKER, { renderBlock, postId: 15 });
    render(MARKER, { renderBlock, postId: 99 });
    expect(renderBlock.mock.calls.map(([props]) => props.exclude)).toEqual([15, 99]);
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

  it("links a video or audio without a src to its first usable source", () => {
    const mp4 = UPLOAD.replace(".jpg", ".mp4");
    expect(render(`<video controls><source src="javascript:alert(1)"><source src="${mp4}" type="video/mp4"><source src="https://example.com/b.webm"></video>`)).toBe(
      '<a href="/media/2026/11/photo.mp4" rel="noopener noreferrer">/media/2026/11/photo.mp4</a>',
    );
    expect(render(`<video src="https://example.com/a.mp4"><source src="${mp4}"></video>`)).toBe(
      '<a href="https://example.com/a.mp4" rel="noopener noreferrer">https://example.com/a.mp4</a>',
    );
    expect(render('<p><audio controls><source src="data:audio/mp3;base64,AA"></audio></p>')).toBe("<p></p>");
  });

  it("renders an embed inside a link as its text, never as a nested link", () => {
    expect(render('<a href="https://example.com/"><iframe src="https://www.youtube.com/embed/x" title="A talk"></iframe></a>')).toBe(
      '<a href="https://example.com/">A talk</a>',
    );
    expect(render(`<a href="/resources/"><video src="${UPLOAD.replace(".jpg", ".mp4")}"></video></a>`)).toBe(
      '<a href="/resources/">/media/2026/11/photo.mp4</a>',
    );
    expect(render('<a href="/resources/"><div class="wp-block-embed__wrapper">https://example.com/talk</div></a>')).toBe(
      '<a href="/resources/"><div class="wp-block-embed__wrapper">https://example.com/talk</div></a>',
    );
    expect(render('<a href="/a/"><span><a href="/b/">x</a></span></a>')).toBe('<a href="/a/"><span>x</span></a>');
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
    // A REST link leads nowhere on the front end, so it is unwrapped to its text.
    expect(output).not.toContain("wp-json");
    expect(output).toContain("and REST.");
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

  it("splits a 500 KB comma-heavy srcset in under a second", () => {
    // 500 KB keeps the body under MAX_CONTENT_LENGTH, so it reaches the pass; the old pattern took 13.5 s on 200 KB.
    // A run of commas between two non-commas and a trailing comma made the old `/,+$/` quadratic.
    const srcset = `a${",".repeat(500_000)}a,`;
    const start = performance.now();
    const output = render(`<img src="${UPLOAD}" srcset="${srcset}" alt="">`);
    expect(performance.now() - start).toBeLessThan(SECOND);
    expect(output).toBe('<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>');
  });

  it("checks a 500 KB srcset descriptor in under a second", () => {
    // A long run of digits that is not a descriptor made the old `[0-9]*\.?[0-9]+x` quadratic.
    const srcset = `${UPLOAD} ${"1".repeat(500_000)}y`;
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

  it("counts 256 elements of nesting, a void leaf inside them adding none", () => {
    const leaf = "<br>Deep";
    const inside = quietly(() => render(nested(MAX_DEPTH, "<div>", "</div>", leaf)));
    expect(inside.warned).toBe(0);
    expect(inside.result).toBe(nested(MAX_DEPTH, "<div>", "</div>", "<br/>Deep"));
    const over = quietly(() => render(nested(MAX_DEPTH + 1, "<div>", "</div>", leaf)));
    expect(over.warned).toBe(1);
    expect(over.result).toBe("Deep");
  });

  it("leaves every element htmlparser2 treats as void out of the depth, as the parser does", () => {
    const voids = ["area", "base", "basefont", "br", "col", "command", "embed", "frame", "hr", "img", "input", "isindex", "keygen", "link", "meta", "param", "source", "track", "wbr"];
    const { warned } = quietly(() => render(nested(MAX_DEPTH, "<div>", "</div>", voids.map((name) => `<${name}>`).join(""))));
    expect(warned).toBe(0);
  });

  it("counts the elements the parser opens and closes by implication, as it does", () => {
    // Each <p> and <li> closes the one before it; a stray </p> opens and closes an empty <p>.
    const flat = quietly(() => render(`${"<p>x".repeat(1_000)}<ul>${"<li>x".repeat(1_000)}</ul>`));
    expect(flat.warned).toBe(0);
    const stray = (depth: number) => quietly(() => render(nested(depth, "<i>", "</i>", "</p>")));
    expect(stray(MAX_DEPTH - 1).warned).toBe(0);
    expect(stray(MAX_DEPTH).warned).toBe(1);
  });

  it.each([300, 2_000, 20_000])("renders %i nested svgs as plain text, without throwing", (depth) => {
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

  it("reads end tags hidden in comments, raw text, attribute values and CDATA as the parser does", () => {
    for (const hidden of ["<!--</div>-->", "<script></div></script>", "<textarea></div></textarea>", '<br title="</div>">', "<![CDATA[</div>]]>"]) {
      for (const depth of [MAX_DEPTH + 1, 20_000]) {
        const { result, warned, errored } = quietly(() => render(`${`<div>${hidden}`.repeat(depth)}<p>Hidden</p>`));
        expect(warned, `${hidden} x ${depth}`).toBe(1);
        expect(errored, `${hidden} x ${depth}`).toBe(0);
        expect(result.endsWith("Hidden"), `${hidden} x ${depth}`).toBe(true);
      }
    }
  });

  it("renders the reviewer's worst case at the size cap as text in well under half a second", () => {
    // Blocks of 1,000 <i> whose end tags hide in a comment, 37,000 deep, then
    // unmatched </p> to the cap: htmlparser2 searched its stack of 37,000 for
    // each </p>, which took 1.6 to 4 s before the depth pre-pass stopped it at
    // MAX_DEPTH + 1. It takes about 5 ms now. 500 ms leaves two orders of
    // magnitude for a slow CI runner and still fails the quadratic case by
    // three times on the fastest machine measured.
    const block = `${"<i>".repeat(1_000)}<!--${"</i>".repeat(1_000)}-->`;
    let html = block.repeat(37);
    html += "</p>".repeat(Math.floor((MAX_CONTENT_LENGTH - html.length) / 4));
    expect(html.length).toBeGreaterThan(MAX_CONTENT_LENGTH - 4);
    expect(html.length).toBeLessThanOrEqual(MAX_CONTENT_LENGTH);
    const start = performance.now();
    const { warned } = quietly(() => render(html));
    expect(performance.now() - start).toBeLessThan(500);
    expect(warned).toBe(1);
  });

  it("renders a body of exactly MAX_CONTENT_LENGTH as markup and one a character longer as plain text", () => {
    const body = (length: number) => {
      const html = `<p><strong>Long</strong> ${"a".repeat(length - 30)}</p>`;
      return html + " ".repeat(length - html.length);
    };
    const atCap = quietly(() => render(body(MAX_CONTENT_LENGTH)));
    expect(body(MAX_CONTENT_LENGTH)).toHaveLength(MAX_CONTENT_LENGTH);
    expect(atCap.warned).toBe(0);
    expect(atCap.result.startsWith("<p><strong>Long</strong> a")).toBe(true);

    const overCap = quietly(() => render(body(MAX_CONTENT_LENGTH + 1)));
    expect(overCap.warned).toBe(1);
    expect(overCap.result.startsWith("Long a")).toBe(true);
    expect(overCap.result).not.toContain("<");
  });

  it("takes the CMS out of the plain text: origins removed, then any word that still names it", () => {
    const body =
      '<p>See <a href="https://cms.example/resources/x/">https://cms.example/resources/x/</a> or //CMS.EXAMPLE:8443/y/.</p>' +
      "<p>Mail editor@cms.example, not cms.example.org or evilcms.example.</p>";
    const { result } = quietly(() => render(nested(MAX_DEPTH + 1, "<div>", "</div>", body)));
    expect(result).toBe("See /resources/x/ or /y/. Mail not cms.example.org or evilcms.example.");
    const subdirectory: CmsUrls = { cmsOrigins: ["https://example.com/blog"], uploadsBase: "https://media.example/wp-content/uploads" };
    const text = quietly(() =>
      render(nested(MAX_DEPTH + 1, "<div>", "</div>", "https://example.com/blog/resources/ https://example.com/shop/ https://media.example/a.png"), undefined, subdirectory),
    );
    expect(text.result).toBe("/resources/ https://example.com/shop/ /a.png");
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

describe("titles and alt text", () => {
  it("drops a title that names the CMS and keeps any other", () => {
    expect(render('<p title="Copied from https://cms.example/x/">x</p>')).toBe("<p>x</p>");
    expect(render('<p title="On CMS.example">x</p>')).toBe("<p>x</p>");
    expect(render('<abbr title="Content management system">CMS</abbr>')).toBe(
      '<abbr title="Content management system">CMS</abbr>',
    );
  });

  it("removes the words of an alt that name the CMS and leaves any other alt as written", () => {
    expect(render(`<img src="${UPLOAD}" alt="Screenshot of https://cms.example/wp-admin/ settings">`)).toBe(
      '<img alt="Screenshot of settings" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
    expect(render('<img src="https://images.example/a.jpg" alt="From cms.example">')).toBe(
      '<img alt="From" src="https://images.example/a.jpg" loading="lazy" referrerPolicy="no-referrer"/>',
    );
    expect(render(`<img src="${UPLOAD}" alt="Two  spaces">`)).toBe(
      '<img alt="Two  spaces" src="/media/2026/11/photo.jpg" loading="lazy"/>',
    );
  });

  it("uses an iframe's title as link text only when it is not its URL and does not name the CMS", () => {
    expect(render('<iframe src="https://www.youtube.com/embed/x" title="https://cms.example/talk/"></iframe>')).toBe(
      '<a href="https://www.youtube.com/embed/x" rel="noopener noreferrer">https://www.youtube.com/embed/x</a>',
    );
    expect(render('<iframe src="https://www.youtube.com/embed/x" title=" https://www.youtube.com/embed/x "></iframe>')).toBe(
      '<a href="https://www.youtube.com/embed/x" rel="noopener noreferrer">https://www.youtube.com/embed/x</a>',
    );
    expect(render('<iframe src="https://cms.example/resources/webinar/x/embed/" title="A talk"></iframe>')).toBe(
      '<a href="/resources/webinar/x/embed/" rel="noopener noreferrer">A talk</a>',
    );
  });

  it("turns an unresolved CMS embed that is not a route into its rewritten path as text", () => {
    expect(render('<div class="wp-block-embed__wrapper">https://cms.example/wp-admin/</div>')).toBe(
      '<div class="wp-block-embed__wrapper">/wp-admin/</div>',
    );
  });
});

describe("fidelity", () => {
  it("drops the newline a browser drops after <pre>, so no blank first line appears", () => {
    expect(render("<pre>\ncode</pre>")).toBe("<pre>code</pre>");
    // The second newline is content; React writes one more for the browser to drop.
    expect(render("<pre>\n\ncode</pre>")).toBe("<pre>\n\ncode</pre>");
    // With more than one child React writes the text as it is, and the browser drops the newline itself.
    expect(render("<pre>\n<code>x</code></pre>")).toBe("<pre>\n<code>x</code></pre>");
    // A newline inside <code> is content.
    expect(render('<pre class="wp-block-code"><code>\nx</code></pre>')).toBe('<pre class="wp-block-code"><code>\nx</code></pre>');
  });

  it("renders a CMS image with one valid dimension as a plain img without dimensions, since next/image needs both", () => {
    for (const [width, height] of [["1024", "0"], ["abc", "683"], ["1024", ""]] as const) {
      expect(render(`<img src="${UPLOAD}" width="${width}" height="${height}" alt="">`), `${width}x${height}`).toBe(
        '<img alt="" src="/media/2026/11/photo.jpg" loading="lazy"/>',
      );
    }
  });
});

describe("tables", () => {
  const REGION = '<div class="rh-table-scroll" role="region" tabindex="0" aria-label=';

  it("wraps every table in a focusable region named by its caption", () => {
    expect(render("<table><caption>Plans by  <em>price</em>\n</caption><tr><td>x</td></tr></table>")).toBe(
      `${REGION}"Plans by price"><table><caption>Plans by  <em>price</em>\n</caption><tr><td>x</td></tr></table></div>`,
    );
  });

  it('names a table with no caption, or a caption with no text, "Table"', () => {
    expect(render("<table><tr><td>x</td></tr></table>")).toBe(`${REGION}"Table"><table><tr><td>x</td></tr></table></div>`);
    expect(render("<table><caption> <script>x</script> </caption><tr><td>x</td></tr></table>")).toContain(`${REGION}"Table">`);
  });

  it("takes the label from the caption's text without the dropped elements' content or words that name the CMS", () => {
    expect(render("<table><caption>Costs<style>p{}</style> from https://cms.example/wp-admin/ today</caption></table>")).toContain(
      `${REGION}"Costs from today">`,
    );
    expect(render("<table><caption>cms.example</caption></table>")).toContain(`${REGION}"Table">`);
  });

  it("wraps the table inside a WordPress table block, not the figure", () => {
    expect(
      render('<figure class="wp-block-table"><table><tbody><tr><td>x</td></tr></tbody></table><figcaption>Caption</figcaption></figure>'),
    ).toBe(
      `<figure class="wp-block-table">${REGION}"Table"><table><tbody><tr><td>x</td></tr></tbody></table></div><figcaption>Caption</figcaption></figure>`,
    );
  });

  it("wraps a nested table too, and leaves a table inside a link bare", () => {
    expect(render("<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>").match(/rh-table-scroll/g)).toHaveLength(2);
    expect(render('<a href="/resources/"><table><tr><td>x</td></tr></table></a>')).toBe(
      '<a href="/resources/"><table><tr><td>x</td></tr></table></a>',
    );
  });

  it("never lets content carry the region's class or its ARIA attributes", () => {
    expect(render('<div class="rh-table-scroll" role="region" tabindex="0" aria-label="x">y</div>')).toBe("<div>y</div>");
  });
});

describe("headings", () => {
  it("shows every heading one level down when the body has an h1, keeping their order", () => {
    expect(render('<h1 id="a">One</h1><h3>Three</h3><h2 class="x">Two</h2>')).toBe(
      '<h2 id="c-a">One</h2><h4>Three</h4><h3 class="x">Two</h3>',
    );
  });

  it("caps the shift at h6", () => {
    expect(render("<h1>a</h1><h5>b</h5><h6>c</h6>")).toBe("<h2>a</h2><h6>b</h6><h6>c</h6>");
  });

  it("leaves a body without an h1 as written", () => {
    expect(render("<h2>Two</h2><h3>Three</h3><h6>Six</h6>")).toBe("<h2>Two</h2><h3>Three</h3><h6>Six</h6>");
  });

  it("counts an h1 anywhere the pass renders it, in any case, and not one inside content it drops", () => {
    expect(render("<section><div><H1>Deep</H1></div></section><h2>x</h2>")).toBe("<div><h2>Deep</h2></div><h3>x</h3>");
    expect(render("<h2>x</h2><template><h1>t</h1></template><noscript><h1>n</h1></noscript><video><h1>v</h1></video>")).toBe(
      "<h2>x</h2>",
    );
    expect(render("<h2>x</h2><!-- <h1>c</h1> --><p>&lt;h1&gt;</p>")).toBe("<h2>x</h2><p>&lt;h1&gt;</p>");
  });

  it("demotes the marker's fallback heading with the rest, and still reads it as the block's heading", () => {
    let heading: string | null = null;
    const output = render(`<h1>Title</h1>${MARKER}`, {
      renderBlock: (props, fallback) => {
        heading = props.heading;
        return fallback;
      },
    });
    expect(heading).toBe("More on Headless delivery");
    expect(output).toContain("<h3>More on Headless delivery</h3>");
  });
});
