import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { renderRelatedBlock } from "@/components/RelatedResources";
import { CONTENT_SIZES, renderContent, type RenderBlock } from "@/lib/content/render";
import { formatPublishedDate } from "@/lib/dates";
import { cmsUrls } from "@/lib/env";
import type { RenderedResource } from "@/lib/redirects";
import { resourceTopics, type ResourceTopic } from "@/lib/resource-topics";
import { resourcePath, topicListingPath, typeListingPath } from "@/lib/routes";
import { DEFAULT_SHARE_IMAGE } from "@/lib/share-image";
import { shareMetadata } from "@/lib/share-metadata";
import { sourceLink, type SourceLink } from "@/lib/source-link";
import type { MarkAccent } from "@/lib/type-accents";
import { toCard } from "@/lib/wp/cards";
import { featuredImage, openGraphImage, type FeaturedImage } from "@/lib/wp/images";

// The row's labels alone, the type mark and the topics the meta line borrows, not the row's layout.
import "@colbitron/resource-hub-ui/card-labels.css";
import "@colbitron/resource-hub-ui/prose.css";
import "./resource.css";

/**
 * The single resource page's content: one `<article>` with the title, a meta
 * line (the type with its mark, linked to its listing; the published date;
 * the topics, linked to theirs), the featured image, the summary, the body
 * and the source link, in the article direction the owner chose on
 * 2026-11-06 (`packages/ui/DESIGN.md`, "Components", "The article").
 * `resourceMetadata` gives the route its `generateMetadata` from the same
 * data.
 *
 * The meta line borrows the row's labels from the shared `card-labels.css`
 * rather than drawing a second mark, and this component imports that file
 * alone rather than the whole row's `card.css`, so the meta line adds none
 * of the row's layout to a page (inlined CSS is in the HTML twice, once in
 * `<style>` and once in the RSC payload). The resource page loads `card.css`
 * all the same, with `related.css`, for the related section's rows, and is
 * over the whole-document size check for it by the owner's decision
 * (`e2e/document-size.spec.ts`'s docblock has the rule and the numbers).
 * The labels: the type is `.rh-card__type` with its
 * `data-accent`, whose `::before` is the dot, and the topics are
 * `.rh-card__topics` with the short rules between them. The type's name is
 * a link to its listing, inside that span, so the dot is the span's and
 * never part of the link's text or underline: a cobalt dot beside a link
 * is what the mark rule forbids (DESIGN.md, "Colors"), and this keeps the
 * two apart. Why the name stays a link is recorded in DESIGN.md.
 *
 * Its path carries the resource's type, the same on both sites (ADR 0024).
 * The CMS's address never reaches the page (ADR 0040). The URL shape is in
 * `packages/ui/README.md`, and so is the block marker.
 *
 * The route hands over a `RenderedResource` from `resourceForRequest`
 * (`lib/redirects.ts`), so by the time this renders the redirect and 404
 * decisions are made: this component only shows a resource that has a URL,
 * at its canonical URL. It also hands over the related section as `related`
 * (`components/RelatedSection.tsx`, issue #50), rendered last in the
 * article, after the source line: the section makes its own CMS reads and
 * contains its own failures, so it is a slot the route fills rather than a
 * read this component makes, and the design specimen, which renders this
 * component from fixture data, leaves the slot empty and stays fixed data.
 *
 * What is shown comes from the same mappings the cards use, so a card and the
 * page it links to agree: `toCard` for the title (with its untitled rule),
 * the type's name, the date and the summary; `featuredImage` for the image,
 * which is rendered only when it passes the image trust rule and has both
 * dimensions, and `resourceTopics` for the topic links. The body is
 * `content.rendered` through the one server-side pass (`renderContent`),
 * which sanitises it and rewrites its URLs, with `postId` so the marker
 * excludes this resource whatever its HTML says, and `renderRelatedBlock`
 * (`components/RelatedResources.tsx`) so each related-resources block
 * marker in it renders as the front end's own list, and with `leadImage`
 * only when no featured image renders, so the body's first image takes its
 * place as the one priority image and the page never has two.
 *
 * The featured image is the page's one LCP candidate. `preload` (Next.js
 * 16's replacement for the deprecated `priority`) puts a `<link
 * rel="preload">` in the head and makes the `<img>` eager, but sets no fetch
 * priority, and Chromium fetches an image preload at Low. `fetchPriority=
 * "high"` is set beside it: Next.js copies it onto the preload link as well
 * as the `<img>`, so the image is requested at High from the head. Its
 * `sizes` is the content column's, `CONTENT_SIZES` from the pass, the one
 * string the body's images use too; its docblock has the measurement.
 */

