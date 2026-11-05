import { z } from "zod";

/**
 * WordPress core's REST error body, built from a `WP_Error`, mirroring
 * `packages/ui/schemas/wp-error.schema.json`. The plugin's resolve and related
 * routes return it for `400` and `404`, and core returns it everywhere else.
 *
 * Neither object is closed in the schema, because core adds keys
 * (`additional_errors` at the top level, `params` and `details` inside `data`).
 * `z.object` accepts unknown keys too; it drops them from the parsed value
 * rather than keeping them, which the schema does not care about and the
 * front end does not need.
 */
export const wpErrorSchema = z.object({
  code: z.string().min(1, { error: "must not be empty" }),
  message: z.string(),
  data: z.object({
    status: z.int().min(400).max(599),
  }),
});

export type WpError = z.infer<typeof wpErrorSchema>;
