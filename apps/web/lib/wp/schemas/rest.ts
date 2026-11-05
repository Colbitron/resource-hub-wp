import { z } from "zod";

import { idSchema, slugSchema } from "./common";
import { wpErrorSchema } from "./wp-error";

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
 * loudly, at the parse.
 */

/** An absolute http or https URL, as WordPress writes links and media URLs. */
const httpUrlSchema = z.url({
  protocol: /^https?$/,
  error: "must be an absolute http or https URL",
});

/**
 * A WordPress `date` or `modified`: ISO 8601 in the site's time zone, with no
 * offset (`2026-11-05T09:31:32`).
 */
const wpDateTimeSchema = z.iso.datetime({ local: true });

/** `{ rendered }`, the shape of `title`, `content` and `excerpt`. */
const renderedSchema = z.object({ rendered: z.string() });

/** A positive pixel dimension. */
const pixelsSchema = z.int().min(1);

/** The three taxonomies on a resource. */
export const wpTaxonomySchema = z.enum(["resource_topic", "resource_type", "resource_flag"]);

/**
 * A term from `/wp/v2/resource_topic`, `/wp/v2/resource_type` or
 * `/wp/v2/resource_flag`. `count` is the number of published resources with
 * the term.
 */
export const wpTermSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string().min(1),
  count: z.int().min(0),
  taxonomy: wpTaxonomySchema,
});

export const wpTermListSchema = z.array(wpTermSchema);

/** A term as `_embed` includes it in `_embedded['wp:term']`: no `count`. */
export const wpEmbeddedTermSchema = wpTermSchema.omit({ count: true });

/** One entry of `media_details.sizes`: a resized copy of the image. */
const wpMediaSizeSchema = z.object({
  source_url: httpUrlSchema,
  width: pixelsSchema,
  height: pixelsSchema,
});

/**
 * An image attachment as `_embed` includes it in
 * `_embedded['wp:featuredmedia']`. `width` and `height` are required because
 * `next/image` needs them to reserve the space. `sizes` is keyed by size name
 * (`thumbnail`, `medium`, `full`, …) and is empty when WordPress made no
 * smaller copies, as it does for an image smaller than every registered size.
 */
export const wpMediaSchema = z.object({
  source_url: httpUrlSchema,
  alt_text: z.string(),
  media_details: z.object({
    width: pixelsSchema,
    height: pixelsSchema,
    sizes: z.record(z.string(), wpMediaSizeSchema),
  }),
});

/**
 * An entry of `_embedded['wp:featuredmedia']`. When the anonymous request may
 * not read the attachment, as when the image was uploaded to a post that is
 * still a draft, core embeds its REST error in the media's place, so the entry
 * is the media or that error. The caller renders no image for an error.
 */
export const wpFeaturedMediaSchema = z.union([wpMediaSchema, wpErrorSchema]);

/**
 * A resource from `/wp/v2/resources?_embed` (or `/wp/v2/resources/{id}?_embed`).
 *
 * `resource_type`, `resource_topic` and `resource_flag` are term IDs; the
 * matching terms, with their slugs, are in `_embedded['wp:term']`, one array
 * per taxonomy. `resource_type` is not held to exactly one ID here, although
 * the content model gives every resource one type: a resource saved outside
 * the REST API can have none or two (ADR 0016), and one such resource should
 * not fail a whole listing, so the code that builds its URL decides.
 *
 * `_embedded` is required, so a fetch that forgot `_embed` fails at the parse.
 * `wp:featuredmedia` is absent when the resource has no featured image.
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
  _embedded: z.object({
    "wp:term": z.array(z.array(wpEmbeddedTermSchema)),
    "wp:featuredmedia": z.array(wpFeaturedMediaSchema).optional(),
  }),
});

export const wpResourceListSchema = z.array(wpResourceSchema);

export type WpTaxonomy = z.infer<typeof wpTaxonomySchema>;
export type WpTerm = z.infer<typeof wpTermSchema>;
export type WpEmbeddedTerm = z.infer<typeof wpEmbeddedTermSchema>;
export type WpMedia = z.infer<typeof wpMediaSchema>;
export type WpFeaturedMedia = z.infer<typeof wpFeaturedMediaSchema>;
export type WpResource = z.infer<typeof wpResourceSchema>;
