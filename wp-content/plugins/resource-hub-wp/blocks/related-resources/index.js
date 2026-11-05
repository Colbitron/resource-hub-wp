/**
 * Registers the Related Resources block on the editor side. Rendering happens
 * in PHP; this file only wires metadata and the inspector controls.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
