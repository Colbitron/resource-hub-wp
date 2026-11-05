import Link from "next/link";

import { pageWindow } from "@/lib/pagination";
import { listingPath, type ListingFilter } from "@/lib/routes";

export interface PaginationProps {
  filter: ListingFilter;
  current: number;
  total: number;
}

/**
 * Previous and next links around the page numbers from `pageWindow`, inside
 * a `nav` named "Pagination", with `aria-current="page"` on the current
 * number. Each number is a link whose accessible name says "Page n", so the
 * list reads as pages and not as bare digits. Previous and next are left out
 * at the ends rather than disabled: a link that goes nowhere is a tab stop
 * for nothing. Renders nothing for a single page.
 */
export function Pagination({ filter, current, total }: PaginationProps) {
  if (total <= 1) {
    return null;
  }
  return (
    <nav className="rh-pagination" aria-label="Pagination">
      {/* role="list" because Safari drops list semantics under `list-style: none`. */}
      <ul className="rh-pagination__list" role="list">
        {current > 1 && (
          <li className="rh-pagination__step">
            <Link className="rh-pagination__link" href={listingPath(filter, current - 1)} rel="prev">
              Previous
            </Link>
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
              <Link
                className="rh-pagination__link"
                href={listingPath(filter, item)}
                aria-label={`Page ${item}`}
                aria-current={item === current ? "page" : undefined}
              >
                {item}
              </Link>
            </li>
          ),
        )}
        {current < total && (
          <li className="rh-pagination__step rh-pagination__step--next">
            <Link className="rh-pagination__link" href={listingPath(filter, current + 1)} rel="next">
              Next
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
