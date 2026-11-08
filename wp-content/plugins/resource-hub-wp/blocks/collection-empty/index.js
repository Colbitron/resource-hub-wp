/**
 * Registers the Collection Empty State block on the editor side. Rendering
 * happens in PHP (`src/Blocks/CollectionEmptyBlock.php`) from the page's
 * main query; this file wires the metadata and the editor placeholder.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
