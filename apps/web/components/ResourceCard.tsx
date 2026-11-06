import Image from "next/image";
import Link from "next/link";

import { formatPublishedDate } from "@/lib/dates";

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
  /**
   * Load the image eagerly and at high fetch priority, for the cards a listing
   * shows in its first row, where the LCP element usually is. Defaults to false
   * (lazy). Next 16 deprecates `priority` on `next/image` and advises against
   * `preload` when several images could be the LCP element depending on the
   * viewport, as a row of cards is, so this sets `loading` and `fetchPriority`.
   */
  priority?: boolean;
}

/**
 * The rendered width of a card in `.rh-card-grid` (card.css) inside
 * `.rh-shell__inner` (shell.css): columns of at least 17rem with 1.5rem gaps,
 * in a box at most 72rem wide with a 1rem gutter each side, so the content is
 * 100vw - 2rem wide, capped at 70rem.
 * - Two columns fit from 2 × 17 + 1.5 + 2 = 37.5rem; each is about 50vw.
 * - Three fit from 3 × 17 + 3 + 2 = 56rem; each is about 33vw.
 * - Four never fit in 70rem, so from 74rem (72rem + gutters) a column stops
 *   growing at (70 - 3) / 3 ≈ 22.3rem, about 357px.
 * Change these with the grid's minimum, gap or the shell's width.
 */
const IMAGE_SIZES = "(min-width: 74rem) 22.5rem, (min-width: 56rem) 33vw, (min-width: 37.5rem) 50vw, 100vw";

/**
 * One resource in a listing. A server component with plain props and no data
 * fetching: the caller maps the REST payload to these. The title's link is the
 * card's only interactive element; `card.css` stretches its hit area over the
 * whole card without nesting anything (the trade-off is in `card.css`'s
 * header).
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
  priority = false,
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
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
          />
        </div>
      )}
      <div className="rh-card__body">
        <p className="rh-card__meta">
          <span className="rh-card__type">{typeLabel}</span>
          <time dateTime={date}>{formatPublishedDate(date)}</time>
        </p>
        <Heading className="rh-card__title">
          <Link className="rh-card__link" href={href}>
            {title}
          </Link>
        </Heading>
        {summary && <p className="rh-card__summary">{summary}</p>}
        {topicLabels.length > 0 && (
          // role="list" because Safari drops list semantics under `list-style: none`.
          <ul className="rh-card__topics" aria-label="Topics" role="list">
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
