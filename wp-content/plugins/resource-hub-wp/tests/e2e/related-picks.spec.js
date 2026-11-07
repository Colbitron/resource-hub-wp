/**
 * The related picks control in the "Resource details" panel: picks are found
 * through the search and its type and topic filters, reordered and removed
 * with buttons that keep focus and announce the change, saved in order as
 * `meta.related_picks`, shown with a note once no longer published, deleted
 * or not a resource at all, and capped at ten with a plain message in place of
 * the search. The search waits for a pause in typing, never offers the
 * resource itself, works from the keyboard alone, adds on Enter only from an
 * open list, opens on a click and starts again empty after an add; a reorder
 * sends no request; and for an Author, a pick they cannot read is marked by
 * its ID while the rest resolve.
 */
const { default: AxeBuilder } = require( '@axe-core/playwright' );
const {
	Admin,
	Editor,
	PageUtils,
	RequestUtils,
} = require( '@wordpress/e2e-test-utils-playwright' );
const { test, expect } = require( './fixtures' );

const RELATED_PICKS_MAX = 10;

const SKIPPED = 'Not published, skipped on the site.';

// Whether a request URL is for the resources collection, with pretty
// permalinks or without.
const isResourcesRoute = ( url ) =>
	/\/wp\/v2\/resources\/?$/.test(
		url.searchParams.get( 'rest_route' ) ?? url.pathname
	);

// The values of a list parameter, sent as `name=` or `name[]=`.
const listParam = ( url, name ) =>
	[ ...url.searchParams ]
		.filter( ( [ key ] ) => key === name || key.startsWith( `${ name }[` ) )
		.map( ( [ , value ] ) => value );

/**
 * Waits for the answer to a search query with nothing typed, the one that
 * lists the newest resources, among those `matches` accepts. Once it is in,
 * the combobox holds options and highlights the first, though its list stays
 * closed.
 *
 * @param {import('@playwright/test').Page} page    The page to watch.
 * @param {(url: URL) => boolean}           matches Narrows the queries.
 * @return {Promise<import('@playwright/test').Response>} The response.
 */
const emptySearchAnswered = ( page, matches ) =>
	page.waitForResponse( ( response ) => {
		if ( response.request().method() !== 'GET' ) {
			return false;
		}
		const url = new URL( response.url() );
		return (
			isResourcesRoute( url ) &&
			url.searchParams.get( 'status' ) === 'publish' &&
			! url.searchParams.has( 'search' ) &&
			matches( url )
		);
	} );

// The picks as edited in the store, read straight after a key press: the add
// is dispatched from the keydown itself, so it is there once the press ends.
const editedPicks = ( page ) =>
	page.evaluate(
		() =>
			window.wp.data
				.select( 'core/editor' )
				.getEditedPostAttribute( 'meta' ).related_picks
	);

/**
 * Records the GET requests the page makes to the resources collection: the
 * `include` lists of the picks queries, as sorted-or-not comma lists, and the
 * search queries with the arguments the spec checks.
 *
 * @param {import('@playwright/test').Page} page The page to watch.
 * @return {{includes: string[], searches: Object[]}} Live lists.
 */
const watchResourceQueries = ( page ) => {
	const includes = [];
	const searches = [];

	page.on( 'request', ( request ) => {
		if ( request.method() !== 'GET' ) {
			return;
		}
		const url = new URL( request.url() );
		if ( ! isResourcesRoute( url ) ) {
			return;
		}

		const include = listParam( url, 'include' );
		if ( include.length > 0 ) {
			includes.push( include.join( ',' ) );
		}
		if ( url.searchParams.has( 'search' ) ) {
			searches.push( {
				search: url.searchParams.get( 'search' ),
				perPage: url.searchParams.get( 'per_page' ),
				status: url.searchParams.get( 'status' ),
				exclude: listParam( url, 'exclude' ).map( Number ),
			} );
		}
	} );

	return { includes, searches };
};

const searchOf = ( request ) => {
	const url = new URL( request.url() );
	return url.searchParams.get( 'search' );
};

