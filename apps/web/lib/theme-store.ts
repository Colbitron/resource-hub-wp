import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, type ThemeChoice, themeFromStored } from "./theme";

/**
 * The theme choice as a store the client component subscribes to with
 * `useSyncExternalStore`: `localStorage` holds the value, `<html>`'s
 * `data-theme` shows it, and a change in either place reaches every
 * subscriber. Browser-only; the root layout imports nothing from here.
 *
 * - `readTheme` is the client snapshot: the stored value, or the choice made
 *   in this tab when storage refuses to be read (a browser that blocks it),
 *   so the control never shows System while the page is dark.
 * - `getServerSnapshot` is `null`, "not known yet": the server renders no
 *   option checked and the control invisible, and React's hydration render
 *   uses the same snapshot, so the DOM and the markup agree. Only after
 *   hydration does React re-render with the client snapshot, which is when
 *   the right option becomes checked and the control shows. The head script
 *   (`THEME_INIT_SCRIPT`) has already themed the page by then, so the only
 *   thing that waits for hydration is the control itself.
 * - `setTheme` writes the value, applies it to `<html>` at once, before
 *   React re-renders, and notifies subscribers. System removes the key.
 * - The `storage` event, which fires in the other tabs when one tab writes,
 *   re-applies the stored value there and notifies, so every open tab
 *   follows the last choice.
 */

const listeners = new Set<() => void>();

/** The last choice made in this tab, for when `localStorage` cannot be read. */
let fallback: ThemeChoice = "system";

export function readTheme(): ThemeChoice {
  try {
    return themeFromStored(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return fallback;
  }
}

export function getServerSnapshot(): null {
  return null;
}

/** Sets or removes `data-theme` on `<html>`, which the stylesheet maps to `color-scheme`. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute(THEME_ATTRIBUTE);
  } else {
    root.setAttribute(THEME_ATTRIBUTE, choice);
  }
}

export function setTheme(choice: ThemeChoice): void {
  fallback = choice;
  try {
    if (choice === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Storage refused the write (blocked, full, private mode in an old
    // browser): the choice still applies for this page, through `fallback`.
  }
  applyTheme(choice);
  notify();
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Another tab changed storage: a `null` key is `localStorage.clear()`, which removes ours too. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) {
    return;
  }
  applyTheme(readTheme());
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}
