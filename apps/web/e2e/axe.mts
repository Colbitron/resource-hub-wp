import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * The WCAG tags the accessibility gate scans for: every level A and AA rule
 * axe has for WCAG 2.0, 2.1 and 2.2. axe has no `wcag22a` tag: the 2.2
 * level A criteria it can test are already under the 2.0 and 2.1 tags.
 */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A violation reduced to what a reader of the failure needs: the rule, its impact and the first few nodes. */
export interface Violation {
  rule: string;
  impact: string | null | undefined;
  help: string;
  nodes: { target: string; summary: string | undefined }[];
}

/** Runs axe over the whole page with `WCAG_TAGS` and returns its violations; `[]` is a pass. */
export async function wcagViolations(page: Page): Promise<Violation[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes
      .slice(0, 5)
      .map((node) => ({ target: node.target.join(" "), summary: node.failureSummary })),
  }));
}
