import { expect, test } from "@playwright/test";

/**
 * The theme's hydration under `next dev` (`playwright.dev.config.ts`, run by
 * hand with `pnpm web:test:dev`, never in CI). Development React logs an
 * attribute mismatch on hydration as a console error, which production
 * React never does, and runs Strict Mode's extra mount, which the Next.js
 * guide warns can reset <html> to the attributes it rendered. So with Dark
 * stored, where the head script has set `data-theme` before React runs:
 *
 * - no console error or warning means `suppressHydrationWarning` on <html>
 *   covers the one attribute the script sets, and nothing else mismatches;
 * - `data-theme="dark"` after hydration means nothing cleared it.
 */

const STORAGE_KEY = "rh-theme";

test("hydrates with Dark stored: no console error or warning, and data-theme still dark", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") messages.push(message.text());
  });
  page.on("pageerror", (error) => messages.push(error.message));
  await page.addInitScript((key) => localStorage.setItem(key, "dark"), STORAGE_KEY);

  // The first request compiles the route; load it once before listening matters.
  await page.goto("/");
  await expect(page.getByRole("radio", { name: "Dark theme", exact: true })).toBeChecked({ timeout: 60_000 });
  messages.length = 0;

  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark theme", exact: true })).toBeChecked();
  await page.waitForLoadState("load");
  // Give React's development checks and any effect after hydration a moment
  // to log, then read the attribute they could have reset.
  await page.waitForTimeout(1_000);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(messages).toEqual([]);
});
