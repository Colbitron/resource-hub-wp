/**
 * The Related Resources block in the editor: inserted into a page, it asks
 * for a topic; once one is chosen, the canvas shows the server render, the
 * contract's marker (issue #50; `packages/ui/README.md`, "Block marker") with
 * the newest resources in that topic as card rows and the page being edited
 * as the host.
 * The stylesheet `block.json` names is loaded with it.
 */
const { test, expect } = require( './fixtures' );

test.describe( 'Related Resources block', () => {
	let stamp;
	let type;
	let topic;
	const resources = [];
	const pageIds = [];

	test.beforeAll( async ( { requestUtils } ) => {
		stamp = Date.now();
		// PHPUnit leaves the tests site with no types and no topics, and a
		// published resource needs a title, exactly one type, a topic and a
		// summary (OneType, RequiredFields), so the suite brings all four.
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: { name: `E2E type ${ stamp }`, slug: `e2e-type-${ stamp }` },
		} );
		topic = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_topic',
			data: {
				name: `E2E topic ${ stamp }`,
				slug: `e2e-topic-${ stamp }`,
			},
		} );
		for ( const word of [ 'one', 'two' ] ) {
			resources.push(
				await requestUtils.rest( {
					method: 'POST',
					path: '/wp/v2/resources',
					data: {
						title: `E2E related ${ word } ${ stamp }`,
						slug: `e2e-related-${ word }-${ stamp }`,
						status: 'publish',
						resource_type: [ type.id ],
						resource_topic: [ topic.id ],
						meta: { summary: `E2E summary ${ word }.` },
					},
				} )
			);
		}
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of pageIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/pages/${ id }`,
				params: { force: true },
			} );
		}
		for ( const resource of resources ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ resource.id }`,
				params: { force: true },
			} );
		}
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_topic/${ topic.id }`,
			params: { force: true },
		} );
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_type/${ type.id }`,
			params: { force: true },
		} );
	} );

	test( 'inserted in a page, choosing a topic shows the server preview', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost( {
			postType: 'page',
			title: `E2E related block ${ stamp }`,
		} );
		pageIds.push(
			await page.evaluate( () =>
				window.wp.data.select( 'core/editor' ).getCurrentPostId()
			)
		);

		await editor.insertBlock( { name: 'resource-hub/related-resources' } );
		const block = editor.canvas.getByRole( 'document', {
			name: 'Block: Related Resources',
		} );

		// No topic yet: a placeholder, not an empty render.
		await expect(
			block.getByText(
				'Choose a topic. The block lists the newest resources'
			)
		).toBeVisible();
		await expect(
			block.locator( '[data-rh-block="related-resources"]' )
		).toHaveCount( 0 );

		// The block's stylesheet, the shared package's row, is loaded in the
		// canvas because the block is in it; its tokens come from the shared
		// `resource-hub-tokens` handle (theme-assets.spec.js counts them).
		await expect(
			editor.canvas.locator(
				'link[rel="stylesheet"][href*="build/related-resources/style-index"]'
			)
		).toHaveCount( 1 );

		// Pick the topic in the canvas placeholder, which does not depend on
		// which tab the settings sidebar opens on.
		await block
			.getByRole( 'combobox', { name: 'Topic' } )
			.selectOption( { label: topic.name } );

		// The server render: the marker with its attributes, the default
		// heading, and the two resources, newest first.
		const marker = block.locator( '[data-rh-block="related-resources"]' );
		await expect( marker ).toBeVisible();
		await expect( marker ).toHaveClass( /(^| )rh-related( |$)/ );
		await expect( marker ).toHaveAttribute( 'data-count', '3' );
		await expect( marker ).toHaveAttribute( 'data-topic', topic.slug );
		await expect( marker ).toHaveAttribute(
			'data-topic-id',
			String( topic.id )
		);
		await expect( marker ).toHaveAttribute(
			'data-exclude',
			String( pageIds[ 0 ] )
		);
		await expect( marker.getByRole( 'heading', { level: 2 } ) ).toHaveText(
			`More on ${ topic.name }`
		);
		// The rows are card.css's markup, titles at h3 under the block's h2,
		// each title the row's one link.
		const rows = marker.locator( 'ul.rh-card-grid > li > article.rh-card' );
		await expect( rows ).toHaveCount( 2 );
		await expect(
			rows.getByRole( 'heading', { level: 3 } ).getByRole( 'link' )
		).toHaveText( [
			`E2E related two ${ stamp }`,
			`E2E related one ${ stamp }`,
		] );
		await expect(
			rows.first().locator( 'a.rh-card__link' )
		).toHaveAttribute( 'href', resources[ 1 ].link );
		await expect( rows.first().locator( '.rh-card__type' ) ).toHaveText(
			type.name
		);
		await expect(
			rows.first().getByRole( 'list', { name: 'Topics' } )
		).toHaveText( topic.name );

		// Count and heading are in the inspector: open the sidebar on the
		// block's tab, since it may open on the page's.
		await editor.openDocumentSettingsSidebar();
		const settings = page.getByRole( 'region', {
			name: 'Editor settings',
		} );
		await settings.getByRole( 'tab', { name: 'Block' } ).click();

		await settings
			.getByRole( 'slider', { name: 'Number of resources' } )
			.fill( '1' );
		await expect( marker ).toHaveAttribute( 'data-count', '1' );
		await expect( rows ).toHaveCount( 1 );

		await settings
			.getByRole( 'textbox', { name: 'Heading' } )
			.fill( 'Keep reading' );
		await expect( marker.getByRole( 'heading', { level: 2 } ) ).toHaveText(
			'Keep reading'
		);
	} );
} );
