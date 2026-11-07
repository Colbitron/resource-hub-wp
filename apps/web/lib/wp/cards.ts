import "server-only";

import { DomUtils, parseDocument } from "htmlparser2";

import type { ResourceCardProps } from "../../components/ResourceCard";
import { isTypeSlug, resourcePath } from "../routes";
import { typeAccent } from "../type-accents";
import { featuredImage, type FeaturedImage } from "./images";
import type { WpEmbeddedTerm, WpResource } from "./schemas/rest";

/**
 * The title a card shows when the resource's is empty or only zero-width
 * characters, so its one link still has a visible, spoken name.
 */
export const UNTITLED = "Untitled resource";

/** Zero-width spaces, joiners and byte-order marks (U+200B to U+200D, U+FEFF). */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * `html` as the plain text a reader sees: tags dropped and entities decoded,
 * so `A&#8217;s &#038; B` is `A’s & B`, then whitespace runs collapsed. For
 * `title.rendered`, which WordPress texturizes, and term names, which it
 * stores with `&` as `&amp;`.
 *
 * The output is text, not HTML, and must only ever be rendered as React
 * text (a JSX child or an attribute React sets). Decoding turns
 * `&lt;img src=x onerror=…&gt;` into a literal `<img src=x onerror=…>`
 * string, which React escapes but `innerHTML`, `dangerouslySetInnerHTML` or
 * an inline JSON-LD `<script>` would not: never pass it to any of them.
 */
export function plainText(html: string): string {
  return DomUtils.textContent(parseDocument(html)).replace(/\s+/g, " ").trim();
}

/**
 * True when `title.rendered` shows something: its plain text is more than
 * whitespace and zero-width characters. The one notion of an empty title:
 * a listing's row falls back to `UNTITLED` for such a resource, and a
 * related list leaves it out (`toRelatedCard` in `related.ts`).
 */
export function hasVisibleTitle(rendered: string): boolean {
  return plainText(rendered).replace(ZERO_WIDTH, "").trim() !== "";
}

/** `title.rendered` as plain text, or `UNTITLED` when it has no visible title (`hasVisibleTitle`). */
function cardTitle(rendered: string): string {
  return hasVisibleTitle(rendered) ? plainText(rendered) : UNTITLED;
}

function embeddedTerm(
  resource: WpResource,
  taxonomy: WpEmbeddedTerm["taxonomy"],
  id: number,
): WpEmbeddedTerm | undefined {
  for (const list of resource._embedded["wp:term"]) {
    const term = list.find((candidate) => candidate.taxonomy === taxonomy && candidate.id === id);
    if (term !== undefined) {
      return term;
    }
  }
  return undefined;
}

/**
 * The resource's one type, as the embedded term, or `null` when the resource
 * cannot have a URL: it does not have exactly one type (a resource saved
 * outside the REST API can have none or two, ADR 0024), its type is not
 * embedded, or the type's slug cannot be a path segment (`isTypeSlug`). The
 * card mapping and the resource page's redirect decision (`lib/redirects.ts`)
 * both read the type through this, so they agree on which resources have a URL
 * at all.
 */
export function resourceType(resource: WpResource): WpEmbeddedTerm | null {
  if (resource.resource_type.length !== 1) {
    return null;
  }
  const type = embeddedTerm(resource, "resource_type", resource.resource_type[0]);
  return type === undefined || !isTypeSlug(type.slug) ? null : type;
}

/**
 * A resource as the listing shows it: `ResourceCard`'s props, which the row
 * renders, plus the resource's ID, for telling the lead apart from the rows,
 * and its featured image, which only the lead (`FeaturedLead`) shows.
 */
export interface CardData extends ResourceCardProps {
  /** The resource's post ID. */
  readonly id: number;
  /** `featuredImage`, when the resource has a trusted one. */
  readonly image?: FeaturedImage;
}

/**
 * A parsed resource as `CardData`, or `null` when it cannot have a URL
 * (`resourceType`). The caller skips a `null`.
 *
 * - `id`: the post's ID.
 * - `href`: `resourcePath(type, slug)`, canonical and root-relative.
 * - `typeLabel` and `topicLabels`: the embedded terms' names as plain text,
 *   topics in the order of `resource_topic`, each name once; a topic that is
 *   not embedded is left out.
 * - `accent`: the type mark's colour from `typeAccent`, by the type term's ID
 *   and slug; `"neutral"` for a type the table does not know.
 * - `title`: `title.rendered` as plain text, or `UNTITLED` when that is
 *   empty or only zero-width characters.
 * - `summary`: `meta.summary`, which the plugin stores as plain text.
 * - `date`: `date_gmt` with a `Z`, the UTC instant the card formats.
 * - `image`: `featuredImage`, left out when `null`.
 */
export function toCard(resource: WpResource): CardData | null {
  const type = resourceType(resource);
  if (type === null) {
    return null;
  }
  const topicLabels = resource.resource_topic
    .map((id) => embeddedTerm(resource, "resource_topic", id))
    .filter((term): term is WpEmbeddedTerm => term !== undefined)
    .map((term) => plainText(term.name));
  const image = featuredImage(resource);
  return {
    id: resource.id,
    title: cardTitle(resource.title.rendered),
    href: resourcePath(type.slug, resource.slug),
    typeLabel: plainText(type.name),
    accent: typeAccent(type),
    topicLabels: [...new Set(topicLabels)],
    summary: resource.meta.summary,
    date: `${resource.date_gmt}Z`,
    ...(image === null ? {} : { image }),
  };
}
