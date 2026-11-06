import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/** `/resources/[type]/topic/[topic]/page/[n]/`: page `n` of one type within one topic. */

// The data layer's interval, as a literal: Next.js reads segment config statically.
export const revalidate = 3600;

export function generateStaticParams(): { type: string; topic: string; n: string }[] {
  return [];
}

export async function generateMetadata({
  params,
}: PageProps<"/resources/[type]/topic/[topic]/page/[n]">): Promise<Metadata> {
  const { type, topic, n } = await params;
  return listingMetadata({ type, topic, pageSegment: n });
}

export default async function TypeTopicPageN({ params }: PageProps<"/resources/[type]/topic/[topic]/page/[n]">) {
  const { type, topic, n } = await params;
  return <ListingPage request={{ type, topic, pageSegment: n }} />;
}
