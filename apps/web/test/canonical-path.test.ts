import { describe, expect, it } from "vitest";

import { canonicalResourcesPath, isResourcesPath } from "../lib/canonical-path";
import { canonicalSlug, listingPath, resourcePath } from "../lib/routes";

describe("isResourcesPath", () => {
  it("is /resources and anything under it, in any case", () => {
    expect(isResourcesPath("/resources")).toBe(true);
    expect(isResourcesPath("/resources/")).toBe(true);
    expect(isResourcesPath("/resources/webinar/")).toBe(true);
    expect(isResourcesPath("/Resources/")).toBe(true);
    expect(isResourcesPath("/RESOURCES")).toBe(true);
  });

  it("is not another path that starts the same way", () => {
    expect(isResourcesPath("/resourcesx/")).toBe(false);
    expect(isResourcesPath("/resource/")).toBe(false);
    expect(isResourcesPath("/")).toBe(false);
    expect(isResourcesPath("/api/revalidate/")).toBe(false);
  });
});

describe("canonicalResourcesPath", () => {
  it("is null for a path outside /resources", () => {
    expect(canonicalResourcesPath("/")).toBeNull();
    expect(canonicalResourcesPath("/About/page/1/")).toBeNull();
    expect(canonicalResourcesPath("/resourcesX/")).toBeNull();
  });

  it("is null for a canonical listing or resource path", () => {
    for (const path of [
      "/resources/",
      "/resources/page/2/",
      "/resources/webinar/",
      "/resources/webinar/page/12/",
      "/resources/topic/accessibility/",
      "/resources/topic/accessibility/page/2/",
      "/resources/webinar/topic/accessibility/",
      "/resources/webinar/topic/accessibility/page/3/",
      "/resources/webinar/alt-text-at-scale/",
      "/resources/topic/%e6%97%a5/",
    ]) {
      expect(canonicalResourcesPath(path), path).toBeNull();
    }
  });

  it("lower-cases ASCII letters in every segment, resources included", () => {
    expect(canonicalResourcesPath("/resources/Webinar/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/Resources/")).toBe("/resources/");
    expect(canonicalResourcesPath("/resources/Topic/Accessibility/")).toBe("/resources/topic/accessibility/");
    expect(canonicalResourcesPath("/resources/WEBINAR/Alt-Text-At-Scale/")).toBe("/resources/webinar/alt-text-at-scale/");
    expect(canonicalResourcesPath("/resources/webinar/Page/2/")).toBe("/resources/webinar/page/2/");
  });

  it("leaves percent escapes as sent, their hex case included", () => {
    expect(canonicalResourcesPath("/resources/topic/%E6%97%A5/")).toBeNull();
    expect(canonicalResourcesPath("/resources/topic/%e6%97%A5/")).toBeNull();
    expect(canonicalResourcesPath("/resources/Topic/%E6%97%A5/")).toBe("/resources/topic/%E6%97%A5/");
    expect(canonicalResourcesPath("/resources/topic/a%20B/")).toBe("/resources/topic/a%20b/");
    expect(canonicalResourcesPath("/resources/topic/%2F/")).toBeNull();
  });

  it("decodes an escape of an unreserved character, as Next.js would, and then lower-cases it", () => {
    expect(canonicalResourcesPath("/resources/%57ebinar/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/%77ebinar/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/case%2Dstudy/")).toBe("/resources/case-study/");
    expect(canonicalResourcesPath("/resources/a%7Eb/")).toBe("/resources/a~b/");
  });

  it("does not decode an escape twice", () => {
    // `%25` is a literal `%`, so `%2541` is `%41` once decoded, never `A`.
    expect(canonicalResourcesPath("/resources/%2541/")).toBeNull();
  });

  it("drops a trailing /page/1/ from any listing", () => {
    expect(canonicalResourcesPath("/resources/page/1/")).toBe("/resources/");
    expect(canonicalResourcesPath("/resources/webinar/page/1/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/resources/topic/accessibility/page/1/")).toBe("/resources/topic/accessibility/");
    expect(canonicalResourcesPath("/resources/webinar/topic/accessibility/page/1/")).toBe(
      "/resources/webinar/topic/accessibility/",
    );
  });

  it("applies both rules in one step", () => {
    expect(canonicalResourcesPath("/resources/Webinar/Page/1/")).toBe("/resources/webinar/");
    expect(canonicalResourcesPath("/Resources/Topic/A11y/PAGE/1/")).toBe("/resources/topic/a11y/");
  });

  it("leaves other page segments to the route, which answers 404", () => {
    for (const path of ["/resources/page/0/", "/resources/page/01/", "/resources/page/1.5/", "/resources/page/x/", "/resources/page/-1/"]) {
      expect(canonicalResourcesPath(path), path).toBeNull();
    }
    expect(canonicalResourcesPath("/resources/page/")).toBeNull();
    expect(canonicalResourcesPath("/resources/topic/")).toBeNull();
  });

  it("keeps the trailing slash as given", () => {
    expect(canonicalResourcesPath("/resources/Webinar")).toBe("/resources/webinar");
    expect(canonicalResourcesPath("/Resources")).toBe("/resources");
  });

  it("is idempotent: a canonical result is canonical", () => {
    for (const path of [
      "/resources/Webinar/Page/1/",
      "/resources/%57ebinar/Topic/A%20B/",
      "/Resources/Topic/%E6%97%A5/page/1/",
      "/resources/case%2Dstudy/Slug%2Dhere/",
    ]) {
      const canonical = canonicalResourcesPath(path);
      expect(canonical, path).not.toBeNull();
      expect(canonicalResourcesPath(canonical as string), path).toBeNull();
    }
  });

  it("agrees with the path builders: every built path is canonical", () => {
    const slugs = ["webinar", "case-study", "日", "%e6%97%a5", "a-b_c.d~e", "x!$&'()*+,;=:@y"];
    for (const type of ["webinar", "case-study"]) {
      for (const slug of slugs) {
        expect(canonicalResourcesPath(resourcePath(type, slug))).toBeNull();
        expect(canonicalResourcesPath(listingPath({ type, topic: slug }, 2))).toBeNull();
        expect(canonicalResourcesPath(listingPath({ topic: slug }))).toBeNull();
      }
    }
    // And a slug upper-cased in a URL comes back to its canonical form.
    for (const slug of ["Webinar", "Case-Study", "%E6%97%A5"]) {
      const path = `/resources/topic/${slug}/`;
      const expected = `/resources/topic/${canonicalSlug(slug)}/`;
      const canonical = canonicalResourcesPath(path) ?? path;
      // Hex case is left alone by the proxy and ignored by the page, so compare without it.
      expect(canonical.toLowerCase()).toBe(expected);
    }
  });
});
