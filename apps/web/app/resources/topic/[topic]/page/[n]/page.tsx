import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/** `/resources/topic/[topic]/page/[n]/`: page `n` of one topic. */

// The data layer's interval, as a literal: Next.js reads segment config statically.
export const revalidate = 3600;

export function generateStaticParams(): { topic: string; n: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/resources/topic/[topic]/page/[n]">): Promise<Metadata> {
  const { topic, n } = await params;
  return listingMetadata({ topic, pageSegment: n });
}

export default async function TopicPageN({ params }: PageProps<"/resources/topic/[topic]/page/[n]">) {
  const { topic, n } = await params;
  return <ListingPage request={{ topic, pageSegment: n }} />;
}
