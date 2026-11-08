/**
 * The header's search control's icon (`HeaderSearch`): a magnifier, or a
 * cross while the bar is open. Decorative, since the control's name is
 * "Search". Drawn by SVG attributes rather than CSS: the control's markup
 * is in a page's HTML once, while every stylesheet the shell imports is in
 * it three times (`HeaderSearch`'s docblock has the bytes); the stylesheet
 * sets only its size. The specimen's still copies draw the same icon.
 */
export function HeaderSearchIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className="rh-header-search__icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      {open ? (
        <path d="M6 6l12 12M18 6 6 18" />
      ) : (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.5-4.5" />
        </>
      )}
    </svg>
  );
}
