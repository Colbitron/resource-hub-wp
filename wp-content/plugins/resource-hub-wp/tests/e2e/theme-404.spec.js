/**
 * The lockdown's 404 is rendered with the `resource-hub` theme's 404
 * template (`src/Lockdown/Gate.php`), and issue #89 sets two rules for it:
 * it lists no pages, because a navigation block's fallback lists every
 * published page and would show anonymous visitors what exists; and it
 * points at no pingback endpoint, neither a `<link rel="pingback">` in the
 * head nor an `X-Pingback` header.
 *
 * The site is given a published page, a resource and a post open to pings,
 * each with a title no fixed text contains, and a type and a topic with such
 * names, so a listing, a title or a term on the 404 would show up. Each is asked for as an anonymous visitor at a path that
 * would otherwise render it, and the 404 is read twice: as HTML from a request
 * context, for the head and the headers, and in a browser with no session,
 * for what a visitor's accessibility tree shows. The theme's own lockup is
 * checked first in each, so a blank or foreign page cannot pass. The paths
 * work under any permalink structure, since `?page_id=` and `?p=` are 404s
 * like every pretty path, and the resource is asked for at its own link.
 */
const { request } = require( '@playwright/test' );
const { test: base, expect } = require( './fixtures' );

const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend( {
	// No cookies and no redirects followed, as in lockdown.spec.js.
	anonymous: [
		async ( { baseURL }, use ) => {
			const context = await request.newContext( {
				baseURL,
				maxRedirects: 0,
				storageState: NO_SESSION,
			} );
			await use( context );
			await context.dispose();
		},
		{ scope: 'test' },
	],
	anonymousPage: [
		async ( { browser, baseURL }, use ) => {
			const context = await browser.newContext( {
				baseURL,
				storageState: NO_SESSION,
			} );
			const page = await context.newPage();
			await use( page );
			await context.close();
		},
		{ scope: 'test' },
	],
} );

test.describe( "The theme's 404 for anonymous visitors", () => {
	const stamp = Date.now();
	const titles = {
		page: `E2E listed page ${ stamp }`,
		post: `E2E pinged post ${ stamp }`,
		resource: `E2E hidden resource ${ stamp }`,
	};
	let page;
	let post;
	let type;
	let topic;
	let resource;
	let paths;

	// Every title and term name the site was given, none of which a 404 may show.
	const hiddenNames = () => [
		...Object.values( titles ),
		type.name,
		topic.name,
	];

	test.beforeAll( async ( { requestUtils } ) => {
		page = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: { title: titles.page, status: 'publish' },
		} );
		post = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/posts',
			data: {
				title: titles.post,
				status: 'publish',
				ping_status: 'open',
			},
		} );
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
		// A published resource needs all four fields (OneType, RequiredFields).
		resource = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: titles.resource,
				status: 'publish',
				resource_type: [ type.id ],
				resource_topic: [ topic.id ],
				meta: { summary: 'An e2e summary.' },
			},
		} );

		paths = [
			'/',
			`/?page_id=${ page.id }`,
			`/?p=${ post.id }`,
			resource.link,
			`/e2e-no-such-path-${ stamp }/`,
		];
	} );

	test.afterAll( async ( { requestUtils } ) => {
		// Guarded, so a beforeAll that failed part-way reports its own error, not a TypeError here.
		const created = [
			[ 'resources', resource ],
			[ 'resource_type', type ],
			[ 'resource_topic', topic ],
			[ 'posts', post ],
			[ 'pages', page ],
		];
		for ( const [ route, item ] of created ) {
			if ( item?.id ) {
				await requestUtils.rest( {
					method: 'DELETE',
					path: `/wp/v2/${ route }/${ item.id }`,
					params: { force: true },
				} );
			}
		}
	} );

	test( 'has no pingback link or header, no navigation and no titles in its HTML', async ( {
		anonymous,
	} ) => {
		for ( const path of paths ) {
			const response = await anonymous.get( path );
			const headers = response.headers();
			const html = await response.text();

			expect( response.status(), path ).toBe( 404 );
			expect( html, path ).toContain( 'class="rh-brand"' );
			expect( html, path ).toContain( 'Page not found' );

			expect( headers[ 'x-pingback' ], path ).toBeUndefined();
			expect( html, path ).not.toMatch( /rel\s*=\s*["']?pingback/i );
			expect( html, path ).not.toContain( 'xmlrpc.php' );

			expect( html, path ).not.toMatch( /<nav\b/i );
			expect( html, path ).not.toContain( 'wp-block-navigation' );
			expect( html, path ).not.toContain( 'wp-block-page-list' );
			for ( const name of hiddenNames() ) {
				expect( html, path ).not.toContain( name );
			}
		}
	} );

	test( 'shows a visitor the lockup and the message, and no navigation or titles', async ( {
		anonymousPage,
	} ) => {
		for ( const path of paths ) {
			const response = await anonymousPage.goto( path );

			expect( response.status(), path ).toBe( 404 );
			await expect(
				anonymousPage.getByRole( 'link', { name: 'Resource Hub' } ),
				path
			).toBeVisible();
			await expect(
				anonymousPage.getByRole( 'heading', {
					level: 1,
					name: 'Page not found',
				} ),
				path
			).toBeVisible();

			await expect(
				anonymousPage.getByRole( 'navigation' ),
				path
			).toHaveCount( 0 );
			for ( const name of hiddenNames() ) {
				await expect(
					anonymousPage.getByText( name ),
					path
				).toHaveCount( 0 );
			}
			await expect(
				anonymousPage.locator( 'link[rel="pingback"]' ),
				path
			).toHaveCount( 0 );
		}
	} );

	test( 'a logged-in user still sees the page, through the index template', async ( {
		page: browserPage,
	} ) => {
		const response = await browserPage.goto( `/?page_id=${ page.id }` );

		expect( response.status() ).toBe( 200 );
		await expect(
			browserPage.getByRole( 'link', { name: 'Resource Hub' } )
		).toBeVisible();
		await expect(
			browserPage.getByRole( 'heading', { name: titles.page } )
		).toBeVisible();
	} );
} );
