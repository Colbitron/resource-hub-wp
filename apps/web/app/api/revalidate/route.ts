import { createHash, timingSafeEqual } from "node:crypto";

import { revalidatePath, revalidateTag } from "next/cache";

import {
  EnvError,
  MAX_SECRET_LENGTH,
  MIN_SECRET_LENGTH,
  SecretError,
  type SecretProblem,
} from "@/lib/env-schema";
import { revalidateSecret } from "@/lib/env";
import { plainIssueMessage } from "@/lib/plain-issues";
import { eventsToInvalidations } from "@/lib/tags";
import {
  revalidateRequestSchema,
  type RevalidateResponseError,
  type RevalidateResponseOk,
} from "@/lib/wp/schemas/revalidate";

/**
 * `POST /api/revalidate/`: the endpoint WordPress calls with a batch of
 * events so the pages its change touched are rebuilt on the next request
 * (root `CLAUDE.md`, "Revalidation request" and "Revalidation response";
 * ADRs 0043, 0046 and 0048).
 *
 * The request is handled in this order, and each step answers before the
 * next one runs:
 *
 * 1. The secret. `REVALIDATE_SECRET` missing, shorter than 32 characters,
 *    longer than 256 (the CMS refuses one that long, so the two could never
 *    agree on it), or holding a character a bearer token cannot carry (anything outside
 *    printable ASCII, whitespace included) is a `500`: the front end is
 *    misconfigured, and no request can be authorised, so the editor is told
 *    that rather than `unauthorized`. This runs before auth on purpose; all
 *    it tells an unauthenticated caller is that this deploy is misconfigured.
 * 2. Auth, before the body is read. `Authorization: Bearer <token>` with the
 *    scheme in any case, exactly one space and a non-empty token; the token
 *    and the secret are hashed with SHA-256 and the digests compared with
 *    `timingSafeEqual`, so the comparison takes the same time whatever the
 *    token's length or content. Any failure is `401 { "error": "unauthorized" }`,
 *    exactly, as the contract says.
 * 3. The body. `Content-Type` must be `application/json`; the body is read
 *    with a cap (`MAX_BODY_BYTES`), never buffered unbounded, and within a
 *    deadline (`READ_DEADLINE_MS`), never waited on forever; then parsed as
 *    JSON and checked against the reader schema, which drops unknown keys and
 *    holds every known one to the contract. Every problem is a `400` whose
 *    `error` says what was wrong in plain words, naming the first issue's
 *    path but never a value (`lib/plain-issues.ts`), because the plugin
 *    stores this body and shows it to the editor.
 * 4. Revalidation. `eventsToInvalidations` gives the tags and paths for the
 *    union of every event's current and previous state; each tag goes to
 *    `revalidateTag(tag, { expire: 0 })`, so no page serves one more stale
 *    render, and each path to `revalidatePath`. Nothing is fetched from the
 *    CMS, or from anywhere: `rest_url` is validated and otherwise ignored,
 *    so the route has no request to forge. A failure here is a `500`.
 * 5. `200 { "revalidated": [paths] }`: the paths, as the response schema
 *    lists them; the tags are not reported.
 *
 * Every response carries `Cache-Control: no-store`. Any method but `POST`
 * is a `405` with `Allow: POST`. The route is served at `/api/revalidate/`,
 * with the slash, because `trailingSlash: true` answers the slashless path
 * with a `308` the plugin's client will not follow with its body (ADR 0043).
 *
 * The plugin times out after 3 seconds (ADR 0013), so nothing here is slow:
 * no fetch, no retry, no work after the answer.
 */

/**
 * The most bytes a body may have. A batch is at most 25 events, and an event
 * is a few hundred bytes (a slug is at most 200 characters, `rest_url` and
 * each topic slug likewise, and `previous` repeats three of those), so a full
 * batch with several topics per event is well under 16 KB; 64 KB leaves room
 * for the longest slugs the schema allows, and is the same bound the plugin
 * puts on the response it reads from this route (ADR 0013, amended
 * 2026-11-05). A body over it is refused before it is parsed, so no request
 * can make the handler hold more than this in memory.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * How long the body may take to arrive, from when the route starts reading
 * it. The plugin gives up after 3 seconds (ADR 0013), so a body still
 * arriving after 2 is from a client that is stalled or dribbling bytes, and
 * holding the request open for it only ties up the function. Past it the
 * read is cancelled and the request is a `400`.
 */
const READ_DEADLINE_MS = 2000;

/** How many events a batch may hold; the schema enforces it, the message names it. */
const MAX_EVENTS = 25;

/** The one `version` this front end reads. */
const SUPPORTED_VERSION = 1;

/** The route is never cached: every request authenticates and does work. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(status: number, body: RevalidateResponseOk | RevalidateResponseError): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status: number, message: string): Response {
  return json(status, { error: message });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}

/**
 * The token of `Authorization: Bearer <token>`, or `null` when the header is
 * missing or is not exactly that: the scheme in any case (RFC 9110 says
 * schemes are case-insensitive), one space, and a non-empty token with no
 * whitespace in it.
 */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) {
    return null;
  }
  const match = /^bearer (\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Whether `token` is `secret`, compared in constant time: both are hashed to
 * the same length first, since `timingSafeEqual` needs equal lengths and the
 * token's length is the caller's to choose, so comparing lengths early would
 * leak it.
 */
function tokenMatches(token: string, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(token), digest(secret));
}

