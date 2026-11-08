/**
 * The content model over REST and in the editor: a resource created with meta
 * and the featured flag comes back through the flag-filtered collection, and
 * the editor shows the "Resource details" panel for the post type, the Types
 * panel as radio buttons, and a Flags panel nobody can add to. Publishing
 * waits for a type, chosen with the radio buttons.
 */
const { test, expect } = require( './fixtures' );

test.describe( 'Resource content model', () => {
	let featuredId;
	let type;
	let topic;
	const createdIds = [];

	test.beforeAll( async ( { requestUtils } ) => {
		const flags = await requestUtils.rest( {
			path: '/wp/v2/resource_flag',
			params: { slug: 'featured' },
		} );
		featuredId = flags[ 0 ].id;

		// A published resource needs exactly one type, and PHPUnit leaves the
		// tests site with none, so the suite brings its own.
		const stamp = Date.now();
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: { name: `E2E type ${ stamp }`, slug: `e2e-type-${ stamp }` },
		} );
		// A published resource also needs a topic and a summary (RequiredFields).
		topic = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_topic',
			data: {
				name: `E2E topic ${ stamp }`,
				slug: `e2e-topic-${ stamp }`,
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of createdIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}

		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_type/${ type.id }`,
			params: { force: true },
		} );
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_topic/${ topic.id }`,
			params: { force: true },
		} );
	} );

	test( 'a flagged resource is returned by the flag filter with its meta', async ( {
		requestUtils,
	} ) => {
		const stamp = Date.now();
		const summary = 'A plain-text summary written by the e2e suite.';
		const sourceUrl = `https://example.com/e2e/${ stamp }`;

		const flagged = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E featured ${ stamp }`,
				slug: `e2e-featured-${ stamp }`,
				status: 'publish',
				meta: { summary, source_url: sourceUrl },
				resource_flag: [ featuredId ],
				resource_type: [ type.id ],
				resource_topic: [ topic.id ],
			},
		} );
		createdIds.push( flagged.id );

		const unflagged = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E plain ${ stamp }`,
				slug: `e2e-plain-${ stamp }`,
				status: 'publish',
				resource_type: [ type.id ],
				resource_topic: [ topic.id ],
				meta: { summary: 'An e2e summary.' },
			},
		} );
		createdIds.push( unflagged.id );

		const collection = await requestUtils.rest( {
			path: '/wp/v2/resources',
			params: { resource_flag: featuredId, per_page: 100 },
		} );

		const ids = collection.map( ( item ) => item.id );
		expect( ids ).toContain( flagged.id );
		expect( ids ).not.toContain( unflagged.id );

		for ( const item of collection ) {
			expect( item.resource_flag ).toContain( featuredId );
		}

		const found = collection.find( ( item ) => item.id === flagged.id );
		expect( found.meta.summary ).toBe( summary );
		expect( found.meta.source_url ).toBe( sourceUrl );
	} );

	test( 'the editor shows the Resource details panel and the term panels', async ( {
		admin,
		editor,
		page,
	} ) => {
		// Opens a document-settings panel by its title if it is collapsed.
		const openPanel = async ( name ) => {
			const toggle = page.getByRole( 'button', { name, exact: true } );
			await expect( toggle ).toBeVisible();

			if ( ( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
				await toggle.click();
			}
		};

		await admin.createNewPost( { postType: 'resource' } );
		await editor.openDocumentSettingsSidebar();

		await openPanel( 'Resource details' );
		await expect( page.getByLabel( 'Summary' ) ).toBeVisible();
		await expect( page.getByLabel( 'Source URL' ) ).toBeVisible();

		// Types: one radio button per type, so only one can be chosen, and no
		// checkboxes or "Add New Type" form; types are managed on their screen.
		await openPanel( 'Types' );
		const typeRadio = page.getByRole( 'radio', { name: type.name } );
		await expect( typeRadio ).toBeVisible();
		await expect( typeRadio ).not.toBeChecked();
		await typeRadio.check();
		await expect( typeRadio ).toBeChecked();
		await expect(
			page.getByRole( 'button', { name: 'Add New Type' } )
		).toHaveCount( 0 );

		// Flags: nobody can create flags (edit_terms is do_not_allow), so the
		// "Add New Flag" button core's checkbox panel shows to those who can is
		// absent even for an admin. The Featured checkbox proves the panel is
		// open; PHPUnit checks the label is exactly "Add New Flag".
		await openPanel( 'Flags' );
		await expect(
			page.getByRole( 'checkbox', { name: 'Featured' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Add New Flag' } )
		).toHaveCount( 0 );
	} );

	test( 'publishing needs a type, chosen with the radio buttons', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E no type ${ Date.now() }`,
		} );
		// The topic and the summary publishing also needs, set through the
		// store; their panels are the required-fields spec's concern.
		await page.evaluate(
			( topicId ) =>
				window.wp.data.dispatch( 'core/editor' ).editPost( {
					resource_topic: [ topicId ],
					meta: { summary: 'An e2e summary.' },
				} ),
			topic.id
		);

		// With no type, the pre-publish sidebar's Publish button is off: the
		// required-fields plugin locks saving while the sidebar is open, so the
		// editor never sends the server a save that breaks the one-type rule
		// (PHPUnit covers the server's refusal).
		await page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Publish', exact: true } )
			.click();
		await expect(
			page
				.getByRole( 'region', { name: 'Editor publish' } )
				.getByRole( 'button', { name: 'Publish', exact: true } )
		).toHaveAttribute( 'aria-disabled', 'true' );

		const postId = await page.evaluate( () =>
			window.wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		createdIds.push( postId );

		// Choose the type in the Types panel and publish: the radio's choice
		// is what the save sends, so the server accepts it. (The URL's shape
		// is PHPUnit's to check: the tests site has plain permalinks.)
		await page
			.getByRole( 'region', { name: 'Editor publish' } )
			.getByRole( 'button', { name: 'Cancel' } )
			.click();
		await editor.openDocumentSettingsSidebar();
		const typesPanel = page.getByRole( 'button', {
			name: 'Types',
			exact: true,
		} );
		if ( ( await typesPanel.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
			await typesPanel.click();
		}
		await page.getByRole( 'radio', { name: type.name } ).check();
		await editor.publishPost();

		const saved = await requestUtils.rest( {
			path: `/wp/v2/resources/${ postId }`,
			params: { context: 'edit' },
		} );
		expect( saved.status ).toBe( 'publish' );
		expect( saved.resource_type ).toEqual( [ type.id ] );
	} );
} );
