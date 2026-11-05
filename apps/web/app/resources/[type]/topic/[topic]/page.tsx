import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/** `/resources/[type]/topic/[topic]/`: one type within one topic. */

// The data layer's interval, as a literal: Next.js reads segment config statically (ADR 0049).
export const revalidate = 3600;

export function generateStaticParams(): { type: string; topic: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/resources/[type]/topic/[topic]">): Promise<Metadata> {
  const { type, topic } = await params;
  return listingMetadata({ type, topic });
}

export default async function TypeTopicPage({ params }: PageProps<"/resources/[type]/topic/[topic]">) {
  const { type, topic } = await params;
  return <ListingPage request={{ type, topic }} />;
}
