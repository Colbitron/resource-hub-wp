import Link from "next/link";

import { formatPublishedDate } from "@/lib/dates";
import type { MarkAccent } from "@/lib/type-accents";

import "@colbitron/resource-hub-ui/card.css";

export interface ResourceCardProps {
  title: string;
  /** The resource's public path, `/resources/{type}/{slug}/`. */
  href: string;
  typeLabel: string;
  /** The accent of the type mark beside `typeLabel`: `typeAccent` in `lib/type-accents.ts`, `"neutral"` for a type the table does not know. */
  accent: MarkAccent;
  topicLabels: string[];
  summary: string;
  /** The publication date, ISO 8601 (`date_gmt` from the REST API, with a `Z`). */
  date: string;
  /** The heading level the title takes, so a row fits under the page's own headings. */
  headingLevel?: "h2" | "h3";
}

/**
 * The meta line: the type's name with its mark before it, and the date. The
 * mark is the `::before` of `.rh-card__type`, coloured by `data-accent`
 * (`card.css`); the name is always printed, so the colour only hints. Shared
 * by the row and the lead (`FeaturedLead`), so the two say the type the
 * same way.
 */
export function CardMeta({ typeLabel, accent, date }: Pick<ResourceCardProps, "typeLabel" | "accent" | "date">) {
  return (
    <p className="rh-card__meta">
      <span className="rh-card__type" data-accent={accent}>
        {typeLabel}
      </span>
      <time dateTime={date}>{formatPublishedDate(date)}</time>
    </p>
  );
}

/** The topics as plain labels in a list named "Topics", or nothing when there are none. Shared by the row and the lead. */
export function CardTopics({ topicLabels }: Pick<ResourceCardProps, "topicLabels">) {
  if (topicLabels.length === 0) {
    return null;
  }
  return (
    // role="list" because Safari drops list semantics under `list-style: none`.
    <ul className="rh-card__topics" aria-label="Topics" role="list">
      {topicLabels.map((label) => (
        <li className="rh-card__topic" key={label}>
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * One resource as a row in a list: the meta line (type mark, type, date) in
 * a column beside the title, summary and topics, under a hairline
 * (`packages/ui/DESIGN.md`, "Components"). A server component with plain
 * props and no data fetching: the caller maps the REST payload to these
 * (`toCard` in `lib/wp/cards.ts`). The row has no image; the listing's one
 * image is the lead above the list (`FeaturedLead`). The title's link is the
 * row's only interactive element; `card.css` stretches its hit area over the
 * whole row without nesting anything. The related-resources section (slice
 * 4, issue #50) renders the same rows.
 */
export function ResourceCard({
  title,
  href,
  typeLabel,
  accent,
  topicLabels,
  summary,
  date,
  headingLevel: Heading = "h2",
}: ResourceCardProps) {
  return (
    <article className="rh-card">
      <CardMeta typeLabel={typeLabel} accent={accent} date={date} />
      <div className="rh-card__body">
        <Heading className="rh-card__title">
          <Link className="rh-card__link" href={href}>
            {title}
          </Link>
        </Heading>
        {summary && <p className="rh-card__summary">{summary}</p>}
        <CardTopics topicLabels={topicLabels} />
      </div>
    </article>
  );
}
