import { describe, expect, it } from "vitest";

import { mediaPath, rewriteHref, rewriteSrcset, stripCmsOrigin } from "../lib/urls";

const CMS = ["https://cms.example"];
const UPLOADS = "https://cms.example/wp-content/uploads";

describe("stripCmsOrigin", () => {
  it("makes a CMS URL root-relative, keeping the query and hash", () => {
    expect(stripCmsOrigin("https://cms.example/resources/webinar/example/", CMS)).toBe(
      "/resources/webinar/example/",
    );
    expect(stripCmsOrigin("https://cms.example/resources/?a=1&b=2#top", CMS)).toBe(
      "/resources/?a=1&b=2#top",
    );
    expect(stripCmsOrigin("https://cms.example", CMS)).toBe("/");
  });

  it("accepts several origins", () => {
    const origins = ["https://cms.example", "http://localhost:8888"];
    expect(stripCmsOrigin("http://localhost:8888/resources/", origins)).toBe("/resources/");
    expect(stripCmsOrigin("https://cms.example/x/", origins)).toBe("/x/");
    expect(stripCmsOrigin("http://localhost:8889/x/", origins)).toBe("http://localhost:8889/x/");
  });

  it("treats http and https on the CMS host alike", () => {
    expect(stripCmsOrigin("http://cms.example/x/", CMS)).toBe("/x/");
  });

  it("leaves relative URLs, anchors and mailto alone", () => {
    for (const href of [
      "/resources/",
      "resources/",
      "../x",
      "?page=2",
      "#section",
      "#",
      "",
      "mailto:editor@cms.example",
      "tel:+15555550100",
    ]) {
      expect(stripCmsOrigin(href, CMS)).toBe(href);
    }
  });

  it("leaves other origins alone", () => {
    expect(stripCmsOrigin("https://other.example/x/", CMS)).toBe("https://other.example/x/");
  });

  it("never treats javascript: as the CMS", () => {
    for (const href of [
      "javascript:alert(1)",
      "javascript://cms.example/%0aalert(1)",
      "JavaScript://cms.example/",
      " javascript://cms.example/",
      "java\tscript://cms.example/",
      "data:text/html,<a href=https://cms.example/>",
    ]) {
      expect(stripCmsOrigin(href, CMS)).toBe(href);
    }
  });

  it("strips protocol-relative CMS URLs, slash or backslash", () => {
    expect(stripCmsOrigin("//cms.example/resources/", CMS)).toBe("/resources/");
    expect(stripCmsOrigin("\\\\cms.example\\resources\\", CMS)).toBe("/resources/");
    expect(stripCmsOrigin("/\\cms.example/resources/", CMS)).toBe("/resources/");
    expect(stripCmsOrigin("//other.example/x/", CMS)).toBe("//other.example/x/");
  });

  it("reads hosts case-insensitively", () => {
    expect(stripCmsOrigin("HTTPS://CMS.EXAMPLE/Resources/", CMS)).toBe("/Resources/");
    expect(stripCmsOrigin("https://Cms.Example/x/", ["HTTPS://CMS.example"])).toBe("/x/");
  });

  it("treats default ports as the CMS and other ports as another origin", () => {
    expect(stripCmsOrigin("https://cms.example:443/x/", CMS)).toBe("/x/");
    expect(stripCmsOrigin("http://cms.example:80/x/", CMS)).toBe("/x/");
    expect(stripCmsOrigin("https://cms.example:8443/x/", CMS)).toBe(
      "https://cms.example:8443/x/",
    );
    expect(stripCmsOrigin("http://localhost:8888/x/", ["http://localhost:8888"])).toBe("/x/");
    expect(stripCmsOrigin("http://localhost/x/", ["http://localhost:8888"])).toBe(
      "http://localhost/x/",
    );
  });

  it("does not match lookalike hosts", () => {
    for (const href of [
      "https://cms.example.evil/x/",
      "https://evilcms.example/x/",
      "https://cms-example/x/",
      "https://cms.example@evil.example/x/",
      "https://evil.example/cms.example/",
      "https://evil.example/?u=https://cms.example/",
      "https://evil.example#cms.example",
      "//cms.example.evil/x/",
    ]) {
      expect(stripCmsOrigin(href, CMS)).toBe(href);
    }
  });

  it("strips credentials along with the origin", () => {
    expect(stripCmsOrigin("https://user:pass@cms.example/x/", CMS)).toBe("/x/");
  });

  it("never returns a protocol-relative path", () => {
    expect(stripCmsOrigin("https://cms.example//evil.example/x/", CMS)).toBe("/evil.example/x/");
    expect(stripCmsOrigin("https://cms.example/\\evil.example/x/", CMS)).toBe("/evil.example/x/");
  });

  it("reads the URL as a browser would, ignoring surrounding space and inner newlines", () => {
    expect(stripCmsOrigin("  https://cms.example/x/\n", CMS)).toBe("/x/");
    expect(stripCmsOrigin("https://cms.\nexample/x/", CMS)).toBe("/x/");
    expect(stripCmsOrigin("\t//cms.example/x/", CMS)).toBe("/x/");
  });

  it("throws on a configured origin that is not http(s)", () => {
    expect(() => stripCmsOrigin("/x/", ["cms.example"])).toThrow(TypeError);
    expect(() => stripCmsOrigin("/x/", ["ftp://cms.example"])).toThrow(TypeError);
  });
});

