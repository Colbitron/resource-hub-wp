/**
 * Editor component for the Related Resources block.
 *
 * The preview is the real server render via ServerSideRender, so what the
 * editor shows is what the front end will serve.
 */
import ServerSideRender from '@wordpress/server-side-render';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, RangeControl, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';

export default function Edit( { attributes, setAttributes } ) {
	const { count, topic } = attributes;
	const blockProps = useBlockProps();

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Settings', 'resource-hub' ) }>
					<RangeControl
						label={ __( 'Number of resources', 'resource-hub' ) }
						value={ count }
						onChange={ ( value ) =>
							setAttributes( { count: value } )
						}
						min={ 1 }
						max={ 12 }
					/>
					<TextControl
						label={ __( 'Topic slug', 'resource-hub' ) }
						help={ __(
							'Leave empty to use the topics of the current resource.',
							'resource-hub'
						) }
						value={ topic }
						onChange={ ( value ) =>
							setAttributes( { topic: value } )
						}
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				<ServerSideRender
					block={ metadata.name }
					attributes={ attributes }
				/>
			</div>
		</>
	);
}
