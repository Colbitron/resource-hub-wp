import type { z } from "zod";

/**
 * Plain sentences for Zod's own issue messages, for the revalidate route's
 * `400` bodies, which the plugin stores and shows to the editor (ADR 0018).
 * Zod's defaults read like a stack trace there ("Invalid discriminator value.
 * Expected 'update' | …", "Too small: expected string to have >=1
 * characters"); these read as the end of a sentence that starts with the
 * issue's path: `events[0].event` + ` must be "update", "publish", … or
 * "delete"`.
 *
 * Passed to `safeParse` as the per-parse error map, so it fills in only the
 * issues whose schema set no message of its own: a message written on a
 * check (`must not list a topic twice`) or added by a refinement always
 * wins (Zod's precedence: schema, then per-parse, then global, then locale).
 *
 * Nothing here repeats the input. The allowed values a literal, enum or
 * discriminator lists come from the schema, never from the body; an
 * unrecognised key is counted, not named.
 */

/** How each `expected` of an `invalid_type` issue reads after "must be". */
const EXPECTED: Readonly<Record<string, string>> = {
  string: "a string",
  number: "a number",
  int: "a whole number",
  boolean: "true or false",
  object: "an object",
  array: "an array",
  null: "null",
};

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`: the allowed values, as JSON. */
function oneOf(values: readonly unknown[]): string {
  const quoted = values.map((value) => JSON.stringify(value) ?? String(value));
  if (quoted.length <= 1) {
    return quoted[0] ?? "";
  }
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

function plural(count: number | bigint, one: string, many: string): string {
  return `${count} ${Number(count) === 1 ? one : many}`;
}

function sizeMessage(
  bound: "least" | "most",
  origin: string,
  limit: number | bigint,
  inclusive: boolean | undefined,
): string | undefined {
  switch (origin) {
    case "string":
      if (bound === "least" && limit === 1) {
        return "must not be empty";
      }
      return `must be at ${bound} ${plural(limit, "character", "characters")} long`;
    case "array":
    case "set":
      if (bound === "least" && limit === 1) {
        return "must not be empty";
      }
      return `must have at ${bound} ${plural(limit, "item", "items")}`;
    case "number":
    case "int":
    case "bigint":
      if (inclusive === false) {
        return `must be ${bound === "least" ? "greater" : "less"} than ${limit}`;
      }
      return `must be at ${bound} ${limit}`;
    default:
      return undefined;
  }
}

/** The fallback for any issue this map has no sentence for. */
export const FALLBACK_ISSUE_MESSAGE = "is not valid";

/**
 * The plain message for `issue`. Typed as Zod's error map so it can be passed
 * straight to `safeParse(value, { error: plainIssueMessage })`.
 */
export const plainIssueMessage: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) {
        return "is missing";
      }
      return EXPECTED[issue.expected] === undefined
        ? "has the wrong type"
        : `must be ${EXPECTED[issue.expected]}`;
    case "invalid_value":
      return `must be ${oneOf(issue.values)}`;
    case "invalid_union": {
      // A discriminated union whose key matched no branch: the path already
      // ends in the key (`events[0].event`), and `options` are its allowed values.
      const options = (issue as { options?: unknown }).options;
      if (Array.isArray(options) && options.length > 0) {
        return `must be ${oneOf(options)}`;
      }
      return "does not match any of the shapes it may take";
    }
    case "too_small":
      return sizeMessage("least", issue.origin, issue.minimum, issue.inclusive) ?? "is too small";
    case "too_big":
      return sizeMessage("most", issue.origin, issue.maximum, issue.inclusive) ?? "is too large";
    case "unrecognized_keys":
      return `has ${plural(issue.keys.length, "key", "keys")} it must not have`;
    case "invalid_format":
      return "is not in the expected format";
    default:
      return FALLBACK_ISSUE_MESSAGE;
  }
};
