import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The revalidate route's request handling: auth, the body checks, every
 * error body, and what a good batch revalidates. `next/cache` is replaced
 * with spies, so the test shows exactly which tags and paths the route
 * clears and with which profile. The route reads `REVALIDATE_SECRET` through
 * `lib/env.ts` at request time, so each test sets `process.env` directly.
 */

const revalidateTag = vi.fn<(tag: string, profile: unknown) => void>();
const revalidatePath = vi.fn<(path: string) => void>();

vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }));

const { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } = await import("../app/api/revalidate/route");

const URL_WITH_SLASH = "http://localhost:3000/api/revalidate/";
const SECRET = "a-long-random-secret-for-the-tests";

interface RequestOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
  readonly duplex?: "half";
}

/** A request with a good bearer and content type unless the options say otherwise. */
function request(options: RequestOptions = {}): Request {
  const headers = new Headers({
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  });
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === "") {
      headers.delete(name);
    } else {
      headers.set(name, value);
    }
  }
  const init: RequestInit & { duplex?: "half" } = {
    method: options.method ?? "POST",
    headers,
    body: options.body ?? null,
  };
  if (options.duplex !== undefined) {
    init.duplex = options.duplex;
  }
  return new Request(URL_WITH_SLASH, init);
}

function resourceUpdate(overrides: Record<string, unknown> = {}) {
  return {
    type: "resource",
    event: "update",
    id: 123,
    slug: "example",
    rest_url: "https://cms.example/wp-json/wp/v2/resources/123",
    types: ["webinar"],
    topics: ["performance"],
    previous: { slug: "old-example", types: ["webinar"], topics: ["accessibility"] },
    ...overrides,
  };
}

function batch(events: unknown[], version: unknown = 1): string {
  return JSON.stringify({ version, events });
}

async function expectError(response: Response, status: number, message: string | RegExp) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  const body = (await response.json()) as { error?: unknown };
  expect(Object.keys(body)).toEqual(["error"]);
  if (typeof message === "string") {
    expect(body.error).toBe(message);
  } else {
    expect(body.error).toMatch(message);
  }
}

beforeEach(() => {
  process.env.REVALIDATE_SECRET = SECRET;
  revalidateTag.mockReset();
  revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.REVALIDATE_SECRET;
  vi.restoreAllMocks();
});

