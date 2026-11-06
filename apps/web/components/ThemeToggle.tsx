"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import { applyTheme, getServerSnapshot, readTheme, setTheme, subscribe } from "@/lib/theme-store";

import { ThemeFieldset } from "./ThemeFieldset";

/**
 * The live System / Light / Dark control in the site header: the stored
 * choice from `lib/theme-store.ts`, rendered by `ThemeFieldset`, with the
 * change applied by `setTheme`. One of the two client components in the app
 * (`apps/web/CLAUDE.md`), because the choice is the reader's and lives in
 * their browser.
 *
 * The server snapshot is `null`, so the server renders nothing checked and
 * the control invisible, and the hydration render agrees with that markup;
 * React then re-renders with the stored choice, which is when the control
 * appears. The page itself was themed before first paint by the head script
 * in `app/layout.tsx`.
 *
 * The layout effect re-applies the choice to `<html>` whenever it changes,
 * before paint. It is a guard: the Next.js guide warns that development's
 * Strict Mode remount can reset `<html>` to the attributes React rendered,
 * clearing the one the head script set. That was not reproduced on Next.js
 * 16.4.5 with React 19.3 (`e2e/theme.dev.ts` checks it under `next dev`),
 * so today the effect finds the attribute already set and sets it again,
 * to the same value; it is kept in case a later version does reset it.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, readTheme, getServerSnapshot);

  useLayoutEffect(() => {
    if (choice !== null) {
      applyTheme(choice);
    }
  }, [choice]);

  return <ThemeFieldset name="theme" value={choice} onChange={setTheme} />;
}
