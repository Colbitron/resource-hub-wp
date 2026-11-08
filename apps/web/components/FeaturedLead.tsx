import Image from "next/image";
import Link from "next/link";

import { CardMeta, CardTopics, type ResourceCardProps } from "@/components/ResourceCard";
import type { FeaturedImage } from "@/lib/wp/images";

import "@colbitron/resource-hub-ui/lead.css";

export interface FeaturedLeadProps extends Omit<ResourceCardProps, "headingLevel"> {
  /** The resource's featured image, already a same-origin `/media/…` path with both dimensions (`featuredImage`). */
  image?: FeaturedImage;
  /** The heading level the title takes: `h3` under the listing's "Featured" heading. */
  headingLevel?: "h2" | "h3";
}

/**
 * `sizes` for the lead image. The lead is two columns where they fit
 * (`lead.css`): the media asks for 22rem and the body for 18rem, with a
 * `--rh-space-6` (2rem) gap, inside the shell's content box (`--rh-measure-wide`
 * 72rem less a 1rem gutter each side, so 70rem at most). Side by side, the
 * media takes its 22rem plus seven twelfths of what is left, which is about
 * 58vw between 44rem and 72rem and 39rem at the widest; below 44rem the body
 * wraps under it and it is the content's width, 100vw less the gutters.
 * `sizes` cannot read a token, so the numbers are written out; change them
 * with `lead.css` or the shell's width.
 */
const IMAGE_SIZES = "(min-width: 72rem) 39rem, (min-width: 44rem) 58vw, 100vw";

/**
 * The lead: the featured resource at the top of the library, large, with its
 * image beside the meta line, the title, the summary and the topics
 * (`packages/ui/DESIGN.md`, "Components"), in the shared `rh-lead` classes
 * the CMS theme's library will render too; the meta line and the topics
 * are the row's parts, so the type is said the same way in both.
 *
 * The image is the library's one LCP candidate, above the fold at every
 * width, so it is loaded like the resource page's featured image
 * (`ResourceArticle`): `preload`, Next.js 16's replacement for the
 * deprecated `priority`, puts a `<link rel="preload">` in the head and makes
 * the `<img>` eager, and `fetchPriority="high"` beside it is copied onto
 * that link, so the image is requested at High from the head rather than at
 * the Low priority Chromium gives an image preload. The box reserves a 16:9
 * space with the image's own width and height on the `<img>`, so a late
 * image moves nothing. A lead without a trusted image renders its text at
 * the full width, with no empty box.
 *
 * The title's link is the lead's only interactive element and is stretched
 * over the whole lead, image included, like the row's.
 */
export function FeaturedLead({
  title,
  href,
  typeLabel,
  accent,
  topicLabels,
  summary,
  date,
  image,
  headingLevel: Heading = "h3",
}: FeaturedLeadProps) {
  return (
    <article className="rh-lead">
      {image && (
        <div className="rh-lead__media">
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes={IMAGE_SIZES}
            preload
            fetchPriority="high"
          />
        </div>
      )}
      <div className="rh-lead__body">
        <CardMeta typeLabel={typeLabel} accent={accent} date={date} />
        <Heading className="rh-lead__title">
          <Link className="rh-lead__link" href={href}>
            {title}
          </Link>
        </Heading>
        {summary && <p className="rh-lead__summary">{summary}</p>}
        <CardTopics topicLabels={topicLabels} />
      </div>
    </article>
  );
}
