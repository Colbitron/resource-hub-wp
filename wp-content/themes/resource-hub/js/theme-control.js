/**
 * The System / Light / Dark control on the CMS's own pages.
 *
 * The theme's own copy of what the front end does in `apps/web/lib/theme.ts`
 * and `lib/theme-store.ts`, because the contract package shares CSS and
 * markup but never JavaScript (`packages/ui/DESIGN.md`, "Do's and Don'ts").
 * It keeps the same three facts, which `apps/web/test/theme-cms-parity.test.ts`
 * holds to the front end's constants: the choice is stored in `localStorage`
 * under `rh-theme` as `light` or `dark`, System being the absence of a value;
 * it is applied as `data-theme` on `<html>`, which `base.css` maps to
 * `color-scheme`, and System removes the attribute; and the control is the
 * footer part's `fieldset.rh-theme`, three radios whose values are the
 * choices.
 *
 * `inc/theme-control.php` prints this whole file inline in `<head>`, before
 * core prints a stylesheet, so the first statement that runs sets the
 * attribute as the browser parses the head, before anything is painted and
 * before any other script loads: a stored choice never flashes the other
 * scheme, with no external file to wait for. The rest waits for the DOM: it
 * checks the stored choice's radio, shows the group (`rh-theme--pending` off),
 * and applies and stores each change. Other open tabs follow a choice through
 * the `storage` event, and a page restored from the back/forward cache
 * re-reads the stored value, since it missed any such event while frozen. When
 * storage refuses a write (blocked, full), the choice still applies to this
 * page; after a reload both the page and the control fall back to what storage
 * holds, as on the front end.
 *
 * No identifier leaks into the page's global scope, and no inline event
 * handler is written: the one `change` listener is added here. Modern syntax,
 * because every browser WordPress supports runs it, and the file is linted
 * with the plugin's `@wordpress/scripts`.
 */
( () => {
	const STORAGE_KEY = 'rh-theme';
	const ATTRIBUTE = 'data-theme';
	const PENDING = 'rh-theme--pending';
	const root = document.documentElement;

	/** The stored choice: `light` or `dark`, and `system` for no value, another value, or storage that throws. */
	const stored = () => {
		try {
			const value = localStorage.getItem( STORAGE_KEY );
			return value === 'light' || value === 'dark' ? value : 'system';
		} catch {
			return 'system';
		}
	};

	/**
	 * Sets or removes `data-theme` on `<html>`.
	 *
	 * @param {string} choice `system`, `light` or `dark`.
	 */
	const apply = ( choice ) => {
		if ( choice === 'system' ) {
			root.removeAttribute( ATTRIBUTE );
		} else {
			root.setAttribute( ATTRIBUTE, choice );
		}
	};

	/**
	 * Checks the choice's radio in every control on the page.
	 *
	 * @param {string} choice `system`, `light` or `dark`.
	 */
	const check = ( choice ) => {
		for ( const input of document.querySelectorAll(
			'fieldset.rh-theme input.rh-theme__input'
		) ) {
			input.checked = input.value === choice;
		}
	};

	// First paint: the file runs inline in <head>, before the body is parsed.
	apply( stored() );

	const onChange = ( event ) => {
		const choice = event.target.value;
		if ( choice !== 'system' && choice !== 'light' && choice !== 'dark' ) {
			return;
		}
		try {
			if ( choice === 'system' ) {
				localStorage.removeItem( STORAGE_KEY );
			} else {
				localStorage.setItem( STORAGE_KEY, choice );
			}
		} catch {
			// Storage refused the write: the choice still applies to this page.
		}
		apply( choice );
	};

	/** After something outside this page may have changed the stored value. */
	const resync = () => {
		const choice = stored();
		apply( choice );
		check( choice );
	};

	const wire = () => {
		check( stored() );
		for ( const fieldset of document.querySelectorAll(
			'fieldset.rh-theme'
		) ) {
			fieldset.addEventListener( 'change', onChange );
			fieldset.classList.remove( PENDING );
		}
		// Another tab wrote localStorage: a null key is `clear()`, which removes ours too.
		window.addEventListener( 'storage', ( event ) => {
			if ( event.key === null || event.key === STORAGE_KEY ) {
				resync();
			}
		} );
		window.addEventListener( 'pageshow', ( event ) => {
			if ( event.persisted ) {
				resync();
			}
		} );
	};

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', wire );
	} else {
		wire();
	}
} )();
