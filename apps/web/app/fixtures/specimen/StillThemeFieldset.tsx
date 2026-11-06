"use client";

import { ThemeFieldset } from "@/components/ThemeFieldset";
import type { ThemeChoice } from "@/lib/theme";

/**
 * A copy of the theme control for the specimen, fixed in one state: its
 * radios are controlled and the handler does nothing, so a click or an arrow
 * key moves focus but never the checked option, and nothing is stored or
 * applied. It reads and announces as the live control does, which `disabled`
 * would not ("dimmed"). A client component only because a handler, even an
 * empty one, cannot be passed from the specimen, a Server Component.
 */
export function StillThemeFieldset({ name, value }: { name: string; value: ThemeChoice }) {
  return <ThemeFieldset name={name} value={value} onChange={ignore} />;
}

function ignore(): void {}
