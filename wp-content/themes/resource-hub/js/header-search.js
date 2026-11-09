/**
 * The header's search control on the CMS's own pages.
 *
 * The theme's own copy of what the front end does in
 * `apps/web/components/HeaderSearch.tsx` and `HeaderSearchBar.tsx`, because
 * the contract package shares CSS and markup but never JavaScript
 * (`packages/ui/DESIGN.md`, "Do's and Don'ts"). It keeps the facts
 * `apps/web/test/header-search-cms-parity.test.ts` holds to the front end's:
 * the panel's id, the bar's field id and the page's field id, the icon's two
 * drawings, and the bar's markup, the search page's own form (`search.css`)
 * in the shell's gutter, with core's query var `s` where the front end's is
 * `q`.
 *
 * `inc/header-search.php` prints this file inline at the end of the body,
 * with the form's action and the bar's stylesheets as `data-` attributes on
 * the tag, read back here by the tag's id. What it does, as the front end's
 * control does after hydration:
 *
 * - On the search page the control stays a link to the page's own field,
 *   and a click focuses it; nothing else runs.
 * - Elsewhere the server's link becomes a disclosure button with the same
 *   class, name and icon (`aria-expanded`, `aria-controls`), and the panel
 *   it controls is added after it, hidden; a link that had focus hands it
 *   to the button.
 * - The bar's stylesheets are added to the page when a pointer comes over
 *   the button or it takes focus, and at the latest on the press that opens
 *   it, which waits for them: the bar opens only if that press is still the
 *   one waiting (a second press cancels it) and focus has not moved on, and
 *   if a stylesheet fails to load the press goes to the search page instead.
 * - Open, the panel holds the form, the icon is a cross and focus is in the
 *   field. Escape, wherever focus is, closes it and returns focus to the
 *   button, as a press on the button does; Tab or Shift-Tab out of the
 *   control closes it and leaves focus where it went; a pointer press outside
 *   closes it; and a page restored from the back/forward cache closes it, as
 *   a change of path closes the front end's.
 *
 * No identifier leaks into the page's global scope, no inline event handler
 * is written, and the only HTML written is the fixed string below. Modern
 * syntax, because every browser WordPress supports runs it, and the file is
 * linted with the plugin's `@wordpress/scripts`.
 */
