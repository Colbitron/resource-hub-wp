import { z } from "zod";

import { idSchema, slugSchema } from "./common";

/**
 * The core WordPress REST shapes the front end reads: a resource from
 * `/wp/v2/resources` with `_embed`, a term from the three taxonomy endpoints,
 * and the media embedded as a featured image. These are core's shapes, not the
 * contract's, so no JSON Schema in `packages/ui` describes them; the fixtures
 * in `test/fixtures/wp/` were captured from a real WordPress running the
 * plugin.
 *
 * Each schema names only the fields the front end uses, and unknown fields are
 * ignored, not rejected: `z.object` accepts them and drops them from the
 * parsed value. WordPress adds fields freely (`class_list`, `guid`, `_links`,
 * whatever another plugin registers), and none of them should fail a page. A
 * field the front end does use that is missing or of the wrong type does fail,
 * loudly, at the parse, except the featured image, which is decoration: an
 * unusable one becomes no image rather than failing the resource.
 */

/** An absolute http or https URL, as WordPress writes links and media URLs. */
const httpUrlSchema = z.url({
  protocol: /^https?$/,
  error: "must be an absolute http or https URL",
});

/**
 * A WordPress `date` or `modified`: ISO 8601 in the site's time zone, with no
 * offset (`2026-11-05T09:31:32`). `local: true` still accepts a trailing `Z`,
 * which WordPress never writes and which would claim UTC, so that is refused.
 */
const wpDateTimeSchema = z.iso
  .datetime({ local: true })
  .refine((value) => !value.endsWith("Z"), { error: "must have no time zone offset" });

/** `{ rendered }`, the shape of `title`, `content` and `excerpt`. */
const renderedSchema = z.object({ rendered: z.string() });

/** A positive pixel dimension. */
const pixelsSchema = z.int().min(1);

/** The three taxonomies on a resource. */
export const wpTaxonomySchema = z.enum(["resource_topic", "resource_type", "resource_flag"]);

/**
 * True when `value` is an object whose `taxonomy` is one of the three the
 * front end knows, narrowing it to say so. It takes anything, so it can sort
 * raw `_embedded['wp:term']` entries before they are parsed.
 */
export function hasWpTaxonomy<T>(value: T): value is T & { taxonomy: WpTaxonomy } {
  return (
    typeof value === "object" &&
    value !== null &&
    wpTaxonomySchema.safeParse((value as { taxonomy?: unknown }).taxonomy).success
  );
}

/**
 * A term from `/wp/v2/resource_topic`, `/wp/v2/resource_type` or
 * `/wp/v2/resource_flag`. `count` is the number of published resources with
 * the term. `taxonomy` is held to the three known names because core's terms
 * controller serves one taxonomy per endpoint, so these endpoints can only
 * ever return their own.
 */
export const wpTermSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string().min(1),
  count: z.int().min(0),
  taxonomy: wpTaxonomySchema,
});

/**
 * A whole term list, for the tests and fixtures. The data layer does not
 * parse a list with it: `cmsGetList` parses each term with `wpTermSchema`,
 * so one bad term is skipped rather than failing the list (the rule is in
 * `fetch.ts`).
 */
export const wpTermListSchema = z.array(wpTermSchema);

/** A term as `_embed` includes it in `_embedded['wp:term']`: no `count`. */
export const wpEmbeddedTermSchema = wpTermSchema.omit({ count: true });

/**
 * One array of `_embedded['wp:term']`. `wp:term` has one array per
 * REST-visible taxonomy attached to the post type, so a taxonomy another
 * plugin attaches to `resource` shows up here too. Its entries are dropped
 * before the per-term parse, unread, so a malformed term the front end would
 * ignore anyway (a bad slug, an empty name) cannot fail the resource; every
 * entry of the three known taxonomies is parsed strictly. An array that is
 * not an array still fails.
 */
const wpEmbeddedTermListSchema = z.preprocess(
  (entries) => (Array.isArray(entries) ? entries.filter(hasWpTaxonomy) : entries),
  z.array(wpEmbeddedTermSchema),
);

/** One entry of `media_details.sizes`: a resized copy of the image. */
const wpMediaSizeSchema = z.object({
  source_url: httpUrlSchema,
  width: pixelsSchema,
  height: pixelsSchema,
});

/**
 * An image attachment as `_embed` includes it in
 * `_embedded['wp:featuredmedia']`.
 *
 * `media_details` is `{}` when WordPress could not read the file's
 * dimensions, as for an SVG, so `width` and `height` are optional and `sizes`
 * defaults to empty. `next/image` needs both dimensions to reserve the space,
 * so the component that renders a featured image (a later PR) must skip one
 * without them. `sizes` is keyed by size name (`thumbnail`, `medium`, `full`,
 * …) and is empty when WordPress made no smaller copies, as it does for an
 * image smaller than every registered size.
 */
