import type { Metadata } from "next";
import Link from "next/link";

import "@/components/not-found.css";

/**
 * The site's 404 page, in place of Next.js's default: what `notFound()`
 * renders from a listing (an unknown term, a page past the end) and from the
 * single resource page (an unknown slug), and what an unmatched URL gets.
 * It renders inside the root layout, so inside the shell, on the server: the
 * heading, the sentence and the link are in the response's HTML, readable
 * with no JavaScript. Next.js sends the 404 status and adds `noindex`
 * itself. It reads no data, so it can never fail for a reason of its own,
 * and it names nothing of the CMS.
 */

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="rh-not-found">
      <h1>Page not found</h1>
      <p>There is no page at this address. It may have moved, or the link may be wrong.</p>
      <p>
        <Link href="/resources/">Browse all resources</Link>
      </p>
    </div>
  );
}
