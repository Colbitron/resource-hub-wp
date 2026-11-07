/**
 * The post title's required attributes.
 *
 * The title is core's, in the editor canvas, which is an iframe when the
 * editor iframes it: a separate document from the notice and the sidebar, so
 * `aria-describedby` cannot point the title at a state (ids do not cross
 * documents), and adding a state inside the canvas would put plugin markup
 * among the blocks. What is feasible is the two attributes that need no
 * other element: `aria-required="true"` and, while the title is missing and
 * the resource is published, scheduled or being published, `aria-invalid`,
 * by the same rule as the panels' controls (`required-state.js`). The notice above
 * the canvas is what names the missing title in words. The canvas renders
 * after the editor, so the lookup retries for a moment, and once the title is
 * found the canvas is watched so a re-rendered title gets the attributes too.
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
		let observer;

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

		const start = ( retries ) => {
			const title = apply();

			if ( title ) {
				const view = title.ownerDocument.defaultView;
				observer = new view.MutationObserver( apply );
				observer.observe( title.ownerDocument.body, {
					childList: true,
					subtree: true,
				} );
			} else if ( retries > 0 ) {
				timer = window.setTimeout(
					() => start( retries - 1 ),
					RETRY_MS
				);
			}
		};

		start( RETRIES );

		return () => {
			window.clearTimeout( timer );
			observer?.disconnect();
		};
	}, [ isResource, isInvalid ] );

	return null;
}
