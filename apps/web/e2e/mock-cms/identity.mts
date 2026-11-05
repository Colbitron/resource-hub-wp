import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * How a mock CMS process can be told apart from another one in
 * `/__mock/health`: the directory it runs from, and a hash of the code and
 * fixtures it was started with. A mock reused from the same checkout but
 * started before its files last changed has the right `dir` and the wrong
 * `build`, and `harness.spec.ts` fails on either.
 *
 * No `import.meta` here: Playwright loads the specs, and what they import,
 * as CommonJS, so the caller passes the directory (`control.mts` its own).
 */

/** Every file under `dir`, as paths relative to it with `/` separators, sorted. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

/**
 * A SHA-256 over every file under `dir`, each as its relative path, a NUL,
 * its byte length, a NUL and its bytes, in sorted path order: the mock's
 * source files and its fixtures, so a change to either changes it.
 */
export function buildId(dir: string): string {
  const hash = createHash("sha256");
  for (const file of files(dir)) {
    const bytes = readFileSync(join(dir, file));
    hash.update(`${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
