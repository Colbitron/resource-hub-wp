---
status: accepted
date: 2026-11-05
---

# Listings are ISR routes that render on their first request, not at build

The eight listing routes under `apps/web/app/resources/` (the library, a type, a topic, a type within a topic, and page `n` of each; [ADR 0034](0034-filters-and-pagination-are-path-segments.md)) are Incremental Static Regeneration routes: each exports `revalidate = 3600`, the data layer's interval written as a literal because Next.js reads segment config statically ([ADR 0049](0049-data-layer-fetch-policy.md)), and a `generateStaticParams` that returns `[]`, so `next build` prerenders none of them and asks the CMS for nothing. A listing is rendered on its first request, stored, served from the route cache from then on (`x-nextjs-cache: HIT`, `s-maxage=3600`), cleared by the revalidation events of [ADR 0046](0046-which-tags-and-paths-each-event-revalidates.md) through the tags its fetches carry, and re-rendered by the interval as the safety net ([ADR 0043](0043-fetch-cache-with-tags-without-cache-components.md)).

## The build never needs the CMS

A build that renders pages from the CMS couples a front-end deploy to the CMS being up and in step, and makes a Vercel preview build fail for a reason that has nothing to do with the change. With no page prerendered, the build is a function of the code alone, and the deploy order of the root `CLAUDE.md` (the CMS first, then the front end) is what keeps the first renders correct. The cost is one render per listing on its first visit after a deploy, against the Data Cache, which survives deploys.

The library's own path, `/resources/`, has no dynamic segment, and a route with none is prerendered at build whatever `generateStaticParams` says. It is therefore the optional catch-all `app/resources/[[...rest]]/page.tsx`, which gives it a `generateStaticParams` to return `[]` from. Static and dynamic siblings win over a catch-all in the App Router, so the page serves `/resources/` alone: `rest` is empty there, and a path that fell through every other route to it is a 404. The precedence was checked under `next start`: `/resources/topic/accessibility/` reaches `topic/[topic]`, not `[type]` with a type called `topic`; `/resources/page/2/` reaches `page/[n]`; a bare `/resources/topic/` or `/resources/page/` reaches `[type]` and is a 404 because both words are reserved.

## What a listing never does

- Read `searchParams`, `headers()` or `cookies()`, or call `connection()`: each makes the route dynamic, and `connection()` with a `generateStaticParams` returning `[]` is a 500 on every request ([ADR 0035](0035-type-paths-with-a-computed-no-store-308.md)'s measurement).
- Redirect. A `permanentRedirect()` from an ISR route is stored with `s-maxage`, so the canonical-form redirects come from `proxy.ts` (ADR 0035's listings amendment).

## What a listing answers

- A segment that cannot be a type slug, a topic slug or a page number 2 or more is `notFound()` before any request.
- A type or topic that names no term, or a page past the last, is `notFound()` after the data layer answers `null` or `NO_SUCH_PAGE`. The 404 is stored like a 200, under the tags of the fetches that decided it (the term lookup's `type:{slug}` or `topic:{slug}`, the listing's tags), so a term `create` or a publish that adds a page clears it.
- A filter combination with no resources, when both terms exist, is a 200 with an empty state: it is a page with nothing on it, not a missing page.

## Considered options

- **A plain `app/resources/page.tsx` for the library.** Prerendered at build, so the build needs the CMS and fails without it. Rejected.
- **Prerender every listing at build from `generateStaticParams`.** Fast first visits, at the cost of a build that depends on the CMS and grows with the topics editors add. Rejected for the demo; the first-request render is one render per listing.
- **Catching the CMS error at build and rendering a placeholder.** The placeholder would be stored and served until an event or the interval. Rejected.
- **A rewrite from `/resources/` to `/resources/page/1/`.** Would render the library through the pagination route, with a path that the proxy redirects away from and that the revalidate route's `revalidatePath('/resources/')` would not name. Rejected.

## Consequences

- Each route file is a thin shell over `components/ListingPage.tsx`: it parses its segments, exports the two constants, and hands the segments to one component and one `listingMetadata`.
- A title and a canonical `link` are set per listing from the path builders in `lib/routes.ts`; the canonical is a path, which Next.js makes absolute with `metadataBase`, taken from the Vercel deployment's production URL when none is configured. The CMS's absolute URLs are never used ([ADR 0040](0040-the-cms-url-never-reaches-the-browser.md)).
- Every fetch a listing makes carries the tags of ADR 0046, so `e2e/listings.spec.ts` proves that a `publish` reaches the library, the type, the topic and the type-within-topic listings, and a `trash` takes the resource off them.
- Adding `generateStaticParams` entries later (say, the first page of every listing) is a one-line change per route and makes the build need the CMS; this record is the one to amend.
