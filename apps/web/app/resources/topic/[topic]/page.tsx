import type { Metadata } from "next";

import { ListingPage, listingMetadata } from "@/components/ListingPage";

/** `/resources/topic/[topic]/`: one topic across every type. The static `topic` segment wins over `[type]`. */

// The data layer's interval, as a literal: Next.js reads segment config statically (ADR 0049).
export const revalidate = 3600;

export function generateStaticParams(): { topic: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/resources/topic/[topic]">): Promise<Metadata> {
  const { topic } = await params;
  return listingMetadata({ topic });
}

export default async function TopicPage({ params }: PageProps<"/resources/topic/[topic]">) {
  const { topic } = await params;
  return <ListingPage request={{ topic }} />;
}
