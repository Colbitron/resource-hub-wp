import type { CSSProperties } from "react";
import Link from "next/link";

import "./brand.css";

/**
 * Colbination's mark and the site's lockup (`packages/ui/DESIGN.md`,
 * "Brand"). Colbination publishes the site; the site's own name stays
 * "Resource Hub", so the lockup is the publisher's mark beside the site's
 * wordmark, and the two together are the header's one home link.
 *
 * The mark is the publisher's own favicon drawing: a coral rounded square
 * with a "C" cut from it, tilted six degrees over its shadow square, in its
 * own two fixed colours in both schemes (a logo, not a token). `app/icon.svg`
 * is the same drawing as the site's icon, and `test/brand-mark.test.tsx`
 * checks the two never drift apart. It is decorative wherever it is drawn
 * (`aria-hidden`, `focusable="false"`): the wordmark beside it carries the
 * name, so the home link's accessible name is "Resource Hub" and nothing
 * else.
 */
export function BrandMark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g transform="rotate(-6 32 32)">
        <rect x="13" y="13" width="44" height="44" rx="11" fill="#1b1436" />
        <rect x="8" y="8" width="44" height="44" rx="11" fill="#ff5a4f" stroke="#1b1436" strokeWidth="4" />
        <path d="M37.8 22.2a11 11 0 1 0 0 15.6" fill="none" stroke="#1b1436" strokeWidth="7" />
      </g>
    </svg>
  );
}

/**
 * The lockup as the header renders it: the mark and the wordmark "Resource
 * Hub", in Figtree at the heading weight, as one link to the library. The
 * mark is sized from the wordmark (`brand.css`), so the two scale together
 * with the reader's text size.
 */
export function BrandLockup() {
  return (
    <Link className="rh-brand" href="/resources/">
      <BrandMark className="rh-brand__mark" />
      <span className="rh-brand__name">Resource Hub</span>
    </Link>
  );
}
