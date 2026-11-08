/**
 * Editor component for the Featured Lead block.
 *
 * A placeholder, not a server preview: the block renders from the library's
 * main query, which the Site Editor's canvas does not have, so the server
 * would render nothing there. The placeholder says when the block draws.
 */
import { useBlockProps } from '@wordpress/block-editor';
import { Placeholder } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';

export default function Edit() {
	return (
		<div { ...useBlockProps() }>
			<Placeholder
				icon={ metadata.icon }
				label={ metadata.title }
				instructions={ __(
					'On the first page of the library, the newest featured resource, large, under a Featured heading; nothing on any other page, or when nothing is featured.',
					'resource-hub'
				) }
			/>
		</div>
	);
}
