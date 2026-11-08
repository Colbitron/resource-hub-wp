/**
 * Registers the Resource Summary block on the editor side. Rendering happens
 * in PHP (`src/Blocks/ResourceSummaryBlock.php`); this file wires the
 * metadata and the editor component. The block has no stylesheet: the
 * paragraph's rule is the article's (`resource.css`), which the template
 * that renders the article loads.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
