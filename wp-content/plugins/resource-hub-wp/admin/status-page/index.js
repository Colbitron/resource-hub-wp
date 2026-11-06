/**
 * The resource picker's search on Settings > Resource Hub (see
 * `docs/architecture/revalidation.md`).
 *
 * PHP renders the picker with the most recently modified published resources,
 * so the form works without this script. Typing in the search box replaces
 * the list with the published resources matching the search, read from the
 * public `wp/v2/resources` collection; the "most recently modified" default
 * stays as the first option, and a polite live region says how many matched.
 * The search box sits inside the test form, so Enter there runs the search
 * at once instead of submitting the form with whatever the list held. The
 * submit button is disabled once the form is sent, so one click sends one
 * test. The page itself needs `manage_options`.
 */
import apiFetch from '@wordpress/api-fetch';
import { decodeEntities } from '@wordpress/html-entities';
import { __, _n, sprintf } from '@wordpress/i18n';
import { addQueryArgs } from '@wordpress/url';

const DEBOUNCE_MS = 300;
const LIMIT = 20;

const form = document.getElementById( 'rh-test-form' );
const search = document.getElementById( 'rh-test-search' );
const picker = document.getElementById( 'rh-test-resource' );
const status = document.getElementById( 'rh-test-search-status' );
const submit = document.getElementById( 'rh-test-submit' );

if ( form && submit ) {
	form.addEventListener( 'submit', () => {
		submit.disabled = true;
	} );
}

if ( search && picker ) {
	const defaultOption = picker.options[ 0 ];
	let timer = 0;
	let latest = 0;

	const announce = ( count ) => {
		if ( ! status ) {
			return;
		}

		status.textContent =
			count === 0
				? __( 'No matches', 'resource-hub' )
				: sprintf(
						/* translators: %d: how many published resources match the search. */
						_n(
							'%d resource found',
							'%d resources found',
							count,
							'resource-hub'
						),
						count
					);
	};

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

		announce( resources.length );
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

	search.addEventListener( 'keydown', ( event ) => {
		if ( event.key !== 'Enter' ) {
			return;
		}

		event.preventDefault();
		window.clearTimeout( timer );
		run();
	} );
}
