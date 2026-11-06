import { fileURLToPath } from "node:url";

import { FaultError, parseFault } from "./faults.mts";
import { buildId } from "./identity.mts";
import { isTaxonomy, MockError, type MockState } from "./state.mts";
import type { CreatePageInput, CreateResourceInput, HealthResponse, PageStatus, RenameTermInput, ResourceStatus } from "./types.mts";
import type { MockResponse } from "./rest.mts";

/**
 * The control endpoints under `/__mock/`, which only the specs call: the
 * front end never requests a path outside `/wp-json/` and
 * `/wp-content/uploads/`, and WordPress has no such path. Every body in and
 * out is JSON; an error is a 4xx `{ "error": "…" }`. The shapes are in
 * `types.ts` and the typed caller is `client.ts`; `e2e/README.md` lists them.
 *
 * These requests are not counted: the counters show what the front end did.
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" };

/** This directory, absolute, without a trailing separator: the mock's identity in `/__mock/health`. */
export const MOCK_DIR = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "");

/** The mock's code and fixtures as this process started with them (`identity.mts`). */
const BUILD = buildId(MOCK_DIR);

function json(status: number, body: unknown): MockResponse {
  return { status, headers: { ...JSON_HEADERS }, body };
}

function error(status: number, message: string): MockResponse {
  return json(status, { error: message });
}

const STATUSES: readonly ResourceStatus[] = ["publish", "draft", "trash"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new MockError(422, `${key} must be a string.`);
  return value;
}

function parseCreate(body: unknown): CreateResourceInput {
  if (!isRecord(body)) throw new MockError(422, "The body must be a JSON object.");
  const title = optionalString(body, "title");
  const type = optionalString(body, "type");
  if (title === undefined) throw new MockError(422, "title is needed.");
  if (type === undefined) throw new MockError(422, "type is needed.");
  if (body.topics !== undefined && !isStringArray(body.topics)) throw new MockError(422, "topics must be an array of slugs.");
  if (body.featured !== undefined && typeof body.featured !== "boolean") throw new MockError(422, "featured must be a boolean.");
  if (body.mediaId !== undefined && body.mediaId !== null && !Number.isInteger(body.mediaId)) {
    throw new MockError(422, "mediaId must be an integer or null.");
  }
  return {
    title,
    type,
    slug: optionalString(body, "slug"),
    topics: body.topics,
    featured: body.featured,
    summary: optionalString(body, "summary"),
    sourceUrl: optionalString(body, "sourceUrl"),
    content: optionalString(body, "content"),
    mediaId: body.mediaId as number | null | undefined,
  };
}

const PAGE_STATUSES: readonly PageStatus[] = ["publish", "draft", "trash"];

function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) throw new MockError(422, `${key} must be a non-negative integer.`);
  return value as number;
}

function parsePageStatus(value: unknown): PageStatus {
  if (typeof value !== "string" || !(PAGE_STATUSES as readonly string[]).includes(value)) {
    throw new MockError(422, `status must be one of ${PAGE_STATUSES.join(", ")}.`);
  }
  return value as PageStatus;
}

function parseCreatePage(body: unknown): CreatePageInput {
  if (!isRecord(body)) throw new MockError(422, "The body must be a JSON object.");
  const title = optionalString(body, "title");
  if (title === undefined) throw new MockError(422, "title is needed.");
  return {
    title,
    slug: optionalString(body, "slug"),
    parent: optionalInteger(body, "parent"),
    content: optionalString(body, "content"),
    excerpt: optionalString(body, "excerpt"),
    status: body.status === undefined ? undefined : parsePageStatus(body.status),
  };
}

function parseRename(body: unknown): RenameTermInput {
  if (!isRecord(body)) throw new MockError(422, "The body must be a JSON object.");
  const patch = { slug: optionalString(body, "slug"), name: optionalString(body, "name") };
  if (patch.slug === undefined && patch.name === undefined) throw new MockError(422, "Give a slug, a name or both.");
  return patch;
}

/**
 * Answers a request whose path starts with `/__mock/`. `body` is the parsed
 * JSON body, or `undefined` when there was none.
 */
