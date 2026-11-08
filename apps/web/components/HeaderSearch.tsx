"use client";

import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { isSearchPagePath, SEARCH_PATH } from "@/lib/routes";
import { HEADER_SEARCH_INPUT_ID, SEARCH_INPUT_ID } from "@/lib/search-field";

import { HeaderSearchIcon } from "./HeaderSearchIcon";

import "@colbitron/resource-hub-ui/header-search.css";

/**
 * The header's search control, at the end of the header's row after the
 * lockup (issue #115; `packages/ui/DESIGN.md`, "Brand" and "Components").
 * A client component because it holds the bar's open state; it reads the
 * pathname, never the query string, `headers()` or `cookies()`, so the root
 * layout that renders it stays static on every ISR route.
 *
 * - **Without JavaScript**, and in the server's HTML on every page, it is a
 *   plain link to `/search/`, named "Search", so it works everywhere.
 * - **With JavaScript** it becomes a disclosure button after hydration
 *   (`aria-expanded`, `aria-controls`): the same box in the same place, so
 *   nothing moves. Opening it shows the bar under the header, laid over the
 *   page rather than pushing it down, and moves focus to the bar's field.
 *   The bar is the search page's own form (`SearchForm`, a GET form to
 *   `/search/` in a `search` landmark) with a field ID of its own, so a
 *   submission is the same full document load as from the page, and the
 *   page's sentences about a too-short, too-long or unsearchable query are
 *   the hints for both. Escape, from the button or anywhere in the bar,
 *   closes it and returns focus to the button. Focus is never trapped:
 *   Tab or Shift-Tab out of the button and the bar closes it and leaves
 *   focus where it went, so the bar never covers the focused element; a
 *   pointer press outside closes it too, and a navigation closes it,
 *   because it is open only on the path it was opened on.
 * - **On the search page** it stays a link, to the page's own field
 *   (`#rh-search-q`), and with JavaScript focuses that field: the page
 *   already has the form, so a second one in the header would be two
 *   fields named `q` and two `search` landmarks for one task. It is the same
 *   box on every page, so the header never changes shape, and from the foot
 *   of a long list of results it takes the reader back to the field.
 *
 * **Bytes.** Every page's HTML carries this control, and on an image-led
 * page that HTML must fit the 14,600 bytes of Lighthouse's first round trip
 * (`e2e/document-size.spec.ts`); with `experimental.inlineCss` each
 * stylesheet imported here is in it three times (the `<style>` and two
 * copies in the RSC payload). So the server renders the link and its icon
 * alone, with the icon's paint as SVG attributes rather than CSS, since a
 * client component's markup is in the HTML once; the eager stylesheet,
 * `header-search.css`, is the button's alone; and the bar, its stylesheet
 * `header-search-bar.css` and the form with `search.css` are one module,
 * `HeaderSearchBar`, imported on demand: when a pointer comes over the
 * button or it takes focus, and at the latest on the press that opens it,
 * which waits for it. If that import fails, the press goes to the search
 * page instead.
 *
 * If the button replaces a link that had focus during hydration (a reader
 * who tabbed to it before the bundle ran), the button takes the focus.
 */

const PANEL_ID = "rh-header-search-panel";

type Bar = (typeof import("./HeaderSearchBar"))["HeaderSearchBar"];

let barModule: Promise<Bar> | null = null;

/** The bar's module, imported once; a failed import is forgotten, so the next press tries again. */
function loadBar(): Promise<Bar> {
  barModule ??= import("./HeaderSearchBar").then(
    (module) => module.HeaderSearchBar,
    (error: unknown) => {
      barModule = null;
      throw error;
    },
  );
  return barModule;
}

function preloadBar(): void {
  loadBar().catch(() => {
    // Retried on the press that opens the bar, which then falls back to the page.
  });
}

/** Nothing to subscribe to: hydration renders the server's link, and React then renders the button. */
function subscribe(): () => void {
  return () => {};
}

const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

export function HeaderSearch() {
  const pathname = usePathname();
  const enhanced = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // The path the bar was opened on: it is open only while that is still the page.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [SearchBar, setSearchBar] = useState<Bar | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const linkHadFocus = useRef(false);

  const onSearchPage = isSearchPagePath(pathname);
  const open = !onSearchPage && SearchBar !== null && openOn === pathname;

  // Before the swap, note whether the server's link had focus; after it, give it to the button.
  useLayoutEffect(() => {
    if (!enhanced) {
      linkHadFocus.current = linkRef.current !== null && document.activeElement === linkRef.current;
    } else if (linkHadFocus.current) {
      linkHadFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [enhanced]);

  useEffect(() => {
    if (!open) {
      return;
    }
    document.getElementById(HEADER_SEARCH_INPUT_ID)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) {
        setOpenOn(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (onSearchPage || !enhanced) {
    const focusPageField = (event: MouseEvent<HTMLAnchorElement>) => {
      const field = onSearchPage ? document.getElementById(SEARCH_INPUT_ID) : null;
      if (field !== null) {
        event.preventDefault();
        field.focus();
      }
    };
    return (
      <div className="rh-header-search">
        <a
          ref={linkRef}
          className="rh-header-search__toggle"
          href={onSearchPage ? `#${SEARCH_INPUT_ID}` : SEARCH_PATH}
          aria-label="Search"
          onClick={focusPageField}
        >
          <HeaderSearchIcon />
        </a>
      </div>
    );
  }

  const toggle = () => {
    if (open) {
      setOpenOn(null);
      return;
    }
    const openedOn = pathname;
    loadBar().then(
      (bar) => {
        setSearchBar(() => bar);
        setOpenOn(openedOn);
      },
      () => window.location.assign(SEARCH_PATH),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpenOn(null);
      buttonRef.current?.focus();
    }
  };

  // Focus leaving the control closes it; a blur with no new focus (a click on
  // the page in Safari, which focuses no button) is the pointer handler's.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !event.currentTarget.contains(next)) {
      setOpenOn(null);
    }
  };

  return (
    <div ref={rootRef} className="rh-header-search" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        className="rh-header-search__toggle"
        type="button"
        aria-label="Search"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={toggle}
        onPointerEnter={preloadBar}
        onFocus={preloadBar}
      >
        <HeaderSearchIcon open={open} />
      </button>
      <div className="rh-header-search__panel" id={PANEL_ID} hidden={!open}>
        {SearchBar !== null && <SearchBar />}
      </div>
    </div>
  );
}
