import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resourceTopics } from "../lib/resource-topics";
import { wpResourceSchema } from "../lib/wp/schemas/rest";

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/wp/resource.single.json", import.meta.url)), "utf8"));

describe("resourceTopics", () => {
  it("lists the embedded topics in resource_topic order with plain-text names", () => {
    const resource = wpResourceSchema.parse(FIXTURE);
    const topics = resourceTopics(resource);
    expect(topics.map((topic) => topic.slug)).toEqual(
      resource.resource_topic.map((id) => resource._embedded["wp:term"].flat().find((term) => term.id === id)?.slug),
    );
    expect(topics.every((topic) => topic.name !== "" && !topic.name.includes("&amp;"))).toBe(true);
  });

  it("leaves out a topic ID that is not embedded and lists each slug once", () => {
    const resource = wpResourceSchema.parse({
      ...FIXTURE,
      resource_topic: [9, 9, 999],
      _embedded: {
        "wp:term": [[{ id: 9, slug: "a-b", name: "A &amp; B", taxonomy: "resource_topic" }], []],
      },
    });
    expect(resourceTopics(resource)).toEqual([{ slug: "a-b", name: "A & B" }]);
  });

  it("is empty for a resource with no topics", () => {
    const resource = wpResourceSchema.parse({ ...FIXTURE, resource_topic: [], _embedded: {} });
    expect(resourceTopics(resource)).toEqual([]);
  });
});
