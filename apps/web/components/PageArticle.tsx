import type { Metadata } from "next";

import { renderContent } from "@/lib/content/render";
import { cmsUrls } from "@/lib/env";
import type { RenderedPage } from "@/lib/page-request";
import { plainText } from "@/lib/wp/cards";
import type { WpPage } from "@/lib/wp/schemas/rest";

import "./page.css";
import "./prose.css";

/**
 * A WordPress page as the front end shows it (ADR 0052): one `<article>` with
 * the title and the body, at `/` for the static front page and at its own
 * path otherwise. The route hands over a `RenderedPage` from
 * `pageForRequest` (`lib/page-request.ts`), so by the time this renders the
 * redirect and 404 decisions are made and the page is a published one at
 * its canonical path.
 *
 * The body is `content.rendered` through the one server-side pass
 * (`renderContent`, ADR 0047), which sanitises it and rewrites its URLs, with
 * `postId` so a related-resources block in the page excludes the page's own
 * ID whatever its HTML says. A password-protected page is never served: the
 * plugin answers none, and the decision refuses one whose `content.protected`
 * is set. Pages carry no featured image here: the content model gives pages
 * no meta of their own and the front end shows what core's pages endpoint
 * gives.
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
 * The metadata for a page: its title (the root layout's template adds the
 * site name), its excerpt as the description or none, and its canonical
 * path, which the root layout's `metadataBase` makes absolute (ADR 0050's
 * amendment). The CMS's absolute `link` is never used (ADR 0040).
 */
export function pageMetadata(rendered: Extract<RenderedPage, { kind: "render" }>): Metadata {
  const view = pageView(rendered.page, rendered.path);
  return {
    title: view.title,
    description: view.description,
    alternates: { canonical: view.canonical },
    openGraph: {
      type: "website",
      title: view.title,
      ...(view.description === null ? {} : { description: view.description }),
      url: view.canonical,
    },
  };
}

export function PageArticle({ rendered }: { rendered: Extract<RenderedPage, { kind: "render" }> }) {
  const view = pageView(rendered.page, rendered.path);
  const { page } = rendered;

  return (
    <article className="rh-page">
      <header className="rh-page__header">
        <h1 className="rh-page__title">{view.title}</h1>
      </header>
      <div className="rh-page__body rh-prose">
        {renderContent(page.content.rendered, cmsUrls(), { postId: page.id })}
      </div>
    </article>
  );
}
