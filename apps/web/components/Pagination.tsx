import Link from "next/link";
import type { ReactNode } from "react";

import { pageWindow } from "@/lib/pagination";
import { listingPath, searchPath, type ListingFilter } from "@/lib/routes";

export type PaginationProps = {
  current: number;
  total: number;
} & (
  | {
      /** A listing's pages, at `listingPath(filter, n)`. */
      filter: ListingFilter;
      search?: never;
    }
  | {
      /** The search results' pages for this normalised query, at `searchPath(search, n)`. */
      search: string;
      filter?: never;
    }
);

interface PageLinkProps {
  href: string;
  /** A plain `<a>`, a full document load, rather than a client-side `<Link>`. */
  document: boolean;
  children: ReactNode;
  rel?: string;
  "aria-label"?: string;
  "aria-current"?: "page";
}

function PageLink({ href, document, children, ...rest }: PageLinkProps) {
  return document ? (
    <a className="rh-pagination__link" href={href} {...rest}>
      {children}
    </a>
  ) : (
    <Link className="rh-pagination__link" href={href} {...rest}>
      {children}
    </Link>
  );
}

/**
 * Previous and next links around the page numbers from `pageWindow`, inside
 * a `nav` named "Pagination", with `aria-current="page"` on the current
 * number. Each number is a link whose accessible name says "Page n", so the
 * list reads as pages and not as bare digits. Previous and next are left out
 * at the ends rather than disabled: a link that goes nowhere is a tab stop
 * for nothing. Renders nothing for a single page.
 *
 * A listing's links are `<Link>`s, prefetched as every ISR page is. The
 * search page's are plain links, a full document load each: the search page
 * is dynamic (ADR 0043, amended), so a prefetch would be a function run and
 * a CMS search for a page the reader may never open, counted by the edge's
 * rate limit, and a load starts focus at the top of the new page as the
 * form's own submission does.
 */
export function Pagination({ filter, search, current, total }: PaginationProps) {
  if (total <= 1) {
    return null;
  }
  const link = (page: number) => (search === undefined ? { href: listingPath(filter, page), document: false } : { href: searchPath(search, page), document: true });
  return (
    <nav className="rh-pagination" aria-label="Pagination">
      {/* role="list" because Safari drops list semantics under `list-style: none`. */}
      <ul className="rh-pagination__list" role="list">
        {current > 1 && (
          <li className="rh-pagination__step">
            <PageLink {...link(current - 1)} rel="prev">
              Previous
            </PageLink>
          </li>
        )}
        {pageWindow(current, total).map((item, index) =>
          item === null ? (
            <li key={`gap-${index}`}>
              <span className="rh-pagination__gap" aria-hidden="true">
                …
              </span>
            </li>
          ) : (
            <li key={item}>
              <PageLink {...link(item)} aria-label={`Page ${item}`} aria-current={item === current ? "page" : undefined}>
                {item}
              </PageLink>
            </li>
          ),
        )}
        {current < total && (
          <li className="rh-pagination__step rh-pagination__step--next">
            <PageLink {...link(current + 1)} rel="next">
              Next
            </PageLink>
          </li>
        )}
      </ul>
    </nav>
  );
}
