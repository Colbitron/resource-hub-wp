/**
 * The inline "Required" state a panel shows beside its control while the
 * field is missing.
 *
 * A `Notice` with the word "Required" in it, not a colour or an asterisk, so
 * the state reads the same to a screen reader, in high contrast and in the
 * panel's own typography; it is a warning while the resource is a draft
 * (drafts save) and an error once the resource is published or scheduled
 * (the update waits). It is silent: the editor's one notice for the whole
 * list is what is spoken, so a panel's state does not announce itself a
 * second time. It renders nothing once the field is set.
 */
import { Notice } from '@wordpress/components';

import { field, useRequiredFields } from './rules';

/**
 * The inline state for one field.
 *
 * @param {Object} props
 * @param {string} props.field `type`, `topic` or `summary`.
 * @return {Element|null} The state, or nothing while the field is set.
 */
export function RequiredState( { field: key } ) {
	const { isResource, missing, isPublic } = useRequiredFields();

	if ( ! isResource || ! missing.includes( key ) ) {
		return null;
	}

	return (
		<Notice
			className="resource-hub-required-state"
			status={ isPublic ? 'error' : 'warning' }
			isDismissible={ false }
			spokenMessage={ null }
		>
			{ field( key ).state }
		</Notice>
	);
}
