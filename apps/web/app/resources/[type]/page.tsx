import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";
import { typeListingParams } from "@/lib/prerender";

/**
 * `/resources/[type]/`: one type. The static siblings `topic/` and `page/`
 * win over this segment, so `/resources/topic/…` and `/resources/page/…`
 * never arrive here with those words as a type; a bare `/resources/topic/`
 * or `/resources/page/` does, and is a 404 because both are reserved.
 */

// The data layer's interval, as a literal: Next.js reads segment config statically.
export const revalidate = 3600;

/**
 * Each type's first page, prerendered as an entry to the library when the
 * CMS answers at build, or `[]` when it does not (ADR 0043;
 * `lib/prerender.ts`). Later pages and topic listings stay on demand.
 */
export function generateStaticParams(): Promise<{ type: string }[]> {
  return typeListingParams();
}

export async function generateMetadata({ params }: PageProps<"/resources/[type]">): Promise<Metadata> {
  const { type } = await params;
  return listingMetadata({ type });
}

export default async function TypePage({ params }: PageProps<"/resources/[type]">) {
  const { type } = await params;
  return <ListingPage request={{ type }} />;
}
