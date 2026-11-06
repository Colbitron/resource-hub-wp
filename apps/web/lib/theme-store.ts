import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, type ThemeChoice, themeFromStored } from "./theme";

/**
 * The theme choice as a store the client component subscribes to with
 * `useSyncExternalStore`: `localStorage` holds the value, `<html>`'s
 * `data-theme` shows it, and a change in either place reaches every
 * subscriber. Browser-only; the root layout imports nothing from here.
 *
 * - `readTheme` is the client snapshot: a choice made in this tab that
 *   storage refused to hold, if there is one, and otherwise the stored
 *   value. So the control and the page agree whenever storage cannot write
 *   (blocked, full) or cannot be read at all: the control never shows System
 *   while the page is dark.
 * - `getServerSnapshot` is `null`, "not known yet": the server renders no
 *   option checked and the control invisible, and React's hydration render
 *   uses the same snapshot, so the DOM and the markup agree. Only after
 *   hydration does React re-render with the client snapshot, which is when
 *   the right option becomes checked and the control shows. The head script
 *   (`THEME_INIT_SCRIPT`) has already themed the page by then, so the only
 *   thing that waits for hydration is the control itself.
 * - `setTheme` writes the value, applies it to `<html>` at once, before
 *   React re-renders, and notifies subscribers. System removes the key.
 * - The `storage` event, which fires in the other tabs when one tab writes
 *   `localStorage`, re-applies the stored value there and notifies, so every
 *   open tab follows the last choice. A page restored from the back/forward
 *   cache (`pageshow` with `persisted`) missed any such event while it was
 *   frozen, so it re-reads the value the same way.
 *
 * An unpersisted choice lasts only as long as the page: the head script
 * reads storage alone, so after a reload both it and the control fall back
 * to what storage holds, and they still agree.
 */

const listeners = new Set<() => void>();

/**
 * The choice made in this tab that storage did not take, or `null` when
 * storage holds the reader's last choice. Set when a write throws, cleared
 * by the next write that succeeds and by a write in another tab, which is
 * newer.
 */
let unpersisted: ThemeChoice | null = null;

export function readTheme(): ThemeChoice {
  if (unpersisted !== null) {
    return unpersisted;
  }
  try {
    return themeFromStored(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage cannot be read, so the head script read nothing either and
    // set no attribute: System is what the page shows.
    return "system";
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
  try {
    if (choice === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
    unpersisted = null;
  } catch {
    // Storage refused the write (blocked, full, private mode in an old
    // browser): the choice still applies to this page, and `readTheme`
    // answers with it, so the control shows what the page shows.
    unpersisted = choice;
  }
  applyTheme(choice);
  notify();
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Re-reads the choice and applies it, after something outside this tab may have changed it. */
function resync(): void {
  applyTheme(readTheme());
  notify();
}

/** Whether a `storage` event is about `localStorage`, and not `sessionStorage`. */
function isLocalStorage(area: Storage | null): boolean {
  try {
    return area === localStorage;
  } catch {
    return false;
  }
}

/** Another tab changed `localStorage`: a `null` key is `localStorage.clear()`, which removes ours too. */
function onStorage(event: StorageEvent): void {
  if (!isLocalStorage(event.storageArea)) {
    return;
  }
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) {
    return;
  }
  unpersisted = null;
  resync();
}

/** The page came back from the back/forward cache, frozen through any `storage` event meanwhile. */
function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted) {
    resync();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    }
  };
}
