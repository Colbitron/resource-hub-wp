/**
 * Editor component for the Collection Head block.
 *
 * A placeholder, not a server preview: the block renders from the page's
 * main query, which the Site Editor's canvas does not have, so the server
 * would render nothing there. The placeholder says what the block draws on
 * the CMS's collection pages.
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
					'On the library and on a type or topic collection, this is the heading, the count and the type and topic filters, as the front end shows them.',
					'resource-hub'
				) }
			/>
		</div>
	);
}
