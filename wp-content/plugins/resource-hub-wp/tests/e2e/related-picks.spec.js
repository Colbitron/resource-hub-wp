/**
 * The related picks control in the "Resource details" panel: picks are found
 * through the search and its type and topic filters, reordered and removed
 * with buttons that keep focus and announce the change, saved in order as
 * `meta.related_picks`, shown with a note once no longer published, and
 * capped at ten with a plain message in place of the search.
 */
const path = require( 'node:path' );
const { createRequire } = require( 'node:module' );
const { test, expect } = require( './fixtures' );

// `@axe-core/playwright` is the front end's dependency (apps/web), not this
// package's, so it is resolved from there rather than installed twice.
const webRequire = createRequire(
	path.resolve( __dirname, '../../../../../apps/web/package.json' )
);
const { AxeBuilder } = webRequire( '@axe-core/playwright' );

const RELATED_PICKS_MAX = 10;

test.describe( 'Related picks', () => {
	const stamp = Date.now();
	const createdIds = [];
	let typeA;
	let typeB;
	let topicX;
	let topicY;
	let alpha;
	let beta;
	let delta;
	let fillers;

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

	test.beforeAll( async ( { requestUtils } ) => {
		const term = ( taxonomy, name ) =>
			requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/${ taxonomy }`,
				data: { name },
			} );
		typeA = await term( 'resource_type', `E2E type A ${ stamp }` );
		typeB = await term( 'resource_type', `E2E type B ${ stamp }` );
		topicX = await term( 'resource_topic', `E2E topic X ${ stamp }` );
		topicY = await term( 'resource_topic', `E2E topic Y ${ stamp }` );

		const resource = async ( title, type, topic ) => {
			const created = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/resources',
				data: {
					title,
					status: 'publish',
					resource_type: [ type.id ],
					resource_topic: [ topic.id ],
				},
			} );
			createdIds.push( created.id );
			return created;
		};

		alpha = await resource( `E2E pick alpha ${ stamp }`, typeA, topicX );
		beta = await resource( `E2E pick beta ${ stamp }`, typeA, topicY );
		delta = await resource( `E2E pick delta ${ stamp }`, typeB, topicY );

		fillers = [];
		for ( let i = 1; i <= RELATED_PICKS_MAX; i++ ) {
			fillers.push(
				await resource( `E2E filler ${ i } ${ stamp }`, typeB, topicX )
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
		for ( const [ taxonomy, term ] of [
			[ 'resource_type', typeA ],
			[ 'resource_type', typeB ],
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

		const axe = await new AxeBuilder( { page } )
			.include( '.resource-hub-related-picks' )
			.analyze();
		expect( axe.violations ).toEqual( [] );

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
		await expect( reopenedItems.nth( 1 ) ).toContainText(
			'Not published, skipped on the site.'
		);
		await expect( reopenedItems.nth( 0 ) ).not.toContainText(
			'Not published'
		);
		await reopened.screenshot( {
			path: testInfo.outputPath( 'related-picks-skipped.png' ),
		} );
	} );

	test( 'the tenth pick replaces the search with the cap message', async ( {
		admin,
		editor,
		page,
		requestUtils,
	}, testInfo ) => {
		const nine = fillers.slice( 0, RELATED_PICKS_MAX - 1 );
		const host = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E capped host ${ stamp }`,
				status: 'draft',
				meta: { related_picks: nine.map( ( item ) => item.id ) },
			},
		} );
		createdIds.push( host.id );

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
