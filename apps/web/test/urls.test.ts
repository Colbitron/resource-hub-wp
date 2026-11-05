import { describe, expect, it } from "vitest";

import { mediaPath, rewriteSrcset, stripCmsOrigin } from "../lib/urls";

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

describe("mediaPath", () => {
  it("maps an uploads URL to /media/, keeping the query and hash", () => {
    expect(mediaPath("https://cms.example/wp-content/uploads/2026/11/photo.jpg", UPLOADS)).toBe(
      "/media/2026/11/photo.jpg",
    );
    expect(mediaPath("https://cms.example/wp-content/uploads/a.jpg?ver=2#x", UPLOADS)).toBe(
      "/media/a.jpg?ver=2#x",
    );
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
    ).toBe("/media/a.jpg?crop=0,0,10,10 1x, /media/b.jpg 2x");
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
