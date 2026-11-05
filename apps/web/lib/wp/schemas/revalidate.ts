import { z } from "zod";

import {
  idSchema,
  isReservedTypeSlug,
  pathSchema,
  RESERVED_TYPE_SLUG_MESSAGE,
  slugSchema,
  topicListSchema,
  typeListSchema,
} from "./common";

/**
 * The revalidation request WordPress POSTs to `/api/revalidate/` and the two
 * reply shapes, mirroring `revalidate-request.schema.json`,
 * `revalidate-response-ok.schema.json` and
 * `revalidate-response-error.schema.json` in `packages/ui/schemas/`.
 *
 * Every object here is strict (`z.strictObject`), as every object in those
 * schemas has `additionalProperties: false`: an unknown key is an error, not
 * something to drop, because it means the CMS is speaking a contract this
 * front end does not know.
 */

/**
 * `rest_url`: `"format": "uri"` plus `"pattern": "^https?://"`.
 *
 * The pattern is mirrored exactly, case-sensitive as it is in the schema (so
 * `HTTPS://` is rejected). `format: uri` cannot be mirrored exactly: Ajv's
 * formats plugin checks the RFC 3986 grammar with a regular expression, and Zod
 * offers only `z.url()`, which asks the WHATWG URL parser. The two disagree at
 * the edges: WHATWG accepts characters RFC 3986 forbids (a space, `|`, `^`,
 * `{`, a non-ASCII letter, `[` in a path, a second `#`) and percent-encodes
 * them, and rejects some strings RFC 3986 allows (`http://` with an empty
 * host, a non-numeric or out-of-range port). The checks below close the first
 * gap: only RFC 3986's unreserved and reserved characters and well-formed
 * percent escapes, `[` and `]` only in the host (an IPv6 literal, which the
 * parser then validates), and at most one `#`. The second gap stays open on
 * purpose: there the WHATWG parser is the stricter, and a URL it cannot parse
 * could not be fetched anyway. A differential run of Ajv against this schema
 * over about 70,000 mutations of the contract fixtures found no other
 * disagreement.
 *
 * Neither check knows the WordPress origin. Before fetching this URL the
 * caller must compare its origin with `WP_API_URL`'s and refuse a mismatch:
 * that is the guard against server-side request forgery (packages/ui README).
 */
const restUrlSchema = z
  .string()
  .regex(/^https?:\/\//u, { error: "must start with http:// or https://" })
  .regex(/^(?:[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})*$/u, {
    error: "must contain only characters a URI allows",
  })
  .refine(
    (value) => {
      // Everything after the scheme and authority: path, query and fragment.
      const rest = value.replace(/^https?:\/\/[^/?#]*/u, "");
      return !/[[\]]/u.test(rest) && rest.indexOf("#") === rest.lastIndexOf("#");
    },
    { error: "must have [ and ] only in the host and at most one #" },
  )
  .refine((value) => URL.canParse(value), { error: "must be a valid URL" });

/** A term's display name: any non-empty string. */
const termNameSchema = z.string().min(1, { error: "must not be empty" });

/** `$defs/resourceState`: where a resource is listed. */
export const resourceStateSchema = z.strictObject({
  slug: slugSchema,
  types: typeListSchema,
  topics: topicListSchema,
});

const resourceEventFields = {
  type: z.literal("resource"),
  id: idSchema,
  slug: slugSchema,
  rest_url: restUrlSchema,
  types: typeListSchema,
  topics: topicListSchema,
};

/**
 * `$defs/resourceEvent`. The schema's `if event is update then previous is a
 * resourceState else previous is null` becomes a union discriminated on
 * `event`: one branch for `update`, one for the other four. It accepts and
 * rejects the same bodies, and the inferred type says that `previous` is
 * non-null exactly when `event` is `"update"`.
 */
export const resourceEventSchema = z.discriminatedUnion("event", [
  z.strictObject({
    ...resourceEventFields,
    event: z.literal("update"),
    previous: resourceStateSchema,
  }),
  z.strictObject({
    ...resourceEventFields,
    event: z.enum(["publish", "unpublish", "trash", "delete"]),
    previous: z.null(),
  }),
]);

/** `$defs/termState`: a term's slug and name before an update. */
export const termStateSchema = z.strictObject({
  slug: slugSchema,
  name: termNameSchema,
});

const termEventFields = {
  type: z.literal("term"),
  taxonomy: z.enum(["resource_topic", "resource_type"]),
  id: idSchema,
  slug: slugSchema,
  name: termNameSchema,
};

/**
 * `$defs/termEvent`. The schema has two conditionals. The one on `event`
 * (`previous` set on `update`, `null` otherwise) is a discriminated union, as
 * for resource events. The one on `taxonomy` (a `resource_type` term's `slug`
 * and `previous.slug` are type slugs, so never `topic` or `page`) is a
 * refinement, because splitting on both keys would make four near-identical
 * branches for a rule that only adds a check.
 */
export const termEventSchema = z
  .discriminatedUnion("event", [
    z.strictObject({
      ...termEventFields,
      event: z.literal("update"),
      previous: termStateSchema,
    }),
    z.strictObject({
      ...termEventFields,
      event: z.enum(["create", "delete"]),
      previous: z.null(),
    }),
  ])
  .superRefine((event, ctx) => {
    if (event.taxonomy !== "resource_type") {
      return;
    }
    if (isReservedTypeSlug(event.slug)) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: RESERVED_TYPE_SLUG_MESSAGE });
    }
    if (event.previous !== null && isReservedTypeSlug(event.previous.slug)) {
      ctx.addIssue({
        code: "custom",
        path: ["previous", "slug"],
        message: RESERVED_TYPE_SLUG_MESSAGE,
      });
    }
  });

/**
 * One event in a batch, told apart by `type`. The schema's `oneOf` over the two
 * shapes can match at most one branch, since `type` is a different constant in
 * each, so a discriminated union accepts the same events.
 */
export const revalidationEventSchema = z.discriminatedUnion("type", [
  resourceEventSchema,
  termEventSchema,
]);

/** The request body: `version` 1 and a batch of 1 to 25 events. */
export const revalidateRequestSchema = z.strictObject({
  version: z.literal(1),
  events: z
    .array(revalidationEventSchema)
    .min(1, { error: "must contain at least one event" })
    .max(25, { error: "must contain at most 25 events" }),
});

/** The `200` reply: every path the batch revalidated. */
export const revalidateResponseOkSchema = z.strictObject({
  revalidated: z.array(pathSchema),
});

/** The `400`, `401` and `500` reply. A `401`'s error is exactly `unauthorized`. */
export const revalidateResponseErrorSchema = z.strictObject({
  error: z.string().min(1, { error: "must not be empty" }),
});

export type ResourceState = z.infer<typeof resourceStateSchema>;
export type ResourceEvent = z.infer<typeof resourceEventSchema>;
export type TermState = z.infer<typeof termStateSchema>;
export type TermEvent = z.infer<typeof termEventSchema>;
export type RevalidationEvent = z.infer<typeof revalidationEventSchema>;
export type RevalidateRequest = z.infer<typeof revalidateRequestSchema>;
export type RevalidateResponseOk = z.infer<typeof revalidateResponseOkSchema>;
export type RevalidateResponseError = z.infer<typeof revalidateResponseErrorSchema>;
