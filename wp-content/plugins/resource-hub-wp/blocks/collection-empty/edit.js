/**
 * Editor component for the Collection Empty State block.
 *
 * A placeholder, not a server preview: the sentence depends on the page's
 * main query, which the Site Editor's canvas does not have.
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
					'When a collection lists nothing: the sentence the front end shows, and a link back to the library on a filtered page.',
					'resource-hub'
				) }
			/>
		</div>
	);
}
