/**
 * Editor component for the Resource Card block.
 *
 * The preview is the real server render through ServerSideRender, sent the
 * post the Query Loop gives this instance as `post_id`, so each post in the
 * loop previews its own row, as the CMS's pages render it. ServerSideRender
 * would otherwise send the post being edited. With no published resource
 * there (a draft, another post type, or a template with no post), the server
 * renders nothing and the canvas says so. The inspector sets the title's
 * heading level, 2 to 4, as the front end's `ResourceCard` takes it.
 */
import ServerSideRender from '@wordpress/server-side-render';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, Placeholder, SelectControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';

const LEVELS = [ 2, 3, 4 ];

function Empty() {
	return (
		<Placeholder
			icon={ metadata.icon }
			label={ metadata.title }
			instructions={ __(
				'Each published resource the Query Loop lists shows here as a row.',
				'resource-hub'
			) }
		/>
	);
}

export default function Edit( { attributes, setAttributes, context } ) {
	const blockProps = useBlockProps();
	const { postId } = context;

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Settings', 'resource-hub' ) }>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Title heading level', 'resource-hub' ) }
						help={ __(
							'H2 under the page title; H3 under a section heading.',
							'resource-hub'
						) }
						value={ String( attributes.level ) }
						options={ LEVELS.map( ( level ) => ( {
							label: `H${ level }`,
							value: String( level ),
						} ) ) }
						onChange={ ( next ) =>
							setAttributes( { level: Number( next ) } )
						}
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				<ServerSideRender
					block={ metadata.name }
					attributes={ attributes }
					urlQueryArgs={ postId ? { post_id: postId } : {} }
					EmptyResponsePlaceholder={ Empty }
				/>
			</div>
		</>
	);
}
