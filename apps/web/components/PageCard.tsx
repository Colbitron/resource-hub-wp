import Link from "next/link";

import "@colbitron/resource-hub-ui/card.css";

export interface PageCardProps {
  title: string;
  /** The page's public path: `/` or `/{segments}/`. */
  href: string;
  /** The excerpt as plain text; `""` for none. */
  summary: string;
  /** As for `ResourceCard`: `h2` under the page's `h1`. */
  headingLevel?: "h2" | "h3";
}

/**
 * One CMS page as a row in a mixed list, the search results (issue #115):
 * the resource row's shape (`ResourceCard`, `card.css`), so a page and a
 * resource read as rows of one list, with the differences a page has. Its
 * meta line holds the small upper-case label "Page", `.rh-card__kind`, with
 * no type mark, since the mark stands for a resource type and a page has
 * none (`packages/ui/DESIGN.md`, "Components"), and no date, since a page's
 * publish date says little about it; the body has the title, as the row's
 * one stretched link, and the excerpt as the summary, and no topics. A server
 * component with plain props: the caller maps the REST payload with
 * `toPageCard` in `lib/wp/cards.ts`.
 */
export function PageCard({ title, href, summary, headingLevel: Heading = "h2" }: PageCardProps) {
  return (
    <article className="rh-card">
      <p className="rh-card__meta">
        <span className="rh-card__kind">Page</span>
      </p>
      <div className="rh-card__body">
        <Heading className="rh-card__title">
          <Link className="rh-card__link" href={href}>
            {title}
          </Link>
        </Heading>
        {summary && <p className="rh-card__summary">{summary}</p>}
      </div>
    </article>
  );
}
