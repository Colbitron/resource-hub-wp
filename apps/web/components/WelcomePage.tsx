import type { Metadata } from "next";
import Link from "next/link";

import { DEFAULT_SHARE_IMAGE } from "@/lib/share-image";
import { shareMetadata } from "@/lib/share-metadata";

import "@colbitron/resource-hub-ui/page.css";
import "@colbitron/resource-hub-ui/welcome.css";

/**
 * What `/` shows when the CMS has no static front page (Settings > Reading
 * on `posts`, or `page_on_front` naming no published page), which is the
 * hosted CMS's state today (ADR 0052): the site's name, one sentence saying
 * what it is, and a link into the library. A page rather than a redirect,
 * because a redirect from `/` would be a permanent answer to a question an
 * editor can change by setting a front page, and because the root of a site
 * should answer 200 to a crawler. It reads no data, so it can never fail for
 * a reason of its own, and it names nothing of the CMS.
 */

export const WELCOME_TITLE = "Resource Hub";

export const welcomeMetadata: Metadata = {
  title: { absolute: WELCOME_TITLE },
  alternates: { canonical: "/" },
  // The default share image, named here because an `openGraph` of its own drops the file-based one (lib/share-image.ts).
  ...shareMetadata({ type: "website", title: WELCOME_TITLE, url: "/", images: [DEFAULT_SHARE_IMAGE] }),
};

export function WelcomePage() {
  return (
    <div className="rh-page rh-welcome">
      <h1 className="rh-page__title">{WELCOME_TITLE}</h1>
      <p>
        A filterable library of resources: guides, webinars, reports and more, modelled in WordPress and rendered by
        Next.js.
      </p>
      <p>
        <Link href="/resources/">Browse the library</Link>
      </p>
    </div>
  );
}
