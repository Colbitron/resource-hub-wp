import type { FaultInput, FaultSummary } from "./types.mts";

/**
 * Failure injection for the specs: a fault makes the public routes under a
 * path answer slowly, with an error status, or both, so a spec can show
 * what the front end does when the CMS is down or slow. `POST
 * /__mock/faults` adds one, `DELETE /__mock/faults` and `/__mock/reset`
 * clear them all (`control.mts`), and the server consults `take` before it
 * answers any request outside `/__mock/` (`server.mts`).
 *
 * A fault's `path` matches a request path that is the same or lies under it
 * by whole segments: `/wp-json/wp/v2/resources` matches
 * `/wp-json/wp/v2/resources` and `/wp-json/wp/v2/resources/33`, not
 * `/wp-json/wp/v2/resources_x`, and `/wp-json` matches every REST route.
 * The earliest added fault that matches wins. With `times`, it applies to
 * that many requests and is then gone; without, until cleared.
 *
 * A fault with a `status` answers WordPress's fatal-error page by default.
 * With a `code` as well, it answers the JSON error body WordPress's REST API
 * writes, `{ code, message, data: { status } }`, instead: `{ status: 404,
 * code: "rest_no_route" }` on a plugin route is what a CMS without that
 * route (the plugin deactivated, or a deploy behind) answers.
 */

/** The longest delay a fault may hold a request for: beyond the front end's ten-second timeout, short enough not to stall a run. */
export const MAX_FAULT_DELAY_MS = 30_000;

/** A WordPress error code, shaped as core and plugins write them. */
const WP_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/** A fault as the server applies it: `status` to answer instead of the route, after `delayMs`. */
export interface Fault {
  readonly path: string;
  readonly status: number | null;
  /** The REST error `code` to answer with `status`, or `null` for the fatal-error page. */
  readonly code: string | null;
  readonly delayMs: number;
  /** Requests left before it expires, or `null` for no limit. */
  remaining: number | null;
}

export class FaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaultError";
  }
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** `input` checked and normalised; throws a `FaultError` naming the first field that is wrong. */
export function parseFault(input: unknown): Fault {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FaultError("The body must be a JSON object.");
  }
  const { path, status, code, delayMs, times } = input as FaultInput;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("/__mock")) {
    throw new FaultError("path must be a path starting with / and outside /__mock/.");
  }
  if (status !== undefined && !isInteger(status, 400, 599)) {
    throw new FaultError("status must be an integer from 400 to 599.");
  }
  if (code !== undefined && (typeof code !== "string" || !WP_ERROR_CODE.test(code) || status === undefined)) {
    throw new FaultError("code must be a WordPress error code (a-z, 0-9, _) and comes with a status.");
  }
  if (delayMs !== undefined && !isInteger(delayMs, 0, MAX_FAULT_DELAY_MS)) {
    throw new FaultError(`delayMs must be an integer from 0 to ${MAX_FAULT_DELAY_MS}.`);
  }
  if (times !== undefined && !isInteger(times, 1, 1_000)) {
    throw new FaultError("times must be an integer from 1 to 1000.");
  }
  if (status === undefined && (delayMs === undefined || delayMs === 0)) {
    throw new FaultError("Give a status, a delayMs or both.");
  }
  return {
    path: path.length > 1 ? path.replace(/\/+$/, "") : path,
    status: status ?? null,
    code: code ?? null,
    delayMs: delayMs ?? 0,
    remaining: times ?? null,
  };
}

function covers(fault: Fault, pathname: string): boolean {
  return fault.path === "/" || pathname === fault.path || pathname.startsWith(`${fault.path}/`);
}

export class Faults {
  private faults: Fault[] = [];

  add(fault: Fault): FaultSummary[] {
    this.faults.push(fault);
    return this.list();
  }

  clear(): void {
    this.faults = [];
  }

  list(): FaultSummary[] {
    return this.faults.map(({ path, status, code, delayMs, remaining }) => ({ path, status, code, delayMs, remaining }));
  }

  /** The fault that applies to a request for `pathname`, counted against its `times`; `null` when none does. */
  take(pathname: string): Fault | null {
    const index = this.faults.findIndex((fault) => covers(fault, pathname));
    if (index === -1) {
      return null;
    }
    const fault = this.faults[index];
    if (fault.remaining !== null) {
      fault.remaining -= 1;
      if (fault.remaining === 0) {
        this.faults.splice(index, 1);
      }
    }
    return fault;
  }
}
