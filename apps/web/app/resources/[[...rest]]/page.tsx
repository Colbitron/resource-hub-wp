import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/**
 * `/resources/`: the library, every published resource, newest first.
 *
 * An optional catch-all rather than a plain `app/resources/page.tsx` because a
 * route with no dynamic segment is prerendered at build, and that render would
 * need the CMS; a dynamic segment with `generateStaticParams` returning `[]` is
 * rendered on its first request instead, like every other listing, and stored
 * by ISR from then on (ADR 0043; see `docs/architecture/caching.md`). Static
 * and dynamic siblings win over a catch-all, so this page serves `/resources/`
 * only: `rest` is empty there, and any path that fell through to it is a 404.
 */

// The data layer's interval, as a literal: Next.js reads segment config statically.
export const revalidate = 3600;

export function generateStaticParams(): { rest: string[] }[] {
  return [];
}

export function generateMetadata(): Promise<Metadata> {
  return listingMetadata({});
}

export default async function LibraryPage({ params }: PageProps<"/resources/[[...rest]]">) {
  const { rest } = await params;
  if (rest !== undefined && rest.length > 0) {
    notFound();
  }
  return <ListingPage request={{}} />;
}
