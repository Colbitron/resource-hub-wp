/**
 * The inline "Required" state a panel shows beside its control while the
 * field is missing, and the attributes that tie the control to it.
 *
 * A `Notice` with the word "Required" in it, not a colour or an asterisk, so
 * the state reads the same to a screen reader, in high contrast and in the
 * panel's own typography; it is a warning while the resource is an
 * incomplete draft or is being unpublished (that save goes ahead) and an
 * error while its edited status is `publish` or `future` or the pre-publish
 * sidebar is open (`isUrgent` in `rules.js`). It is silent: the
 * editor's one notice for the whole list is what is spoken, so a panel's
 * state does not announce itself a second time. It renders nothing once the
 * field is set.
 *
 * The state has an id (`stateId()`), and `useRequiredAttributes()` gives the
 * control it describes, on every render and whenever the panel's DOM
 * changes:
 * - `aria-required="true"`, always, since the field is required to publish;
 * - the state's id in `aria-describedby`, ahead of the control's own help,
 *   while the field is missing;
 * - `aria-invalid="true"` while the field is missing and the edited status is
 *   `publish` or `future` or the pre-publish sidebar is open, and never for a
 *   draft that is simply incomplete or a resource being unpublished.
 * The attributes are set on the DOM element rather than passed as props
 * because the three controls are components that do not take them: core's
 * Topics selector, `RadioControl` (whose extra props go to each radio, where
 * `aria-required` is not allowed) and `TextareaControl` (whose help id is its
 * own). The components never set these attributes themselves, apart from
 * `aria-describedby`, which each sets once to a fixed id and which this keeps.
 */
import { Notice } from '@wordpress/components';
import { useLayoutEffect, useState } from '@wordpress/element';

import { field, useRequiredFields } from './rules';

/**
 * The id of a field's inline state.
 *
 * @param {string} key `title`, `type`, `topic` or `summary`.
 * @return {string} The id.
 */
export const stateId = ( key ) => `resource-hub-required-${ key }`;

/**
 * Sets the required attributes on a control, as the module docblock states.
 *
 * @param {HTMLElement} element   The control.
 * @param {string}      key       The field.
 * @param {boolean}     isMissing Whether the field is missing.
 * @param {boolean}     isInvalid Whether to mark it invalid.
 */
export function applyRequiredAttributes( element, key, isMissing, isInvalid ) {
	const id = stateId( key );
	const others = ( element.getAttribute( 'aria-describedby' ) ?? '' )
		.split( /\s+/ )
		.filter( ( token ) => token !== '' && token !== id );
	const describedBy = isMissing ? [ id, ...others ] : others;

	if ( describedBy.length > 0 ) {
		element.setAttribute( 'aria-describedby', describedBy.join( ' ' ) );
	} else {
		element.removeAttribute( 'aria-describedby' );
	}

	element.setAttribute( 'aria-required', 'true' );

	if ( isInvalid ) {
		element.setAttribute( 'aria-invalid', 'true' );
	} else {
		element.removeAttribute( 'aria-invalid' );
	}
}

/**
 * Keeps the required attributes on the control a wrapper holds.
 *
 * @param {string} key      `type`, `topic` or `summary`.
 * @param {string} selector Finds the control in the wrapper.
 * @return {(element: HTMLElement|null) => void} The ref to give the wrapper. A
 * callback ref, so a wrapper that mounts after the first render (the Types
 * panel shows a spinner until its terms load) is still found.
 */
export function useRequiredAttributes( key, selector ) {
	const { isResource, missing, isUrgent } = useRequiredFields();
	const [ wrapper, setWrapper ] = useState( null );
	const isMissing = isResource && missing.includes( key );
	const isInvalid = isMissing && isUrgent;

	useLayoutEffect( () => {
		if ( ! isResource || ! wrapper ) {
			return undefined;
		}

		const apply = () => {
			const element = wrapper.querySelector( selector );

			if ( element ) {
				applyRequiredAttributes( element, key, isMissing, isInvalid );
			}
		};

		apply();

		// The control may render after the wrapper (the Types panel waits for
		// its terms) or be replaced; attributes alone do not trigger this.
		const observer = new window.MutationObserver( apply );
		observer.observe( wrapper, { childList: true, subtree: true } );

		return () => observer.disconnect();
	}, [ key, wrapper, selector, isResource, isMissing, isInvalid ] );

	return setWrapper;
}

/**
 * The inline state for one field.
 *
 * @param {Object} props
 * @param {string} props.field `type`, `topic` or `summary`.
 * @return {Element|null} The state, or nothing while the field is set.
 */
export function RequiredState( { field: key } ) {
	const { isResource, missing, isUrgent } = useRequiredFields();

	if ( ! isResource || ! missing.includes( key ) ) {
		return null;
	}

	// The id is on the sentence alone, so a control described by it reads the
	// sentence and not the notice's hidden "Error notice" label too.
	return (
		<Notice
			className="resource-hub-required-state"
			status={ isUrgent ? 'error' : 'warning' }
			isDismissible={ false }
			spokenMessage={ null }
		>
			<span id={ stateId( key ) }>{ field( key ).state }</span>
		</Notice>
	);
}
