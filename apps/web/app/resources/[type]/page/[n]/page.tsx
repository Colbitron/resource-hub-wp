import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/** `/resources/[type]/page/[n]/`: page `n` of one type. */

// The data layer's interval, as a literal: Next.js reads segment config statically (ADR 0049).
export const revalidate = 3600;

export function generateStaticParams(): { type: string; n: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/resources/[type]/page/[n]">): Promise<Metadata> {
  const { type, n } = await params;
  return listingMetadata({ type, pageSegment: n });
}

export default async function TypePageN({ params }: PageProps<"/resources/[type]/page/[n]">) {
  const { type, n } = await params;
  return <ListingPage request={{ type, pageSegment: n }} />;
}
