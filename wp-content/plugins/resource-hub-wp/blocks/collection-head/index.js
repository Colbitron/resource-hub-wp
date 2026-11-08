/**
 * Registers the Collection Head block on the editor side. Rendering happens in
 * PHP (`src/Blocks/CollectionHeadBlock.php`) from the page's main query; this
 * file wires the metadata and the editor placeholder. The one stylesheet
 * `block.json` names is the shared tokens handle; `listing.css` is the CMS
 * theme's, loaded on its collection templates.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