/** True when the media type of `Content-Type` is `application/json`, whatever its parameters. */
function isJsonContentType(request: Request): boolean {
  const header = request.headers.get("content-type");
  if (header === null) {
    return false;
  }
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/** The outcome of reading the body: its bytes, or why it could not be read. */
type BodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too-large" | "too-slow" | "unreadable" };

/**
 * The body as bytes, read in chunks and abandoned as soon as it passes
 * `limit`, so a long stream is never held in memory. A `Content-Length`
 * over the limit is refused before the first byte.
 *
 * The read is also abandoned `deadlineMs` after it starts: a timer cancels
 * the reader, which settles the pending `read()` at once (a cancelled
 * stream closes before its source is told), and the loop sees the flag and
 * reports `too-slow` rather than a short body. The timer is cleared however
 * the read ends, so nothing runs after the answer. A body that cannot be
 * read at all, because it is locked or already disturbed, is `unreadable`.
 */
async function readBody(request: Request, limit: number, deadlineMs: number): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    return { ok: false, reason: "too-large" };
  }
  if (request.body === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const body = request.body;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Inside the `try`: a body that is locked or already read throws here,
    // and that is an unreadable body, not an unhandled error.
    const reader = body.getReader();
    timer = setTimeout(() => {
      timedOut = true;
      reader.cancel().catch(() => {});
    }, deadlineMs);
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) {
        return { ok: false, reason: "too-slow" };
      }
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel();
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: timedOut ? "too-slow" : "unreadable" };
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** `events[0].previous.slug` for the path `["events", 0, "previous", "slug"]`; `the body` for the root. */
function describePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "the body";
  }
  return path
    .map((key, index) =>
      typeof key === "number" ? `[${key}]` : index === 0 ? String(key) : `.${String(key)}`,
    )
    .join("");
}

/** The `500` sentence for each way `REVALIDATE_SECRET` can break the rule. */
const SECRET_PROBLEM_ERRORS: Record<SecretProblem, string> = {
  "too-short": `The front end's revalidation secret is shorter than ${MIN_SECRET_LENGTH} characters, so every request is refused.`,
  "too-long": `The front end's revalidation secret is longer than ${MAX_SECRET_LENGTH} characters, so every request is refused.`,
  "bad-characters":
    "The front end's revalidation secret has characters a bearer token cannot carry, such as a space or line break, so every request is refused.",
};

/** The `400` sentence for each reason the body could not be read. */
const READ_ERRORS: Record<Exclude<BodyRead, { ok: true }>["reason"], string> = {
  "too-large": `The body is larger than ${MAX_BODY_BYTES / 1024} KB, more than a batch of ${MAX_EVENTS} events can be.`,
  "too-slow": "The body took too long to arrive.",
  unreadable: "The body could not be read.",
};

export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = revalidateSecret();
  } catch (caught) {
    if (caught instanceof SecretError) {
      // The message names the rule, never the value.
      console.error(`[revalidate] ${caught.message} Every request is refused.`);
      return error(500, SECRET_PROBLEM_ERRORS[caught.problem]);
    }
    if (caught instanceof EnvError) {
      console.error("[revalidate] REVALIDATE_SECRET is not set; every request is refused.");
      return error(500, "The front end has no revalidation secret configured.");
    }
    throw caught;
  }

  const token = bearerToken(request);
  if (token === null || !tokenMatches(token, secret)) {
    return error(401, "unauthorized");
  }

  if (!isJsonContentType(request)) {
    return error(400, "The request must be sent with Content-Type: application/json.");
  }

  const read = await readBody(request, MAX_BODY_BYTES, READ_DEADLINE_MS);
  if (!read.ok) {
    return error(400, READ_ERRORS[read.reason]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
  } catch {
    return error(400, "The body is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return error(400, "The body must be a JSON object with version and events.");
  }
  const version: unknown = (parsed as Record<string, unknown>).version;
  if (version !== SUPPORTED_VERSION) {
    return error(
      400,
      version === undefined
        ? "The body has no version; this front end reads version 1."
        : "The body's version is not one this front end understands; it reads version 1.",
    );
  }

  // Zod's own messages are replaced with plain ones; a schema's own message wins.
  const result = revalidateRequestSchema.safeParse(parsed, { error: plainIssueMessage });
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = describePath(issue?.path ?? []);
    const what = issue?.message ?? "does not match the schema";
    return error(400, `The body does not match the revalidation request: ${where} ${what}.`);
  }

  let paths: string[];
  try {
    const invalidations = eventsToInvalidations(result.data.events);
    paths = invalidations.paths;
    for (const tag of invalidations.tags) {
      revalidateTag(tag, { expire: 0 });
    }
    for (const path of paths) {
      revalidatePath(path);
    }
  } catch (caught) {
    console.error("[revalidate] revalidation failed", caught);
    return error(500, "The front end failed while revalidating its cache; save again to retry.");
  }

  return json(200, { revalidated: paths });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function HEAD(): Promise<Response> {
  return methodNotAllowed();
}

export async function PUT(): Promise<Response> {
  return methodNotAllowed();
}

export async function PATCH(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}

export async function OPTIONS(): Promise<Response> {
  return methodNotAllowed();
}
