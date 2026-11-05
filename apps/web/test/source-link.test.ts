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

  it("shows an internationalised host in Unicode", () => {
    expect(sourceLink("https://xn--mnchen-3ya.example/report", CMS)?.label).toBe("münchen.example");
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
    for (const url of ["javascript:alert(1)", "mailto:someone@example.com", "ftp://example.com/x", "not a url"]) {
      expect(sourceLink(url, CMS), url).toBeNull();
    }
  });

  it("honours a separate media origin", () => {
    const cms: CmsUrls = { cmsOrigins: ["https://cms.example", "https://media.example"], uploadsBase: "https://media.example/wp-content/uploads" };
    expect(sourceLink("https://media.example/wp-content/uploads/a.pdf", cms)?.href).toBe("/media/a.pdf");
    expect(sourceLink("https://media.example/other/a.pdf", cms)).toBeNull();
  });
});
