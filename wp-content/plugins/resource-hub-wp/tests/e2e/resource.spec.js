/**
 * The content model over REST and in the editor: a resource created with meta
 * and the featured flag comes back through the flag-filtered collection, and
 * the editor shows the "Resource details" panel for the post type, a Types
 * panel an administrator can add to, and a Flags panel nobody can add to.
 */
const { test, expect } = require( './fixtures' );

test.describe( 'Resource content model', () => {
	let featuredId;
	const createdIds = [];

	test.beforeAll( async ( { requestUtils } ) => {
		const flags = await requestUtils.rest( {
			path: '/wp/v2/resource_flag',
			params: { slug: 'featured' },
		} );
		featuredId = flags[ 0 ].id;
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of createdIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}
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

		// Types: an administrator can add a type, so the button shows with the
		// taxonomy's own label. This is the control for the Flags check below: it
		// proves the label is real and the selector finds the button when present.
		await openPanel( 'Types' );
		await expect(
			page.getByRole( 'button', { name: 'Add New Type' } )
		).toBeVisible();

		// Flags: nobody can create flags (edit_terms is do_not_allow), so the
		// same button, with the flag's own label, is absent even for an admin.
		await openPanel( 'Flags' );
		await expect(
			page.getByRole( 'checkbox', { name: 'Featured' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Add New Flag' } )
		).toHaveCount( 0 );
	} );
} );
