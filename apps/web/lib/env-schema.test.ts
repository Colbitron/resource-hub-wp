import { describe, expect, it } from "vitest";

import {
  EnvError,
  MIN_SECRET_LENGTH,
  optionalMediaOrigin,
  parseMediaOrigin,
  parseRevalidateSecret,
  parseWpApiUrl,
  SecretError,
  secretProblem,
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

  it("rejects an empty path segment, which would leave a base ending in /", () => {
    for (const value of ["https://cms.example//wp-json", "https://example.com/blog//wp-json"]) {
      expect(() => parseWpApiUrl({ WP_API_URL: value })).toThrow(
        /^WP_API_URL must not contain an empty path segment \(\/\/\)\./,
      );
      expect(() => parseMediaOrigin({ WP_API_URL: value })).toThrow(EnvError);
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

  it("drops a trailing slash from WP_MEDIA_ORIGIN, so the base never ends in /", () => {
    for (const [value, base] of [
      ["https://media.example/", "https://media.example"],
      ["https://example.com/blog/", "https://example.com/blog"],
    ]) {
      const result = parseMediaOrigin({ WP_MEDIA_ORIGIN: value });
      expect(result).toBe(base);
      expect(result.endsWith("/")).toBe(false);
    }
  });

  it("rejects a WP_MEDIA_ORIGIN with an empty path segment", () => {
    for (const value of ["https://cms.example//blog", "https://example.com/blog//"]) {
      expect(() => parseMediaOrigin({ WP_MEDIA_ORIGIN: value })).toThrow(
        /^WP_MEDIA_ORIGIN must not contain an empty path segment \(\/\/\)\./,
      );
    }
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
  const GOOD = "0123456789abcdefghijklmnopqrstuv"; // 32 characters

  it("returns a secret of 32 printable ASCII characters unchanged", () => {
    expect(GOOD).toHaveLength(MIN_SECRET_LENGTH);
    expect(parseRevalidateSecret({ REVALIDATE_SECRET: GOOD })).toBe(GOOD);
    const everyCharacter = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
    expect(parseRevalidateSecret({ REVALIDATE_SECRET: everyCharacter })).toBe(everyCharacter);
  });

  it("refuses a secret shorter than 32 characters, without echoing it", () => {
    for (const value of ["#!", "~".repeat(31)]) {
      const thrown = (() => {
        try {
          parseRevalidateSecret({ REVALIDATE_SECRET: value });
        } catch (caught) {
          return caught;
        }
        return undefined;
      })();
      expect(thrown).toBeInstanceOf(SecretError);
      expect(thrown).toBeInstanceOf(EnvError);
      expect((thrown as SecretError).problem).toBe("too-short");
      expect((thrown as Error).message).toMatch(/^REVALIDATE_SECRET must be at least 32 characters long\./);
      expect((thrown as Error).message).not.toContain(value);
    }
  });

  it.each([
    ["a trailing newline", `${GOOD}\n`],
    ["a trailing carriage return and newline", `${GOOD}\r\n`],
    ["a leading space", ` ${GOOD}`],
    ["a space inside", `${GOOD.slice(0, 16)} ${GOOD.slice(16)}`],
    ["a tab", `${GOOD}\t`],
    ["a non-ASCII letter", `${GOOD}é`],
    ["a non-breaking space", `${GOOD}\u00a0`],
    ["a control character", `${GOOD}\u0000`],
    ["DEL", `${GOOD}\u007f`],
    ["whitespace only", " ".repeat(40)],
  ])("refuses a secret with %s, without echoing it", (_name, value) => {
    expect(() => parseRevalidateSecret({ REVALIDATE_SECRET: value })).toThrow(
      /^REVALIDATE_SECRET must be printable ASCII with no whitespace, because a bearer token cannot carry anything else\./,
    );
    try {
      parseRevalidateSecret({ REVALIDATE_SECRET: value });
    } catch (caught) {
      expect((caught as SecretError).problem).toBe("bad-characters");
      expect((caught as Error).message).not.toContain(GOOD);
    }
  });

  it("reports the characters before the length", () => {
    expect(secretProblem("short\n")).toBe("bad-characters");
    expect(secretProblem("short")).toBe("too-short");
    expect(secretProblem(GOOD)).toBeNull();
  });

  it("names the variable when it is missing or empty", () => {
    expect(() => parseRevalidateSecret({})).toThrow(/^REVALIDATE_SECRET is not set\./);
    expect(() => parseRevalidateSecret({ REVALIDATE_SECRET: "" })).toThrow(EnvError);
  });
});
