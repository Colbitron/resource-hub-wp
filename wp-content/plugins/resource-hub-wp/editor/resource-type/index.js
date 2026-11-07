/**
 * Radio buttons for the Types panel of the resource editor.
 *
 * A resource has exactly one type, because the type is a segment of its URL,
 * `/resources/{type}/{slug}/` (ADR 0024). Core's panel for a hierarchical
 * taxonomy is a checkbox list, which allows several, so this replaces it for
 * `resource_type` through the `editor.PostTaxonomyType` filter, the editor's
 * documented way to swap one taxonomy's selector. Every other taxonomy keeps
 * core's control.
 *
 * Choosing a type edits the post's `resource_type` to that one ID; it saves
 * with the post. The server enforces the rule on every REST save (OneType in
 * PHP), so this control is the convenience, not the check. Types are a fixed
 * list managed on the Types screen (ADR 0007), so there is no "Add New Type"
 * form here. While no type is chosen, the panel says so in words above the
 * buttons (`RequiredState`, from the required-fields plugin), and the
 * `resource-hub-type-radio` class is how that plugin's notice finds the
 * buttons to focus.
 */
import { addFilter } from '@wordpress/hooks';
import { RadioControl, Spinner } from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';

import { RequiredState } from '../required-fields/required-state';

const TAXONOMY = 'resource_type';

// One stable query object, so the store resolves it once.
const TYPES_QUERY = {
	per_page: -1,
	orderby: 'name',
	order: 'asc',
	_fields: 'id,name',
	context: 'view',
};

function ResourceTypeRadio() {
	const { selected, types } = useSelect(
		( select ) => ( {
			selected:
				select( editorStore ).getEditedPostAttribute( TAXONOMY ) ?? [],
			types: select( coreStore ).getEntityRecords(
				'taxonomy',
				TAXONOMY,
				TYPES_QUERY
			),
		} ),
		[]
	);
	const { editPost } = useDispatch( editorStore );

	if ( ! types ) {
		return <Spinner />;
	}

	if ( types.length === 0 ) {
		return (
			<p>
				{ __(
					'No types exist yet. An editor adds them under Resources > Types.',
					'resource-hub'
				) }
			</p>
		);
	}

	// Two stored types (possible only through PHP) select nothing, so the
	// editor has to choose one.
	const value = selected.length === 1 ? String( selected[ 0 ] ) : '';

	return (
		<>
			<RequiredState field="type" />
			<RadioControl
				className="resource-hub-type-radio"
				label={ __( 'Type', 'resource-hub' ) }
				hideLabelFromVision
				selected={ value }
				options={ types.map( ( type ) => ( {
					label: decodeEntities( type.name ),
					value: String( type.id ),
				} ) ) }
				onChange={ ( id ) =>
					editPost( { [ TAXONOMY ]: [ Number( id ) ] } )
				}
			/>
		</>
	);
}

addFilter(
	'editor.PostTaxonomyType',
	'resource-hub/resource-type-radio',
	( OriginalSelector ) =>
		function ResourceHubTaxonomySelector( props ) {
			if ( props.slug !== TAXONOMY ) {
				return <OriginalSelector { ...props } />;
			}

			return <ResourceTypeRadio />;
		}
);