describe("stripCmsOrigin on a trailing-dot host", () => {
  it("strips the CMS written with one trailing dot, absolute or scheme-relative", () => {
    expect(stripCmsOrigin("https://cms.example./x/", CMS)).toBe("/x/");
    expect(stripCmsOrigin("//cms.example./x", CMS)).toBe("/x");
    expect(stripCmsOrigin("HTTPS://CMS.EXAMPLE.:443/x/", CMS)).toBe("/x/");
  });

  it("strips the CMS when the configured origin has the trailing dot", () => {
    expect(stripCmsOrigin("https://cms.example/x/", ["https://cms.example."])).toBe("/x/");
  });

  it("drops one dot only, and still refuses lookalikes", () => {
    expect(stripCmsOrigin("https://cms.example../x/", CMS)).toBe("https://cms.example../x/");
    expect(stripCmsOrigin("https://evilcms.example./x/", CMS)).toBe("https://evilcms.example./x/");
    expect(stripCmsOrigin("https://cms.example.evil./x/", CMS)).toBe(
      "https://cms.example.evil./x/",
    );
  });
});

describe("stripCmsOrigin on a subdirectory install", () => {
  const BLOG = ["https://example.com/blog"];

  it("strips the origin and the install path", () => {
    expect(stripCmsOrigin("https://example.com/blog/resources/webinar/x/", BLOG)).toBe(
      "/resources/webinar/x/",
    );
    expect(stripCmsOrigin("https://example.com/blog/resources/?a=1#b", BLOG)).toBe(
      "/resources/?a=1#b",
    );
    expect(stripCmsOrigin("https://example.com/blog", BLOG)).toBe("/");
    expect(stripCmsOrigin("https://example.com/blog/", BLOG)).toBe("/");
    expect(stripCmsOrigin("//example.com/blog/x/", BLOG)).toBe("/x/");
  });

  it("accepts the install path with a trailing slash", () => {
    expect(stripCmsOrigin("https://example.com/blog/x/", ["https://example.com/blog/"])).toBe(
      "/x/",
    );
  });

  it("leaves a same-host URL outside the install path alone", () => {
    for (const href of [
      "https://example.com/",
      "https://example.com/shop/",
      "https://example.com/blogger/x/",
      "https://example.com/Blog/x/",
    ]) {
      expect(stripCmsOrigin(href, BLOG)).toBe(href);
    }
  });

  it("never returns a protocol-relative path from under the install path", () => {
    expect(stripCmsOrigin("https://example.com/blog//evil.example/", BLOG)).toBe("/evil.example/");
  });

  it("uses the longest install path that matches", () => {
    const bases = ["https://example.com", "https://example.com/blog"];
    expect(stripCmsOrigin("https://example.com/blog/x/", bases)).toBe("/x/");
    expect(stripCmsOrigin("https://example.com/shop/", bases)).toBe("/shop/");
    expect(stripCmsOrigin("https://example.com/blog/x/", [...bases].reverse())).toBe("/x/");
  });

  it("resolves dot segments before checking the install path", () => {
    expect(stripCmsOrigin("https://example.com/blog/../shop/", BLOG)).toBe(
      "https://example.com/blog/../shop/",
    );
  });
});

