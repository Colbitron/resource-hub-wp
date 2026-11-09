/**
 * Editor component for the Search Head block.
 *
 * A placeholder, not a server preview: the block renders from the page's
 * main query, which the Site Editor's canvas does not have, so the server
 * would render nothing there. The placeholder says what the block draws on
 * the CMS's search page.
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
					"On the search page, this is the heading, the form with the reader's words, and the count of results, as the front end shows them.",
					'resource-hub'
				) }
			/>
		</div>
	);
}
