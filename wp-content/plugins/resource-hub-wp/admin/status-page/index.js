/**
 * The resource picker's search on Settings > Resource Hub (ADR 0019).
 *
 * PHP renders the picker with the most recently modified published resources,
 * so the form works without this script. Typing in the search box replaces
 * the list with the published resources matching the search, read from the
 * public `wp/v2/resources` collection; the "most recently modified" default
 * stays as the first option. The page itself needs `manage_options`.
 */
import apiFetch from '@wordpress/api-fetch';
import { decodeEntities } from '@wordpress/html-entities';
import { addQueryArgs } from '@wordpress/url';

const DEBOUNCE_MS = 300;
const LIMIT = 20;

const search = document.getElementById( 'rh-test-search' );
const picker = document.getElementById( 'rh-test-resource' );

if ( search && picker ) {
	const defaultOption = picker.options[ 0 ];
	let timer = 0;
	let latest = 0;

	const fill = ( resources ) => {
		const selected = picker.value;
		picker.replaceChildren( defaultOption );

		for ( const resource of resources ) {
			const option = document.createElement( 'option' );
			option.value = String( resource.id );
			option.textContent = decodeEntities(
				resource.title?.rendered || ''
			).trim();
			picker.append( option );
		}

		picker.value = selected;

		if ( picker.value !== selected ) {
			picker.value = '';
		}
	};

	const run = async () => {
		const request = ++latest;
		const resources = await apiFetch( {
			path: addQueryArgs( '/wp/v2/resources', {
				status: 'publish',
				search: search.value.trim(),
				per_page: LIMIT,
				orderby: 'modified',
				order: 'desc',
				_fields: 'id,title',
			} ),
		} ).catch( () => null );

		if ( request === latest && Array.isArray( resources ) ) {
			fill( resources );
		}
	};

	search.addEventListener( 'input', () => {
		window.clearTimeout( timer );
		timer = window.setTimeout( run, DEBOUNCE_MS );
	} );
}
