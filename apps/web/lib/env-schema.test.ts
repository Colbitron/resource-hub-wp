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
});

describe("parseMediaOrigin", () => {
  it("defaults to the origin of WP_API_URL", () => {
    expect(parseMediaOrigin({ WP_API_URL: "https://cms.example:8443/wp-json" })).toBe(
      "https://cms.example:8443",
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

  it("rejects a WP_MEDIA_ORIGIN with a path", () => {
    expect(() =>
      parseMediaOrigin({ WP_MEDIA_ORIGIN: "https://cms.example/wp-content/uploads" }),
    ).toThrow(/^WP_MEDIA_ORIGIN must be an origin only/);
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