( () => {
	const SCRIPT_ID = 'resource-hub-header-search-js';
	const PANEL_ID = 'rh-header-search-panel';
	const INPUT_ID = 'rh-header-search-q';
	const PAGE_INPUT_ID = 'rh-search-q';
	const ICON_SEARCH =
		'<circle cx="11" cy="11" r="6"></circle><path d="m20 20-4.5-4.5"></path>';
	const ICON_CLOSE = '<path d="M6 6l12 12M18 6 6 18"></path>';
	// The front end's HeaderSearchBar: the search page's form, empty, with
	// the bar's field id, in the shell's gutter. The action is set from the
	// script tag's data once the string is in the document.
	const BAR_HTML =
		'<div class="rh-shell__inner"><form class="rh-search" role="search" action="" method="get"><label class="rh-search__label" for="rh-header-search-q">Search resources and pages</label><div class="rh-search__row"><input class="rh-search__input" id="rh-header-search-q" type="search" enterkeyhint="search" name="s" value=""/><button class="rh-search__button" type="submit">Search</button></div></form></div>';

	const script = document.getElementById( SCRIPT_ID );
	const control = document.querySelector( 'div.rh-header-search' );
	const link = control?.querySelector( 'a.rh-header-search__toggle' );
	const icon = link?.querySelector( 'svg.rh-header-search__icon' );
	if ( ! script || ! control || ! link || ! icon ) {
		return;
	}

	const action = script.dataset.action || '';
	let styles = {};
	try {
		styles = JSON.parse( script.dataset.styles || '{}' ) || {};
	} catch {
		styles = {};
	}

	// The search page: the page's own field is the control's target.
	const pageField = document.getElementById( PAGE_INPUT_ID );
	if ( pageField ) {
		link.setAttribute( 'href', '#' + PAGE_INPUT_ID );
		link.addEventListener( 'click', ( event ) => {
			event.preventDefault();
			pageField.focus();
		} );
		return;
	}

	// The link becomes the button, in the same place, with the same icon.
	const hadFocus = control.ownerDocument.activeElement === link;
	const button = document.createElement( 'button' );
	button.className = 'rh-header-search__toggle';
	button.type = 'button';
	button.setAttribute( 'aria-label', 'Search' );
	button.setAttribute( 'aria-expanded', 'false' );
	button.setAttribute( 'aria-controls', PANEL_ID );
	button.append( icon );
	const panel = document.createElement( 'div' );
	panel.className = 'rh-header-search__panel';
	panel.id = PANEL_ID;
	panel.hidden = true;
	link.replaceWith( button );
	control.append( panel );
	if ( hadFocus ) {
		button.focus();
	}

	/**
	 * Adds one stylesheet to the head, once, with the id core gives a handle's
	 * link, and resolves when it has loaded.
	 *
	 * @param {string} handle The stylesheet's handle.
	 * @param {string} href   Its URL.
	 * @return {Promise<void>} Once loaded.
	 */
	const loadStyle = ( handle, href ) =>
		new Promise( ( resolve, reject ) => {
			if ( document.getElementById( handle + '-css' ) ) {
				resolve();
				return;
			}
			const element = document.createElement( 'link' );
			element.rel = 'stylesheet';
			element.id = handle + '-css';
			element.href = href;
			element.addEventListener( 'load', () => resolve() );
			element.addEventListener( 'error', () => {
				element.remove();
				reject( new Error( 'Could not load ' + href ) );
			} );
			document.head.append( element );
		} );

	let loading = null;

	/** The bar's stylesheets, loaded once; a failed load is forgotten, so the next press tries again. */
	const loadStyles = () => {
		loading ??= Promise.all(
			Object.entries( styles ).map( ( [ handle, href ] ) =>
				loadStyle( handle, href )
			)
		).catch( ( error ) => {
			loading = null;
			throw error;
		} );
		return loading;
	};

	const preload = () => {
		loadStyles().catch( () => {
			// Retried on the press that opens the bar, which then falls back to the page.
		} );
	};

	let open = false;
	// The press waiting for the stylesheets, if any; a second press cancels it.
	let pending = null;

	const onPointerDown = ( event ) => {
		if ( ! control.contains( event.target ) ) {
			close();
		}
	};

	const onKeyDown = ( event ) => {
		if ( event.key === 'Escape' ) {
			event.preventDefault();
			close();
			button.focus();
		}
	};

	/** Opens the bar, with the form in it, and moves focus to its field. */
	function show() {
		if ( ! panel.firstChild ) {
			panel.innerHTML = BAR_HTML;
			panel.querySelector( 'form' ).setAttribute( 'action', action );
		}
		open = true;
		panel.hidden = false;
		button.setAttribute( 'aria-expanded', 'true' );
		icon.innerHTML = ICON_CLOSE;
		document.getElementById( INPUT_ID )?.focus();
		document.addEventListener( 'pointerdown', onPointerDown );
		document.addEventListener( 'keydown', onKeyDown );
	}

	/** Closes the bar; focus is the caller's to place. */
	function close() {
		if ( ! open ) {
			return;
		}
		open = false;
		panel.hidden = true;
		button.setAttribute( 'aria-expanded', 'false' );
		icon.innerHTML = ICON_SEARCH;
		document.removeEventListener( 'pointerdown', onPointerDown );
		document.removeEventListener( 'keydown', onKeyDown );
	}

	button.addEventListener( 'pointerenter', preload );
	button.addEventListener( 'focus', preload );
	button.addEventListener( 'click', () => {
		if ( open ) {
			// Focus the button: WebKit does not focus a clicked button, and
			// focus would otherwise be left on the page when the bar hides.
			close();
			button.focus();
			return;
		}
		if ( pending !== null ) {
			// A second press while the stylesheets load: the reader changed their mind.
			pending = null;
			return;
		}
		const press = Symbol( 'open' );
		pending = press;
		loadStyles().then(
			() => {
				// Open only for the press still waiting, with focus still on the
				// button, or on nothing, where WebKit leaves it after a click.
				const focus = control.ownerDocument.activeElement;
				const stayed =
					focus === button ||
					focus === null ||
					focus === document.body;
				if ( pending !== press || ! stayed ) {
					return;
				}
				pending = null;
				show();
			},
			() => {
				if ( pending === press ) {
					window.location.assign( action );
				}
			}
		);
	} );

	// Focus leaving the control closes it; a blur with no new focus (a click
	// on the page in Safari, which focuses no button) is the pointer handler's.
	control.addEventListener( 'focusout', ( event ) => {
		const next = event.relatedTarget;
		if ( open && next && ! control.contains( next ) ) {
			close();
		}
	} );

	// A page back from the back/forward cache: closed, as a navigation closes the front end's.
	window.addEventListener( 'pageshow', ( event ) => {
		if ( event.persisted ) {
			close();
		}
	} );
} )();
