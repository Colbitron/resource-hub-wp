/**
 * Registers the Search Head block on the editor side. Rendering happens in
 * PHP (`src/Blocks/SearchHeadBlock.php`) from the page's main query; this
 * file wires the metadata and the editor placeholder. The one stylesheet
 * `block.json` names is the shared tokens handle; `listing.css` and
 * `search.css` are the CMS theme's, loaded on its search template.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