export function handleControl(state: MockState, method: string, url: URL, body: unknown, origin: string): MockResponse {
  const path = url.pathname.replace(/^\/__mock/, "").replace(/\/+$/, "");
  try {
    if (method === "GET" && path === "/health") {
      const health: HealthResponse = { ok: true, dir: MOCK_DIR, build: BUILD, pid: process.pid, origin };
      return json(200, health);
    }
    if (method === "GET" && path === "/state") return json(200, state.summary(origin));
    if (method === "GET" && path === "/requests") return json(200, state.requests());
    if (method === "POST" && path === "/requests/reset") {
      state.resetRequests();
      return json(200, state.requests());
    }
    if (method === "POST" && path === "/reset") {
      state.reset();
      return json(200, state.summary(origin));
    }
    if (path === "/faults") {
      if (method === "GET") return json(200, state.faults.list());
      if (method === "POST") return json(201, state.faults.add(parseFault(body)));
      if (method === "DELETE") {
        state.faults.clear();
        return json(200, state.faults.list());
      }
    }
    if (method === "POST" && path === "/resources") {
      return json(201, state.summarise(state.createResource(parseCreate(body))));
    }

    let match = /^\/resources\/(\d+)\/(title|slug|type|topics|status|picks)$/.exec(path);
    if (match && method === "POST") {
      const id = Number(match[1]);
      if (!isRecord(body)) throw new MockError(422, "The body must be a JSON object.");
      switch (match[2]) {
        case "title": {
          const title = optionalString(body, "title");
          if (title === undefined) throw new MockError(422, "title is needed.");
          return json(200, state.summarise(state.setTitle(id, title)));
        }
        case "slug": {
          const slug = optionalString(body, "slug");
          if (slug === undefined) throw new MockError(422, "slug is needed.");
          return json(200, state.summarise(state.renameSlug(id, slug)));
        }
        case "type": {
          const type = optionalString(body, "type");
          if (type === undefined) throw new MockError(422, "type is needed.");
          return json(200, state.summarise(state.setType(id, type)));
        }
        case "topics": {
          if (!isStringArray(body.topics)) throw new MockError(422, "topics must be an array of slugs.");
          return json(200, state.summarise(state.setTopics(id, body.topics)));
        }
        case "status": {
          const status = optionalString(body, "status");
          if (status === undefined || !(STATUSES as readonly string[]).includes(status)) {
            throw new MockError(422, `status must be one of ${STATUSES.join(", ")}.`);
          }
          return json(200, state.summarise(state.setStatus(id, status as ResourceStatus)));
        }
        case "picks": {
          const picks = body.picks;
          if (!Array.isArray(picks) || !picks.every((pick) => Number.isInteger(pick) && pick > 0)) {
            throw new MockError(422, "picks must be an array of positive integer IDs.");
          }
          return json(200, state.summarise(state.setPicks(id, picks as number[])));
        }
      }
    }

    if (method === "POST" && path === "/front-page") {
      if (!isRecord(body) || !("pageId" in body)) throw new MockError(422, "pageId is needed: a page ID, or null.");
      const pageId = body.pageId;
      if (pageId !== null && !Number.isInteger(pageId)) throw new MockError(422, "pageId must be an integer or null.");
      return json(200, state.setFrontPage(pageId as number | null));
    }
    if (method === "POST" && path === "/pages") {
      return json(201, state.summarisePage(state.createPage(parseCreatePage(body))));
    }
    match = /^\/pages\/(\d+)$/.exec(path);
    if (match && method === "DELETE") {
      state.deletePage(Number(match[1]));
      return json(200, { deleted: true });
    }
    match = /^\/pages\/(\d+)\/(title|slug|parent|content|status)$/.exec(path);
    if (match && method === "POST") {
      const id = Number(match[1]);
      if (!isRecord(body)) throw new MockError(422, "The body must be a JSON object.");
      switch (match[2]) {
        case "title": {
          const title = optionalString(body, "title");
          if (title === undefined) throw new MockError(422, "title is needed.");
          return json(200, state.summarisePage(state.setPageTitle(id, title)));
        }
        case "slug": {
          const slug = optionalString(body, "slug");
          if (slug === undefined) throw new MockError(422, "slug is needed.");
          return json(200, state.summarisePage(state.setPageSlug(id, slug)));
        }
        case "parent": {
          const parent = optionalInteger(body, "parent");
          if (parent === undefined) throw new MockError(422, "parent is needed.");
          return json(200, state.summarisePage(state.setPageParent(id, parent)));
        }
        case "content": {
          const content = optionalString(body, "content");
          if (content === undefined) throw new MockError(422, "content is needed.");
          return json(200, state.summarisePage(state.setPageContent(id, content)));
        }
        case "status":
          return json(200, state.summarisePage(state.setPageStatus(id, parsePageStatus(body.status))));
      }
    }

    match = /^\/terms\/(resource_topic|resource_type|resource_flag)\/(\d+)$/.exec(path);
    if (match && isTaxonomy(match[1])) {
      const [taxonomy, id] = [match[1], Number(match[2])];
      if (method === "POST") return json(200, state.summariseTerm(state.renameTerm(taxonomy, id, parseRename(body))));
      if (method === "DELETE") {
        state.deleteTerm(taxonomy, id);
        return json(200, { deleted: true });
      }
    }

    return error(404, `No control endpoint answers ${method} ${url.pathname}.`);
  } catch (caught) {
    if (caught instanceof MockError) return error(caught.status, caught.message);
    if (caught instanceof FaultError) return error(422, caught.message);
    throw caught;
  }
}
