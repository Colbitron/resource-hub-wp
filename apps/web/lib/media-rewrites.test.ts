import { describe, expect, it, vi } from "vitest";

import { EnvError } from "./env-schema";
import { mediaRewrites } from "./media-rewrites";

describe("mediaRewrites", () => {
  it("maps /media/ one to one onto the uploads directory of WP_API_URL's site", () => {
    expect(mediaRewrites({ WP_API_URL: "https://cms.example/wp-json" })).toEqual([
      {
        source: "/media/:path*",
        destination: "https://cms.example/wp-content/uploads/:path*",
      },
    ]);
  });

  it("keeps a subdirectory install's path from WP_API_URL", () => {
    expect(mediaRewrites({ WP_API_URL: "https://example.com/blog/wp-json/" })).toEqual([
      {
        source: "/media/:path*",
        destination: "https://example.com/blog/wp-content/uploads/:path*",
      },
    ]);
  });

  it("prefers WP_MEDIA_ORIGIN, path included", () => {
    expect(
      mediaRewrites({
        WP_API_URL: "https://cms.example/wp-json",
        WP_MEDIA_ORIGIN: "https://media.example/wp/",
      }),
    ).toEqual([
      {
        source: "/media/:path*",
        destination: "https://media.example/wp/wp-content/uploads/:path*",
      },
    ]);
  });

  it("leaves the rewrite out with a warning when unset outside Vercel", () => {
    const warn = vi.fn();
    expect(mediaRewrites({ WP_API_URL: "", WP_MEDIA_ORIGIN: "" }, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/\/media\/ is not rewritten/);
  });

  it("throws on a Vercel build when no base can be derived", () => {
    const warn = vi.fn();
    expect(() => mediaRewrites({ VERCEL: "1" }, warn)).toThrow(EnvError);
    expect(() => mediaRewrites({ VERCEL: "1" }, warn)).toThrow(
      /^WP_API_URL is not set, so \/media\/ cannot be rewritten/,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("builds the rewrite on Vercel when WP_API_URL is set", () => {
    expect(
      mediaRewrites({ VERCEL: "1", WP_API_URL: "https://cms.example/wp-json" }),
    ).toHaveLength(1);
  });

  it("throws on a malformed value, on Vercel or not", () => {
    expect(() => mediaRewrites({ WP_API_URL: "https://cms.example/" })).toThrow(EnvError);
    expect(() => mediaRewrites({ VERCEL: "1", WP_MEDIA_ORIGIN: "nope" })).toThrow(EnvError);
  });
});
