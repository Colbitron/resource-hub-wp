import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findRunFiles } from "../e2e/lighthouse-merge.mts";

// Finding the shards' runs before e2e/lighthouse-merge.mts merges them: CI
// downloads each shard's reports into a directory of its own, and a run
// whose shards uploaded nothing must say so plainly.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lighthouse-merge-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findRunFiles", () => {
  it("reports no Lighthouse artifacts, not ENOENT, when the directory is missing", () => {
    const result = findRunFiles(join(root, "lighthouse-shards"));
    expect(result).toEqual({ problem: expect.stringMatching(/^No Lighthouse artifacts found: .*lighthouse-shards does not exist/) });
  });

  it("reports no Lighthouse artifacts when the directory holds no run", () => {
    mkdirSync(join(root, "web-lighthouse-reports-1"));
    writeFileSync(join(root, "web-lighthouse-reports-1", "manifest.json"), "[]");
    expect(findRunFiles(root)).toEqual({ problem: expect.stringMatching(/^No Lighthouse artifacts found: .* holds no lhr-\*\.json file/) });
  });

  it("finds every shard's runs at any depth, and nothing else", () => {
    for (const shard of ["web-lighthouse-reports-1", "web-lighthouse-reports-2"]) {
      mkdirSync(join(root, shard));
      writeFileSync(join(root, shard, "lhr-1.json"), "{}");
      writeFileSync(join(root, shard, "manifest.json"), "[]");
    }
    expect(findRunFiles(root)).toEqual({
      files: [join("web-lighthouse-reports-1", "lhr-1.json"), join("web-lighthouse-reports-2", "lhr-1.json")],
    });
  });
});
