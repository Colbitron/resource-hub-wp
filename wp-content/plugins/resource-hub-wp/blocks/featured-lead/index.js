/**
 * Registers the Featured Lead block on the editor side. Rendering happens in
 * PHP (`src/Blocks/FeaturedLeadBlock.php`) from the library's main query;
 * this file wires the metadata and the editor placeholder. The stylesheets
 * are handles `block.json` names: the shared tokens and the shared row (the
 * lead's meta line and topics are the row's parts); `lead.css` is the CMS
 * theme's, loaded on its library template.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

registerBlockType( metadata.name, {
	edit: Edit,
	// Dynamic block: the saved content is empty and PHP renders on request.
	save: () => null,
} );
