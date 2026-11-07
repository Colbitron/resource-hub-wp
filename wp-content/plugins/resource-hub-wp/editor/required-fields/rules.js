/**
 * The required-fields rule, as the editor applies it.
 *
 * A resource needs a non-blank title, exactly one type, at least one topic
 * and a non-blank summary to be published or scheduled, and to stay that
 * way; a draft may lack any of them. The server is the check (`OneType` and
 * `RequiredFields` in PHP refuse a REST save that breaks the rule), and this
 * module is the one place the editor states the same rule, so the notice, the
 * inline states in the panels and the pre-publish checklist cannot disagree
 * with one another. `isBlank()` mirrors `RequiredFields::is_blank()` and the
 * front end's `cardTitle()`: tags stripped, entities decoded, and nothing left
 * once whitespace, no-break spaces and the zero-width characters U+200B to
 * U+200D and U+FEFF are removed.
 */
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { decodeEntities } from '@wordpress/html-entities';
import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export const POST_TYPE = 'resource';

// Mirrors OneType::PUBLIC_STATUSES.
export const PUBLIC_STATUSES = [ 'publish', 'future' ];

// JavaScript's `\s` is every Unicode separator plus the ASCII controls and
// U+FEFF, which is what RequiredFields::BLANK_CHARACTERS lists in PHP.
const BLANK_CHARACTERS = /[\s\u200B-\u200D\uFEFF]/g;

/**
 * The four fields, in the order the notice and the checklist name them.
 * `noun` completes "needs …"; `action` labels the control that fixes it;
 * `state` is the inline sentence a panel shows while it is missing.
 *
 * @type {Array<{key: string, name: string, noun: string, action: string, state: string}>}
 */
export const FIELDS = [
	{
		key: 'title',
		name: __( 'Title', 'resource-hub' ),
		noun: __( 'a title', 'resource-hub' ),
		action: __( 'Add a title', 'resource-hub' ),
		state: __( 'Required. A resource needs a title.', 'resource-hub' ),
	},
	{
		key: 'type',
		name: __( 'Type', 'resource-hub' ),
		noun: __( 'a type', 'resource-hub' ),
		action: __( 'Choose a type', 'resource-hub' ),
		state: __( 'Required. A resource needs one type.', 'resource-hub' ),
	},
	{
		key: 'topic',
		name: __( 'Topic', 'resource-hub' ),
		noun: __( 'a topic', 'resource-hub' ),
		action: __( 'Add a topic', 'resource-hub' ),
		state: __(
			'Required. A resource needs at least one topic.',
			'resource-hub'
		),
	},
	{
		key: 'summary',
		name: __( 'Summary', 'resource-hub' ),
		noun: __( 'a summary', 'resource-hub' ),
		action: __( 'Write a summary', 'resource-hub' ),
		state: __( 'Required. A resource needs a summary.', 'resource-hub' ),
	},
];

/**
 * The field with the given key.
 *
 * @param {string} key `title`, `type`, `topic` or `summary`.
 * @return {Object} The field.
 */
export const field = ( key ) => FIELDS.find( ( item ) => item.key === key );

/**
 * Whether text is blank by the shared rule.
 *
 * @param {unknown} text The title or summary as edited.
 * @return {boolean} Whether nothing would be read from it.
 */
export function isBlank( text ) {
	const stripped = String( text ?? '' ).replace( /<[^>]*>/g, '' );

	return decodeEntities( stripped ).replace( BLANK_CHARACTERS, '' ) === '';
}

/**
 * The keys of the fields a resource in the given state lacks, in FIELDS order.
 *
 * @param {Object}        state         The edited post's values.
 * @param {unknown}       state.title   The title.
 * @param {number[]|void} state.types   The `resource_type` term IDs.
 * @param {number[]|void} state.topics  The `resource_topic` term IDs.
 * @param {unknown}       state.summary The `summary` meta.
 * @return {string[]} The missing keys.
 */
export function missingFrom( { title, types, topics, summary } ) {
	const missing = [];

	if ( isBlank( title ) ) {
		missing.push( 'title' );
	}

	if ( ( types ?? [] ).length !== 1 ) {
		missing.push( 'type' );
	}

	if ( ( topics ?? [] ).length === 0 ) {
		missing.push( 'topic' );
	}

	if ( isBlank( summary ) ) {
		missing.push( 'summary' );
	}

	return missing;
}

/**
 * The rule applied to the post in the editor, live.
 *
 * @return {{isResource: boolean, missing: string[], isPublic: boolean}} Whether
 * the post is a resource, which fields it lacks as edited, and whether the
 * saved post is published or scheduled (the status the server has, not the
 * one being edited towards).
 */
export function useRequiredFields() {
	const { isResource, missingKeys, isPublic } = useSelect( ( select ) => {
		const editor = select( editorStore );

		if ( editor.getCurrentPostType() !== POST_TYPE ) {
			return { isResource: false, missingKeys: '', isPublic: false };
		}

		return {
			isResource: true,
			// A string, so the selector's result is stable while nothing changes.
			missingKeys: missingFrom( {
				title: editor.getEditedPostAttribute( 'title' ),
				types: editor.getEditedPostAttribute( 'resource_type' ),
				topics: editor.getEditedPostAttribute( 'resource_topic' ),
				summary: editor.getEditedPostAttribute( 'meta' )?.summary,
			} ).join( ' ' ),
			isPublic: PUBLIC_STATUSES.includes(
				editor.getCurrentPostAttribute( 'status' )
			),
		};
	}, [] );

	const missing = useMemo(
		() => ( missingKeys === '' ? [] : missingKeys.split( ' ' ) ),
		[ missingKeys ]
	);

	return { isResource, missing, isPublic };
}
