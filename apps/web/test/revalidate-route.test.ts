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
const { revalidateResponseErrorSchema, revalidateResponseOkSchema } = await import("../lib/wp/schemas/revalidate");

const URL_WITH_SLASH = "http://localhost:3000/api/revalidate/";
const SECRET = "a-long-random-secret-for-the-tests"; // 34 characters, over the 32 minimum

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
  // The real body against the contract's error reply, not only its keys.
  expect(revalidateResponseErrorSchema.safeParse(body).success).toBe(true);
  if (typeof message === "string") {
    expect(body.error).toBe(message);
  } else {
    expect(body.error).toMatch(message);
  }
}

/** The `200` body, checked against the contract's ok reply. */
async function okBody(response: Response): Promise<{ revalidated: string[] }> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  const parsed = revalidateResponseOkSchema.safeParse(body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return body as { revalidated: string[] };
}

const MISMATCH = "The body does not match the revalidation request: ";

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

  it("is answered before auth, so a request with no bearer gets the 500 too", async () => {
    delete process.env.REVALIDATE_SECRET;
    const incoming = request({ headers: { Authorization: "" }, body: batch([resourceUpdate()]) });
    await expectError(await POST(incoming), 500, "The front end has no revalidation secret configured.");
    expect(incoming.bodyUsed).toBe(false);
  });

  const TOO_SHORT =
    "The front end's revalidation secret is shorter than 32 characters, so every request is refused.";
  const BAD_CHARACTERS =
    "The front end's revalidation secret has characters a bearer token cannot carry, such as a space or line break, so every request is refused.";

  it.each([
    ["one character", "#"],
    ["31 characters", "~".repeat(31)],
  ])("is a 500 when REVALIDATE_SECRET is %s, even with a bearer that matches it", async (_name, value) => {
    process.env.REVALIDATE_SECRET = value;
    const response = await POST(
      request({ headers: { Authorization: `Bearer ${value}` }, body: batch([resourceUpdate()]) }),
    );
    const text = await response.clone().text();
    await expectError(response, 500, TOO_SHORT);
    expect(text).not.toContain(value);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["32", 32],
    ["256", 256],
  ])("accepts a secret of exactly %s characters", async (_name, length) => {
    const value = "x".repeat(length);
    process.env.REVALIDATE_SECRET = value;
    await okBody(await POST(request({ headers: { Authorization: `Bearer ${value}` }, body: batch([resourceUpdate()]) })));
  });

  it("is a 500 when REVALIDATE_SECRET is 257 characters, even with a bearer that matches it, never echoed", async () => {
    const value = `${SECRET}${"~".repeat(257 - SECRET.length)}`;
    process.env.REVALIDATE_SECRET = value;
    const response = await POST(
      request({ headers: { Authorization: `Bearer ${value}` }, body: batch([resourceUpdate()]) }),
    );
    const text = await response.clone().text();
    await expectError(
      response,
      500,
      "The front end's revalidation secret is longer than 256 characters, so every request is refused.",
    );
    expect(text).not.toContain(SECRET);
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain(SECRET);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["a trailing newline", `${SECRET}\n`],
    ["a leading space", ` ${SECRET}`],
    ["a space inside", `${SECRET.slice(0, 10)} ${SECRET.slice(10)}`],
    ["a non-ASCII character", `${SECRET}é`],
  ])("is a 500 when REVALIDATE_SECRET has %s, never trimmed into a match, never echoed", async (_name, value) => {
    process.env.REVALIDATE_SECRET = value;
    const response = await POST(request({ body: batch([resourceUpdate()]) }));
    const text = await response.clone().text();
    await expectError(response, 500, BAD_CHARACTERS);
    expect(text).not.toContain(SECRET);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("logs the rule, never the value", async () => {
    const value = `${SECRET}\n`;
    process.env.REVALIDATE_SECRET = value;
    await POST(request({ body: batch([resourceUpdate()]) }));
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toMatch(/REVALIDATE_SECRET must be printable ASCII with no whitespace/);
    expect(logged).not.toContain(SECRET);
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

  it("checks the bearer before the content type", async () => {
    const incoming = request({
      headers: { Authorization: "Bearer wrong", "Content-Type": "text/plain" },
      body: batch([resourceUpdate()]),
    });
    await expectError(await POST(incoming), 401, "unauthorized");
    expect(incoming.bodyUsed).toBe(false);
  });

  it("checks the bearer before an oversized Content-Length", async () => {
    const incoming = request({
      headers: { Authorization: "Bearer wrong", "Content-Length": String(10 * 1024 * 1024) },
      body: "{}",
    });
    await expectError(await POST(incoming), 401, "unauthorized");
    expect(incoming.bodyUsed).toBe(false);
  });

  it("refuses two Authorization headers, even when both carry the secret", async () => {
    // The Fetch Headers the route reads joins repeated values with ", ", so
    // two bearers read as one value with a space in it and fail the strict
    // parse. Behind next start, Node's HTTP parser keeps the first
    // Authorization and drops the rest before a Request is built, so there
    // the first wins; either way a second bearer never authorises.
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Authorization", `Bearer ${SECRET}`);
    headers.append("Authorization", `Bearer ${SECRET}`);
    const incoming = new Request(URL_WITH_SLASH, { method: "POST", headers, body: batch([resourceUpdate()]) });
    expect(incoming.headers.get("authorization")).toBe(`Bearer ${SECRET}, Bearer ${SECRET}`);
    await expectError(await POST(incoming), 401, "unauthorized");
    expect(revalidateTag).not.toHaveBeenCalled();
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
    // A 65,000-character topic slug is no slug, so the body is a 400, but for
    // its content: it was read to the end, not refused for its size.
    const READ_TO_THE_END = /^The body does not match the revalidation request: events\[0\]\.topics\[0\] /;
    const atLimit = await POST(request({ body: exact }));
    await expectError(atLimit, 400, READ_TO_THE_END);
    const declaredAtLimit = await POST(
      request({ headers: { "Content-Length": String(64 * 1024) }, body: exact }),
    );
    await expectError(declaredAtLimit, 400, READ_TO_THE_END);
    const overBy = pad(64 * 1024 + 1);
    await expectError(await POST(request({ body: overBy })), 400, TOO_LARGE);
  });

  it("refuses a body of 64 KB plus one byte that arrives in chunks summing past the limit", async () => {
    // 64 chunks of 1 KB reach the limit exactly; one more byte passes it.
    const kilobyte = new Uint8Array(1024).fill(0x20);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < 64) {
          sent += 1;
          controller.enqueue(kilobyte);
        } else {
          controller.enqueue(new Uint8Array([0x20]));
          controller.close();
        }
      },
    });
    await expectError(await POST(request({ body: stream, duplex: "half" })), 400, TOO_LARGE);
  });
});