/** The page's view of a resource, computed once per render and shared by the component and the metadata. */
interface ResourceView {
  readonly title: string;
  /** The summary as plain text, or `null` when the resource has none. */
  readonly description: string | null;
  readonly typeLabel: string;
  readonly typePath: string;
  /** The type mark's colour, the row's own (`toCard`). */
  readonly accent: MarkAccent;
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
    accent: card.accent,
    date: card.date,
    topics: resourceTopics(rendered.resource),
    image: featuredImage(rendered.resource),
    source: sourceLink(rendered.resource.meta.source_url, cmsUrls()),
    canonical: resourcePath(rendered.type, rendered.slug),
  };
}

/**
 * The metadata for the resource: its title (the root layout's template adds
 * the site name), its summary as the description, or none rather than the
 * site's when it has no summary, its canonical path, and Open Graph fields
 * with the featured image's `/media/…` path when there is a trusted one,
 * and the site's default share image otherwise, named here because an
 * `openGraph` of its own drops the file-based one (`lib/share-image.ts`).
 * That featured image is `openGraphImage`'s choice, not the page's: the
 * same trust rules, but the smallest same-shape size at least
 * `OPEN_GRAPH_MIN_WIDTH` (1200) wide, or the original when none is, since a
 * link preview wants a larger file than the 1024-wide `large` size the page
 * and the card read (`lib/wp/images.ts`). The canonical, `og:url` and
 * `og:image` are paths, which the root layout's `metadataBase`, from the
 * server-only `SITE_URL`, makes absolute on the public origin (see
 * `apps/web/README.md`); with `SITE_URL` unset, as in local work, the first
 * two stay relative and Next.js resolves `og:image` against the
 * deployment's URL. The CMS's absolute URLs are never used (ADR 0040).
 * `shareMetadata` adds the X card type, the large card, since there is
 * always an image.
 */
export function resourceMetadata(rendered: RenderedResource): Metadata {
  const view = resourceView(rendered);
  const image = openGraphImage(rendered.resource);
  return {
    title: view.title,
    description: view.description,
    alternates: { canonical: view.canonical },
    ...shareMetadata({
      type: "article",
      title: view.title,
      ...(view.description === null ? {} : { description: view.description }),
      url: view.canonical,
      publishedTime: view.date,
      images: [
        image === null
          ? DEFAULT_SHARE_IMAGE
          : {
              url: image.src,
              width: image.width,
              height: image.height,
              ...(image.alt === "" ? {} : { alt: image.alt }),
            },
      ],
    }),
  };
}

export interface ResourceArticleProps {
  readonly rendered: RenderedResource;
  /** The related section (`RelatedSection`), rendered after the source line; nothing when left out. */
  readonly related?: ReactNode;
  /**
   * What a related-resources block marker in the body renders as:
   * `renderRelatedBlock`, the front end's list, by default. The design
   * specimen passes the pass's own fallback instead, so it renders from
   * fixture data alone and makes no CMS read.
   */
  readonly renderBlock?: RenderBlock;
}

export function ResourceArticle({ rendered, related, renderBlock = renderRelatedBlock }: ResourceArticleProps) {
  const view = resourceView(rendered);
  const { resource } = rendered;

  return (
    <article className="rh-resource">
      <header className="rh-resource__header">
        <h1 className="rh-resource__title">{view.title}</h1>
        <div className="rh-resource__meta">
          {/* The mark is the span's `::before` (card-labels.css); the link holds the name alone. */}
          <span className="rh-card__type" data-accent={view.accent}>
            <Link className="rh-resource__type" href={view.typePath}>
              {view.typeLabel}
            </Link>
          </span>
          <time dateTime={view.date}>{formatPublishedDate(view.date)}</time>
          {view.topics.length > 0 && (
            // role="list" because Safari drops list semantics under `list-style: none`.
            <ul className="rh-card__topics" aria-label="Topics" role="list">
              {view.topics.map((topic) => (
                <li className="rh-card__topic" key={topic.slug}>
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
            sizes={CONTENT_SIZES}
            preload
            fetchPriority="high"
          />
        </div>
      )}
      {view.description !== null && <p className="rh-resource__summary">{view.description}</p>}
      <div className="rh-resource__body rh-prose">
        {/*
         * The related-resources block (issue #50; the marker is in
         * `packages/ui/README.md`): the pass finds the marker and hands it to
         * `renderRelatedBlock`, which swaps it for `<RelatedResources>`,
         * fetched with the `topic:{slug}` tag, and falls back to the CMS's own
         * rows when that read fails.
         */}
        {renderContent(resource.content.rendered, cmsUrls(), { postId: resource.id, renderBlock, leadImage: view.image === null })}
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
      {related}
    </article>
  );
}
