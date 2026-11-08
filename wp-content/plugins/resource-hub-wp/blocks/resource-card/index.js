/**
 * Registers the Resource Card block on the editor side. Rendering happens in
 * PHP (`src/Blocks/ResourceCardBlock.php`); this file wires the metadata, the
 * editor component and the stylesheet.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';
// Extracted to build/resource-card/style-index.css, which block.json loads.
import './style.css';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
