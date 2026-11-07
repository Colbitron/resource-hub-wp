import { ResourceCard, type ResourceCardProps } from "@/components/ResourceCard";

import "./related.css";

/**
 * One related resource as a row: the row's props, with the ID as its key.
 * A caller may pass a wider object (`CardData`, with its `image`); only the
 * card's own props reach `ResourceCard`, named one by one, so a field added
 * to `CardData` never reaches the row unasked.
 */
export interface RelatedCard extends ResourceCardProps {
  readonly id: number;
}

export interface RelatedListProps {
  /** The heading's text: the section's fixed title, or the block's from the editor. */
  readonly heading: string;
  /** The heading's level; the rows take the level under it. `h2` by default. */
  readonly headingLevel?: "h2" | "h3";
  /** The rows, in display order, at least one. */
  readonly cards: readonly RelatedCard[];
  /**
   * An `id` for the heading, which also names the section as a region
   * (`aria-labelledby`); left out, the section is a plain grouping with no
   * landmark, for a list that can appear more than once on a page.
   */
  readonly headingId?: string;
}

/**
 * Related resources as the listing shows resources: a heading on a strong
 * rule and the rows of `card.css` under it, each row a `ResourceCard` with
 * its title one heading level below the list's (`packages/ui/DESIGN.md`,
 * "Components"). A server component with plain props and no data fetching;
 * the resource page's section (`RelatedSection`) maps the data layer's
 * answer to these with `toCard`, as the listing does, so a row here and a
 * row in the library are the same markup and say the type the same way.
 *
 * The wrapper carries `rh-related`, the class the contract gives the block
 * marker's wrapper, so the front end's list and the pass's fallback render
 * under the one rule in `related.css` and `prose.css`. The list is an
 * explicit `role="list"` because Safari drops list semantics under
 * `list-style: none`, as every card list here is.
 */
export function RelatedList({ heading, headingLevel: Heading = "h2", cards, headingId }: RelatedListProps) {
  const rowLevel = Heading === "h2" ? "h3" : "h4";
  return (
    <section className="rh-related" aria-labelledby={headingId}>
      <Heading className="rh-related__heading" id={headingId}>
        {heading}
      </Heading>
      <ul className="rh-card-grid" role="list">
        {cards.map(({ id, title, href, typeLabel, accent, topicLabels, summary, date }) => (
          <li key={id}>
            <ResourceCard
              title={title}
              href={href}
              typeLabel={typeLabel}
              accent={accent}
              topicLabels={topicLabels}
              summary={summary}
              date={date}
              headingLevel={rowLevel}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