describe("rewriteHref", () => {
  const urls = { cmsOrigins: CMS, uploadsBase: UPLOADS };

  it("maps a link to an upload to /media/, keeping its query and hash", () => {
    expect(rewriteHref("https://cms.example/wp-content/uploads/a.pdf", urls)).toBe("/media/a.pdf");
    expect(rewriteHref("https://cms.example/wp-content/uploads/a.pdf?dl=1#page=2", urls)).toBe(
      "/media/a.pdf?dl=1#page=2",
    );
    expect(rewriteHref("/wp-content/uploads/2026/11/a.pdf", urls)).toBe("/media/2026/11/a.pdf");
    expect(rewriteHref("//cms.example./wp-content/uploads/a.pdf", urls)).toBe("/media/a.pdf");
  });

  it("strips the CMS origin from any other CMS link", () => {
    expect(rewriteHref("https://cms.example/resources/webinar/x/?a=1", urls)).toBe(
      "/resources/webinar/x/?a=1",
    );
    expect(rewriteHref("https://cms.example/wp-content/uploads/../themes/x.css", urls)).toBe(
      "/wp-content/themes/x.css",
    );
  });

  it("leaves everything else alone", () => {
    for (const href of [
      "https://other.example/wp-content/uploads/a.pdf",
      "/resources/",
      "#top",
      "mailto:editor@cms.example",
      "javascript:alert(1)",
    ]) {
      expect(rewriteHref(href, urls)).toBe(href);
    }
  });

  it("supports uploads on a subdirectory install", () => {
    const blog = {
      cmsOrigins: ["https://example.com/blog"],
      uploadsBase: "https://example.com/blog/wp-content/uploads",
    };
    expect(rewriteHref("https://example.com/blog/wp-content/uploads/a.pdf", blog)).toBe(
      "/media/a.pdf",
    );
    expect(rewriteHref("https://example.com/blog/resources/", blog)).toBe("/resources/");
    expect(rewriteHref("https://example.com/wp-content/uploads/a.pdf", blog)).toBe(
      "https://example.com/wp-content/uploads/a.pdf",
    );
  });

  it("throws on a configured URL that is not http(s)", () => {
    expect(() => rewriteHref("/x", { cmsOrigins: ["ftp://cms.example"], uploadsBase: UPLOADS })).toThrow(
      TypeError,
    );
    expect(() => rewriteHref("/x", { cmsOrigins: CMS, uploadsBase: "cms.example" })).toThrow(
      TypeError,
    );
  });
});

describe("mediaPath", () => {
  it("maps an uploads URL to /media/, keeping the hash and dropping the query", () => {
    expect(mediaPath("https://cms.example/wp-content/uploads/2026/11/photo.jpg", UPLOADS)).toBe(
      "/media/2026/11/photo.jpg",
    );
    // next.config.ts's localPatterns has search: "", so next/image would refuse ?ver=2.
    expect(mediaPath("https://cms.example/wp-content/uploads/a.jpg?ver=2#x", UPLOADS)).toBe(
      "/media/a.jpg#x",
    );
    expect(mediaPath("https://cms.example/wp-content/uploads/a.jpg?", UPLOADS)).toBe(
      "/media/a.jpg",
    );
  });

  it("accepts a CMS host written with a trailing dot, on either side", () => {
    expect(mediaPath("https://cms.example./wp-content/uploads/a.jpg", UPLOADS)).toBe(
      "/media/a.jpg",
    );
    expect(mediaPath("//cms.example./wp-content/uploads/a.jpg", UPLOADS)).toBe("/media/a.jpg");
    expect(
      mediaPath("https://cms.example/wp-content/uploads/a.jpg", "https://cms.example./wp-content/uploads"),
    ).toBe("/media/a.jpg");
    expect(mediaPath("https://cms.example../wp-content/uploads/a.jpg", UPLOADS)).toBeNull();
  });

  it("accepts an uploads base with a trailing slash and a subdirectory install", () => {
    expect(mediaPath("https://cms.example/wp-content/uploads/a.jpg", `${UPLOADS}/`)).toBe(
      "/media/a.jpg",
    );
    expect(
      mediaPath(
        "https://example.com/blog/wp-content/uploads/a.jpg",
        "https://example.com/blog/wp-content/uploads",
      ),
    ).toBe("/media/a.jpg");
    expect(
      mediaPath(
        "https://example.com/wp-content/uploads/a.jpg",
        "https://example.com/blog/wp-content/uploads",
      ),
    ).toBeNull();
  });

  it("maps a root-relative uploads path", () => {
    expect(mediaPath("/wp-content/uploads/a.jpg", UPLOADS)).toBe("/media/a.jpg");
  });

  it("maps protocol-relative uploads URLs and rejects protocol-relative other hosts", () => {
    expect(mediaPath("//cms.example/wp-content/uploads/a.jpg", UPLOADS)).toBe("/media/a.jpg");
    expect(mediaPath("\\\\cms.example\\wp-content\\uploads\\a.jpg", UPLOADS)).toBe(
      "/media/a.jpg",
    );
    expect(mediaPath("//evil.example/wp-content/uploads/a.jpg", UPLOADS)).toBeNull();
  });

  it("reads hosts case-insensitively and with default ports", () => {
    expect(mediaPath("HTTPS://CMS.EXAMPLE/wp-content/uploads/A.jpg", UPLOADS)).toBe(
      "/media/A.jpg",
    );
    expect(mediaPath("https://cms.example:443/wp-content/uploads/a.jpg", UPLOADS)).toBe(
      "/media/a.jpg",
    );
    expect(mediaPath("https://cms.example:8443/wp-content/uploads/a.jpg", UPLOADS)).toBeNull();
  });

  it("returns null for lookalike hosts", () => {
    for (const src of [
      "https://cms.example.evil/wp-content/uploads/a.jpg",
      "https://evilcms.example/wp-content/uploads/a.jpg",
      "https://cms.example@evil.example/wp-content/uploads/a.jpg",
    ]) {
      expect(mediaPath(src, UPLOADS)).toBeNull();
    }
  });

  it("returns null for javascript:, data: and other schemes", () => {
    for (const src of [
      "javascript:alert(1)",
      "javascript://cms.example/wp-content/uploads/a.jpg",
      "data:image/png;base64,AAAA",
      "blob:https://cms.example/1",
      "ftp://cms.example/wp-content/uploads/a.jpg",
    ]) {
      expect(mediaPath(src, UPLOADS)).toBeNull();
    }
  });

  it("returns null outside the uploads directory", () => {
    for (const src of [
      "https://cms.example/wp-content/themes/x/a.jpg",
      "https://cms.example/wp-content/uploads-old/a.jpg",
      "https://cms.example/wp-content/uploads",
      "https://cms.example/wp-content/uploads/",
      "https://cms.example/wp-content/uploads//a.jpg",
      "https://cms.example/WP-CONTENT/uploads/a.jpg",
      "/media/a.jpg",
      "a.jpg",
      "",
    ]) {
      expect(mediaPath(src, UPLOADS), src).toBeNull();
    }
  });

  it("returns null for paths that climb out of the uploads directory", () => {
    for (const src of [
      "https://cms.example/wp-content/uploads/../../wp-config.php",
      "https://cms.example/wp-content/uploads/%2e%2e/%2E%2E/wp-config.php",
      "https://cms.example/wp-content/uploads/..%2f..%2fwp-config.php",
      "https://cms.example/wp-content/uploads/..%5C..%5Cwp-config.php",
      "/wp-content/uploads/../wp-config.php",
    ]) {
      expect(mediaPath(src, UPLOADS), src).toBeNull();
    }
  });

  it("throws on an uploads base that is not http(s)", () => {
    expect(() => mediaPath("/wp-content/uploads/a.jpg", "/wp-content/uploads")).toThrow(TypeError);
  });
});

