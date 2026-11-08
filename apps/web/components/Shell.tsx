import type { ReactNode } from "react";

import "@colbitron/resource-hub-ui/tokens.css";
import "@colbitron/resource-hub-ui/fonts/figtree-fallback.css";
import "@colbitron/resource-hub-ui/base.css";
import "./shell.css";

import { BrandLockup } from "./Brand";
import { HeaderSearch } from "./HeaderSearch";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The page shell: skip link, header, `main` and footer around every page.
 *
 * This component, not `layout.tsx`, imports the shared tokens, because the
 * rule is that shared CSS is imported from the component that uses it
 * (packages/ui/DESIGN.md): the shell's own styles build on the tokens, and
 * the root layout renders the shell around every page, so the tokens reach
 * every page. It imports the size-adjusted fallback faces beside them,
 * since `--rh-font-sans` in the tokens names those faces, then the shared
 * base styles (`base.css`: the document, the theme choice's colour scheme
 * and the skip link) before its own landmark layout (`shell.css`). Page
 * content is stacked under `main`, which carries `tabIndex={-1}` so the
 * skip link lands focus on it in every browser.
 *
 * The header holds the lockup (`BrandLockup`: the publisher's mark and the
 * wordmark "Resource Hub", one link to the library) and, at the end of the
 * row, the search control (`HeaderSearch`, a client component, which
 * imports its own `header-search.css` from the shared package, after
 * `shell.css` in the order because this file imports it after). The control
 * is drawn into the row's padding, so the header is still one row at every
 * width from 320 px up, as short as it can be without shrinking anything
 * (`shell.css`).
 *
 * The footer names the publisher, with the one external link the shell
 * has, says what the site is, and closes with the theme control
 * (`ThemeToggle`, a client component): the same place on every page, out
 * of the reading path, and the last Tab stop. Beside the text where both
 * fit, under it where they do not.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="rh-shell">
      <a className="rh-skip" href="#main">
        Skip to content
      </a>
      <header className="rh-header">
        <div className="rh-shell__inner rh-header__inner">
          <BrandLockup />
          <HeaderSearch />
        </div>
      </header>
      <main className="rh-shell__inner rh-main" id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="rh-footer">
        <div className="rh-shell__inner rh-footer__inner">
          <div className="rh-footer__text">
            <p>
              Published by <a href="https://colbination.com/">Colbination</a>.
            </p>
            <p>A headless WordPress demonstration: WordPress models the library, Next.js renders it.</p>
          </div>
          <div className="rh-footer__theme">
            <ThemeToggle />
          </div>
        </div>
      </footer>
    </div>
  );
}
