/**
 * Every `--rh-*` token in the shared `tokens.css`
 * (`@colbitron/resource-hub-ui`), grouped as the specimen page shows them.
 * Listed by hand rather than parsed, so the page is plain data; the unit
 * test `test/specimen-tokens.test.ts` fails when `tokens.css` declares a
 * token this list does not have, or this list names one it no longer
 * declares, and `e2e/specimen.spec.ts` checks the page renders each one.
 */

export const COLOR_TOKENS = [
  "--rh-color-text",
  "--rh-color-text-muted",
  "--rh-color-surface",
  "--rh-color-surface-raised",
  "--rh-color-border",
  "--rh-color-border-strong",
  "--rh-color-accent",
  "--rh-color-accent-text",
  "--rh-color-focus",
] as const;

/** The five brand accents, for marks only; `lib/type-accents.ts` gives each type one. */
export const MARK_TOKENS = [
  "--rh-mark-coral",
  "--rh-mark-cobalt",
  "--rh-mark-lemon",
  "--rh-mark-mint",
  "--rh-mark-grape",
] as const;

export const FONT_TOKENS = ["--rh-font-sans"] as const;

/** How a heading differs from body text in the same face. */
export const HEADING_TOKENS = ["--rh-weight-heading", "--rh-tracking-heading"] as const;

export const TEXT_SIZE_TOKENS = [
  "--rh-text-sm",
  "--rh-text-base",
  "--rh-text-md",
  "--rh-text-lg",
  "--rh-text-xl",
  "--rh-text-2xl",
] as const;

export const LEADING_TOKENS = ["--rh-leading-tight", "--rh-leading-body"] as const;

export const SPACE_TOKENS = [
  "--rh-space-1",
  "--rh-space-2",
  "--rh-space-3",
  "--rh-space-4",
  "--rh-space-5",
  "--rh-space-6",
  "--rh-space-7",
  "--rh-space-8",
] as const;

export const RADIUS_TOKENS = ["--rh-radius-sm", "--rh-radius"] as const;

export const LINE_TOKENS = ["--rh-border-width", "--rh-focus-width"] as const;

export const MEASURE_TOKENS = ["--rh-measure", "--rh-measure-wide"] as const;

/** Every token the specimen shows, in page order. */
export const SPECIMEN_TOKENS: readonly string[] = [
  ...COLOR_TOKENS,
  ...MARK_TOKENS,
  ...FONT_TOKENS,
  ...HEADING_TOKENS,
  ...TEXT_SIZE_TOKENS,
  ...LEADING_TOKENS,
  ...SPACE_TOKENS,
  ...RADIUS_TOKENS,
  ...LINE_TOKENS,
  ...MEASURE_TOKENS,
];
