/**
 * Registers the Related Resources block on the editor side. Rendering happens
 * in PHP (`src/Blocks/RelatedResourcesBlock.php`); this file wires the
 * metadata and the inspector controls. The stylesheets are handles that
 * `block.json` names: the shared tokens and the shared row
 * (`src/Blocks/SharedTokens.php`, `src/Blocks/SharedCard.php`).
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
