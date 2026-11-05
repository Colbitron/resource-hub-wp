"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** The listing path the last mounted `ListingFocus` saw, across client navigations. */
let lastPathname: string | null = null;

/**
 * Moves focus to the listing's heading after a client-side navigation from
 * one listing to another: a filter link or a pagination link. Next.js's
 * router announces the new title but leaves focus where it was, which after
 * the old page's link is gone is `<body>`, so a keyboard user would start
 * again from the top of the document. Focus lands on the `<h1>` (which
 * carries `tabIndex={-1}`) instead, the next Tab reaches the filters, and
 * the scroll stays Next.js's to manage (`preventScroll`).
 *
 * The first listing a visit renders takes no focus, so a full page load
 * keeps the browser's own start, the skip link first. The last path is kept
 * at module scope, not in a ref, because each listing route is a separate
 * page that mounts its own copy; comparing paths also keeps React's
 * development double effect from focusing on load. Renders nothing.
 */
export function ListingFocus({ targetId }: { targetId: string }) {
  const pathname = usePathname();
  useEffect(() => {
    const previous = lastPathname;
    lastPathname = pathname;
    if (previous === null || previous === pathname) {
      return;
    }
    document.getElementById(targetId)?.focus({ preventScroll: true });
  }, [pathname, targetId]);
  return null;
}