describe("methods", () => {
  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
    ["PUT", PUT],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
    ["OPTIONS", OPTIONS],
  ])("%s is a 405 with Allow: POST and no-store", async (_name, handler) => {
    const response = await handler();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("the secret", () => {
  it("is a 500 when REVALIDATE_SECRET is missing, before auth, and never echoed", async () => {
    delete process.env.REVALIDATE_SECRET;
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    await expectError(response, 500, "The front end has no revalidation secret configured.");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("is a 500 when REVALIDATE_SECRET is empty", async () => {
    process.env.REVALIDATE_SECRET = "";
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    await expectError(response, 500, "The front end has no revalidation secret configured.");
  });
});

describe("auth", () => {
  const cases: [string, Record<string, string>][] = [
    ["a missing header", { Authorization: "" }],
    ["an empty header", { Authorization: " " }],
    ["the wrong scheme", { Authorization: `Basic ${SECRET}` }],
    ["no scheme", { Authorization: SECRET }],
    ["two spaces after the scheme", { Authorization: `Bearer  ${SECRET}` }],
    // No "trailing space" case: HTTP strips whitespace around a header value before it reaches the route.
    ["a space inside the token", { Authorization: `Bearer ${SECRET} x` }],
    ["an empty token", { Authorization: "Bearer " }],
    ["the scheme alone", { Authorization: "Bearer" }],
    ["a token differing in its last character", { Authorization: `Bearer ${SECRET.slice(0, -1)}X` }],
    ["a token that is a prefix of the secret", { Authorization: `Bearer ${SECRET.slice(0, -1)}` }],
    ["a token with the secret as a prefix", { Authorization: `Bearer ${SECRET}x` }],
    ["a very long token", { Authorization: `Bearer ${"x".repeat(100_000)}` }],
    ["the secret in another case", { Authorization: `Bearer ${SECRET.toUpperCase()}` }],
  ];

  it.each(cases)("%s is 401 unauthorized, exactly, and reads no body", async (_name, headers) => {
    const incoming = request({ headers, body: batch([resourceUpdate()]) });
    const response = await POST(incoming);
    await expectError(response, 401, "unauthorized");
    expect(incoming.bodyUsed).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("accepts the scheme in any case", async () => {
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      const response = await POST(
        request({ headers: { Authorization: `${scheme} ${SECRET}` }, body: batch([resourceUpdate()]) }),
      );
      expect(response.status, scheme).toBe(200);
    }
  });

  it("compares the secret byte for byte, never trimmed", async () => {
    process.env.REVALIDATE_SECRET = ` ${SECRET}`;
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    await expectError(response, 401, "unauthorized");
  });
});

describe("the content type", () => {
  it("is a 400 when missing or not application/json", async () => {
    for (const contentType of ["", "text/plain", "application/x-www-form-urlencoded", "application/jsonx"]) {
      const response = await POST(
        request({ headers: { "Content-Type": contentType }, body: batch([resourceUpdate()]) }),
      );
      await expectError(response, 400, "The request must be sent with Content-Type: application/json.");
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("allows parameters and any case on application/json", async () => {
    for (const contentType of ["application/json; charset=UTF-8", "Application/JSON", "application/json ;x=y"]) {
      const response = await POST(
        request({ headers: { "Content-Type": contentType }, body: batch([resourceUpdate()]) }),
      );
      expect(response.status, contentType).toBe(200);
    }
  });
});

describe("the body size cap", () => {
  const TOO_LARGE = "The body is larger than 64 KB, more than a batch of 25 events can be.";

  it("refuses a Content-Length over 64 KB before reading", async () => {
    const incoming = request({ headers: { "Content-Length": String(64 * 1024 + 1) }, body: "{}" });
    const response = await POST(incoming);
    await expectError(response, 400, TOO_LARGE);
    expect(incoming.bodyUsed).toBe(false);
  });

  it("refuses a Content-Length that is not a number", async () => {
    const response = await POST(request({ headers: { "Content-Length": "lots" }, body: "{}" }));
    await expectError(response, 400, TOO_LARGE);
  });

  it("stops reading a stream once it passes 64 KB, however long it goes on", async () => {
    let chunks = 0;
    const chunk = new Uint8Array(1024).fill(0x20);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(chunk);
      },
    });
    const response = await POST(request({ body: endless, duplex: "half" }));
    await expectError(response, 400, TOO_LARGE);
    // 64 chunks fill the cap; the 65th passes it; a few more may be pulled while cancelling.
    expect(chunks).toBeGreaterThanOrEqual(65);
    expect(chunks).toBeLessThan(80);
  });

  it("refuses a body of 64 KB plus one byte and accepts one of exactly 64 KB", async () => {
    // Padding inside a string value keeps the body valid JSON at any length.
    const pad = (total: number) => {
      const skeleton = batch([resourceUpdate({ topics: [] })]).replace('"topics":[]', '"topics":["PAD"]');
      const fixed = skeleton.replace("PAD", "").length;
      return skeleton.replace("PAD", "a".repeat(total - fixed));
    };
    const exact = pad(64 * 1024);
    expect(Buffer.byteLength(exact)).toBe(64 * 1024);
    expect((await POST(request({ body: exact }))).status).toBe(400); // a 65,000-character slug is no slug, but it is read
    const overBy = pad(64 * 1024 + 1);
    await expectError(await POST(request({ body: overBy })), 400, TOO_LARGE);
  });
});

describe("a malformed body", () => {
  it("is a 400 for JSON that does not parse", async () => {
    for (const body of ["", "{", "not json", '{"version": 1, "events": [}', "\u0000"]) {
      const response = await POST(request({ body }));
      await expectError(response, 400, "The body is not valid JSON.");
    }
  });

  it("is a 400 for bytes that are not UTF-8", async () => {
    const response = await POST(request({ body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }));
    await expectError(response, 400, "The body is not valid JSON.");
  });

  it("is a 400 for JSON that is not an object", async () => {
    for (const body of ["[]", "1", '"string"', "null", "true"]) {
      const response = await POST(request({ body }));
      await expectError(response, 400, "The body must be a JSON object with version and events.");
    }
  });
});

describe("version", () => {
  it("is a 400 when missing", async () => {
    const response = await POST(request({ body: JSON.stringify({ events: [resourceUpdate()] }) }));
    await expectError(response, 400, "The body has no version; this front end reads version 1.");
  });

  it("is a 400 for any version but 1, without echoing it", async () => {
    for (const version of [2, 0, "1", 1.5, null, { v: 1 }]) {
      const response = await POST(request({ body: batch([resourceUpdate()], version) }));
      await expectError(
        response,
        400,
        "The body's version is not one this front end understands; it reads version 1.",
      );
    }
  });
});

describe("the events array", () => {
  it("is a 400 when missing, not an array, empty or over 25", async () => {
    const missing = await POST(request({ body: JSON.stringify({ version: 1 }) }));
    await expectError(missing, 400, /^The body does not match the revalidation request: events /);

    const notArray = await POST(request({ body: JSON.stringify({ version: 1, events: {} }) }));
    await expectError(notArray, 400, /^The body does not match the revalidation request: events /);

    const empty = await POST(request({ body: batch([]) }));
    await expectError(
      empty,
      400,
      "The body does not match the revalidation request: events must contain at least one event.",
    );

    const twentySix = Array.from({ length: 26 }, (_, index) => resourceUpdate({ id: index + 1 }));
    const tooMany = await POST(request({ body: batch(twentySix) }));
    await expectError(
      tooMany,
      400,
      "The body does not match the revalidation request: events must contain at most 25 events.",
    );
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("accepts exactly 25", async () => {
    const twentyFive = Array.from({ length: 25 }, (_, index) => resourceUpdate({ id: index + 1 }));
    expect((await POST(request({ body: batch(twentyFive) }))).status).toBe(200);
  });
});

describe("schema failures", () => {
  it("name the first issue's path and never a value", async () => {
    const secretValue = "this-value-must-not-appear";
    const response = await POST(
      request({ body: batch([resourceUpdate({ slug: `${secretValue}/with-slash` })]) }),
    );
    const text = await response.clone().text();
    await expectError(
      response,
      400,
      "The body does not match the revalidation request: events[0].slug must not contain a slash or whitespace.",
    );
    expect(text).not.toContain(secretValue);
  });

  it.each([
    ["an unknown event name", { event: "archive", previous: null }, /events\[0\]/],
    ["an unknown event type", { type: "page" }, /events\[0\]/],
    ["a previous on publish", { event: "publish" }, /events\[0\]\.previous/],
    ["a reserved type slug", { types: ["topic"] }, /events\[0\]\.types\[0\] must not be "topic" or "page"/],
    ["two types", { types: ["webinar", "guide"] }, /events\[0\]\.types/],
    ["a duplicate topic", { topics: ["a", "a"] }, /events\[0\]\.topics must not list a topic twice/],
    ["a string id", { id: "123" }, /events\[0\]\.id/],
    ["a rest_url with the wrong scheme", { rest_url: "ftp://cms.example/x" }, /events\[0\]\.rest_url/],
    ["a previous missing its types", { previous: { slug: "x", topics: [] } }, /events\[0\]\.previous\.types/],
  ])("%s is a 400 naming the path", async (_name, overrides, pattern) => {
    const response = await POST(request({ body: batch([resourceUpdate(overrides)]) }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/^The body does not match the revalidation request: /);
    expect(body.error).toMatch(pattern);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an unknown term taxonomy and event", async () => {
    const term = {
      type: "term",
      taxonomy: "resource_flag",
      event: "update",
      id: 1,
      slug: "featured",
      name: "Featured",
      previous: { slug: "featured", name: "Featured" },
    };
    const taxonomy = await POST(request({ body: batch([term]) }));
    await expectError(taxonomy, 400, /events\[0\]\.taxonomy/);
    const event = await POST(
      request({ body: batch([{ ...term, taxonomy: "resource_topic", event: "rename" }]) }),
    );
    await expectError(event, 400, /events\[0\]/);
  });

  it("reports the second event's problem under its index", async () => {
    const response = await POST(
      request({ body: batch([resourceUpdate(), resourceUpdate({ id: 2, slug: "" })]) }),
    );
    await expectError(
      response,
      400,
      "The body does not match the revalidation request: events[1].slug must not be empty.",
    );
  });
});

describe("a good batch", () => {
  it("revalidates the union of both states as tags with { expire: 0 } and paths, and lists the paths", async () => {
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    const paths = [
      "/resources/",
      "/resources/topic/accessibility/",
      "/resources/topic/performance/",
      "/resources/webinar/",
      "/resources/webinar/example/",
      "/resources/webinar/old-example/",
      "/resources/webinar/topic/accessibility/",
      "/resources/webinar/topic/performance/",
    ];
    expect(body).toEqual({ revalidated: paths });

    expect(revalidateTag.mock.calls).toEqual(
      [
        "resource:example",
        "resource:old-example",
        "resources",
        "topic:accessibility",
        "topic:performance",
        "type:webinar",
      ].map((tag) => [tag, { expire: 0 }]),
    );
    expect(revalidatePath.mock.calls).toEqual(paths.map((path) => [path]));
  });

  it("handles a term event and a removal, and drops unknown keys without a 400", async () => {
    const events = [
      {
        type: "term",
        taxonomy: "resource_type",
        event: "update",
        id: 5,
        slug: "webinar",
        name: "Webinars",
        previous: { slug: "webinars", name: "Webinar" },
        future_field: "ignored",
      },
      resourceUpdate({ event: "trash", previous: null, topics: [], extra: true }),
    ];
    const response = await POST(request({ body: batch(events) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revalidated: ["/resources/", "/resources/webinar/", "/resources/webinar/example/", "/resources/webinars/"],
    });
    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      "resource:example",
      "resources",
      "terms",
      "type:webinar",
      "type:webinars",
    ]);
    expect(revalidateTag.mock.calls.every(([, profile]) => JSON.stringify(profile) === '{"expire":0}')).toBe(true);
  });

  it("never fetches rest_url or anything else", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is a 500 with a plain message when revalidateTag throws", async () => {
    revalidateTag.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing");
    });
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    await expectError(
      response,
      500,
      "The front end failed while revalidating its cache; save again to retry.",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is a 500 with a plain message when revalidatePath throws", async () => {
    revalidatePath.mockImplementation(() => {
      throw new Error("boom");
    });
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    await expectError(
      response,
      500,
      "The front end failed while revalidating its cache; save again to retry.",
    );
  });
});