export const wpMediaSchema = z.object({
  source_url: httpUrlSchema,
  alt_text: z.string(),
  media_details: z.object({
    width: pixelsSchema.optional(),
    height: pixelsSchema.optional(),
    sizes: z.record(z.string(), wpMediaSizeSchema).default(() => ({})),
  }),
});

/**
 * An entry of `_embedded['wp:featuredmedia']`, parsed leniently: the media,
 * or `null` for "no image". Core puts its REST error object in an entry's
 * place when the request may not read the attachment, and any entry that is
 * not a usable image (that error, a missing URL, a malformed size) parses as
 * `null` instead of failing the resource it belongs to.
 */
export const wpFeaturedMediaSchema = wpMediaSchema.nullable().catch(null);

/**
 * `_embedded`, with every key defaulted so consumers need no checks. Core
 * leaves out `wp:term` when every term list is empty and `wp:featuredmedia`
 * when there is no featured image, and leaves out `_embedded` itself when
 * nothing is embedded; each becomes an empty array.
 *
 * Every default and catch value that is an object or an array is a factory.
 * Zod copies a plain default value only one level deep and a plain catch
 * value not at all, so a literal would hand every parse the same inner
 * arrays, and a change to one parsed resource would show up in the next.
 */
const wpResourceEmbeddedSchema = z
  .object({
    "wp:term": z.array(wpEmbeddedTermListSchema).default(() => []),
    "wp:featuredmedia": z
      .array(wpFeaturedMediaSchema)
      .default(() => [])
      .catch(() => []),
  })
  .default(() => ({ "wp:term": [], "wp:featuredmedia": [] }));

/**
 * A resource from `/wp/v2/resources?_embed` (or `/wp/v2/resources/{id}?_embed`).
 *
 * `resource_type`, `resource_topic` and `resource_flag` are term IDs; the
 * matching terms, with their slugs, are in `_embedded['wp:term']`, one array
 * per taxonomy, empty where the resource has none of its terms (and the whole
 * key absent when it has no terms at all); the parsed value keeps only the
 * terms of those three taxonomies. `resource_type` is not held to
 * exactly one ID here, although the content model gives every resource one
 * type: a resource saved outside the REST API can have none or two (ADR
 * 0024), and one such resource should not fail a whole listing, so the code
 * that builds its URL decides.
 *
 * Because core omits `_embedded` for a resource with nothing to embed, a
 * missing `_embedded` cannot tell a fetch without `_embed` apart, so the parse
 * does not try: the data layer guarantees `_embed` through the URL it builds.
 *
 * `meta.source_url` is empty when unset; the plugin's sanitizer stores either
 * an http or https URL with a host or the empty string.
 */
export const wpResourceSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  link: httpUrlSchema,
  date: wpDateTimeSchema,
  /** `date` in UTC, still without an offset: the card appends the `Z`. Set on every published post. */
  date_gmt: wpDateTimeSchema,
  modified: wpDateTimeSchema,
  title: renderedSchema,
  content: renderedSchema,
  excerpt: renderedSchema,
  meta: z.object({
    summary: z.string(),
    source_url: z.union([z.literal(""), httpUrlSchema]),
  }),
  resource_type: z.array(idSchema),
  resource_topic: z.array(idSchema),
  resource_flag: z.array(idSchema),
  _embedded: wpResourceEmbeddedSchema,
});

/**
 * A page from `/wp/v2/pages/{id}` (ADR 0052): what the page route renders.
 * `parent` is 0 for a top-level page; the path is not here, because core
 * gives only `link`, an absolute CMS URL that depends on the permalink
 * structure, and the plugin's page route answers the path instead.
 * `content.protected` is true for a password-protected page, whose
 * `content.rendered` core sends empty to an anonymous reader.
 */
export const wpPageSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  link: httpUrlSchema,
  parent: z.int().min(0),
  date_gmt: wpDateTimeSchema,
  modified_gmt: wpDateTimeSchema,
  title: renderedSchema,
  content: renderedSchema.extend({ protected: z.boolean().default(false) }),
  excerpt: renderedSchema,
});

/**
 * A whole resource list, for the tests and fixtures. The data layer does not
 * parse a list with it: `cmsGetList` parses each resource with
 * `wpResourceSchema`, so one bad resource is skipped rather than failing the
 * list (the rule is in `fetch.ts`).
 */
export const wpResourceListSchema = z.array(wpResourceSchema);

export type WpTaxonomy = z.infer<typeof wpTaxonomySchema>;
export type WpTerm = z.infer<typeof wpTermSchema>;
export type WpEmbeddedTerm = z.infer<typeof wpEmbeddedTermSchema>;
export type WpMedia = z.infer<typeof wpMediaSchema>;
export type WpFeaturedMedia = z.infer<typeof wpFeaturedMediaSchema>;
export type WpResource = z.infer<typeof wpResourceSchema>;
export type WpPage = z.infer<typeof wpPageSchema>;
