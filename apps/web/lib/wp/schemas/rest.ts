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

/** True when `taxonomy` is one of the three the front end knows. */
export function isWpTaxonomy(taxonomy: string): taxonomy is WpTaxonomy {
  return wpTaxonomySchema.safeParse(taxonomy).success;
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

export const wpTermListSchema = z.array(wpTermSchema);

/**
 * A term as `_embed` includes it in `_embedded['wp:term']`: no `count`, and
 * any taxonomy. `wp:term` has one array per REST-visible taxonomy attached to
 * the post type, so a taxonomy another plugin attaches to `resource` shows up
 * here too; a closed enum would fail every resource. Consumers keep the terms
 * whose taxonomy passes `isWpTaxonomy`.
 */
export const wpEmbeddedTermSchema = wpTermSchema
  .omit({ count: true })
  .extend({ taxonomy: z.string().min(1) });

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
    sizes: z.record(z.string(), wpMediaSizeSchema).default({}),
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
 */
const wpResourceEmbeddedSchema = z
  .object({
    "wp:term": z.array(z.array(wpEmbeddedTermSchema)).default([]),
    "wp:featuredmedia": z.array(wpFeaturedMediaSchema).default([]).catch([]),
  })
  .default({ "wp:term": [], "wp:featuredmedia": [] });

/**
 * A resource from `/wp/v2/resources?_embed` (or `/wp/v2/resources/{id}?_embed`).
 *
 * `resource_type`, `resource_topic` and `resource_flag` are term IDs; the
 * matching terms, with their slugs, are in `_embedded['wp:term']`, one array
 * per taxonomy, empty where the resource has none of its terms (and the whole
 * key absent when it has no terms at all). `resource_type` is not held to
 * exactly one ID here, although the content model gives every resource one
 * type: a resource saved outside the REST API can have none or two (ADR
 * 0016), and one such resource should not fail a whole listing, so the code
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

export const wpResourceListSchema = z.array(wpResourceSchema);

export type WpTaxonomy = z.infer<typeof wpTaxonomySchema>;
export type WpTerm = z.infer<typeof wpTermSchema>;
export type WpEmbeddedTerm = z.infer<typeof wpEmbeddedTermSchema>;
export type WpMedia = z.infer<typeof wpMediaSchema>;
export type WpFeaturedMedia = z.infer<typeof wpFeaturedMediaSchema>;
export type WpResource = z.infer<typeof wpResourceSchema>;
