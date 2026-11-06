import Link from "next/link";

import { listingPath, type ListingFilter } from "@/lib/routes";

/** A term as the filter bar shows it: its slug for the path and its name as plain text. */
export interface FilterTerm {
  slug: string;
  name: string;
}

export interface FilterNavProps {
  types: FilterTerm[];
  topics: FilterTerm[];
  /** The filter the page is showing; each link keeps the other dimension and goes back to page 1. */
  current: ListingFilter;
}

interface FilterGroupProps {
  id: string;
  name: string;
  /** The link that clears this dimension. */
  all: { label: string; href: string };
  terms: FilterTerm[];
  /** The slug that is current, if any. */
  selected: string | undefined;
  hrefFor: (slug: string) => string;
}

function FilterGroup({ id, name, all, terms, selected, hrefFor }: FilterGroupProps) {
  return (
    <div className="rh-filters__group">
      <span className="rh-filters__name" id={id}>
        {name}
      </span>
      {/* role="list" because Safari drops list semantics under `list-style: none`. */}
      <ul className="rh-filters__list" aria-labelledby={id} role="list">
        <li>
          <Link className="rh-filters__link" href={all.href} aria-current={selected === undefined ? "true" : undefined}>
            {all.label}
          </Link>
        </li>
        {terms.map((term) => (
          <li key={term.slug}>
            <Link
              className="rh-filters__link"
              href={hrefFor(term.slug)}
              aria-current={term.slug === selected ? "true" : undefined}
            >
              {term.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The filter bar: one row of type links and one of topic links, as plain
 * links to the listing paths (ADR 0024: filters are path segments, so no
 * client JavaScript is needed to change one). The current term in each row
 * carries `aria-current="true"`, and so does "All" when nothing in that row
 * is selected. Each row is a list named by its visible label, so a screen
 * reader hears "Type, list, 6 items" and "Topic, list, 6 items".
 */
export function FilterNav({ types, topics, current }: FilterNavProps) {
  return (
    <nav className="rh-filters" aria-label="Filter resources">
      <FilterGroup
        id="rh-filter-type"
        name="Type"
        all={{ label: "All types", href: listingPath({ topic: current.topic }) }}
        terms={types}
        selected={current.type}
        hrefFor={(type) => listingPath({ type, topic: current.topic })}
      />
      <FilterGroup
        id="rh-filter-topic"
        name="Topic"
        all={{ label: "All topics", href: listingPath({ type: current.type }) }}
        terms={topics}
        selected={current.topic}
        hrefFor={(topic) => listingPath({ type: current.type, topic })}
      />
    </nav>
  );
}