test.describe( 'Related picks', () => {
	const stamp = Date.now();
	const createdIds = [];
	const createdPostIds = [];
	const createdUserIds = [];
	let typeA;
	let typeB;
	let typeC;
	let topicX;
	let topicY;
	let alpha;
	let beta;
	let delta;
	let kilo;
	let lima;
	let publishedHost;
	let fillers;

	// Creates a resource through REST. A published one always has a title,
	// one type, a topic and a summary, so it passes the server's rules for
	// publishing.
	const resource = async ( requestUtils, data ) => {
		const created = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				status: 'publish',
				...data,
				meta: { summary: 'E2E summary.', ...( data.meta ?? {} ) },
			},
		} );
		createdIds.push( created.id );
		return created;
	};

	const published = ( requestUtils, title, type, topic ) =>
		resource( requestUtils, {
			title,
			resource_type: [ type.id ],
			resource_topic: [ topic.id ],
		} );

	// Opens a document-settings panel by its title if it is collapsed.
	const openPanel = async ( page, name ) => {
		const toggle = page.getByRole( 'button', { name, exact: true } );
		await expect( toggle ).toBeVisible();

		if ( ( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
			await toggle.click();
		}
	};

	const openResourceDetails = async ( page, editor ) => {
		await editor.openDocumentSettingsSidebar();
		await openPanel( page, 'Resource details' );
		return page.locator( '.resource-hub-related-picks' );
	};

	// Types into the search, waits for the option and picks it.
	const pick = async ( page, text, optionName ) => {
		const search = page.getByRole( 'combobox', { name: 'Add a pick' } );
		await search.fill( text );
		const option = page.getByRole( 'option', { name: optionName } );
		await expect( option ).toBeVisible();
		await option.click();
	};

	const listTitles = ( panel ) =>
		panel.getByRole( 'list', { name: 'Picks, in order' } ).locator( 'li' );

	const activeName = ( page ) =>
		page.locator( ':focus' ).getAttribute( 'aria-label' );

	const axeViolations = async ( page ) =>
		(
			await new AxeBuilder( { page } )
				.include( '.resource-hub-related-picks' )
				.analyze()
		).violations;

	test.beforeAll( async ( { requestUtils } ) => {
		const term = ( taxonomy, name ) =>
			requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/${ taxonomy }`,
				data: { name },
			} );
		typeA = await term( 'resource_type', `E2E type A ${ stamp }` );
		typeB = await term( 'resource_type', `E2E type B ${ stamp }` );
		typeC = await term( 'resource_type', `E2E type C ${ stamp }` );
		topicX = await term( 'resource_topic', `E2E topic X ${ stamp }` );
		topicY = await term( 'resource_topic', `E2E topic Y ${ stamp }` );

		alpha = await published(
			requestUtils,
			`E2E pick alpha ${ stamp }`,
			typeA,
			topicX
		);
		beta = await published(
			requestUtils,
			`E2E pick beta ${ stamp }`,
			typeA,
			topicY
		);
		delta = await published(
			requestUtils,
			`E2E pick delta ${ stamp }`,
			typeB,
			topicY
		);
		kilo = await published(
			requestUtils,
			`E2E search kilo ${ stamp }`,
			typeC,
			topicX
		);
		lima = await published(
			requestUtils,
			`E2E search lima ${ stamp }`,
			typeC,
			topicX
		);
		publishedHost = await published(
			requestUtils,
			`E2E published host ${ stamp }`,
			typeC,
			topicY
		);

		fillers = [];
		for ( let i = 1; i <= RELATED_PICKS_MAX; i++ ) {
			fillers.push(
				await published(
					requestUtils,
					`E2E filler ${ i } ${ stamp }`,
					typeB,
					topicX
				)
			);
		}
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of createdIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}
		for ( const id of createdPostIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/posts/${ id }`,
				params: { force: true },
			} );
		}
		for ( const id of createdUserIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/users/${ id }`,
				params: { force: true, reassign: 1 },
			} );
		}
		for ( const [ taxonomy, term ] of [
			[ 'resource_type', typeA ],
			[ 'resource_type', typeB ],
			[ 'resource_type', typeC ],
			[ 'resource_topic', topicX ],
			[ 'resource_topic', topicY ],
		] ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/${ taxonomy }/${ term.id }`,
				params: { force: true },
			} );
		}
	} );

	test( 'picks are searched, ordered, removed, saved and marked once unpublished', async ( {
		admin,
		editor,
		page,
		requestUtils,
	}, testInfo ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E host ${ stamp }`,
		} );
		const postId = await page.evaluate( () =>
			window.wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		createdIds.push( postId );
		const queries = watchResourceQueries( page );

		const panel = await openResourceDetails( page, editor );
		await expect(
			page.getByRole( 'combobox', { name: 'Add a pick' } )
		).toBeVisible();
		await expect( listTitles( panel ) ).toHaveCount( 0 );
		await panel.screenshot( {
			path: testInfo.outputPath( 'related-picks-empty.png' ),
		} );

		// Filter by type: with type B chosen, delta is offered once the
		// results are in and alpha (type A) is not. Every title made here
		// ends in the stamp, and the combobox matches the typed text against
		// the labels as well, so the stamp is what is typed.
		await page
			.getByRole( 'combobox', { name: 'Filter by type' } )
			.selectOption( { label: typeB.name } );
		const search = page.getByRole( 'combobox', { name: 'Add a pick' } );
		await search.fill( String( stamp ) );
		await expect(
			page.getByRole( 'option', {
				name: `${ delta.title.raw } (${ typeB.name })`,
			} )
		).toBeVisible();
		await expect(
			page.getByRole( 'option', { name: new RegExp( 'pick alpha' ) } )
		).toHaveCount( 0 );
		await page
			.getByRole( 'option', {
				name: `${ delta.title.raw } (${ typeB.name })`,
			} )
			.click();
		await expect( listTitles( panel ) ).toHaveCount( 1 );

		// Focus returns to the search after an add.
		await expect( search ).toBeFocused();

		// Filter by topic: with the type back on Any and topic X chosen,
		// alpha is offered and beta (topic Y) is not.
		await page
			.getByRole( 'combobox', { name: 'Filter by type' } )
			.selectOption( { label: 'Any' } );
		await page
			.getByRole( 'combobox', { name: 'Filter by topic' } )
			.selectOption( { label: topicX.name } );
		await search.fill( String( stamp ) );
		await expect(
			page.getByRole( 'option', {
				name: `${ alpha.title.raw } (${ typeA.name })`,
			} )
		).toBeVisible();
		await expect(
			page.getByRole( 'option', { name: new RegExp( 'pick beta' ) } )
		).toHaveCount( 0 );
		// A pick already made is left out of the results.
		await expect(
			page.getByRole( 'option', { name: new RegExp( 'pick delta' ) } )
		).toHaveCount( 0 );
		await page
			.getByRole( 'option', {
				name: `${ alpha.title.raw } (${ typeA.name })`,
			} )
			.click();

		await page
			.getByRole( 'combobox', { name: 'Filter by topic' } )
			.selectOption( { label: 'Any' } );
		await pick(
			page,
			`pick beta ${ stamp }`,
			`${ beta.title.raw } (${ typeA.name })`
		);

		const items = listTitles( panel );
		await expect( items ).toHaveCount( 3 );
		await expect( items.nth( 0 ) ).toContainText( delta.title.raw );
		await expect( items.nth( 0 ) ).toContainText( typeB.name );
		await expect( items.nth( 1 ) ).toContainText( alpha.title.raw );
		await expect( items.nth( 2 ) ).toContainText( beta.title.raw );
		await panel.screenshot( {
			path: testInfo.outputPath( 'related-picks-three.png' ),
		} );

		// Each add asked for the picks once, by sorted ID; alpha, beta and
		// delta were made in that order, so their IDs sort that way.
		const sorted = ( ...records ) =>
			records
				.map( ( record ) => record.id )
				.sort( ( a, b ) => a - b )
				.join( ',' );
		await expect
			.poll( () => queries.includes )
			.toEqual( [
				sorted( delta ),
				sorted( alpha, delta ),
				sorted( alpha, beta, delta ),
			] );

		// Every button names its item; the first item's Move up and the
		// last's Move down are disabled but still in the tab order.
		await expect(
			page.getByRole( 'button', {
				name: `Move up: '${ delta.title.raw }'`,
			} )
		).toHaveAttribute( 'aria-disabled', 'true' );
		await expect(
			page.getByRole( 'button', {
				name: `Move down: '${ beta.title.raw }'`,
			} )
		).toHaveAttribute( 'aria-disabled', 'true' );

		expect( await axeViolations( page ) ).toEqual( [] );

		// Move beta up once: it is second, and focus stays on its Move up.
		const polite = page.locator( '#a11y-speak-polite' );
		await page
			.getByRole( 'button', { name: `Move up: '${ beta.title.raw }'` } )
			.click();
		await expect( items.nth( 1 ) ).toContainText( beta.title.raw );
		expect( await activeName( page ) ).toBe(
			`Move up: '${ beta.title.raw }'`
		);
		await expect( polite ).toContainText(
			`'${ beta.title.raw }' moved up to position 2 of 3.`
		);

		// Move it up again: it is first, its Move up is disabled, so focus
		// moves to its Move down.
		await page
			.getByRole( 'button', { name: `Move up: '${ beta.title.raw }'` } )
			.click();
		await expect( items.nth( 0 ) ).toContainText( beta.title.raw );
		expect( await activeName( page ) ).toBe(
			`Move down: '${ beta.title.raw }'`
		);
		await expect( polite ).toContainText(
			`'${ beta.title.raw }' moved up to position 1 of 3.`
		);

		// Remove delta from the middle: focus lands on the Remove of the item
		// that takes its place, alpha.
		await page
			.getByRole( 'button', { name: `Remove: '${ delta.title.raw }'` } )
			.click();
		await expect( items ).toHaveCount( 2 );
		expect( await activeName( page ) ).toBe(
			`Remove: '${ alpha.title.raw }'`
		);
		await expect( polite ).toContainText(
			`'${ delta.title.raw }' removed. 2 picks left.`
		);

		// The two moves asked for nothing: the only picks query since the
		// third add is the remove's. Requests go out in order, so one sent
		// by a move would sit before it and the list would never match.
		await expect
			.poll( () => queries.includes )
			.toEqual( [
				sorted( delta ),
				sorted( alpha, delta ),
				sorted( alpha, beta, delta ),
				sorted( alpha, beta ),
			] );

		await editor.saveDraft();
		const saved = await requestUtils.rest( {
			path: `/wp/v2/resources/${ postId }`,
			params: { context: 'edit' },
		} );
		expect( saved.meta.related_picks ).toEqual( [ beta.id, alpha.id ] );

		// A pick set to draft stays in the list with the note; the other has
		// none.
		await requestUtils.rest( {
			method: 'POST',
			path: `/wp/v2/resources/${ alpha.id }`,
			data: { status: 'draft' },
		} );
		await page.reload();
		const reopened = await openResourceDetails( page, editor );
		const reopenedItems = listTitles( reopened );
		await expect( reopenedItems ).toHaveCount( 2 );
		await expect( reopenedItems.nth( 1 ) ).toContainText( alpha.title.raw );
		await expect( reopenedItems.nth( 1 ) ).toContainText( SKIPPED );
		await expect( reopenedItems.nth( 0 ) ).not.toContainText(
			'Not published'
		);
		await reopened.screenshot( {
			path: testInfo.outputPath( 'related-picks-skipped.png' ),
		} );
	} );

	test( 'the search waits for a pause, leaves out the resource itself, adds from the keyboard and starts again empty', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.editPost( publishedHost.id );
		const panel = await openResourceDetails( page, editor );
		const queries = watchResourceQueries( page );
		const polite = page.locator( '#a11y-speak-polite' );

		const search = page.getByRole( 'combobox', { name: 'Add a pick' } );
		const listbox = page.getByRole( 'listbox' );
		const items = listTitles( panel );
		const searchSpinner = panel.locator(
			'.components-combobox-control .components-spinner'
		);

		// Type C holds kilo, lima and the host itself, all with the stamp in
		// their titles.
		const typeCListed = emptySearchAnswered( page, ( url ) =>
			listParam( url, 'resource_type' ).map( Number ).includes( typeC.id )
		);
		await page
			.getByRole( 'combobox', { name: 'Filter by type' } )
			.selectOption( { label: typeC.name } );
		await typeCListed;
		await expect( searchSpinner ).toHaveCount( 0 );

		// Enter adds a pick only from an open list. Tabbed into, the search
		// stays closed, though core highlights the newest type C resource
		// behind it; Enter there adds nothing.
		await page.getByRole( 'combobox', { name: 'Filter by topic' } ).focus();
		await page.keyboard.press( 'Tab' );
		await expect( search ).toBeFocused();
		await expect( listbox ).toHaveCount( 0 );
		await page.keyboard.press( 'Enter' );
		expect( await editedPicks( page ) ).toEqual( [] );
		await expect( items ).toHaveCount( 0 );
		await expect( listbox ).toHaveCount( 0 );

		const kiloOption = page.getByRole( 'option', {
			name: `${ kilo.title.raw } (${ typeC.name })`,
		} );
		const limaOption = page.getByRole( 'option', {
			name: `${ lima.title.raw } (${ typeC.name })`,
		} );

		// Typed a key at a time, well inside the delay, the text is searched
		// once, whole, for published resources twenty at a time, leaving out
		// the resource being edited.
		await search.pressSequentially( String( stamp ), { delay: 20 } );
		await expect
			.poll( () => queries.searches.map( ( query ) => query.search ) )
			.toEqual( [ String( stamp ) ] );
		const [ searched ] = queries.searches;
		expect( searched.perPage ).toBe( '20' );
		expect( searched.status ).toBe( 'publish' );
		expect( searched.exclude ).toContain( publishedHost.id );

		await expect( kiloOption ).toBeVisible();
		await expect( limaOption ).toBeVisible();
		await expect(
			page.getByRole( 'option', { name: /published host/ } )
		).toHaveCount( 0 );

		// The open list passes axe too, but for one finding in core's own
		// markup: `ComboboxControl` points its input at the listbox with
		// `aria-owns` and not the `aria-controls` ARIA 1.2 asks of a
		// combobox. Only that finding, on that input, and only for that one
		// missing attribute, is set aside.
		await expect( listbox ).toBeVisible();
		const openViolations = await axeViolations( page );
		const coreCombobox = ( violation ) =>
			violation.id === 'aria-required-attr' &&
			violation.nodes.every( ( node ) => {
				const checks = [ ...node.any, ...node.all, ...node.none ];
				return (
					node.target.every( ( selector ) =>
						selector.startsWith(
							'#components-form-token-input-combobox-control-'
						)
					) &&
					checks.length > 0 &&
					checks.every(
						( check ) =>
							Array.isArray( check.data ) &&
							check.data.length === 1 &&
							check.data[ 0 ] === 'aria-controls'
					)
				);
			} );
		expect( openViolations.filter( ( v ) => ! coreCombobox( v ) ) ).toEqual(
			[]
		);

		// Keyboard only: narrow to kilo, wait for its search to answer so the
		// choice is made from the current results, then ArrowDown and Enter.
		const kiloSearched = page.waitForResponse(
			( response ) =>
				searchOf( response.request() ) === `search kilo ${ stamp }`
		);
		await search.fill( `search kilo ${ stamp }` );
		await kiloSearched;
		await expect( kiloOption ).toBeVisible();
		await expect( limaOption ).toHaveCount( 0 );
		await search.press( 'ArrowDown' );
		await expect( kiloOption ).toHaveAttribute( 'aria-selected', 'true' );
		const restListed = emptySearchAnswered( page, ( url ) =>
			listParam( url, 'exclude' ).map( Number ).includes( kilo.id )
		);
		await search.press( 'Enter' );

		await expect( items ).toHaveCount( 1 );
		await expect( items.nth( 0 ) ).toContainText( kilo.title.raw );
		await expect( search ).toBeFocused();
		await expect( search ).toHaveValue( '' );
		await expect( polite ).toContainText( 'Added as pick 1.' );

		// Straight after the add, Enter adds nothing either: the list closed
		// with the add, and lima, now the newest type C resource, is
		// highlighted behind it once the empty search answers.
		await restListed;
		await expect( searchSpinner ).toHaveCount( 0 );
		await expect( listbox ).toHaveCount( 0 );
		await search.press( 'Enter' );
		expect( await editedPicks( page ) ).toEqual( [ kilo.id ] );
		await expect( items ).toHaveCount( 1 );

		// The input is empty, and so is the search: ArrowDown opens the list
		// of every other type C resource, not one still narrowed to kilo,
		// and with the list open Enter adds the highlighted option.
		await search.press( 'ArrowDown' );
		await expect( limaOption ).toBeVisible();
		await expect( kiloOption ).toHaveCount( 0 );
		await expect( limaOption ).toHaveAttribute( 'aria-selected', 'true' );
		await search.press( 'Enter' );
		await expect( items ).toHaveCount( 2 );
		await expect( items.nth( 1 ) ).toContainText( lima.title.raw );
		await expect( search ).toBeFocused();
		await expect( polite ).toContainText( 'Added as pick 2.' );

		await page
			.getByRole( 'button', { name: `Remove: '${ lima.title.raw }'` } )
			.click();
		await expect( items ).toHaveCount( 1 );

		// Removing the last pick puts focus back on the search without
		// opening its list, so the removal is what is announced.
		await page
			.getByRole( 'button', { name: `Remove: '${ kilo.title.raw }'` } )
			.click();
		await expect( items ).toHaveCount( 0 );
		await expect( search ).toBeFocused();
		await expect( listbox ).toHaveCount( 0 );
		await expect( polite ).toContainText(
			`'${ kilo.title.raw }' removed. 0 picks left.`
		);

		// A click on the empty search opens its list.
		await search.click();
		await expect( listbox ).toBeVisible();
		await expect( kiloOption ).toBeVisible();
		await expect( limaOption ).toBeVisible();
	} );

	test( 'a deleted pick and an ID that is not a resource are marked as skipped', async ( {
		admin,
		editor,
		page,
		requestUtils,
	}, testInfo ) => {
		const doomed = await published(
			requestUtils,
			`E2E doomed ${ stamp }`,
			typeA,
			topicX
		);
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resources/${ doomed.id }`,
			params: { force: true },
		} );
		createdIds.splice( createdIds.indexOf( doomed.id ), 1 );
		const post = await requestUtils.createPost( {
			title: `E2E plain post ${ stamp }`,
			status: 'publish',
		} );
		createdPostIds.push( post.id );

		// The meta keeps any positive ID; it is the route that skips the
		// ones that are not published resources.
		const picks = [ beta.id, doomed.id, post.id ];
		const host = await resource( requestUtils, {
			title: `E2E skipped host ${ stamp }`,
			status: 'draft',
			meta: { related_picks: picks },
		} );
		expect( host.meta.related_picks ).toEqual( picks );

		await admin.editPost( host.id );
		const panel = await openResourceDetails( page, editor );
		const items = listTitles( panel );
		await expect( items ).toHaveCount( 3 );
		await expect( items.nth( 0 ) ).toContainText( beta.title.raw );
		await expect( items.nth( 0 ) ).not.toContainText( SKIPPED );
		await expect( items.nth( 1 ) ).toContainText(
			`Resource #${ doomed.id }`
		);
		await expect( items.nth( 1 ) ).toContainText( SKIPPED );
		await expect( items.nth( 2 ) ).toContainText(
			`Resource #${ post.id }`
		);
		await expect( items.nth( 2 ) ).toContainText( SKIPPED );

		// The note describes the row's Remove button.
		await expect(
			page.getByRole( 'button', {
				name: `Remove: 'Resource #${ doomed.id }'`,
			} )
		).toHaveAccessibleDescription( SKIPPED );
		await expect(
			page.getByRole( 'button', {
				name: `Remove: '${ beta.title.raw }'`,
			} )
		).toHaveAccessibleDescription( '' );

		expect( await axeViolations( page ) ).toEqual( [] );
		await panel.screenshot( {
			path: testInfo.outputPath( 'related-picks-missing.png' ),
		} );
	} );

	test( 'for an Author, a pick they cannot read is marked by its ID and the rest resolve', async ( {
		browser,
		requestUtils,
	}, testInfo ) => {
		const { baseURL } = testInfo.project.use;

		// A throwaway user, and password, on the tests site.
		const username = `e2e-author-${ stamp }`;
		const password = `e2e-author-${ stamp }`;
		const author = await requestUtils.createUser( {
			username,
			email: `${ username }@example.com`,
			password,
			roles: [ 'author' ],
		} );
		createdUserIds.push( author.id );

		// Resources have no author field in REST, so the Author makes their
		// own posts through their own session; the admin's draft is the one
		// they cannot read.
		const othersDraft = await resource( requestUtils, {
			title: `E2E admin draft ${ stamp }`,
			status: 'draft',
		} );
		const authorUtils = await RequestUtils.setup( {
			user: { username, password },
			baseURL,
		} );

		try {
			const ownDraft = await resource( authorUtils, {
				title: `E2E own draft ${ stamp }`,
				status: 'draft',
			} );
			const host = await resource( authorUtils, {
				title: `E2E author host ${ stamp }`,
				status: 'draft',
				meta: {
					related_picks: [ beta.id, othersDraft.id, ownDraft.id ],
				},
			} );
			expect( host.meta.related_picks ).toEqual( [
				beta.id,
				othersDraft.id,
				ownDraft.id,
			] );

			const context = await browser.newContext( {
				baseURL,
				storageState: {
					cookies: authorUtils.storageState.cookies,
					origins: [],
				},
			} );

			try {
				const page = await context.newPage();
				const editor = new Editor( { page } );
				const pageUtils = new PageUtils( {
					page,
					browserName: browser.browserType().name(),
				} );
				const admin = new Admin( { page, pageUtils, editor } );
				await admin.editPost( host.id );

				const panel = await openResourceDetails( page, editor );
				const items = listTitles( panel );
				await expect( items ).toHaveCount( 3 );

				// The query resolves although the server leaves one pick
				// out: the published pick and the Author's own draft show
				// their titles, and the admin's draft shows its ID, each
				// with the right note.
				await expect( items.nth( 0 ) ).toContainText( beta.title.raw );
				await expect( items.nth( 0 ) ).not.toContainText( SKIPPED );
				await expect( items.nth( 1 ) ).toContainText(
					`Resource #${ othersDraft.id }`
				);
				await expect( items.nth( 1 ) ).toContainText( SKIPPED );
				await expect( items.nth( 2 ) ).toContainText(
					ownDraft.title.raw
				);
				await expect( items.nth( 2 ) ).toContainText( SKIPPED );
				await expect(
					panel.locator( '.components-spinner' )
				).toHaveCount( 0 );
			} finally {
				await context.close();
			}
		} finally {
			await authorUtils.request.dispose();
		}
	} );

	test( 'the tenth pick replaces the search with the cap message', async ( {
		admin,
		editor,
		page,
		requestUtils,
	}, testInfo ) => {
		const nine = fillers.slice( 0, RELATED_PICKS_MAX - 1 );
		const host = await resource( requestUtils, {
			title: `E2E capped host ${ stamp }`,
			status: 'draft',
			meta: { related_picks: nine.map( ( item ) => item.id ) },
		} );

		await admin.editPost( host.id );
		const panel = await openResourceDetails( page, editor );
		const items = listTitles( panel );
		await expect( items ).toHaveCount( RELATED_PICKS_MAX - 1 );

		const tenth = fillers[ RELATED_PICKS_MAX - 1 ];
		await pick(
			page,
			`filler ${ RELATED_PICKS_MAX } ${ stamp }`,
			`${ tenth.title.raw } (${ typeB.name })`
		);

		await expect( items ).toHaveCount( RELATED_PICKS_MAX );
		await expect(
			page.getByRole( 'combobox', { name: 'Add a pick' } )
		).toHaveCount( 0 );
		const cap = panel.locator( '.resource-hub-related-picks__cap' );
		await expect( cap ).toHaveText(
			'10 picks is the most a resource can have. Remove one to add another.'
		);
		await expect( cap ).toBeFocused();
		await expect( page.locator( '#a11y-speak-polite' ) ).toContainText(
			`Added as pick ${ RELATED_PICKS_MAX }.`
		);
		expect( await axeViolations( page ) ).toEqual( [] );
		await panel.screenshot( {
			path: testInfo.outputPath( 'related-picks-cap.png' ),
		} );

		await editor.saveDraft();
		const saved = await requestUtils.rest( {
			path: `/wp/v2/resources/${ host.id }`,
			params: { context: 'edit' },
		} );
		expect( saved.meta.related_picks ).toEqual(
			[ ...nine, tenth ].map( ( item ) => item.id )
		);

		// Removing one brings the search back.
		await page
			.getByRole( 'button', { name: `Remove: '${ tenth.title.raw }'` } )
			.click();
		await expect(
			page.getByRole( 'combobox', { name: 'Add a pick' } )
		).toBeVisible();
	} );
} );
