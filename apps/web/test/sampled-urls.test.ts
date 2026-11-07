import { describe, expect, it } from "vitest";

import { SAMPLED_URLS } from "../e2e/sampled-urls.mts";

// The flags on the sampled URLs (e2e/sampled-urls.mts). The document-size
// guard (e2e/document-size.spec.ts) checks only the URLs flagged `imageLed`,
// so a flag lost in an edit would drop a page from it without any test failing.

describe("SAMPLED_URLS", () => {
  it("flags exactly the three pages Lighthouse measures as image-led", () => {
    // The set, not the order: reordering SAMPLED_URLS changes nothing here.
    const imageLed = SAMPLED_URLS.filter((sample) => sample.imageLed)
      .map((sample) => sample.path)
      .toSorted();
    expect(imageLed).toEqual(["/resources/", "/resources/article/taxonomies-versus-meta/", "/welcome/"]);
  });
});
