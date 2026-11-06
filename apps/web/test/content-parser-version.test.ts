import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `renderContent` runs htmlparser2 twice over a body, from two copies. The
// depth pre-pass (`outline`) runs the app's own htmlparser2, pinned
// in package.json. The parse that renders runs the copy html-dom-parser
// bundles in lib/node_modules/htmlparser2: html-react-parser's ESM entry
// re-exports its CommonJS build, which requires html-dom-parser's CommonJS
// build, so Vitest and the Next server bundle both reach that copy. The
// pre-pass is sound only if both copies read a body the same way,
// so this test holds them to one release. It fails on an upgrade of either
// that lets them drift; pin the direct dependency to the version
// html-dom-parser declares.

type Manifest = { version: string; dependencies?: Record<string, string> };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const appManifestPath = new URL("../package.json", import.meta.url);
const pinned = readJson<Manifest>(fileURLToPath(appManifestPath)).dependencies?.htmlparser2;
const appRequire = createRequire(appManifestPath);

// The app's own htmlparser2, which the pre-pass imports. Its exports list
// no ./package.json, so the manifest is found from the entry point.
const ownDist = dirname(appRequire.resolve("htmlparser2"));
const own = readJson<Manifest>(join(ownDist, "..", "package.json"));

// html-dom-parser as html-react-parser resolves it, and the server entry
// that html-react-parser's parse runs.
const reactParserRequire = createRequire(appRequire.resolve("html-react-parser"));
const domParser = readJson<Manifest>(reactParserRequire.resolve("html-dom-parser/package.json"));
const htmlToDom = reactParserRequire.resolve("html-dom-parser/lib/server/html-to-dom");

// The bundled copy, resolved with the specifier html-to-dom.js requires it by.
const BUNDLED_PARSER = "../node_modules/htmlparser2/dist/Parser.js";
const bundledDist = dirname(createRequire(htmlToDom).resolve(BUNDLED_PARSER));

describe("htmlparser2 versions", () => {
  it("pins the app's htmlparser2 to an exact version, and installs that version", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(own.version).toBe(pinned);
  });

  it("is the version html-dom-parser declares", () => {
    expect(domParser.dependencies?.htmlparser2).toBe(pinned);
  });

  it("is the version of the copy html-dom-parser bundles and parses with", () => {
    expect(readFileSync(htmlToDom, "utf8")).toContain(`require("${BUNDLED_PARSER}")`);
    // html-dom-parser 8.0.2 bundles htmlparser2's dist/ without its
    // package.json. When a release ships one, its version must match too.
    const bundledManifest = join(bundledDist, "..", "package.json");
    if (existsSync(bundledManifest)) {
      expect(readJson<Manifest>(bundledManifest).version).toBe(pinned);
    }
    // Either way the copy is compared on what it is: its source maps embed
    // the files it was built from, which must be the pinned release's,
    // byte for byte.
    for (const file of ["Parser.js", "Tokenizer.js"]) {
      const map = readJson<{ sourcesContent?: string[] }>(join(bundledDist, `${file}.map`));
      expect(map.sourcesContent?.[0], file).toBe(readFileSync(join(ownDist, file), "utf8"));
    }
  });
});
