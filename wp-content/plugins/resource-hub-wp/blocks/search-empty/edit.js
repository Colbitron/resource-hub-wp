/**
 * Editor component for the Search Empty State block.
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
					'When a search lists nothing: the sentence the front end shows for no results, a query too short or too long, or a page past the last.',
					'resource-hub'
				) }
			/>
		</div>
	);
}
