import { z } from "zod";

/**
 * WordPress's pagination headers on a collection response: `X-WP-Total`, the
 * number of items across all pages, and `X-WP-TotalPages`. Both are
 * non-negative integers written in decimal; `X-WP-TotalPages` is `0` when
 * nothing matches.
 */

const countSchema = z
  .string({ error: "is missing" })
  .regex(/^\d+$/, { error: "must be a non-negative integer" })
  .transform(Number)
  .pipe(z.int());

// Keyed by header name so a parse error names the header.
const headersSchema = z.object({
  "X-WP-Total": countSchema,
  "X-WP-TotalPages": countSchema,
});

export type Pagination = {
  /** Items across all pages. */
  total: number;
  /** Pages at the requested `per_page`. */
  totalPages: number;
};

/**
 * Reads the pagination headers from a response's `Headers` (or anything with
 * the same case-insensitive `get`). Throws a `ZodError` naming the header when
 * one is missing or not a number.
 */
export function parsePaginationHeaders(headers: Pick<Headers, "get">): Pagination {
  const parsed = headersSchema.parse({
    "X-WP-Total": headers.get("X-WP-Total") ?? undefined,
    "X-WP-TotalPages": headers.get("X-WP-TotalPages") ?? undefined,
  });
  return { total: parsed["X-WP-Total"], totalPages: parsed["X-WP-TotalPages"] };
}
