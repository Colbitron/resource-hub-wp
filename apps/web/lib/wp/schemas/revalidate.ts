import { z } from "zod";

import { typeSlugProblem } from "../../routes";
import {
  idSchema,
  pagePathSchema,
  pathSchema,
  slugSchema,
  topicListSchema,
  typeListSchema,
} from "./common";

/**
 * The revalidation request WordPress POSTs to `/api/revalidate/` and the two
 * reply shapes, mirroring `revalidate-request.schema.json`,
 * `revalidate-response-ok.schema.json` and
 * `revalidate-response-error.schema.json` in `packages/ui/schemas/`. Every
 * object in those schemas has `additionalProperties: false`.
 *
 * The request comes in two variants built from the same definitions (ADR 0010:
 * strict where we produce, lenient on unknown keys where we consume):
 *
 * - `revalidateRequestSchemaStrict` is the exact mirror, every object a
 *   `z.strictObject`. The conformance tests prove it against the package's
 *   fixtures, so an unknown key is rejected as the schema rejects it.
 * - `revalidateRequestSchema` is the reader the route parses with. Every
 *   object is a `z.object`, which drops unknown keys at every level instead
 *   of rejecting them; every constraint on a known key is exactly as strict.
 *   The CMS deploys first and contract changes are additive, so a CMS one
 *   deploy ahead may send a key this front end does not know yet, and that
 *   must not be a `400`. A breaking change bumps `version`, which stays `1`.
 *
 * The two replies are what the front end sends, so they are strict only.
 */

/**
 * `rest_url`: `"format": "uri"` plus `"pattern": "^https?://"`.
 *
 * The pattern is mirrored exactly, case-sensitive as it is in the schema (so
 * `HTTPS://` is rejected). `format: uri` cannot be mirrored exactly: Ajv's
 * formats plugin checks the RFC 3986 grammar with a regular expression, and Zod
 * offers only `z.url()`, which asks the WHATWG URL parser. The two disagree in
 * both directions, and the checks below close one of them.
 *
 * Where WHATWG is the looser, it accepts characters RFC 3986 forbids (a space,
 * `|`, `^`, `{`, a non-ASCII letter, `[` outside the host, a second `#`) and
 * percent-encodes them, and it reads the userinfo up to the last `@`, so
 * `https://a@b@[::1]/` parses. The checks allow only RFC 3986's unreserved and
 * reserved characters and well-formed percent escapes, `[` and `]` only in the
 * host (an IPv6 literal, which the parser then validates) and only behind at
 * most one `@`, and at most one `#`. A differential run against Ajv over this
 * schema (2,600 authority combinations and 100,000 random mutations of a
 * `rest_url`) found no string these checks accept and Ajv rejects.
 *
 * Where WHATWG is the stricter, the gap stays open on purpose: this schema
 * rejects some strings Ajv accepts, because a URL the parser cannot read could
 * not be fetched anyway. The run found these: an empty host (`http://`,
 * `https://a@/`), a port that is not a number from 0 to 65535 (`x:99999`,
 * `x:abc`, a second `:`), an IPvFuture literal (`[v1.x]`), an invalid IPv4
 * address (`1.2.3.256`) and a host that decodes to a forbidden character
 * (`%00`). Some of them RFC 3986 rejects too (`x:abc` is no port there); Ajv's
 * expression is looser than the grammar it implements.
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
      const authority = /^https?:\/\/([^/?#]*)/u.exec(value)?.[1] ?? "";
      const lastAt = authority.lastIndexOf("@");
      // The userinfo as the WHATWG parser reads it: up to the last `@`.
      const userinfo = authority.slice(0, lastAt + 1);
      // Everything after the scheme and authority: path, query and fragment.
      const rest = value.replace(/^https?:\/\/[^/?#]*/u, "");
      return (
        !/[[\]]/u.test(userinfo) &&
        // RFC 3986's userinfo cannot hold an `@`, so `a@b@[::1]` is no
        // authority there, while the WHATWG parser reads `a@b` as the userinfo.
        !(/[[\]]/u.test(authority) && authority.indexOf("@") !== lastAt) &&
        !/[[\]]/u.test(rest) &&
        rest.indexOf("#") === rest.lastIndexOf("#")
      );
    },
    { error: "must have [ and ] only in the host and at most one #" },
  )
  .refine((value) => URL.canParse(value), { error: "must be a valid URL" });

/** A term's display name: any non-empty string. */
const termNameSchema = z.string().min(1, { error: "must not be empty" });

/** The fields of a resource event besides `event` and `previous`. */
const resourceEventFields = {
  type: z.literal("resource"),
  id: idSchema,
  slug: slugSchema,
  rest_url: restUrlSchema,
  types: typeListSchema,
  topics: topicListSchema,
};

/** The fields of a term event besides `event` and `previous`. */
const termEventFields = {
  type: z.literal("term"),
  taxonomy: z.enum(["resource_topic", "resource_type"]),
  id: idSchema,
  slug: slugSchema,
  name: termNameSchema,
};

/**
 * How a variant treats unknown keys: `strict` rejects them, as
 * `additionalProperties: false` does; `strip` drops them from the parsed value.
 */
type UnknownKeys = "strict" | "strip";

/**
 * Builds the request's schemas with every object made by one constructor, so
 * the strict mirror and the reader cannot drift apart in anything but unknown
 * keys. The parsed types are the same for both.
 */
