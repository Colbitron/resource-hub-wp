import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FALLBACK_ISSUE_MESSAGE, plainIssueMessage } from "../lib/plain-issues";

/**
 * The plain sentences `lib/plain-issues.ts` gives for Zod's issue codes. The
 * route's own test covers the sentences a revalidation body produces; this
 * covers the codes the reader schema cannot reach (it strips unknown keys
 * rather than reporting them) and the fallback.
 */

function firstMessage(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value, { error: plainIssueMessage });
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("plainIssueMessage", () => {
  it("counts unrecognised keys and never names them", () => {
    const strict = z.strictObject({ version: z.literal(1) });
    const message = firstMessage(strict, { version: 1, "<script>": 1, other: 2 });
    expect(message).toBe("has 2 keys it must not have");
    expect(firstMessage(strict, { version: 1, other: 2 })).toBe("has 1 key it must not have");
  });

  it("says what a size bound is, for strings, arrays and numbers", () => {
    expect(firstMessage(z.string().min(3), "ab")).toBe("must be at least 3 characters long");
    expect(firstMessage(z.string().max(1), "ab")).toBe("must be at most 1 character long");
    expect(firstMessage(z.array(z.string()).min(1), [])).toBe("must not be empty");
    expect(firstMessage(z.number().max(10), 11)).toBe("must be at most 10");
    expect(firstMessage(z.number().positive(), 0)).toBe("must be greater than 0");
  });

  it("lists a literal's or an enum's allowed values, never the input", () => {
    expect(firstMessage(z.literal(1), 2)).toBe("must be 1");
    expect(firstMessage(z.enum(["a", "b", "c"]), "<b>bold</b>")).toBe('must be "a", "b" or "c"');
  });

  it("says a key is missing rather than of the wrong type", () => {
    expect(firstMessage(z.object({ slug: z.string() }), {})).toBe("is missing");
    expect(firstMessage(z.object({ slug: z.string() }), { slug: 1 })).toBe("must be a string");
  });

  it("falls back to one plain phrase for codes it has no sentence for", () => {
    expect(firstMessage(z.number().multipleOf(5), 7)).toBe(FALLBACK_ISSUE_MESSAGE);
    expect(firstMessage(z.union([z.string(), z.number()]), true)).toBe(
      "does not match any of the shapes it may take",
    );
  });

  it("leaves a message the schema wrote alone", () => {
    expect(firstMessage(z.string().min(1, { error: "must name a topic" }), "")).toBe("must name a topic");
  });
});
