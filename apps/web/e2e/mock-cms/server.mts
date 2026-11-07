import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { handleControl } from "./control.mts";
import { handleRest, restError, type MockResponse } from "./rest.mts";
import { MockState } from "./state.mts";

/**
 * The mock CMS as an HTTP server on `node:http`: no framework, no
 * dependencies. It stands in for WordPress at the three places the front
 * end reaches it:
 *
 * - `/wp-json/…`, the REST routes (`rest.ts`);
 * - `/wp-content/uploads/…`, the files under `fixtures/uploads/`, which the
 *   front end's `/media/` rewrite proxies (ADR 0040);
 * - anything else is the CMS's theme, which answers an anonymous visitor with
 *   a 404 (ADR 0031).
 *
 * `/__mock/…` is the control surface for the specs (`control.ts`). Every
 * request outside it is counted by path and query string, and then answers
 * an injected fault first when one covers its path (`faults.mts`).
 */

export interface MockCmsOptions {
  /** `0` picks a free port, as the unit test does. */
  port: number;
  host: string;
}

export interface MockCms {
  /** `http://{host}:{port}`, the origin in every URL the mock emits. */
  origin: string;
  port: number;
  state: MockState;
  close(): Promise<void>;
}

const UPLOADS_DIR = fileURLToPath(new URL("./fixtures/uploads/", import.meta.url));

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function send(res: ServerResponse, response: MockResponse): void {
  const body = JSON.stringify(response.body);
  res.writeHead(response.status, { ...response.headers, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function plain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=UTF-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

/**
 * An upload under the fixtures directory, or a plain 404 as a web server
 * gives for a missing file. A path with a malformed percent escape (`%`,
 * `%zz`) cannot name a file and is a plain 400, as Apache and nginx answer
 * it.
 */
async function serveUpload(res: ServerResponse, relativePath: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    plain(res, 400, "Bad Request");
    return;
  }
  const file = resolve(UPLOADS_DIR, decoded);
  // Resolved paths that leave the uploads directory (`..`, absolute) are not files.
  if (!file.startsWith(UPLOADS_DIR.replace(/[\\/]$/, "") + sep)) {
    plain(res, 404, "Not Found");
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    plain(res, 404, "Not Found");
    return;
  }
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[extension] ?? "application/octet-stream",
    "Content-Length": bytes.length,
    "Cache-Control": "public, max-age=3600",
  });
  res.end(bytes);
}

function html(res: ServerResponse, status: number, body: string): void {
  if (res.destroyed) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=UTF-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startMockCms(options: MockCmsOptions): Promise<MockCms> {
  const state = new MockState();
  let origin = "";

  const server: Server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", origin);
    try {
      if (url.pathname.startsWith("/__mock/")) {
        const raw = method === "POST" || method === "DELETE" ? await readBody(req) : "";
        let body: unknown;
        try {
          body = raw === "" ? undefined : JSON.parse(raw);
        } catch {
          send(res, { status: 400, headers: { "Content-Type": "application/json; charset=UTF-8" }, body: { error: "The body is not JSON." } });
          return;
        }
        send(res, handleControl(state, method, url, body, origin));
        return;
      }

      state.count(`${url.pathname}${url.search}`);

      const fault = state.faults.take(url.pathname);
      if (fault !== null) {
        if (fault.delayMs > 0) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, fault.delayMs).unref());
        }
        if (fault.status !== null && fault.code !== null) {
          send(res, restError(fault.status, fault.code));
          return;
        }
        if (fault.status !== null) {
          // WordPress's own fatal-error page, with the CMS's address in it as
          // a real one can have, so a spec can show the front end never
          // passes it on.
          html(res, fault.status, `<!DOCTYPE html><html><body><p>There has been a critical error on this website.</p><p>${origin}${url.pathname}</p></body></html>`);
          return;
        }
      }

      if (url.pathname === "/wp-json" || url.pathname.startsWith("/wp-json/")) {
        send(res, handleRest(state, method, url, origin));
        return;
      }
      if (url.pathname.startsWith("/wp-content/uploads/")) {
        if (method !== "GET" && method !== "HEAD") {
          plain(res, 405, "Method Not Allowed");
          return;
        }
        await serveUpload(res, url.pathname.slice("/wp-content/uploads/".length));
        return;
      }
      // The CMS's theme pages: a 404 for anyone not logged in (ADR 0031).
      plain(res, 404, "Not Found");
    } catch (caught) {
      console.error("[mock-cms]", caught);
      if (!res.headersSent) plain(res, 500, "Internal Server Error");
      else res.end();
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  origin = `http://${options.host}:${port}`;

  return {
    origin,
    port,
    state,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}
