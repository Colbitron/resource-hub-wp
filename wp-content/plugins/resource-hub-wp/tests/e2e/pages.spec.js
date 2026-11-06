/**
 * The page route (ADR 0052) against wp-env: an anonymous reader learns which
 * published page the front end serves at a path, the static front page is
 * answered at `/` once Settings > Reading names it, a top-level page asking
 * for a reserved slug gets a suffix, and the CMS's own theme page for `/`
 * stays a 404 for anonymous visitors (ADR 0031).
 */
const { request } = require( '@playwright/test' );
const { test: base, expect } = require( './fixtures' );

const test = base.extend( {
	anonymous: [
		async ( { baseURL }, use ) => {
			const context = await request.newContext( {
				baseURL,
				maxRedirects: 0,
				storageState: { cookies: [], origins: [] },
			} );
			await use( context );
			await context.dispose();
		},
		{ scope: 'test' },
	],
} );

/**
 * The route as a `rest_route` query, because PHPUnit's reinstall leaves the
 * tests site with plain permalinks, under which `/wp-json/` is a 404.
 */
const ROUTE = '/resource-hub/v1/page';

function lookup( context, path ) {
	return context.get( '/', { params: { rest_route: ROUTE, path } } );
}

test.describe( 'the page route', () => {
	let stamp;
	let home;
	let about;
	let team;
	let collision;

	test.beforeAll( async ( { requestUtils } ) => {
		stamp = Date.now();
		home = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E home ${ stamp }`,
				slug: `e2e-home-${ stamp }`,
				status: 'publish',
			},
		} );
		about = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E about ${ stamp }`,
				slug: `e2e-about-${ stamp }`,
				status: 'publish',
			},
		} );
		team = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E team ${ stamp }`,
				slug: `e2e-team-${ stamp }`,
				status: 'publish',
				parent: about.id,
			},
		} );
		collision = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E collision ${ stamp }`,
				slug: 'resources',
				status: 'publish',
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/settings',
			data: { show_on_front: 'posts', page_on_front: 0 },
		} );
		for ( const page of [ team, about, home, collision ] ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/pages/${ page.id }`,
				params: { force: true },
			} );
		}
	} );

	test( 'answers a nested page by its chain, a wrong parent with a unique slug by its current path, and the root with null', async ( {
		anonymous,
	} ) => {
		const nested = await lookup(
			anonymous,
			`/${ about.slug }/${ team.slug }/`
		);
		expect( nested.status() ).toBe( 200 );
		expect( nested.headers()[ 'cache-control' ] ).toBe(
			'no-cache, must-revalidate, max-age=0'
		);
		expect( await nested.json() ).toEqual( {
			page: { id: team.id, path: `/${ about.slug }/${ team.slug }/` },
		} );

		const moved = await lookup( anonymous, `/${ team.slug }/` );
		expect( await moved.json() ).toEqual( {
			page: { id: team.id, path: `/${ about.slug }/${ team.slug }/` },
		} );

		const root = await lookup( anonymous, '/' );
		expect( root.status() ).toBe( 200 );
		expect( await root.json() ).toEqual( { page: null } );
	} );

	test( 'answers the static front page at / once Settings > Reading names it, and its own slug as /', async ( {
		anonymous,
		requestUtils,
	} ) => {
		await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/settings',
			data: { show_on_front: 'page', page_on_front: home.id },
		} );

		for ( const path of [ '/', `/${ home.slug }/` ] ) {
			const response = await lookup( anonymous, path );
			expect( response.status(), path ).toBe( 200 );
			expect( await response.json(), path ).toEqual( {
				page: { id: home.id, path: '/' },
			} );
		}

		// The CMS's own page for `/` is still for logged-in users only (ADR 0031).
		const theme = await anonymous.get( '/' );
		expect( theme.status() ).toBe( 404 );
		expect( theme.headers().location ).toBeUndefined();
	} );

	test( 'a top-level page asking for a reserved slug is saved with a suffix', async () => {
		expect( collision.slug ).toBe( 'resources-2' );
	} );
} );
