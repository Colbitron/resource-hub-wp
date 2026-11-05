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
- A page the CMS counts resources on but none of whose resources can be shown (each fails the reader schema of [ADR 0049](0049-data-layer-fetch-policy.md), on a list too short to throw) is a 200 that says "The resources on this page can't be shown." The copy makes no claim that the problem is passing, because the 200 is stored for up to the interval like any other, and that state alone carries `noindex`, so a stored broken page is not indexed. A list of four or more in which more than half fail, a list whose items all fail included, is a 500 instead: the data layer throws under ADR 0049's list threshold, and ISR keeps serving the last good render where it has one.

## What it costs

- **Any resource event re-renders every cached listing.** Each listing renders the filter bar, which reads the two taxonomy lists, and those carry `resources` as well as `terms` ([ADR 0046](0046-which-tags-and-paths-each-event-revalidates.md), `taxonomyListTags`) so each term's `count` stays right: WordPress changes a count on every publish and trash with no term event. A `publish` of one webinar therefore marks every stored listing stale, not only the library, the webinar listing and its topics'. The re-render is cheap, since the listing fetches of the listings the event did not touch keep their own tags and stay cached, so it costs the two term-list reads and a render. The alternative, if the re-renders ever show up in function time, is to split the term-count lists from `resources`, by reading the bar's terms without counts or under a tag of their own that only events which change a count clear.
- **Every distinct junk path under `/resources/**` stores its own 404.** A 404 from a listing is stored for up to the interval like a 200, and a single unknown segment (`/resources/anything/`) costs one CMS term lookup before it. That is by design: the 404 is stored under the lookup's `type:` or `topic:` tag, so creating that term later clears it. It is also a cache-growth and CMS-load surface, since a crawler or an attacker can mint unlimited distinct paths, each a stored entry and a CMS request. The mitigation is at the edge, not in the app: a Vercel Firewall rate-limit rule on `/resources/` paths per client, set in the project when the site is public.

## Follow-ups for slice 3

- **`metadataBase` from a server-only `SITE_URL`.** The canonical `link` renders as a relative path today: with no `metadataBase` set, Next.js 16 resolves alternates against nothing, and its fallback to the Vercel deployment's URL (`VERCEL_PROJECT_PRODUCTION_URL`, or the branch URL on a preview) applies to social images only. Set `metadataBase` in the root layout from a `SITE_URL` environment variable, read on the server and never `NEXT_PUBLIC_`, so the canonical is absolute and names the public domain on every deployment. Not implemented in this pull request.
- **The resource page makes the relative canonical visible everywhere.** The single resource page (`/resources/[type]/[slug]/`) sets its canonical `link` and `og:url` from the same path builders, so until `metadataBase` lands every resource page, not only every listing, carries a relative canonical; `og:image` is already absolute through Next.js's deployment-URL fallback.

## Considered options

- **A plain `app/resources/page.tsx` for the library.** Prerendered at build, so the build needs the CMS and fails without it. Rejected.
- **Prerender every listing at build from `generateStaticParams`.** Fast first visits, at the cost of a build that depends on the CMS and grows with the topics editors add. Rejected for the demo; the first-request render is one render per listing.
- **Catching the CMS error at build and rendering a placeholder.** The placeholder would be stored and served until an event or the interval. Rejected.
- **A rewrite from `/resources/` to `/resources/page/1/`.** Would render the library through the pagination route, with a path that the proxy redirects away from and that the revalidate route's `revalidatePath('/resources/')` would not name. Rejected.

## Consequences

- Each route file is a thin shell over `components/ListingPage.tsx`: it parses its segments, exports the two constants, and hands the segments to one component and one `listingMetadata`.
- A title and a canonical `link` are set per listing from the path builders in `lib/routes.ts`; the canonical is a path, and renders relative until `metadataBase` is set (the follow-up above). The CMS's absolute URLs are never used ([ADR 0040](0040-the-cms-url-never-reaches-the-browser.md)).
- After a client-side navigation from one listing to another (a filter or a page link), focus moves to the new listing's `<h1>`, which carries `tabIndex={-1}`: Next.js announces the new title but leaves focus where it was, which is `<body>` once the clicked link is gone. `components/ListingFocus.tsx` does it, the listings' one client component; a full page load takes no focus. In forced-colours mode the current filter and the current page are marked by an outline and a thick underline, since the fill that marks them otherwise is dropped.
- Every fetch a listing makes carries the tags of ADR 0046, so `e2e/listings.spec.ts` proves that a `publish` reaches the library, the type, the topic and the type-within-topic listings, and a `trash` takes the resource off them.
- Adding `generateStaticParams` entries later (say, the first page of every listing) is a one-line change per route and makes the build need the CMS; this record is the one to amend.
