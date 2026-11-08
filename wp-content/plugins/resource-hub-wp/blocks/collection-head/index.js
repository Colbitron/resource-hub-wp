/**
 * Registers the Collection Head block on the editor side. Rendering happens in
 * PHP (`src/Blocks/CollectionHeadBlock.php`) from the page's main query; this
 * file wires the metadata and the editor placeholder. The stylesheets are
 * handles `block.json` names: the shared tokens and the CMS theme's copy of
 * the package's `listing.css`.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
