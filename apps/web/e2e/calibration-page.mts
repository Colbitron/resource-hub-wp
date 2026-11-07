/**
 * Serves the calibration page: a frozen copy of the built app's `/`, its
 * HTML and the static files it loads (`calibration-page/`, written by
 * `write-calibration-page.mts`), which `lighthouse.mts` loads to measure how
 * fast this host does a page's main-thread work (`cpu-calibration.mts`).
 *
 * - `GET /calibration/` is the HTML, never cached.
 * - `GET /_next/static/…` is the file of that path under the folder's
 *   `_next/static/`, cached as `next start` caches it. One the folder lacks
 *   is a 404 and is listed in `missing`, so the calibration can refuse a
 *   snapshot that no longer matches what its page loads.
 * - A link prefetch (a request with Next.js's `RSC` header or `_rsc`
 *   parameter) is a 204: the page's links prefetch the routes they point to,
 *   and an empty answer keeps that work out of the measurement without an
 *   error in the console.
 * - Anything else, such as the icons the HTML links, is a 404.
 *
 * Files are served as they are on disk, uncompressed: the measurement is the
 * main thread's task time, which Lighthouse observes rather than simulates,
 * and which compression does not change. It listens on 127.0.0.1 on a port
 * the system chooses, so it never takes one of the harness's.
 */

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The committed snapshot. */
export const CALIBRATION_DIR = fileURLToPath(new URL("./calibration-page", import.meta.url));

/** The page's path on the server. */
export const CALIBRATION_PATH = "/calibration/";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

export interface CalibrationServer {
  /** The calibration page's URL. */
  url: string;
  /** The `/_next/static/` paths the server was asked for and could not serve, in order. */
  missing: string[];
  /** The `/_next/static/` paths it served, in order, each once. */
  served: string[];
  close(): Promise<void>;
}

export interface CalibrationServerOptions {
  /** The page's HTML; the snapshot's `index.html` when omitted. */
  html?: string;
  /** The directory `/_next/static/` maps to; the snapshot's when omitted. */
  staticDir?: string;
}

export async function startCalibrationServer(options: CalibrationServerOptions = {}): Promise<CalibrationServer> {
  const html = options.html ?? readFileSync(join(CALIBRATION_DIR, "index.html"), "utf8");
  const staticDir = normalize(options.staticDir ?? join(CALIBRATION_DIR, "_next", "static"));
  const missing: string[] = [];
  const served = new Set<string>();

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://calibration.invalid");
    if (request.headers.rsc !== undefined || url.searchParams.has("_rsc")) {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === CALIBRATION_PATH) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
      return;
    }
    if (url.pathname.startsWith("/_next/static/")) {
      const file = normalize(join(staticDir, decodeURIComponent(url.pathname.slice("/_next/static/".length))));
      if (file.startsWith(staticDir + sep) && existsSync(file) && statSync(file).isFile()) {
        served.add(url.pathname);
        response
          .writeHead(200, {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
          })
          .end(readFileSync(file));
        return;
      }
      missing.push(url.pathname);
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The calibration server has no port.");
  return {
    url: `http://127.0.0.1:${address.port}${CALIBRATION_PATH}`,
    missing,
    get served() {
      return [...served];
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
