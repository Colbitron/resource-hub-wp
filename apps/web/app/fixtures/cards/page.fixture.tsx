import { ResourceCard, type ResourceCardProps } from "@/components/ResourceCard";

/**
 * A test-only page of cards with fixture props, for e2e/card.spec.ts and for
 * eyeballing the styles. The `.fixture.tsx` extension is a route only when
 * `next.config.ts` adds it to `pageExtensions`, which it does under
 * `RH_FIXTURES=1`; a production build never includes it.
 */

/** Four rows: a type the accent table does not know (a neutral mark), a known one, a long title with many topics, and one with no summary or topics. */
const CARDS: ResourceCardProps[] = [
  {
    title: "Planning a content model before the first post",
    href: "/resources/guide/planning-a-content-model/",
    typeLabel: "Guide",
    accent: "neutral",
    topicLabels: ["Content strategy", "WordPress"],
    summary:
      "Where the fields come from, which ones belong in taxonomies, and what to leave out until an editor asks for it.",
    date: "2026-10-28T09:00:00Z",
  },
  {
    title: "On-demand revalidation in practice",
    href: "/resources/webinar/on-demand-revalidation-in-practice/",
    typeLabel: "Webinar",
    accent: "coral",
    topicLabels: ["Next.js"],
    summary: "What a CMS has to send, what the front end does with it, and how to see both sides from the editor.",
    date: "2026-09-15T14:30:00Z",
  },
  {
    title: "A very long resource title that wraps across several lines to check that the row still reads well and nothing overflows the box at phone width",
    href: "/resources/report/long-title/",
    typeLabel: "Report",
    accent: "neutral",
    topicLabels: ["Accessibility", "Performance", "Core Web Vitals", "Design systems"],
    summary: "",
    date: "2026-08-01T00:00:00Z",
  },
  {
    title: "Measuring layout shift on listing pages",
    href: "/resources/article/measuring-layout-shift/",
    typeLabel: "Article",
    accent: "mint",
    topicLabels: [],
    summary: "Reserved aspect ratios, sized images and why late content is a gate rather than a claim.",
    date: "2026-07-20T12:00:00Z",
  },
];

export default function CardsFixturePage() {
  return (
    <>
      <h1>Card fixtures</h1>
      <ul className="rh-card-grid" role="list">
        {CARDS.map((card) => (
          <li key={card.href}>
            <ResourceCard {...card} />
          </li>
        ))}
      </ul>
    </>
  );
}
