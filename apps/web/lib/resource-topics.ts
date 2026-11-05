import { plainText } from "./wp/cards";
import type { WpEmbeddedTerm, WpResource } from "./wp/schemas/rest";

/**
 * A resource's topics as the resource page links them: the embedded
 * `resource_topic` terms in the order of `resource_topic`, each once, with
 * the name as plain text (WordPress stores `&` as `&amp;` in a term name). A
 * topic ID that is not embedded is left out, as `toCard` leaves its label
 * out; the two therefore show the same topics in the same order.
 */
export interface ResourceTopic {
  readonly slug: string;
  readonly name: string;
}

export function resourceTopics(resource: WpResource): ResourceTopic[] {
  const seen = new Set<string>();
  const topics: ResourceTopic[] = [];
  for (const id of resource.resource_topic) {
    const term = findEmbedded(resource, id);
    if (term === undefined || seen.has(term.slug)) {
      continue;
    }
    seen.add(term.slug);
    topics.push({ slug: term.slug, name: plainText(term.name) });
  }
  return topics;
}

function findEmbedded(resource: WpResource, id: number): WpEmbeddedTerm | undefined {
  for (const list of resource._embedded["wp:term"]) {
    const term = list.find((candidate) => candidate.taxonomy === "resource_topic" && candidate.id === id);
    if (term !== undefined) {
      return term;
    }
  }
  return undefined;
}