describe("reading the body", () => {
  const TOO_SLOW = "The body took too long to arrive.";
  const encoder = new TextEncoder();

  afterEach(() => {
    vi.useRealTimers();
  });

  /** No timer is left pending once the answer is out: the deadline is cleared however the read ends. */
  function expectNoTimers() {
    expect(vi.getTimerCount()).toBe(0);
  }

  /** Only the timers the route's deadline uses are faked, so streams and promises run as usual. */
  function fakeTimers() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }

  it("is a 400 when the body never finishes, and cancels the read at 2 seconds", async () => {
    fakeTimers();
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"version":1,'));
      },
      pull() {
        return new Promise<void>(() => {}); // never another byte, never the end
      },
      cancel() {
        cancelled = true;
      },
    });
    const pending = POST(request({ body: stalled, duplex: "half" }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expectError(await pending, 400, TOO_SLOW);
    expect(cancelled).toBe(true);
    expect(revalidateTag).not.toHaveBeenCalled();
    expectNoTimers();
  });

  it("is a 400 when a body dribbles in slower than the deadline, however valid it would be", async () => {
    fakeTimers();
    const body = encoder.encode(batch([resourceUpdate()]));
    let offset = 0;
    let pulls = 0;
    const slow = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // 10 bytes every 250 ms: several seconds for the whole batch.
        await new Promise((resolve) => setTimeout(resolve, 250));
        pulls += 1;
        controller.enqueue(body.slice(offset, offset + 10));
        offset += 10;
        if (offset >= body.byteLength) {
          controller.close();
        }
      },
    });
    expect(body.byteLength / 10).toBeGreaterThan(2000 / 250); // it cannot finish in time
    const pending = POST(request({ body: slow, duplex: "half" }));
    await vi.advanceTimersByTimeAsync(2000);
    await expectError(await pending, 400, TOO_SLOW);
    expect(pulls).toBeLessThanOrEqual(8);
    expect(revalidateTag).not.toHaveBeenCalled();
    expectNoTimers();
  });

  it("accepts a slow body that finishes inside the deadline", async () => {
    fakeTimers();
    const body = encoder.encode(batch([resourceUpdate()]));
    const half = Math.ceil(body.byteLength / 2);
    let step = 0;
    const slowButInTime = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        controller.enqueue(step === 0 ? body.slice(0, half) : body.slice(half));
        step += 1;
        if (step === 2) {
          controller.close();
        }
      },
    });
    const pending = POST(request({ body: slowButInTime, duplex: "half" }));
    await vi.advanceTimersByTimeAsync(1900);
    const ok = await okBody(await pending);
    expect(ok.revalidated).toContain("/resources/webinar/example/");
    expectNoTimers();
  });

  it.each([
    ["locked by another reader", (incoming: Request) => void incoming.body?.getReader()],
    ["already read", async (incoming: Request) => void (await incoming.text())],
  ])("is a 400 when the body is %s, so getReader() throws", async (_name, disturb) => {
    const incoming = request({ body: batch([resourceUpdate()]) });
    await disturb(incoming);
    expect(() => incoming.body?.getReader()).toThrow(TypeError);
    await expectError(await POST(incoming), 400, "The body could not be read.");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("is a 400 when the stream fails partway", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"version":1,'));
      },
      pull(controller) {
        controller.error(new Error("socket hang up"));
      },
    });
    await expectError(
      await POST(request({ body: failing, duplex: "half" })),
      400,
      "The body could not be read.",
    );
    expect(revalidateTag).not.toHaveBeenCalled();
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

