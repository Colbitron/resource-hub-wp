/**
 * Required fields in the resource editor: the notice, the lock, the
 * pre-publish checklist and the Topics panel's inline state.
 *
 * The front end needs a title, one type, a topic and a summary to show a
 * resource well, and the server refuses a REST save that would publish, or
 * keep published, a resource without them (`OneType` and `RequiredFields` in
 * PHP). Until this plugin, an editor learned that only from the "Publishing
 * failed" notice after the click. This makes the gap obvious before it:
 *
 * - One persistent `core/notices` notice, never dismissible, that names what
 *   is missing in plain words and offers one action per field that moves
 *   focus to its control (`focus.js`). It is a warning while the resource is
 *   a draft and an error once it is published or scheduled, and it follows
 *   every edit.
 * - A `PluginPrePublishPanel` checklist, open when something is missing, so
 *   the pre-publish sidebar says why its Publish button is off.
 * - The inline state on the Topics panel, through the same
 *   `editor.PostTaxonomyType` filter the Types panel's radio buttons use; the
 *   Types and Resource details panels render theirs themselves.
 *
 * The lock: the editor has one saving lock, `lockPostSaving`, and it stops
 * every save, the draft save included; there is no lock for publishing
 * alone (the Publish button reads `isPostSavingLocked` and `isEditedPostSaveable`
 * only). Drafts must keep saving so no work is lost, so the lock is held
 * only while a required field is missing and either the saved post is
 * published or scheduled (so its Update button, and a switch to draft, wait)
 * or the pre-publish sidebar is open (a publish attempt; Cancel lifts it).
 * With the pre-publish checks turned off in the editor's preferences, Publish
 * saves at once and the server's refusal shows in the editor's own notice,
 * next to this one. The lock is the convenience; the server is the check.
 * Trashing is not a save and is never locked.
 */
