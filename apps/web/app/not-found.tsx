import type { Metadata } from "next";

import { NotFoundContent } from "@/components/NotFoundContent";

/**
 * The site's 404 page, in place of Next.js's default. It renders inside the
 * root layout, so inside the shell, on the server, and is what three kinds
 * of 404 show:
 *
 * - a 404 decided from the path alone, which `proxy.ts` rewrites to `/404`,
 *   where Next.js and Vercel serve this page prerendered (issue #46);
 * - a 404 a route decides from data (an unknown slug, an unknown term, a page
 *   past the end, a path no page has) once the page has hydrated: the route
 *   renders `DataNotFound`, whose server HTML is the same content and whose
 *   `notFound()` the client then hands to this page;
 * - a client-side navigation to either.
 *
 * Next.js sends the 404 status and adds `noindex` itself.
 */

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return <NotFoundContent />;
}
