import type { Metadata } from "next";

import { renderRelatedBlock } from "@/components/RelatedResources";
import { renderContent, type RenderBlock } from "@/lib/content/render";
import { cmsUrls } from "@/lib/env";
import type { RenderedPage } from "@/lib/page-request";
import { DEFAULT_SHARE_IMAGE } from "@/lib/share-image";
import { shareMetadata } from "@/lib/share-metadata";
import { plainText } from "@/lib/wp/cards";
import type { WpPage } from "@/lib/wp/schemas/rest";

import "@colbitron/resource-hub-ui/page.css";
import "@colbitron/resource-hub-ui/prose.css";

/**
 * A WordPress page as the front end shows it (ADR 0052): one `<article>` with
 * the title and the body, at `/` for the static front page and at its own
 * path otherwise. The route hands over a `RenderedPage` from
 * `pageForRequest` (`lib/page-request.ts`), so by the time this renders the
 * redirect and 404 decisions are made and the page is a published one at
 * its canonical path.
 *
 * The body is `content.rendered` through the one server-side pass
 * (`renderContent`, whose docblock holds the rules; ADR 0040), which sanitises
 * it and rewrites its URLs, with `postId` so a related-resources block in the
 * page excludes the page's own ID whatever its HTML says, and with
 * `renderRelatedBlock` (`components/RelatedResources.tsx`), so a block the
 * editor put in a page renders as the front end's own list, as on a
 * resource, and as the CMS's rows when its read fails, and with `leadImage`,
 * so the body's first image, the page's topmost, is fetched at high priority
 * rather than lazily (issue #86). A password-protected
 * page is never served: the plugin answers none, and the decision refuses one
 * whose `content.protected` is set. Pages carry no featured image here: the
 * content model gives pages no meta of their own and the front end shows what
 * core's pages endpoint gives.
 */

/** The page's view, computed once per render and shared by the component and the metadata. */
interface PageView {
  readonly title: string;
  /** The excerpt as plain text, or `null` when the page has none. */
  readonly description: string | null;
  readonly canonical: string;
}

/** `title.rendered` as plain text, or a fixed name when it is only whitespace, so the heading is never empty. */
export const UNTITLED_PAGE = "Untitled page";

function pageView(page: WpPage, path: string): PageView {
  const title = plainText(page.title.rendered);
  const description = plainText(page.excerpt.rendered);
  return {
    title: title === "" ? UNTITLED_PAGE : title,
    description: description === "" ? null : description,
    canonical: path,
  };
}

/**
 * The metadata for a page: its title (the root layout's template adds the site
 * name), its excerpt as the description or none, and its canonical path, which
 * the root layout's `metadataBase` makes absolute (see `apps/web/README.md`).
 * The CMS's absolute `link` is never used (ADR 0040). Pages carry the site's
 * default share image, so `shareMetadata` gives them the large X card.
 */
export function pageMetadata(rendered: Extract<RenderedPage, { kind: "render" }>): Metadata {
  const view = pageView(rendered.page, rendered.path);
  return {
    title: view.title,
    description: view.description,
    alternates: { canonical: view.canonical },
    ...shareMetadata({
      type: "website",
      title: view.title,
      ...(view.description === null ? {} : { description: view.description }),
      url: view.canonical,
      // The default share image, named here because an `openGraph` of its own drops the file-based one (lib/share-image.ts).
      images: [DEFAULT_SHARE_IMAGE],
    }),
  };
}

export interface PageArticleProps {
  readonly rendered: Extract<RenderedPage, { kind: "render" }>;
  /** What a related-resources block marker in the body renders as: `renderRelatedBlock` by default; the design specimen passes the pass's fallback. */
  readonly renderBlock?: RenderBlock;
}

export function PageArticle({ rendered, renderBlock = renderRelatedBlock }: PageArticleProps) {
  const view = pageView(rendered.page, rendered.path);
  const { page } = rendered;

  return (
    <article className="rh-page">
      <header className="rh-page__header">
        <h1 className="rh-page__title">{view.title}</h1>
      </header>
      <div className="rh-page__body rh-prose">
        {renderContent(page.content.rendered, cmsUrls(), { postId: page.id, renderBlock, leadImage: true })}
      </div>
    </article>
  );
}
