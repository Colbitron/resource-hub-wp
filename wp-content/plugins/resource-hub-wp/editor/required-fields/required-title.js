/**
 * The post title's required attributes.
 *
 * The title is core's, in the editor canvas, which is an iframe when the
 * editor iframes it: a separate document from the notice and the sidebar, so
 * `aria-describedby` cannot point the title at a state (ids do not cross
 * documents), and adding a state inside the canvas would put plugin markup
 * among the blocks. What is feasible is the two attributes that need no
 * other element: `aria-required="true"` and, while the title is missing and
 * the edited status is `publish` or `future` or the pre-publish sidebar is
 * open, `aria-invalid`, by the same rule as the panels' controls
 * (`required-state.js`). The notice above the canvas is what names the
 * missing title in words.
 *
 * The canvas renders after the editor, so the lookup retries for a moment.
 * Once the title is found, its document is watched so a re-rendered title
 * gets the attributes too. The canvas can also be replaced: switching to the
 * Code editor removes the iframe and renders a plain title in the editor's
 * own document, and switching back mounts a new iframe. So the editor's
 * document is watched as well, and when the title found is no longer the one
 * whose document is watched, the lookup starts again and the new document is
 * watched instead.
 */
import { useEffect } from '@wordpress/element';

import { findTitle } from './focus';
import { useRequiredFields } from './rules';

const RETRY_MS = 100;
const RETRIES = 50;

/**
 * Keeps the title's attributes in step with the rule. Renders nothing.
 *
 * @return {null} Nothing.
 */
export function RequiredTitle() {
	const { isResource, missing, isUrgent } = useRequiredFields();
	const isMissing = isResource && missing.includes( 'title' );
	const isInvalid = isMissing && isUrgent;

	useEffect( () => {
		if ( ! isResource ) {
			return undefined;
		}

		let timer;
		let watched = null;
		let inner = null;

		const apply = () => {
			const title = findTitle();

			if ( title ) {
				title.setAttribute( 'aria-required', 'true' );

				if ( isInvalid ) {
					title.setAttribute( 'aria-invalid', 'true' );
				} else {
					title.removeAttribute( 'aria-invalid' );
				}
			}

			return title;
		};

		// Watches the title's document, unless it is the editor's own, which
		// `outer` already watches.
		const watch = ( title ) => {
			const owner = title.ownerDocument;

			if ( owner === watched ) {
				return;
			}

			inner?.disconnect();
			inner = null;
			watched = owner;

			if ( owner !== document && owner.defaultView ) {
				inner = new owner.defaultView.MutationObserver( apply );
				inner.observe( owner.body, { childList: true, subtree: true } );
			}
		};

		const start = ( retries ) => {
			window.clearTimeout( timer );
			const title = apply();

			if ( title ) {
				watch( title );
			} else if ( retries > 0 ) {
				timer = window.setTimeout(
					() => start( retries - 1 ),
					RETRY_MS
				);
			}
		};

		// The editor's document: the canvas iframe is added, removed and
		// replaced here, and the Code editor's title renders here.
		const outer = new window.MutationObserver( () => {
			const title = findTitle();

			if ( ! title || title.ownerDocument !== watched ) {
				start( RETRIES );
			} else if ( watched === document ) {
				apply();
			}
		} );
		outer.observe( document.body, { childList: true, subtree: true } );

		start( RETRIES );

		return () => {
			window.clearTimeout( timer );
			outer.disconnect();
			inner?.disconnect();
		};
	}, [ isResource, isInvalid ] );

	return null;
}
