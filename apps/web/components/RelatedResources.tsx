import type { ReactNode } from "react";

import { RelatedList, type RelatedCard } from "@/components/RelatedList";
import type { RelatedBlockProps, RenderBlock } from "@/lib/content/render";
import { plainText } from "@/lib/wp/cards";
import { CmsError } from "@/lib/wp/fetch";
import { getNewestInTopic, RELATED_BLOCK_SPARE, toRelatedCard } from "@/lib/wp/related";
import type { WpResource } from "@/lib/wp/schemas/rest";

export interface RelatedResourcesProps extends RelatedBlockProps {
  /** The marker as the content pass renders it: the CMS's heading and rows, with its URLs rewritten. */
  readonly fallback: ReactNode;
}

/** The heading when the marker has none and no row names the topic. */
export const RELATED_BLOCK_HEADING = "Related resources";

/** The topic's name as a row embeds it, for a heading the marker did not give; `null` when no row carries the term. */
function topicName(resources: readonly WpResource[], topicId: number): string | null {
  for (const resource of resources) {
    for (const terms of resource._embedded["wp:term"]) {
      const term = terms.find((candidate) => candidate.taxonomy === "resource_topic" && candidate.id === topicId);
      if (term !== undefined) {
        return plainText(term.name);
      }
    }
  }
  return null;
}

/**
 * The `resource-hub/related-resources` block on the front end (issue #50;
 * the marker is in `packages/ui/README.md`, "Block marker"): in place of
 * the marker the content pass found in a body, the newest `count` published
 * resources in the marker's topic, the post the block sits in left out, as
 * the related list's rows (`RelatedList`), under the heading the editor
 * gave the block at the level the pass says (`headingLevel`: one level down
 * when the body's own headings are). One fetch per marker, of core's
 * collection filtered by `resource_topic`, tagged `relatedBlockTags(topic)`
 * so a topic event or any resource event in the topic clears it, and a
 * body puts at most `MAX_MARKERS` markers through here.
 *
 * It asks for `count + RELATED_BLOCK_SPARE` resources and keeps the first
 * `count` after leaving out the host and the rows `toRelatedCard` refuses
 * (no visible title, no type), so a dropped row is filled from the next
 * newest; more than the spare dropped in a row leaves the block short. A
 * marker with no heading takes "More on {Topic}" from the topic's name as
 * a row embeds it, or `RELATED_BLOCK_HEADING` when no row carries it.
 *
 * What it renders: nothing when no row is left, rather than a heading over
 * an empty list; on a `CmsError` from the fetch, the `fallback` the pass
 * gave it, the CMS's own rendering of the block with its URLs rewritten,
 * logged, so a body never fails its page for its related block. Any other
 * error is a bug and still fails the page. The CMS's address reaches
 * neither the rows nor the fallback (ADR 0040).
 *
 * An async server component; `renderRelatedBlock` is the `renderBlock` the
 * resource page and the CMS page pass to `renderContent`.
 */
export async function RelatedResources({ count, topic, topicId, exclude, heading, headingLevel, fallback }: RelatedResourcesProps) {
  let cards: RelatedCard[];
  let title: string;
  try {
    const resources = await getNewestInTopic({ topicId, topicSlug: topic, count: count + RELATED_BLOCK_SPARE });
    cards = resources
      .filter((resource) => resource.id !== exclude)
      .map(toRelatedCard)
      .filter((card): card is NonNullable<typeof card> => card !== null)
      .slice(0, count);
    const name = topicName(resources, topicId);
    title = heading ?? (name === null ? RELATED_BLOCK_HEADING : `More on ${name}`);
  } catch (error) {
    if (!(error instanceof CmsError)) {
      throw error;
    }
    console.error("RelatedResources: the block's read failed; rendering the CMS's fallback", error);
    return fallback;
  }
  if (cards.length === 0) {
    return null;
  }
  return <RelatedList heading={title} headingLevel={headingLevel} cards={cards} />;
}

/** The `renderBlock` for `renderContent`: the marker as `<RelatedResources>`, with the pass's fallback. */
export const renderRelatedBlock: RenderBlock = (props, fallback) => <RelatedResources {...props} fallback={fallback} />;
