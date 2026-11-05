/**
 * Revalidation feedback for editors (ADRs 0018, 0019): publishing a resource
 * in the block editor shows the revalidation notice, and the status page's
 * "Send test revalidation" button is disabled until a resource is published.
 *
 * The tests site has no front-end URL or secret, so every send is recorded
 * as "not configured" straight away, with no cron involved. That is the
 * outcome these tests expect. The status page test assumes no other
 * published resource is left on the tests site; PHPUnit resets it before the
 * suite, and every spec deletes what it creates.
 */
const { test, expect } = require( './fixtures' );

const NOT_CONFIGURED =
	'Revalidation skipped: the front-end URL or the secret is not configured.';

test.describe( 'Revalidation feedback', () => {
	let type;
	const createdIds = [];

	test.beforeAll( async ( { requestUtils } ) => {
		const stamp = Date.now();
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: { name: `E2E type ${ stamp }`, slug: `e2e-type-${ stamp }` },
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
	} );

	test( 'publishing in the editor shows the revalidation notice, and reloading shows it again', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E revalidation ${ Date.now() }`,
		} );
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

		const postId = await page.evaluate( () =>
			window.wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		createdIds.push( postId );

		// The editor's own notice list, not the screen-reader copy of it.
		const content = page.getByRole( 'region', { name: 'Editor content' } );
		await expect( content.getByText( NOT_CONFIGURED ) ).toBeVisible();

		// The record is on the resource, readable in the edit context only.
		const saved = await requestUtils.rest( {
			path: `/wp/v2/resources/${ postId }`,
			params: { context: 'edit', _fields: 'rh_last_revalidation' },
		} );
		expect( saved.rh_last_revalidation.outcome ).toBe( 'not_configured' );
		expect( saved.rh_last_revalidation.event ).toBe( 'publish' );

		// A failure is shown again when the editor loads the resource.
		await admin.editPost( postId );
		await expect(
			page
				.getByRole( 'region', { name: 'Editor content' } )
				.getByText( NOT_CONFIGURED )
		).toBeVisible();
	} );

	test( 'the status page enables the test button only when a resource is published, and the test records its result', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const visit = () =>
			admin.visitAdminPage( 'options-general.php', 'page=resource-hub' );

		// Leave the resources the first test made out of the picture.
		for ( const id of createdIds.splice( 0 ) ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}

		await visit();
		await expect(
			page.getByRole( 'heading', { name: 'Revalidation status' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Send test revalidation' } )
		).toBeDisabled();
		await expect(
			page.getByText(
				'The button is disabled because no resource is published'
			)
		).toBeVisible();

		const stamp = Date.now();
		const published = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E status page ${ stamp }`,
				slug: `e2e-status-page-${ stamp }`,
				status: 'publish',
				resource_type: [ type.id ],
			},
		} );
		createdIds.push( published.id );

		await visit();
		const button = page.getByRole( 'button', {
			name: 'Send test revalidation',
		} );
		await expect( button ).toBeEnabled();
		await expect( page.getByLabel( 'Resource to send' ) ).toContainText(
			`Most recently modified: E2E status page ${ stamp }`
		);

		await button.click();
		await expect( page.getByText( NOT_CONFIGURED ).first() ).toBeVisible();
		await expect(
			page.getByRole( 'link', { name: `E2E status page ${ stamp }` } )
		).toBeVisible();

		const record = await requestUtils.rest( {
			path: `/wp/v2/resources/${ published.id }`,
			params: { context: 'edit', _fields: 'rh_last_revalidation' },
		} );
		expect( record.rh_last_revalidation.event ).toBe( 'update' );
		expect( record.rh_last_revalidation.outcome ).toBe( 'not_configured' );
	} );

	test( 'Enter in the picker search runs the search and sends nothing', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const stamp = Date.now();

		for ( const name of [ 'Searched', 'Newest' ] ) {
			const created = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/resources',
				data: {
					title: `E2E ${ name } ${ stamp }`,
					status: 'publish',
					resource_type: [ type.id ],
				},
			} );
			createdIds.push( created.id );
		}

		const sends = [];
		page.on( 'request', ( request ) => {
			if ( request.url().includes( 'admin-post.php' ) ) {
				sends.push( request.url() );
			}
		} );

		await admin.visitAdminPage(
			'options-general.php',
			'page=resource-hub'
		);
		const search = page.getByRole( 'searchbox', {
			name: 'Find a resource',
		} );
		await expect( search ).toHaveAccessibleDescription(
			/Type to search the published resources/
		);

		await search.fill( `E2E Searched ${ stamp }` );
		await search.press( 'Enter' );

		const status = page.getByRole( 'status' );
		await expect( status ).toHaveText( '1 resource found' );
		await expect( page.getByLabel( 'Resource to send' ) ).toContainText(
			`E2E Searched ${ stamp }`
		);
		expect( sends ).toEqual( [] );
		await expect( page ).not.toHaveURL( /rh_test=/ );

		await search.fill( `no-such-resource-${ stamp }` );
		await search.press( 'Enter' );
		await expect( status ).toHaveText( 'No matches' );
		expect( sends ).toEqual( [] );
	} );
} );
