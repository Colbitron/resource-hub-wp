import { BrandLockup } from "@/components/Brand";
import { HeaderSearchIcon } from "@/components/HeaderSearchIcon";
import { SearchForm } from "@/components/SearchForm";

import "@colbitron/resource-hub-ui/header-search.css";
import "@colbitron/resource-hub-ui/header-search-bar.css";

/**
 * A still copy of the header's row with its search control, closed or open,
 * for the specimen: the markup `HeaderSearch` renders on the client after
 * hydration (`packages/ui/header-search.css` has it), with a button that
 * does nothing, so the screenshot gate sees the open bar the live control
 * shows only after a press. The row is the shell's header classes on a
 * `div`, so it is not a second `banner` landmark. A Server Component; the
 * IDs are its own, so it never shares one with the live control or the
 * specimen's search form.
 */
export function StillHeaderSearch({ id, open }: { id: string; open: boolean }) {
  const panel = `${id}-panel`;
  return (
    <div className="rh-header rh-specimen__header" data-open={open || undefined}>
      <div className="rh-shell__inner rh-header__inner">
        <BrandLockup />
        <div className="rh-header-search">
          <button className="rh-header-search__toggle" type="button" aria-label="Search" aria-expanded={open} aria-controls={panel}>
            <HeaderSearchIcon open={open} />
          </button>
          <div className="rh-header-search__panel" id={panel} hidden={!open}>
            <div className="rh-shell__inner">
              <SearchForm input="" id={`${id}-q`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
