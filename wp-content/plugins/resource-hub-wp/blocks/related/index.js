/**
 * Registers the Related Section block on the editor side. Rendering happens
 * in PHP (`src/Blocks/RelatedBlock.php`); this file wires the metadata and
 * the editor component. The stylesheets are handles that `block.json`
 * names: the shared tokens and the shared row (`src/Blocks/SharedTokens.php`,
 * `src/Blocks/SharedCard.php`); the section's own heading rule is the
 * theme's `related.css`, which the template that renders the article loads.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
