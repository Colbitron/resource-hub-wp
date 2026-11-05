import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/** `/resources/page/[n]/`: page `n` of the library. */

// The data layer's interval, as a literal: Next.js reads segment config statically (ADR 0049).
export const revalidate = 3600;

export function generateStaticParams(): { n: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/resources/page/[n]">): Promise<Metadata> {
  const { n } = await params;
  return listingMetadata({ pageSegment: n });
}

export default async function LibraryPageN({ params }: PageProps<"/resources/page/[n]">) {
  const { n } = await params;
  return <ListingPage request={{ pageSegment: n }} />;
}