describe("rewriteSrcset", () => {
  it("rewrites every uploads candidate and keeps the descriptors", () => {
    expect(
      rewriteSrcset(
        "https://cms.example/wp-content/uploads/a-300x200.jpg 300w, https://cms.example/wp-content/uploads/a-768x512.jpg 768w, https://cms.example/wp-content/uploads/a.jpg 1024w",
        UPLOADS,
      ),
    ).toBe("/media/a-300x200.jpg 300w, /media/a-768x512.jpg 768w, /media/a.jpg 1024w");
  });

  it("handles density descriptors, no descriptor and messy whitespace", () => {
    expect(
      rewriteSrcset(
        "  //cms.example/wp-content/uploads/a.jpg,\n\thttps://cms.example/wp-content/uploads/a@2x.jpg   2x  ",
        UPLOADS,
      ),
    ).toBe("/media/a.jpg, /media/a@2x.jpg 2x");
  });

  it("keeps commas inside a URL", () => {
    expect(
      rewriteSrcset(
        "https://cms.example/wp-content/uploads/a.jpg?crop=0,0,10,10 1x,https://cms.example/wp-content/uploads/b.jpg 2x",
        UPLOADS,
      ),
    ).toBe("/media/a.jpg 1x, /media/b.jpg 2x");
    expect(
      rewriteSrcset(
        "https://cms.example/wp-content/uploads/a,b.jpg 1x,https://cms.example/wp-content/uploads/c.jpg 2x",
        UPLOADS,
      ),
    ).toBe("/media/a,b.jpg 1x, /media/c.jpg 2x");
  });

  it("drops the query from every uploads candidate and keeps it on the others", () => {
    expect(
      rewriteSrcset(
        "https://cms.example/wp-content/uploads/a.jpg?ver=1 1x, https://other.example/b.jpg?ver=2 2x",
        UPLOADS,
      ),
    ).toBe("/media/a.jpg 1x, https://other.example/b.jpg?ver=2 2x");
  });

  it("leaves candidates that are not uploads as they were", () => {
    expect(
      rewriteSrcset(
        "https://other.example/a.jpg 1x, https://cms.example/wp-content/uploads/b.jpg 2x, javascript:alert(1) 3x, https://cms.example.evil/wp-content/uploads/c.jpg 4x",
        UPLOADS,
      ),
    ).toBe(
      "https://other.example/a.jpg 1x, /media/b.jpg 2x, javascript:alert(1) 3x, https://cms.example.evil/wp-content/uploads/c.jpg 4x",
    );
  });

  it("returns an empty string for an empty srcset", () => {
    expect(rewriteSrcset("", UPLOADS)).toBe("");
    expect(rewriteSrcset(" , ,", UPLOADS)).toBe("");
  });
});
