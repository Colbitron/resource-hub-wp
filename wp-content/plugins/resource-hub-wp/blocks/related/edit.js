/**
 * Editor component for the Related Section block.
 *
 * The preview is the real server render through ServerSideRender, sent the
 * post in this instance's context as `post_id`: the resource being edited,
 * or the post a template gives it. In a template with no post, for anything
 * but a published resource, or for a resource nothing is related to, the
 * server renders nothing and the canvas says what will show there instead.
 */
import ServerSideRender from '@wordpress/server-side-render';
import { useBlockProps } from '@wordpress/block-editor';
import { Placeholder } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';

function Empty() {
	return (
		<Placeholder
			icon={ metadata.icon }
			label={ metadata.title }
			instructions={ __(
				'A published resource’s related resources show here, picks first, when it has any.',
				'resource-hub'
			) }
		/>
	);
}

export default function Edit( { attributes, context } ) {
	const blockProps = useBlockProps();
	const { postId } = context;

	return (
		<div { ...blockProps }>
			<ServerSideRender
				block={ metadata.name }
				attributes={ attributes }
				urlQueryArgs={ postId ? { post_id: postId } : {} }
				EmptyResponsePlaceholder={ Empty }
			/>
		</div>
	);
}
