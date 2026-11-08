/**
 * The Resource Card block in a Query Loop: on the CMS's own page, for a
 * logged-in user, each listed resource is a `card.css` row, styled by the
 * shared `resource-hub-card` stylesheet on the shared tokens, and a page that
 * also has the related-resources block loads that stylesheet once; in the
 * editor, the post template's block previews are the server's rows and log
 * no console error. The markup
 * itself is held to the front end's by the contract's markup fixtures
 * (`MarkupParityTest`, `apps/web/test/markup-parity.test.tsx`).
 */
const { test, expect } = require( './fixtures' );

// A Query Loop of published resources, its post template the front end's row list.
const CONTENT =
	'<!-- wp:query {"queryId":1,"query":{"perPage":20,"pages":0,"offset":0,"postType":"resource","order":"desc","orderBy":"date","inherit":false}} -->' +
	'<div class="wp-block-query"><!-- wp:post-template {"className":"rh-card-grid"} -->' +
	'<!-- wp:resource-hub/resource-card /-->' +
	'<!-- /wp:post-template --></div><!-- /wp:query -->';

test.describe( 'Resource Card block', () => {
	let stamp;
	let type;
	let topic;
	let host;
	let both;
	const resources = [];

	test.beforeAll( async ( { requestUtils } ) => {
		stamp = Date.now();
		// A published resource needs a title, one type, a topic and a summary (OneType, RequiredFields).
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
						title: `E2E card ${ word } ${ stamp }`,
						slug: `e2e-card-${ word }-${ stamp }`,
						status: 'publish',
						resource_type: [ type.id ],
						resource_topic: [ topic.id ],
						meta: { summary: `E2E summary ${ word }.` },
					},
				} )
			);
		}
		host = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E card list ${ stamp }`,
				status: 'publish',
				content: CONTENT,
			},
		} );
		// The related-resources block's rows and the card rows on one page.
		both = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E card list and related ${ stamp }`,
				status: 'publish',
				content: `<!-- wp:resource-hub/related-resources {"topic":${ topic.id }} /-->${ CONTENT }`,
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of [ host.id, both.id ] ) {
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

	test( 'the CMS page renders each resource as a styled row', async ( {
		page,
	} ) => {
		await page.goto( host.link );

		const list = page.locator( 'ul.rh-card-grid' );
		await expect( list ).toHaveCount( 1 );

		for ( const resource of resources ) {
			const row = list.locator( 'article.rh-card', {
				has: page.getByRole( 'link', { name: resource.title.raw } ),
			} );
			await expect( row ).toHaveCount( 1 );
			await expect( row.getByRole( 'heading', { level: 2 } ) ).toHaveText(
				resource.title.raw
			);
			await expect( row.locator( '.rh-card__type' ) ).toHaveText(
				type.name
			);
			await expect(
				row.getByRole( 'list', { name: 'Topics' } )
			).toHaveText( topic.name );
		}

		// The shared row stylesheet, once, as a link: it has no `path` data,
		// so core never inlines it, and the block has no stylesheet of its own.
		await expect(
			page.locator(
				'link#resource-hub-card-css[href*="build/shared/card.css"]'
			)
		).toHaveCount( 1 );
		await expect(
			page.locator( '[id^="resource-hub-resource-card-style"]' )
		).toHaveCount( 0 );

		// Styled: the tokens resolve, the list's hairlines, the row's layout and its labels apply, and the type's mark is drawn.
		const styles = await list
			.locator( 'article.rh-card' )
			.first()
			.evaluate( ( row ) => {
				const label = row.querySelector( '.rh-card__type' );
				const mark = window.getComputedStyle( label, '::before' );
				return {
					token: window
						.getComputedStyle( document.documentElement )
						.getPropertyValue( '--rh-color-text' )
						.trim(),
					display: window.getComputedStyle( row ).display,
					hairline: window.getComputedStyle( row.parentElement )
						.borderBottomStyle,
					transform: window.getComputedStyle( label ).textTransform,
					markWidth: parseFloat( mark.width ),
					listStyle: window.getComputedStyle(
						row.querySelector( '.rh-card__topics' )
					).listStyleType,
				};
			} );
		expect( styles.token ).not.toBe( '' );
		expect( styles.display ).toBe( 'flex' );
		expect( styles.hairline ).toBe( 'solid' );
		expect( styles.transform ).toBe( 'uppercase' );
		expect( styles.markWidth ).toBeGreaterThan( 0 );
		expect( styles.listStyle ).toBe( 'none' );
	} );

	test( 'a page with the related block and the cards loads card.css once', async ( {
		page,
	} ) => {
		await page.goto( both.link );

		await expect(
			page.locator(
				'[data-rh-block="related-resources"] article.rh-card'
			)
		).toHaveCount( resources.length );
		await expect(
			page.locator(
				'ul.rh-card-grid.wp-block-post-template article.rh-card'
			)
		).toHaveCount( resources.length );

		// One link to the shared copy, no block stylesheet of either block's own.
		await expect(
			page.locator(
				'link[rel="stylesheet"][href*="build/shared/card.css"]'
			)
		).toHaveCount( 1 );
		await expect(
			page.locator(
				'[id^="resource-hub-related-resources-style"], [id^="resource-hub-resource-card-style"]'
			)
		).toHaveCount( 0 );

		// Every rule in the document, `@import`ed sheets included: the row's
		// rules and its labels' are each declared once.
		const counts = await page.evaluate( () => {
			const found = { body: 0, type: 0 };
			const walk = ( rules ) => {
				for ( const rule of rules ) {
					if ( rule.styleSheet ) {
						walk( rule.styleSheet.cssRules );
					} else if ( rule.cssRules && ! rule.selectorText ) {
						walk( rule.cssRules );
					} else if ( rule.selectorText === '.rh-card__body' ) {
						found.body++;
					} else if ( rule.selectorText === '.rh-card__type' ) {
						found.type++;
					}
				}
			};
			for ( const sheet of document.styleSheets ) {
				walk( sheet.cssRules );
			}
			return found;
		} );
		expect( counts ).toEqual( { body: 1, type: 1 } );
	} );

	test( 'the editor previews each row from the server with no console error', async ( {
		admin,
		editor,
		page,
	} ) => {
		const errors = [];
		page.on( 'console', ( message ) => {
			if ( message.type() === 'error' ) {
				errors.push( message.text() );
			}
		} );
		page.on( 'pageerror', ( error ) => errors.push( error.message ) );

		await admin.editPost( host.id );

		// The first post's block is the editable one, a ServerSideRender
		// preview; the others are the post template's previews of the same
		// edit component. Each is sent its own post, so each shows its row.
		for ( const resource of resources ) {
			await expect(
				editor.canvas.locator( 'article.rh-card', {
					has: editor.canvas.getByRole( 'link', {
						name: resource.title.raw,
					} ),
				} )
			).toHaveCount( 1 );
		}
		await expect(
			editor.canvas.locator(
				'link[rel="stylesheet"][href*="build/shared/card.css"]'
			)
		).toHaveCount( 1 );
		await expect(
			editor.canvas.locator( 'article.rh-card .rh-card__type' ).first()
		).toHaveCSS( 'text-transform', 'uppercase' );

		expect( errors ).toEqual( [] );
	} );
} );
