/**
 * Editor component for the Related Resources block.
 *
 * The topic is chosen from the `resource_topic` terms and stored as the
 * term's ID, so a renamed topic keeps working (issue #50). The preview is the
 * real server render through ServerSideRender, which sends the post being
 * edited as `post_id`, so the list leaves out this post as it will on the
 * site. With no topic the canvas shows a placeholder instead of an empty
 * render; a stored term that no longer exists shows a warning, since the
 * server renders nothing for it.
 */
import ServerSideRender from '@wordpress/server-side-render';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	Notice,
	PanelBody,
	Placeholder,
	RangeControl,
	SelectControl,
	Spinner,
	TextControl,
} from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';

const TAXONOMY = 'resource_topic';
// The contract's range; PHP clamps to the same (RelatedResourcesBlock::MIN_COUNT, MAX_COUNT).
const MIN_COUNT = 1;
const MAX_COUNT = 10;
// Every topic, by name; the editor's list is small and a select needs all of it.
const TOPICS_QUERY = {
	per_page: -1,
	orderby: 'name',
	order: 'asc',
	context: 'view',
	_fields: 'id,name',
};

/**
 * The topic select, shared by the inspector and the canvas placeholder.
 *
 * @param {Object}                  props
 * @param {Array|null}              props.topics   The topic terms, or null while loading.
 * @param {number}                  props.value    The stored term ID, 0 for none.
 * @param {(topic: number) => void} props.onChange Receives the chosen term ID.
 * @return {Element} The control.
 */
function TopicSelect( { topics, value, onChange } ) {
	const options = [
		{ label: __( 'Choose a topic', 'resource-hub' ), value: '0' },
		...( topics ?? [] ).map( ( term ) => ( {
			label: decodeEntities( term.name ),
			value: String( term.id ),
		} ) ),
	];

	return (
		<SelectControl
			__nextHasNoMarginBottom
			__next40pxDefaultSize
			label={ __( 'Topic', 'resource-hub' ) }
			value={ String( value ) }
			options={ options }
			onChange={ ( next ) => onChange( Number( next ) || 0 ) }
		/>
	);
}

export default function Edit( { attributes, setAttributes } ) {
	const { count, topic, heading } = attributes;
	const blockProps = useBlockProps();

	const { topics, hasResolved } = useSelect( ( select ) => {
		const { getEntityRecords, hasFinishedResolution } = select( coreStore );
		const args = [ 'taxonomy', TAXONOMY, TOPICS_QUERY ];

		return {
			topics: getEntityRecords( ...args ),
			hasResolved: hasFinishedResolution( 'getEntityRecords', args ),
		};
	}, [] );

	const setTopic = ( next ) => setAttributes( { topic: next } );
	// A stored ID that no term has: the term was deleted, or merged away.
	const topicMissing =
		topic > 0 &&
		hasResolved &&
		Array.isArray( topics ) &&
		! topics.some( ( term ) => term.id === topic );

	let canvas;

	if ( topic <= 0 ) {
		canvas = (
			<Placeholder
				icon={ metadata.icon }
				label={ metadata.title }
				instructions={ __(
					'Choose a topic. The block lists the newest resources in it, leaving out the post it sits in.',
					'resource-hub'
				) }
			>
				{ hasResolved ? (
					<TopicSelect
						topics={ topics }
						value={ topic }
						onChange={ setTopic }
					/>
				) : (
					<Spinner />
				) }
			</Placeholder>
		);
	} else if ( topicMissing ) {
		canvas = (
			<Placeholder icon={ metadata.icon } label={ metadata.title }>
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'The chosen topic no longer exists, so nothing is shown. Choose another.',
						'resource-hub'
					) }
				</Notice>
				<TopicSelect
					topics={ topics }
					value={ topic }
					onChange={ setTopic }
				/>
			</Placeholder>
		);
	} else {
		canvas = (
			<ServerSideRender
				block={ metadata.name }
				attributes={ attributes }
			/>
		);
	}

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Settings', 'resource-hub' ) }>
					{ topicMissing && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'The chosen topic no longer exists.',
								'resource-hub'
							) }
						</Notice>
					) }
					<TopicSelect
						topics={ topics }
						value={ topic }
						onChange={ setTopic }
					/>
					<RangeControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Number of resources', 'resource-hub' ) }
						value={ count }
						onChange={ ( value ) =>
							setAttributes( { count: value } )
						}
						min={ MIN_COUNT }
						max={ MAX_COUNT }
					/>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Heading', 'resource-hub' ) }
						help={ __(
							'Leave empty for “More on {topic}”.',
							'resource-hub'
						) }
						value={ heading }
						onChange={ ( value ) =>
							setAttributes( { heading: value } )
						}
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>{ canvas }</div>
		</>
	);
}