describe("keys JSON.parse treats specially", () => {
  it("drops a __proto__ key at the top and in an event, and pollutes nothing", async () => {
    const event = JSON.stringify(resourceUpdate()).replace(/^\{/, '{"__proto__":{"polluted":true},');
    const body = `{"__proto__":{"polluted":true},"version":1,"events":[${event}]}`;
    const ok = await okBody(await POST(request({ body })));
    expect(ok.revalidated).toContain("/resources/webinar/example/");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("is a 400 for a __proto__ that replaces the events", async () => {
    // JSON.parse makes "__proto__" an own key, so it never becomes `events`.
    const body = `{"version":1,"__proto__":{"events":[${JSON.stringify(resourceUpdate())}]}}`;
    await expectError(await POST(request({ body })), 400, `${MISMATCH}events is missing.`);
  });

  it("reads a repeated key as JSON.parse does: the last one wins", async () => {
    // WordPress's encoder never repeats a key; this pins what happens if a body does.
    const lastIsGood = await POST(request({ body: `{"version":2,"version":1,"events":[${JSON.stringify(resourceUpdate())}]}` }));
    await okBody(lastIsGood);

    const lastIsBad = await POST(request({ body: `{"version":1,"version":2,"events":[${JSON.stringify(resourceUpdate())}]}` }));
    await expectError(
      lastIsBad,
      400,
      "The body's version is not one this front end understands; it reads version 1.",
    );

    const slugTwice = JSON.stringify(resourceUpdate()).replace('"slug":"example"', '"slug":"a/b","slug":"example"');
    const ok = await okBody(await POST(request({ body: `{"version":1,"events":[${slugTwice}]}` })));
    expect(ok.revalidated).toContain("/resources/webinar/example/");
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
    await expectError(missing, 400, `${MISMATCH}events is missing.`);

    const notArray = await POST(request({ body: JSON.stringify({ version: 1, events: {} }) }));
    await expectError(notArray, 400, `${MISMATCH}events must be an array.`);

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
    ["an unknown event type", { type: "post" }, /events\[0\]/],
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

  it.each([
    ["an unknown event name", { event: "archive", previous: null }, 'events[0].event must be "update", "publish", "unpublish", "trash" or "delete".'],
    ["an unknown event type", { type: "post" }, 'events[0].type must be "resource", "term" or "page".'],
    ["a string id", { id: "123" }, "events[0].id must be a number."],
    ["a fractional id", { id: 1.5 }, "events[0].id must be a whole number."],
    ["a zero id", { id: 0 }, "events[0].id must be at least 1."],
    ["a missing slug", { slug: undefined }, "events[0].slug is missing."],
    ["a previous on publish", { event: "publish" }, "events[0].previous must be null."],
    ["a previous missing its types", { previous: { slug: "x", topics: [] } }, "events[0].previous.types is missing."],
    ["two types", { types: ["webinar", "guide"] }, "events[0].types must have at most 1 item."],
    ["no types", { types: [] }, "events[0].types must not be empty."],
    ["topics as a string", { topics: "performance" }, "events[0].topics must be an array."],
  ])("%s has a plain sentence, not Zod's", async (_name, overrides, sentence) => {
    const response = await POST(request({ body: batch([resourceUpdate(overrides)]) }));
    await expectError(response, 400, `${MISMATCH}${sentence}`);
  });

  it("names a term event's taxonomy plainly", async () => {
    const term = { type: "term", taxonomy: "resource_flag", event: "create", id: 1, slug: "x", name: "X", previous: null };
    await expectError(
      await POST(request({ body: batch([term]) })),
      400,
      `${MISMATCH}events[0].taxonomy must be "resource_topic" or "resource_type".`,
    );
  });

  it("keeps the schema's own messages where it has them", async () => {
    // `must not list a topic twice` is written on the schema; the plain map never replaces it.
    const response = await POST(request({ body: batch([resourceUpdate({ topics: ["a", "a"] })]) }));
    await expectError(response, 400, `${MISMATCH}events[0].topics must not list a topic twice.`);
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
    const body = await okBody(response);
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

  it("revalidates pages and the two paths of a page event (ADR 0052)", async () => {
    const event = { type: "page", event: "update", id: 14, path: "/company/team/", previous: { path: "/about/team/" } };
    const body = await okBody(await POST(request({ body: batch([event]) })));
    expect(body).toEqual({ revalidated: ["/about/team/", "/company/team/"] });
    expect(revalidateTag.mock.calls).toEqual([["pages", { expire: 0 }]]);
    expect(revalidatePath.mock.calls).toEqual([["/about/team/"], ["/company/team/"]]);
  });

  it("refuses a page event with an unknown name or a bad path with a plain sentence", async () => {
    await expectError(
      await POST(request({ body: batch([{ type: "page", event: "move", id: 14, path: "/about/", previous: null }]) })),
      400,
      `${MISMATCH}events[0].event must be "update", "publish", "unpublish", "trash" or "delete".`,
    );
    await expectError(
      await POST(request({ body: batch([{ type: "page", event: "publish", id: 14, path: "about/", previous: null }]) })),
      400,
      `${MISMATCH}events[0].path must be / or segments between slashes, each non-empty with no whitespace.`,
    );
    expect(revalidateTag).not.toHaveBeenCalled();
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
    expect(await okBody(response)).toEqual({
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
