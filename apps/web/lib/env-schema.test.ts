import { describe, expect, it } from "vitest";

import {
  EnvError,
  optionalMediaOrigin,
  parseMediaOrigin,
  parseRevalidateSecret,
  parseWpApiUrl,
} from "./env-schema";

describe("parseWpApiUrl", () => {
  it("returns the base without a trailing slash", () => {
    expect(parseWpApiUrl({ WP_API_URL: "http://localhost:8888/wp-json/" })).toBe(
      "http://localhost:8888/wp-json",
    );
  });

  it("names the variable when it is missing or empty", () => {
    expect(() => parseWpApiUrl({})).toThrow(EnvError);
    expect(() => parseWpApiUrl({ WP_API_URL: "" })).toThrow(/^WP_API_URL is not set\./);
  });

  it("rejects a value that is not an http or https URL", () => {
    expect(() => parseWpApiUrl({ WP_API_URL: "localhost:8888/wp-json" })).toThrow(
      /^WP_API_URL must be an absolute http or https URL/,
    );
    expect(() => parseWpApiUrl({ WP_API_URL: "ftp://cms.example/wp-json" })).toThrow(EnvError);
  });

  it("keeps a subdirectory install's path", () => {
    expect(parseWpApiUrl({ WP_API_URL: "https://example.com/blog/wp-json" })).toBe(
      "https://example.com/blog/wp-json",
    );
  });

  it("rejects a URL whose path is not the /wp-json base", () => {
    for (const value of [
      "https://cms.example",
      "https://cms.example/",
      "https://cms.example/wp-json/wp/v2",
      "https://cms.example/not-wp-json",
    ]) {
      expect(() => parseWpApiUrl({ WP_API_URL: value })).toThrow(
        /^WP_API_URL must be the REST API base, ending in \/wp-json\./,
      );
    }
  });

  it("rejects a query string or fragment", () => {
    for (const value of [
      "https://cms.example/wp-json?rest_route=/",
      "https://cms.example/wp-json#top",
    ]) {
      expect(() => parseWpApiUrl({ WP_API_URL: value })).toThrow(
        /^WP_API_URL must not have a query string or fragment\./,
      );
    }
  });

  it("rejects embedded credentials without echoing them", () => {
    for (const value of [
      "https://editor:hunter2@cms.example/wp-json",
      "https://editor@cms.example/wp-json",
    ]) {
      let message = "";
      try {
        parseWpApiUrl({ WP_API_URL: value });
      } catch (error) {
        expect(error).toBeInstanceOf(EnvError);
        message = (error as Error).message;
      }
      expect(message).toMatch(/^WP_API_URL must not contain a user name or password\./);
      expect(message).not.toContain("editor");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("cms.example");
    }
  });
});

describe("parseMediaOrigin", () => {
  it("defaults to WP_API_URL without /wp-json", () => {
    expect(parseMediaOrigin({ WP_API_URL: "https://cms.example:8443/wp-json" })).toBe(
      "https://cms.example:8443",
    );
  });

  it("keeps a subdirectory install's path from WP_API_URL", () => {
    expect(parseMediaOrigin({ WP_API_URL: "https://example.com/blog/wp-json/" })).toBe(
      "https://example.com/blog",
    );
  });

  it("prefers WP_MEDIA_ORIGIN, without requiring WP_API_URL", () => {
    expect(parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://media.example/" })).toBe(
      "https://media.example",
    );
  });

  it("treats an empty WP_MEDIA_ORIGIN as unset", () => {
    expect(
      parseMediaOrigin({ WP_MEDIA_ORIGIN: "", WP_API_URL: "https://cms.example/wp-json" }),
    ).toBe("https://cms.example");
  });

  it("accepts a WP_MEDIA_ORIGIN with the install path", () => {
    expect(parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://example.com/blog/" })).toBe(
      "https://example.com/blog",
    );
  });

  it("rejects a WP_MEDIA_ORIGIN that already names the uploads directory", () => {
    expect(() =>
      parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://cms.example/wp-content/uploads" }),
    ).toThrow(/^WP_MEDIA_ORIGIN must be the site's base URL, without \/wp-content\/uploads\./);
  });

  it("rejects a WP_MEDIA_ORIGIN with a query, fragment or credentials", () => {
    expect(() => parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://media.example/?v=1" })).toThrow(
      /^WP_MEDIA_ORIGIN must not have a query string or fragment\./,
    );
    expect(() => parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://media.example/#x" })).toThrow(
      /^WP_MEDIA_ORIGIN must not have a query string or fragment\./,
    );
    expect(() =>
      parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://user:secret@media.example" }),
    ).toThrow(/^WP_MEDIA_ORIGIN must not contain a user name or password\.(?!.*secret)/);
  });
});

describe("optionalMediaOrigin", () => {
  it("is undefined when neither variable is set", () => {
    expect(optionalMediaOrigin({ WP_API_URL: "", WP_MEDIA_ORIGIN: "" })).toBeUndefined();
  });

  it("still throws on a value that is set but malformed", () => {
    expect(() => optionalMediaOrigin({ WP_API_URL: "not a url" })).toThrow(EnvError);
  });
});

describe("parseRevalidateSecret", () => {
  it("returns the secret unchanged", () => {
    expect(parseRevalidateSecret({ REVALIDATE_SECRET: " s3cret " })).toBe(" s3cret ");
  });

  it("names the variable when it is missing or empty", () => {
    expect(() => parseRevalidateSecret({})).toThrow(/^REVALIDATE_SECRET is not set\./);
    expect(() => parseRevalidateSecret({ REVALIDATE_SECRET: "" })).toThrow(EnvError);
  });
});
