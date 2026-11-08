/**
 * The theme choice: what the reader picked in the System / Light / Dark
 * control, and the one place that knows how it is stored and applied
 * (`packages/ui/DESIGN.md`, "Theme and colour scheme").
 *
 * - The choice lives in the browser only, in `localStorage` under
 *   `THEME_STORAGE_KEY`, as `light` or `dark`; System means the key is
 *   absent. Pages are static and ISR-cached, so no cookie and no server
 *   read: the server renders no option as checked and the client reads the
 *   value during hydration.
 * - It is applied as `data-theme` on `<html>`, which `packages/ui/base.css`
 *   maps to `color-scheme: light` or `dark`; every `light-dark()` token
 *   follows at once. System removes the attribute, so `:root`'s
 *   `color-scheme: light dark` and the system preference apply again.
 * - `THEME_INIT_SCRIPT` is the inline script the root layout puts in
 *   `<head>`: it reads the key inside try/catch and sets the attribute
 *   before the first paint, so a stored choice never flashes the other
 *   scheme. It runs with no JavaScript bundle loaded, which is what makes it
 *   work on a slow connection, and `test/theme.test.ts` runs it as a string
 *   against stubs. It is built from the same constants the component uses,
 *   so the two cannot disagree on the key or the values.
 *
 * No module here touches `window` at import time, so the root layout (a
 * Server Component) can import the script and the client component the
 * rest.
 */

export const THEME_STORAGE_KEY = "rh-theme";

export const THEME_ATTRIBUTE = "data-theme";

/** The three options, in the order the control shows them. */
export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The two values that are ever stored; `system` is the absence of a value. */
export type StoredTheme = Exclude<ThemeChoice, "system">;

export function isStoredTheme(value: unknown): value is StoredTheme {
  return value === "light" || value === "dark";
}

/**
 * The choice a stored value means: `light` and `dark` as themselves, and
 * anything else (no value, or a value another version wrote) as System.
 */
export function themeFromStored(value: string | null | undefined): ThemeChoice {
  return isStoredTheme(value) ? value : "system";
}

/**
 * The head script. Plain ES5 in one expression, so the oldest browser that
 * reaches the page runs it without a syntax error, and no identifier leaks
 * into the page's global scope. The key and the two values are interpolated
 * as JSON so the string is always a valid literal.
 */
export const THEME_INIT_SCRIPT = [
  "(function(){",
  "var t=null;",
  `try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}`,
  `if(t==="light"||t==="dark")document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t)`,
  "})()",
].join("");

/**
 * What the root layout puts in a `<noscript>` in `<head>`. With script, the
 * control waits for hydration invisible but keeping its space, so the footer
 * does not move when it appears. Without script it never appears, so that
 * space would be an empty gap for good: this removes the control's slot in
 * the footer (`.rh-footer__theme`, `components/Shell.tsx`) instead, and the
 * footer is laid out as if it had no control.
 */
export const THEME_NOSCRIPT_STYLE = "<style>.rh-footer__theme{display:none}</style>";
