/**
 * Registers the Page Card block on the editor side. Rendering happens in PHP
 * (`src/Blocks/PageCardBlock.php`) for the post a Query Loop's post template
 * gives each instance; this file wires the metadata and the editor preview.
 * The stylesheets `block.json` names are the shared tokens and card handles
 * the `resource-card` block names too, so a loop with both loads them once.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