function buildRequestSchemas(unknownKeys: UnknownKeys) {
  const object = <Shape extends z.ZodRawShape>(shape: Shape) =>
    unknownKeys === "strict" ? z.strictObject(shape) : z.object(shape);

  /** `$defs/resourceState`: where a resource is listed. */
  const resourceState = object({
    slug: slugSchema,
    types: typeListSchema,
    topics: topicListSchema,
  });

  /**
   * `$defs/resourceEvent`. The schema's `if event is update then previous is a
   * resourceState else previous is null` becomes a union discriminated on
   * `event`: one branch for `update`, one for the other four. It accepts and
   * rejects the same bodies, and the inferred type says that `previous` is
   * non-null exactly when `event` is `"update"`.
   */
  const resourceEvent = z.discriminatedUnion("event", [
    object({
      ...resourceEventFields,
      event: z.literal("update"),
      previous: resourceState,
    }),
    object({
      ...resourceEventFields,
      event: z.enum(["publish", "unpublish", "trash", "delete"]),
      previous: z.null(),
    }),
  ]);

  /** `$defs/termState`: a term's slug and name before an update. */
  const termState = object({
    slug: slugSchema,
    name: termNameSchema,
  });

  /**
   * `$defs/termEvent`. The schema has two conditionals. The one on `event`
   * (`previous` set on `update`, `null` otherwise) is a discriminated union, as
   * for resource events. The one on `taxonomy` (a `resource_type` term's `slug`
   * and `previous.slug` are type slugs, so never `topic` or `page`) is a
   * refinement, because splitting on both keys would make four near-identical
   * branches for a rule that only adds a check.
   */
  const termEvent = z
    .discriminatedUnion("event", [
      object({
        ...termEventFields,
        event: z.literal("update"),
        previous: termState,
      }),
      object({
        ...termEventFields,
        event: z.enum(["create", "delete"]),
        previous: z.null(),
      }),
    ])
    .superRefine((event, ctx) => {
      if (event.taxonomy !== "resource_type") {
        return;
      }
      const problem = typeSlugProblem(event.slug);
      if (problem !== null) {
        ctx.addIssue({ code: "custom", path: ["slug"], message: problem });
      }
      const previousProblem = event.previous === null ? null : typeSlugProblem(event.previous.slug);
      if (previousProblem !== null) {
        ctx.addIssue({ code: "custom", path: ["previous", "slug"], message: previousProblem });
      }
    });

  /** `$defs/pageState`: where a page is served. */
  const pageState = object({
    path: pagePathSchema,
  });

  /**
   * `$defs/pageEvent` (ADR 0052): the five event names of a resource event,
   * the page's ID and public path, and `previous` on `update` only, as for the
   * other two shapes.
   */
  const pageEvent = z.discriminatedUnion("event", [
    object({
      type: z.literal("page"),
      id: idSchema,
      path: pagePathSchema,
      event: z.literal("update"),
      previous: pageState,
    }),
    object({
      type: z.literal("page"),
      id: idSchema,
      path: pagePathSchema,
      event: z.enum(["publish", "unpublish", "trash", "delete"]),
      previous: z.null(),
    }),
  ]);

  /**
   * One event in a batch, told apart by `type`. The schema's `oneOf` over the
   * three shapes can match at most one branch, since `type` is a different
   * constant in each, so a discriminated union accepts the same events.
   */
  const event = z.discriminatedUnion("type", [resourceEvent, termEvent, pageEvent]);

  /** The request body: `version` 1 and a batch of 1 to 25 events. */
  const request = object({
    version: z.literal(1),
    events: z
      .array(event)
      .min(1, { error: "must contain at least one event" })
      .max(25, { error: "must contain at most 25 events" }),
  });

  return { resourceState, resourceEvent, termState, termEvent, pageState, pageEvent, event, request };
}

const strictRequest = buildRequestSchemas("strict");
const readerRequest = buildRequestSchemas("strip");

/**
 * The exact mirror of `revalidate-request.schema.json`: rejects unknown keys.
 * For the conformance tests; the route parses with `revalidateRequestSchema`.
 */
export const revalidateRequestSchemaStrict = strictRequest.request;

/**
 * The reader the revalidate route parses with: drops unknown keys at every
 * level, and holds every known key to exactly the strict mirror's rules.
 */
export const revalidateRequestSchema = readerRequest.request;

/** The reader's parts, for code that handles one event or state at a time. */
export const resourceStateSchema = readerRequest.resourceState;
export const resourceEventSchema = readerRequest.resourceEvent;
export const termStateSchema = readerRequest.termState;
export const termEventSchema = readerRequest.termEvent;
export const pageStateSchema = readerRequest.pageState;
export const pageEventSchema = readerRequest.pageEvent;
export const revalidationEventSchema = readerRequest.event;

/** The `200` reply: every path the batch revalidated. */
export const revalidateResponseOkSchema = z.strictObject({
  revalidated: z.array(pathSchema),
});

/**
 * The `400`, `401` and `500` reply: any non-empty `error`. The contract says a
 * `401` carries `unauthorized`; this schema does not check that, so the route
 * must send it.
 */
export const revalidateResponseErrorSchema = z.strictObject({
  error: z.string().min(1, { error: "must not be empty" }),
});

export type ResourceState = z.infer<typeof resourceStateSchema>;
export type ResourceEvent = z.infer<typeof resourceEventSchema>;
export type TermState = z.infer<typeof termStateSchema>;
export type TermEvent = z.infer<typeof termEventSchema>;
export type PageState = z.infer<typeof pageStateSchema>;
export type PageEvent = z.infer<typeof pageEventSchema>;
export type RevalidationEvent = z.infer<typeof revalidationEventSchema>;
export type RevalidateRequest = z.infer<typeof revalidateRequestSchema>;
export type RevalidateResponseOk = z.infer<typeof revalidateResponseOkSchema>;
export type RevalidateResponseError = z.infer<typeof revalidateResponseErrorSchema>;
