import { describe, expect, it } from "vitest";

import { sourceLink } from "../lib/source-link";
import type { CmsUrls } from "../lib/urls";

const CMS: CmsUrls = {
  cmsOrigins: ["https://cms.example"],
  uploadsBase: "https://cms.example/wp-content/uploads",
};

describe("sourceLink", () => {
  it("gives nothing for an empty or blank value", () => {
    expect(sourceLink("", CMS)).toBeNull();
    expect(sourceLink("   ", CMS)).toBeNull();
  });

  it("links to another site by its host, marked external", () => {
    expect(sourceLink("https://example.com/downloads/report.pdf?v=2", CMS)).toEqual({
      href: "https://example.com/downloads/report.pdf?v=2",
      label: "example.com",
      external: true,
    });
    expect(sourceLink("http://docs.example.org/", CMS)?.label).toBe("docs.example.org");
  });

  it("shows an internationalised host in its ASCII (punycode) form, so a look-alike cannot pass for a Latin name", () => {
    expect(sourceLink("https://xn--mnchen-3ya.example/report", CMS)?.label).toBe("xn--mnchen-3ya.example");
    expect(sourceLink("https://münchen.example/report", CMS)?.label).toBe("xn--mnchen-3ya.example");
    // A Cyrillic "а" (U+0430) in place of the Latin "a".
    expect(sourceLink("https://\u0430pple.example/", CMS)).toEqual({
      href: "https://\u0430pple.example/",
      label: "xn--pple-43d.example",
      external: true,
    });
  });

  it("keeps a port that is not the scheme's default in the label", () => {
    expect(sourceLink("https://example.com:8443/report.pdf", CMS)?.label).toBe("example.com:8443");
    expect(sourceLink("http://example.com:8080/", CMS)?.label).toBe("example.com:8080");
    expect(sourceLink("https://example.com:443/report.pdf", CMS)?.label).toBe("example.com");
    expect(sourceLink("http://example.com:80/", CMS)?.label).toBe("example.com");
  });

  it("drops a trailing dot from the label", () => {
    expect(sourceLink("https://example.com./report.pdf", CMS)?.label).toBe("example.com");
  });

  it("gives nothing for a URL with userinfo, which can pose as a host", () => {
    for (const url of [
      "https://example.com@evil.example/",
      "https://user:pass@example.com/report.pdf",
      "https://cms.example@evil.example/resources/",
      "https://user@cms.example/resources/webinar/example/",
    ]) {
      expect(sourceLink(url, CMS), url).toBeNull();
    }
  });

  it("maps an upload on the CMS to /media/ and labels it with the file name", () => {
    expect(sourceLink("https://cms.example/wp-content/uploads/2026/11/field%20guide.pdf", CMS)).toEqual({
      href: "/media/2026/11/field%20guide.pdf",
      label: "field guide.pdf",
      external: false,
    });
  });

  it("makes a CMS link to a resource root-relative", () => {
    expect(sourceLink("https://cms.example/resources/webinar/example/", CMS)).toEqual({
      href: "/resources/webinar/example/",
      label: "/resources/webinar/example/",
      external: false,
    });
  });

  it("adds the trailing slash a public URL has, so the click costs no 308", () => {
    expect(sourceLink("https://cms.example/resources", CMS)).toEqual({ href: "/resources/", label: "/resources/", external: false });
    expect(sourceLink("https://cms.example/resources/webinar/example", CMS)?.href).toBe("/resources/webinar/example/");
    expect(sourceLink("https://cms.example/resources?x=1#top", CMS)?.href).toBe("/resources/?x=1#top");
    expect(sourceLink("https://cms.example/resources/webinar/example/#notes", CMS)?.href).toBe("/resources/webinar/example/#notes");
  });

  it("recognises the CMS whatever the case or a trailing dot on its host", () => {
    expect(sourceLink("HTTPS://CMS.EXAMPLE/resources/webinar/example/", CMS)?.href).toBe("/resources/webinar/example/");
    expect(sourceLink("https://cms.example./resources/webinar/example/", CMS)?.href).toBe("/resources/webinar/example/");
    expect(sourceLink("https://CMS.Example./wp-content/uploads/a.pdf", CMS)?.href).toBe("/media/a.pdf");
    expect(sourceLink("HTTPS://CMS.EXAMPLE/wp-admin/", CMS)).toBeNull();
    expect(sourceLink("https://cms.example./some-theme-page/", CMS)).toBeNull();
  });

  it("gives nothing for a CMS URL the front end does not serve", () => {
    for (const url of [
      "https://cms.example/wp-admin/",
      "https://cms.example/wp-login.php",
      "https://cms.example/?p=12",
      "https://cms.example/some-theme-page/",
      "https://cms.example/wp-json/wp/v2/resources/12",
    ]) {
      expect(sourceLink(url, CMS), url).toBeNull();
    }
  });

  it("gives nothing for a URL that still names a CMS host after the rewrite", () => {
    // Another port is not the configured origin, so `rewriteHref` leaves it; it still names the CMS.
    expect(sourceLink("https://cms.example:8443/report.pdf", CMS)).toBeNull();
    expect(sourceLink("http://cms.example./report.pdf", CMS)).toBeNull();
  });

  it("gives nothing for a scheme other than http(s)", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:application/pdf;base64,JVBERi0=",
      "mailto:someone@example.com",
      "ftp://example.com/x",
      "not a url",
    ]) {
      expect(sourceLink(url, CMS), url).toBeNull();
    }
  });

  it("gives nothing for a protocol-relative URL, to the CMS or elsewhere", () => {
    for (const url of ["//example.com/report.pdf", "//cms.example/resources/", "//cms.example/wp-content/uploads/a.pdf", "\\\\example.com/x"]) {
      expect(sourceLink(url, CMS), url).toBeNull();
    }
  });

  it("honours a separate media origin", () => {
    const cms: CmsUrls = { cmsOrigins: ["https://cms.example", "https://media.example"], uploadsBase: "https://media.example/wp-content/uploads" };
    expect(sourceLink("https://media.example/wp-content/uploads/a.pdf", cms)?.href).toBe("/media/a.pdf");
    expect(sourceLink("https://media.example/other/a.pdf", cms)).toBeNull();
  });
});
