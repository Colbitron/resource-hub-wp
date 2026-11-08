import Link from "next/link";

import "@colbitron/resource-hub-ui/not-found.css";

/**
 * The 404 page's content: a heading, a sentence and a link. `app/not-found.tsx`
 * renders it for a 404 decided from the path, and `DataNotFound` renders the
 * same markup into the server HTML of a 404 a route decides from data, so the
 * two are one page. It reads no data, so it can never fail for a reason of
 * its own, and it names nothing of the CMS.
 */
export function NotFoundContent() {
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