import { Button } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { PluginPrePublishPanel, store as editorStore } from '@wordpress/editor';
import { useEffect } from '@wordpress/element';
import { addFilter } from '@wordpress/hooks';
import { __, _n, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import { registerPlugin } from '@wordpress/plugins';

import { focusField } from './focus';
import { RequiredState } from './required-state';
import { FIELDS, field, useRequiredFields } from './rules';
// Named `editor.scss`, not `style.scss`, so wp-scripts emits `required-fields.css`
// beside the script rather than a `style-` prefixed file.
import './editor.scss';

const NOTICE_ID = 'resource-hub-required-fields';
const LOCK_NAME = 'resource-hub-required-fields';
const TOPIC_TAXONOMY = 'resource_topic';

/**
 * Nouns as one list: "a title", "a title and a type", "a title, a type and a
 * summary".
 *
 * @param {string[]} nouns At least one noun.
 * @return {string} The list.
 */
function listOf( nouns ) {
	if ( nouns.length === 1 ) {
		return nouns[ 0 ];
	}

	const head = nouns.slice( 0, -1 ).reduce( ( joined, noun ) =>
		sprintf(
			/* translators: 1: the items so far. 2: the next item; the two are joined with a comma. */
			__( '%1$s, %2$s', 'resource-hub' ),
			joined,
			noun
		)
	);

	return sprintf(
		/* translators: 1: every item but the last. 2: the last item. */
		__( '%1$s and %2$s', 'resource-hub' ),
		head,
		nouns[ nouns.length - 1 ]
	);
}

/**
 * The notice's text.
 *
 * @param {string[]} missing  The missing keys, in FIELDS order.
 * @param {boolean}  isPublic Whether the saved post is published or scheduled.
 * @return {string} One or two short sentences, naming no value.
 */
function noticeText( missing, isPublic ) {
	const list = listOf( missing.map( ( key ) => field( key ).noun ) );

	if ( isPublic ) {
		return sprintf(
			/* translators: %s: what the resource lacks, such as "a title and a topic". */
			__(
				'This resource needs %s before it can be updated. The published version stays as it is until then.',
				'resource-hub'
			),
			list
		);
	}

	return sprintf(
		/* translators: %s: what the resource lacks, such as "a title and a topic". */
		__(
			'This resource needs %s before it can be published. Drafts can still be saved.',
			'resource-hub'
		),
		list
	);
}

/**
 * The pre-publish checklist: every field with its state, and a link to the
 * control for each one still missing.
 *
 * @param {Object}   props
 * @param {string[]} props.missing The missing keys.
 * @return {Element} The panel.
 */
function Checklist( { missing } ) {
	const count = missing.length;
	const status =
		count === 0
			? __( 'complete', 'resource-hub' )
			: sprintf(
					/* translators: %d: how many required fields are missing. */
					_n( '%d missing', '%d missing', count, 'resource-hub' ),
					count
				);

	return (
		<PluginPrePublishPanel
			className="resource-hub-required-fields"
			icon={ false }
			title={ [
				__( 'Required fields:', 'resource-hub' ),
				<span className="editor-post-publish-panel__link" key="label">
					{ status }
				</span>,
			] }
			initialOpen={ count > 0 }
		>
			<p>
				{ count > 0
					? __(
							'Publishing waits until these are filled in. Drafts can still be saved.',
							'resource-hub'
						)
					: __(
							'Everything the site needs to show this resource is here.',
							'resource-hub'
						) }
			</p>
			<ul className="resource-hub-required-fields__list">
				{ FIELDS.map( ( item ) => {
					const isMissing = missing.includes( item.key );

					return (
						<li
							key={ item.key }
							className="resource-hub-required-fields__item"
						>
							<span>
								{ sprintf(
									/* translators: 1: the field's name. 2: "missing" or "set". */
									__( '%1$s: %2$s', 'resource-hub' ),
									item.name,
									isMissing
										? __( 'missing', 'resource-hub' )
										: __( 'set', 'resource-hub' )
								) }
							</span>
							{ isMissing && (
								<Button
									variant="link"
									onClick={ () => focusField( item.key ) }
								>
									{ item.action }
								</Button>
							) }
						</li>
					);
				} ) }
			</ul>
		</PluginPrePublishPanel>
	);
}

/**
 * Keeps the notice and the lock in step with the edited post, and renders
 * the checklist.
 *
 * @return {Element|null} The checklist, or nothing for another post type.
 */
function RequiredFields() {
	const { isResource, missing, isPublic } = useRequiredFields();
	const isPublishSidebarOpened = useSelect(
		( select ) => select( editorStore ).isPublishSidebarOpened(),
		[]
	);
	const { createNotice, removeNotice } = useDispatch( noticesStore );
	const { lockPostSaving, unlockPostSaving } = useDispatch( editorStore );
	const missingKeys = missing.join( ' ' );

	// The notice follows every change to the list, goes when the list empties,
	// and goes when the editor closes.
	useEffect( () => () => removeNotice( NOTICE_ID ), [ removeNotice ] );
	useEffect( () => {
		if ( ! isResource ) {
			return;
		}

		if ( missing.length === 0 ) {
			removeNotice( NOTICE_ID );
			return;
		}

		createNotice(
			isPublic ? 'error' : 'warning',
			noticeText( missing, isPublic ),
			{
				id: NOTICE_ID,
				isDismissible: false,
				actions: missing.map( ( key ) => ( {
					label: field( key ).action,
					onClick: () => focusField( key ),
				} ) ),
			}
		);
		// `missing` changes identity only with `missingKeys`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ isResource, missingKeys, isPublic, createNotice, removeNotice ] );

	// The lock, as the module docblock explains.
	const shouldLock =
		isResource &&
		missing.length > 0 &&
		( isPublic || isPublishSidebarOpened );

	useEffect( () => {
		if ( shouldLock ) {
			lockPostSaving( LOCK_NAME );
			return () => unlockPostSaving( LOCK_NAME );
		}

		return undefined;
	}, [ shouldLock, lockPostSaving, unlockPostSaving ] );

	if ( ! isResource ) {
		return null;
	}

	return <Checklist missing={ missing } />;
}

registerPlugin( 'resource-hub-required-fields', {
	render: RequiredFields,
} );

// The Topics panel keeps core's selector and gains the inline state above it;
// the wrapper is also what `focus.js` finds the selector's input through.
addFilter(
	'editor.PostTaxonomyType',
	'resource-hub/required-topic',
	( OriginalSelector ) =>
		function ResourceHubTopicSelector( props ) {
			if ( props.slug !== TOPIC_TAXONOMY ) {
				return <OriginalSelector { ...props } />;
			}

			return (
				<div className="resource-hub-topic-selector">
					<RequiredState field="topic" />
					<OriginalSelector { ...props } />
				</div>
			);
		}
);
