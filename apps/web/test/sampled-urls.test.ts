import { describe, expect, it } from "vitest";

import { SAMPLED_URLS } from "../e2e/sampled-urls.mts";

// The flags on the sampled URLs (e2e/sampled-urls.mts). The document-size
// guards (e2e/document-size.spec.ts) check only the URLs flagged `imageLed`,
// less the ones each exempts, so a flag lost or added in an edit would change
// what they check without any test failing.

describe("SAMPLED_URLS", () => {
  it("flags exactly the three pages Lighthouse measures as image-led", () => {
    // The set, not the order: reordering SAMPLED_URLS changes nothing here.
    const imageLed = SAMPLED_URLS.filter((sample) => sample.imageLed)
      .map((sample) => sample.path)
      .toSorted();
    expect(imageLed).toEqual(["/resources/", "/resources/article/taxonomies-versus-meta/", "/welcome/"]);
  });

  it("exempts only the resource page from the whole-document check and only the CMS page from the discovery check", () => {
    // An exemption from the whole-document check is the owner's decision
    // (e2e/document-size.spec.ts's docblock); the change that makes one
    // updates this list with it. The resource page's is the owner's of
    // 2026-11-08, for its related section.
    const exempt = (key: "wholeDocumentGuard" | "discoveryGuard") =>
      SAMPLED_URLS.filter((sample) => sample[key] === false).map((sample) => sample.path);
    expect(exempt("wholeDocumentGuard")).toEqual(["/resources/article/taxonomies-versus-meta/"]);
    expect(exempt("discoveryGuard")).toEqual(["/welcome/"]);
  });
});
