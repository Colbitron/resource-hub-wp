import { useId, type ReactNode } from "react";

import { THEME_CHOICES, type ThemeChoice } from "@/lib/theme";

import "./theme-toggle.css";

/**
 * The theme control's markup: a native `<fieldset>` with a `<legend>` and
 * one radio per choice, System, Light and Dark, each with an inline icon and
 * a visible word. Presentational: `ThemeToggle` renders it live, with the
 * stored choice and `setTheme`, and the design specimen renders it in each
 * state with a handler that does nothing (`StillThemeFieldset`). The
 * stylesheet is imported here, by the component that renders the markup
 * (`packages/ui/DESIGN.md`).
 *
 * Why native radios and not a cycling button or a menu: the platform gives
 * the group, the single selection, the arrow keys and the announcements for
 * free, and a radio tells a screen reader its own new state, so no live
 * region is needed. Arrowing between the options changes the theme at each
 * press, as native radios select on focus; the switch is instant, with no
 * transition, so that is a change of content and not of context.
 *
 * Each option's accessible name is "System theme", "Light theme" or "Dark
 * theme": the visible word plus a visually hidden suffix inside the label,
 * so the name stands on its own where the legend is dropped (iOS VoiceOver
 * inside the header landmark, TalkBack with any group), and so it begins
 * with the visible text for voice control. The legend is visually hidden,
 * never removed. The text is never hidden at narrow widths: at 400% zoom
 * the group wraps instead, so the people who zoom keep the words.
 *
 * The input is not hidden from the page: it is laid over its whole segment
 * at `opacity: 0`, so touch exploration and a click find the real control
 * where the segment is drawn. The checked segment is marked by a bar as
 * well as a fill, and the focus ring is a real outline, because fills and
 * shadows vanish under forced colours (`theme-toggle.css`).
 *
 * `value` is `null` while the choice is not known: on the server, and on
 * the client until hydration has read storage. Then no option is checked
 * and the group is invisible but keeps its space, so nothing shifts when it
 * appears. Without JavaScript it never appears, which is right, since the
 * choice could not be applied, and the page follows the system preference;
 * a `<noscript>` style in the root layout then removes the header's slot for
 * it, so no empty space is kept (`THEME_NOSCRIPT_STYLE` in `lib/theme.ts`).
 */

export interface ThemeFieldsetProps {
  /** The radios' `name`; two copies on one page need two names. */
  name: string;
  /** The checked option, or `null` while unknown. */
  value: ThemeChoice | null;
  /**
   * Called with the option the reader picked. The radios are always
   * controlled, so `value` alone decides which is checked: a handler that
   * does nothing leaves the group as it is. A function cannot cross from a
   * Server Component to the client, so the parent that passes it must be a
   * client component (`ThemeToggle`, or the specimen's `StillThemeFieldset`);
   * this file has no `"use client"` of its own and becomes client code there.
   */
  onChange: (choice: ThemeChoice) => void;
}

const LABELS: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * The icons: a screen, a sun and a moon, drawn by hand on a 24 px grid as
 * strokes in `currentColor`, so they follow the text colour in every scheme
 * and under forced colours. Decorative: the word beside each carries the
 * meaning.
 */
const ICONS: Record<ThemeChoice, ReactNode> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
};

export function ThemeFieldset({ name, value, onChange }: ThemeFieldsetProps) {
  const id = useId();
  return (
    <fieldset className={value === null ? "rh-theme rh-theme--pending" : "rh-theme"}>
      <legend className="rh-theme__legend">Theme</legend>
      {THEME_CHOICES.map((choice) => {
        const inputId = `${id}-${choice}`;
        const checked = value === choice;
        return (
          <span className="rh-theme__option" key={choice}>
            <input
              className="rh-theme__input"
              type="radio"
              name={name}
              id={inputId}
              value={choice}
              checked={checked}
              onChange={() => onChange(choice)}
            />
            <label className="rh-theme__label" htmlFor={inputId}>
              <svg className="rh-theme__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {ICONS[choice]}
              </svg>
              {LABELS[choice]}
              <span className="rh-theme__suffix"> theme</span>
            </label>
          </span>
        );
      })}
    </fieldset>
  );
}
