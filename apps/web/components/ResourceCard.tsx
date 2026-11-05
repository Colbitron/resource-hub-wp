import Image from "next/image";
import Link from "next/link";

import "@colbitron/resource-hub-ui/card.css";

/** An image for the card, already rewritten to the same-origin `/media/…` path (ADR 0040). */
export interface ResourceCardImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface ResourceCardProps {
  title: string;
  /** The resource's public path, `/resources/{type}/{slug}/`. */
  href: string;
  typeLabel: string;
  topicLabels: string[];
  summary: string;
  /** The publication date, ISO 8601 (`date_gmt` from the REST API, with a `Z`). */
  date: string;
  image?: ResourceCardImage;
  /** The heading level the title takes, so a card fits under the page's own headings. */
  headingLevel?: "h2" | "h3";
}

/** Cards sit in a grid of ~17rem columns: one at phone width, two on tablets, then a bounded width. */
const IMAGE_SIZES = "(max-width: 40rem) 100vw, (max-width: 64rem) 50vw, 24rem";

const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/**
 * One resource in a listing. A server component with plain props and no data
 * fetching: the caller maps the REST payload to these. The title's link is the
 * card's only interactive element; `card.css` stretches its hit area over the
 * whole card without nesting anything (ADR 0045).
 */
export function ResourceCard({
  title,
  href,
  typeLabel,
  topicLabels,
  summary,
  date,
  image,
  headingLevel: Heading = "h2",
}: ResourceCardProps) {
  return (
    <article className="rh-card">
      {image && (
        <div className="rh-card__media">
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes={IMAGE_SIZES}
          />
        </div>
      )}
      <div className="rh-card__body">
        <p className="rh-card__meta">
          <span className="rh-card__type">{typeLabel}</span>
          <time dateTime={date}>{DATE_FORMAT.format(new Date(date))}</time>
        </p>
        <Heading className="rh-card__title">
          <Link className="rh-card__link" href={href}>
            {title}
          </Link>
        </Heading>
        {summary && <p className="rh-card__summary">{summary}</p>}
        {topicLabels.length > 0 && (
          <ul className="rh-card__topics" aria-label="Topics">
            {topicLabels.map((label) => (
              <li className="rh-card__topic" key={label}>
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
