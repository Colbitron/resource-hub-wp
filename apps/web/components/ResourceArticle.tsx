import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { renderContent } from "@/lib/content/render";
import { formatPublishedDate } from "@/lib/dates";
import { cmsUrls } from "@/lib/env";
import type { RenderedResource } from "@/lib/redirects";
import { resourceTopics, type ResourceTopic } from "@/lib/resource-topics";
import { resourcePath, topicListingPath, typeListingPath } from "@/lib/routes";
import { sourceLink, type SourceLink } from "@/lib/source-link";
import { toCard } from "@/lib/wp/cards";
import { featuredImage, type FeaturedImage } from "@/lib/wp/images";

import "./prose.css";
import "./resource.css";

/**
 * The single resource page's content: one `<article>` with the title, a meta
 * line (the type, linked to its listing; the published date; the topics,
 * linked to theirs), the featured image, the summary, the body and the source
 * link. `resourceMetadata` gives the route its `generateMetadata` from the
 * same data.
 *
 * Its path carries the resource's type, the same on both sites (ADR 0024).
 * The CMS's address never reaches the page (ADR 0040). The URL shape is in
 * `packages/ui/README.md`, and so is the block marker. The related list the
 * marker stands for is not built yet (issue #50).
 *
 * The route hands over a `RenderedResource` from `resourceForRequest`
 * (`lib/redirects.ts`), so by the time this renders the redirect and 404
 * decisions are made: this component only shows a resource that has a URL,
 * at its canonical URL.
 *
 * What is shown comes from the same mappings the cards use, so a card and the
 * page it links to agree: `toCard` for the title (with its untitled rule),
 * the type's name, the date and the summary; `featuredImage` for the image,
 * which is rendered only when it passes the image trust rule and has both
 * dimensions, and `resourceTopics` for the topic links. The body is
 * `content.rendered` through the one server-side pass (`renderContent`),
 * which sanitises it and rewrites its URLs, with `postId` so the marker
 * excludes this resource whatever its HTML says.
 *
 * The featured image is the page's one LCP candidate. `preload` (Next.js
 * 16's replacement for the deprecated `priority`) puts a `<link
 * rel="preload">` in the head and makes the `<img>` eager, but sets no fetch
 * priority, and Chromium fetches an image preload at Low. `fetchPriority=
 * "high"` is set beside it: Next.js copies it onto the preload link as well
 * as the `<img>`, so the image is requested at High from the head. Its
 * `sizes` is the content column's, the same string the body's images use.
 */

/**
 * `sizes` for the featured image: the content column is `--rh-measure`
 * (65ch, about 40rem at the system font) and `sizes` cannot read a CSS
 * variable, so it is written out, rounded up, as `CONTENT_SIZES` in
 * `lib/content/render.tsx` is for the body's images.
 */
const IMAGE_SIZES = "(max-width: 40rem) 100vw, 40rem";

/** The page's view of a resource, computed once per render and shared by the component and the metadata. */
interface ResourceView {
  readonly title: string;
  /** The summary as plain text, or `null` when the resource has none. */
  readonly description: string | null;
  readonly typeLabel: string;
  readonly typePath: string;
  /** `date_gmt` as an ISO 8601 instant, for `<time>` and `publishedTime`. */
  readonly date: string;
  readonly topics: readonly ResourceTopic[];
  readonly image: FeaturedImage | null;
  readonly source: SourceLink | null;
  readonly canonical: string;
}

function resourceView(rendered: RenderedResource): ResourceView {
  const card = toCard(rendered.resource);
  if (card === null) {
    // `resourceForRequest` renders only a resource `resourceType` gives a type for, which is what `toCard` needs.
    throw new Error("The resource has no URL, so it cannot be rendered");
  }
  const description = card.summary.replace(/\s+/g, " ").trim();
  return {
    title: card.title,
    description: description === "" ? null : description,
    typeLabel: card.typeLabel,
    typePath: typeListingPath(rendered.type),
    date: card.date,
    topics: resourceTopics(rendered.resource),
    image: featuredImage(rendered.resource),
    source: sourceLink(rendered.resource.meta.source_url, cmsUrls()),
    canonical: resourcePath(rendered.type, rendered.slug),
  };
}

/**
 * The metadata for the resource: its title (the root layout's template adds the
 * site name), its summary as the description, or none rather than the site's
 * when it has no summary, its canonical path, and Open Graph fields with the
 * featured image's `/media/…` path when there is a trusted one. The canonical,
 * `og:url` and `og:image` are paths, which the root layout's `metadataBase`,
 * from the server-only `SITE_URL`, makes absolute on the public origin (see
 * `apps/web/README.md`); with `SITE_URL` unset, as in local work, the first two
 * stay relative and Next.js resolves `og:image` against the deployment's URL.
 * The CMS's absolute URLs are never used (ADR 0040).
 */
export function resourceMetadata(rendered: RenderedResource): Metadata {
  const view = resourceView(rendered);
  return {
    title: view.title,
    description: view.description,
    alternates: { canonical: view.canonical },
    openGraph: {
      type: "article",
      title: view.title,
      ...(view.description === null ? {} : { description: view.description }),
      url: view.canonical,
      publishedTime: view.date,
      ...(view.image === null
        ? {}
        : {
            images: [
              {
                url: view.image.src,
                width: view.image.width,
                height: view.image.height,
                ...(view.image.alt === "" ? {} : { alt: view.image.alt }),
              },
            ],
          }),
    },
  };
}

export function ResourceArticle({ rendered }: { rendered: RenderedResource }) {
  const view = resourceView(rendered);
  const { resource } = rendered;

  return (
    <article className="rh-resource">
      <header className="rh-resource__header">
        <h1 className="rh-resource__title">{view.title}</h1>
        <div className="rh-resource__meta">
          <Link className="rh-resource__type" href={view.typePath}>
            {view.typeLabel}
          </Link>
          <time dateTime={view.date}>{formatPublishedDate(view.date)}</time>
          {view.topics.length > 0 && (
            // role="list" because Safari drops list semantics under `list-style: none`.
            <ul className="rh-resource__topics" aria-label="Topics" role="list">
              {view.topics.map((topic) => (
                <li key={topic.slug}>
                  <Link className="rh-resource__topic" href={topicListingPath(topic.slug)}>
                    {topic.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>
      {view.image !== null && (
        <div className="rh-resource__media">
          <Image
            src={view.image.src}
            alt={view.image.alt}
            width={view.image.width}
            height={view.image.height}
            sizes={IMAGE_SIZES}
            preload
            fetchPriority="high"
          />
        </div>
      )}
      {view.description !== null && <p className="rh-resource__summary">{view.description}</p>}
      <div className="rh-resource__body rh-prose">
        {/*
         * The related-resources block, not built yet (issue #50; the marker
         * is in `packages/ui/README.md`): the pass finds the marker and hands
         * it to `renderBlock`, whose default renders the CMS's own fallback
         * list. Slice 4 passes `renderBlock` here to swap the marker for
         * `<RelatedResources>`, fetched with the `topic:{slug}` tag.
         */}
        {renderContent(resource.content.rendered, cmsUrls(), { postId: resource.id })}
      </div>
      {view.source !== null && (
        <footer className="rh-resource__source">
          <p>
            Source:{" "}
            {view.source.external ? (
              <a href={view.source.href} rel="noopener noreferrer">
                {view.source.label}
              </a>
            ) : (
              <a href={view.source.href}>{view.source.label}</a>
            )}
          </p>
        </footer>
      )}
    </article>
  );
}
