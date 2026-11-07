import type { ReactNode } from "react";
import Link from "next/link";

import "@colbitron/resource-hub-ui/tokens.css";
import "./shell.css";

/**
 * The page shell: skip link, header, `main` and footer around every page.
 *
 * This component, not `layout.tsx`, imports the shared tokens, because the
 * rule is that shared CSS is imported from the component that uses it
 * (packages/ui/DESIGN.md): the shell's own styles build on the tokens, and
 * the root layout renders the shell around every page, so the tokens reach
 * every page. Page content is stacked under `main`, which carries
 * `tabIndex={-1}` so the skip link lands focus on it in every browser.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="rh-shell">
      <a className="rh-skip" href="#main">
        Skip to content
      </a>
      <header className="rh-header">
        <div className="rh-shell__inner rh-header__inner">
          <Link className="rh-header__name" href="/resources/">
            Resource Hub
          </Link>
        </div>
      </header>
      <main className="rh-shell__inner rh-main" id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="rh-footer">
        <div className="rh-shell__inner rh-footer__inner">
          <p>A headless WordPress demonstration: WordPress models the library, Next.js renders it.</p>
        </div>
      </footer>
    </div>
  );
}
