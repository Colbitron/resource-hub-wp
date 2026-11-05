import { ResourceCard, type ResourceCardProps } from "@/components/ResourceCard";

/**
 * A test-only page of cards with fixture props, for e2e/card.spec.ts and for
 * eyeballing the styles. The `.fixture.tsx` extension is a route only when
 * `next.config.ts` adds it to `pageExtensions`, which it does under
 * `RH_FIXTURES=1`; a production build never includes it.
 */

const CARDS: ResourceCardProps[] = [
  {
    title: "Planning a content model before the first post",
    href: "/resources/guide/planning-a-content-model/",
    typeLabel: "Guide",
    topicLabels: ["Content strategy", "WordPress"],
    summary:
      "Where the fields come from, which ones belong in taxonomies, and what to leave out until an editor asks for it.",
    date: "2026-10-28T09:00:00Z",
    image: { src: "/media/2026/10/content-model.jpg", alt: "", width: 1200, height: 800 },
  },
  {
    title: "On-demand revalidation in practice",
    href: "/resources/webinar/on-demand-revalidation-in-practice/",
    typeLabel: "Webinar",
    topicLabels: ["Next.js"],
    summary: "What a CMS has to send, what the front end does with it, and how to see both sides from the editor.",
    date: "2026-09-15T14:30:00Z",
    image: { src: "/media/2026/09/revalidation.jpg", alt: "", width: 1600, height: 600 },
  },
  {
    title: "A very long resource title that wraps across several lines to check that the card still reads well and nothing overflows the box at phone width",
    href: "/resources/report/long-title/",
    typeLabel: "Report",
    topicLabels: ["Accessibility", "Performance", "Core Web Vitals", "Design systems"],
    summary: "",
    date: "2026-08-01T00:00:00Z",
  },
  {
    title: "Measuring layout shift on listing pages",
    href: "/resources/article/measuring-layout-shift/",
    typeLabel: "Article",
    topicLabels: [],
    summary: "Reserved aspect ratios, sized images and why late content is a gate rather than a claim.",
    date: "2026-07-20T12:00:00Z",
    image: { src: "/media/2026/07/layout-shift.jpg", alt: "", width: 800, height: 800 },
  },
];

export default function CardsFixturePage() {
  return (
    <>
      <h1>Card fixtures</h1>
      <ul className="rh-card-grid">
        {CARDS.map((card) => (
          <li key={card.href}>
            <ResourceCard {...card} />
          </li>
        ))}
      </ul>
    </>
  );
}
