/**
 * The required-fields rule, as the editor applies it.
 *
 * A resource needs a non-blank title, exactly one type, at least one topic
 * and a non-blank summary to be published or scheduled, and to stay that
 * way; a draft may lack any of them. The server is the check (`OneType` and
 * `RequiredFields` in PHP refuse a REST save that breaks the rule), and this
 * module is the one place the editor states the same rule, so the notice, the
 * inline states in the panels and the pre-publish checklist cannot disagree
 * with one another. Blank follows what the front end shows, as the server
 * judges it:
 * - `isBlank()`, for the title, mirrors `RequiredFields::is_blank()` and the
 *   front end's `cardTitle()`: tags stripped, entities decoded, and nothing
 *   left once whitespace, no-break spaces and the zero-width characters
 *   U+200B to U+200D and U+FEFF are removed.
 * - `isBlankSummary()` mirrors `RequiredFields::is_blank_summary()` applied
 *   after `MetaRules::sanitize_summary()`: the summary is shown verbatim as
 *   plain text, so tags are stripped as the sanitizer strips them but nothing
 *   is decoded, and a typed `&nbsp;` is visible text.
 * Tags are stripped as PHP's `strip_tags()` does for these purposes:
 * `script` and `style` elements go with their contents, a `<` followed by
 * whitespace is text, and a `<` with no `>` runs to the end (the title) or,
 * as `wp_pre_kses_less_than()` keeps it, is text (the summary). What is left
 * to the server alone: a `>` inside a quoted attribute value (`<a title=">">`)
 * and inside an HTML comment, which PHP reads as part of the tag and this
 * reads as its end, so the server can find blank what the editor does not.
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

// `wp_strip_all_tags()` removes these elements with what is inside them.
const SCRIPT_OR_STYLE = /<(script|style)[^>]*?>[\s\S]*?<\/\1>/gi;

// A tag as `strip_tags()` finds one: a `<` not followed by whitespace, up to
// the next `>` or, unclosed, to the end of the text.
const TAG_OR_UNCLOSED = /<(?!\s)[^>]*(?:>|$)/g;

// A tag as `wp_pre_kses_less_than()` leaves one for stripping: a `<` with a
// `>` before any other `<`. A `<` without one stays as text.
const CLOSED_TAG = /<(?!\s)[^<>]*>/g;

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
 * Whether a title is blank: nothing left to read once tags are stripped and
 * entities decoded.
 *
 * @param {unknown} text The title as edited.
 * @return {boolean} Whether nothing would be read from it.
 */
export function isBlank( text ) {
	const stripped = String( text ?? '' )
		.replace( SCRIPT_OR_STYLE, '' )
		.replace( TAG_OR_UNCLOSED, '' );

	return decodeEntities( stripped ).replace( BLANK_CHARACTERS, '' ) === '';
}

/**
 * Whether a summary is blank: nothing left to read once the sanitizer has
 * stripped its tags, with no entity decoding.
 *
 * @param {unknown} text The summary as edited.
 * @return {boolean} Whether nothing would be read from it.
 */
export function isBlankSummary( text ) {
	const stripped = String( text ?? '' )
		.replace( SCRIPT_OR_STYLE, '' )
		.replace( CLOSED_TAG, '' );

	return stripped.replace( BLANK_CHARACTERS, '' ) === '';
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

	if ( isBlankSummary( summary ) ) {
		missing.push( 'summary' );
	}

	return missing;
}

/**
 * The rule applied to the post in the editor, live.
 *
 * - `isPublic`: the saved post is published or scheduled (the status the
 *   server has). It words the notice.
 * - `willBePublic`: the status being edited, the one the next save sends, is
 *   `publish` or `future`. With `isPublishing` it decides the lock, so a
 *   published resource switched to Draft or Private saves.
 * - `isPublishing`: the pre-publish sidebar is open, a publish attempt.
 * - `isUrgent`: any of the three. A missing field is then an error (in the
 *   notice, the panels' states and `aria-invalid`), not an incomplete draft's
 *   warning.
 *
 * @return {{isResource: boolean, missing: string[], isPublic: boolean, willBePublic: boolean, isPublishing: boolean, isUrgent: boolean}}
 * Whether the post is a resource, which fields it lacks as edited, and its
 * status as above.
 */
export function useRequiredFields() {
	const { isResource, missingKeys, isPublic, willBePublic, isPublishing } =
		useSelect( ( select ) => {
			const editor = select( editorStore );

			if ( editor.getCurrentPostType() !== POST_TYPE ) {
				return {
					isResource: false,
					missingKeys: '',
					isPublic: false,
					willBePublic: false,
					isPublishing: false,
				};
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
				willBePublic: PUBLIC_STATUSES.includes(
					editor.getEditedPostAttribute( 'status' )
				),
				isPublishing: editor.isPublishSidebarOpened(),
			};
		}, [] );

	const missing = useMemo(
		() => ( missingKeys === '' ? [] : missingKeys.split( ' ' ) ),
		[ missingKeys ]
	);

	return {
		isResource,
		missing,
		isPublic,
		willBePublic,
		isPublishing,
		isUrgent: isPublic || willBePublic || isPublishing,
	};
}
