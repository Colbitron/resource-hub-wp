/**
 * The CMS's theme pages are for logged-in users only (ADR 0031): an
 * anonymous visitor gets a 404 with no redirect from a resource, the front
 * page, the feed and the sitemap; robots.txt stays reachable and disallows
 * everything; a logged-in user still sees the resource; the REST API stays
 * public and says noindex; and an upload is served by the web server, which
 * the plugin cannot touch.
 *
 * PHPUnit's reinstall leaves the tests site with plain permalinks, under
 * which core has no rewrite rules, so `/feed/`, `/wp-sitemap.xml` and
 * `/robots.txt` would all be the home page, and with no theme, so nothing
 * would render at all. The suite puts the site in the host's shape first:
 * the bundled block theme, and the host's permalink structure through the
 * Permalinks screen, because the settings endpoint does not expose it.
 */
const { request } = require( '@playwright/test' );
const { test: base, expect } = require( './fixtures' );

const test = base.extend( {
	// An anonymous visitor: a request context with no cookies, that does not
	// follow redirects, so a Location header would show up. The empty storage
	// state is explicit because the test runner applies the project's `use`
	// options, the logged-in storage state among them, to contexts created
	// here too.
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

// A 1×1 transparent PNG.
const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

async function usePrettyPermalinks( requestUtils ) {
	const screen = await requestUtils.request.get(
		'/wp-admin/options-permalink.php'
	);
	const nonce = ( await screen.text() ).match(
		/name="_wpnonce" value="([^"]+)"/
	)[ 1 ];

	await requestUtils.request.post( '/wp-admin/options-permalink.php', {
		form: {
			_wpnonce: nonce,
			permalink_structure: '/%postname%/',
			category_base: '',
			tag_base: '',
		},
	} );
}

test.describe( 'CMS lockdown', () => {
	let type;
	let resource;

	test.beforeAll( async ( { requestUtils } ) => {
		await requestUtils.activateTheme( 'twentytwentyfive' );
		await usePrettyPermalinks( requestUtils );

		const stamp = Date.now();
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: { name: `E2E type ${ stamp }`, slug: `e2e-type-${ stamp }` },
		} );
		resource = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E locked ${ stamp }`,
				slug: `e2e-locked-${ stamp }`,
				status: 'publish',
				resource_type: [ type.id ],
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resources/${ resource.id }`,
			params: { force: true },
		} );
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_type/${ type.id }`,
			params: { force: true },
		} );
	} );

	test( 'an anonymous visitor gets a 404 page and no redirect', async ( {
		anonymous,
	} ) => {
		expect( resource.link ).toContain( `/resources/${ type.slug }/` );

		const paths = [
			resource.link,
			'/',
			'/feed/',
			'/wp-sitemap.xml',
			`/?p=${ resource.id }`,
			'/?feed=rss2',
			'/?sitemap=index',
		];

		for ( const path of paths ) {
			const response = await anonymous.get( path );
			const headers = response.headers();

			expect( response.status(), path ).toBe( 404 );
			expect( headers.location, path ).toBeUndefined();
			expect( headers[ 'content-type' ], path ).toContain( 'text/html' );
			expect( headers[ 'x-robots-tag' ], path ).toBe( 'noindex' );
		}
	} );

	test( 'the 404 page links to no feed and no RSD endpoint', async ( {
		anonymous,
	} ) => {
		const response = await anonymous.get( resource.link );
		const html = await response.text();

		expect( response.status() ).toBe( 404 );
		expect( html ).not.toContain( 'application/rss+xml' );
		expect( html ).not.toContain( 'EditURI' );
		expect( html ).not.toContain( '/feed/' );
	} );

	test( 'robots.txt is reachable and disallows everything', async ( {
		anonymous,
	} ) => {
		// A parameter that is not a query var never reaches WordPress's query.
		for ( const path of [
			'/robots.txt',
			'/robots.txt?utm_source=probe',
		] ) {
			const response = await anonymous.get( path );

			expect( response.status(), path ).toBe( 200 );
			expect( response.headers()[ 'content-type' ], path ).toContain(
				'text/plain'
			);
			expect( await response.text(), path ).toBe(
				'User-agent: *\nDisallow: /\n'
			);
		}
	} );

	test( 'the robots query var exempts nothing but robots.txt', async ( {
		anonymous,
		requestUtils,
	} ) => {
		const media = await requestUtils.uploadMedia( {
			name: 'e2e-robots-pixel.png',
			mimeType: 'image/png',
			buffer: PIXEL,
		} );

		try {
			const paths = [
				'/wp-sitemap.xml?robots=1',
				'/wp-sitemap-posts-resource-1.xml?robots=1',
				'/wp-sitemap-users-1.xml?robots=1',
				'/?robots=1&sitemap=index',
				`/?attachment_id=${ media.id }&robots=1`,
				'/?robots=1&feed=rss2',
				'/robots.txt?feed=rss2',
			];

			for ( const path of paths ) {
				const response = await anonymous.get( path );
				const headers = response.headers();

				expect( response.status(), path ).toBe( 404 );
				expect( headers.location, path ).toBeUndefined();
				expect( headers[ 'content-type' ], path ).toContain(
					'text/html'
				);
				expect( headers[ 'last-modified' ], path ).toBeUndefined();
				expect( headers.etag, path ).toBeUndefined();
				expect( await response.text(), path ).not.toContain(
					'/author/'
				);
			}
		} finally {
			await requestUtils.deleteMedia( media.id );
		}
	} );

	test( 'the admin and the login page still work for an anonymous visitor', async ( {
		anonymous,
	} ) => {
		// The redirect guards are registered only for requests the gate sees, which these are not.
		const admin = await anonymous.get( '/wp-admin/' );

		expect( admin.status() ).toBe( 302 );
		expect( admin.headers().location ).toContain( '/wp-login.php' );

		for ( const path of [
			'/wp-login.php',
			'/wp-login.php?action=lostpassword',
		] ) {
			const response = await anonymous.get( path );

			expect( response.status(), path ).toBe( 200 );
			expect( await response.text(), path ).toContain(
				'id="user_login"'
			);
		}
	} );

	test( 'a logged-in user sees the resource, marked noindex, with no oEmbed links', async ( {
		page,
	} ) => {
		const response = await page.goto( resource.link );

		expect( response.status() ).toBe( 200 );
		expect( page.url() ).toBe( resource.link );
		expect( response.headers()[ 'x-robots-tag' ] ).toBe( 'noindex' );
		await expect( page.locator( 'meta[name="robots"]' ) ).toHaveAttribute(
			'content',
			/noindex/
		);
		await expect(
			page.locator( 'link[type="application/json+oembed"]' )
		).toHaveCount( 0 );
	} );

	test( 'a logged-in user still gets the sitemap', async ( { page } ) => {
		const response = await page.request.get( '/wp-sitemap.xml', {
			maxRedirects: 0,
		} );

		expect( response.status() ).toBe( 200 );
		expect( response.headers()[ 'content-type' ] ).toContain(
			'application/xml'
		);
		expect( await response.text() ).toContain( '<sitemapindex' );
	} );

	test( 'the REST API stays public and says noindex', async ( {
		anonymous,
	} ) => {
		const response = await anonymous.get( '/wp-json/wp/v2/resources', {
			params: { include: resource.id },
		} );

		expect( response.status() ).toBe( 200 );
		expect( response.headers()[ 'x-robots-tag' ] ).toBe( 'noindex' );
		expect( ( await response.json() ).map( ( item ) => item.id ) ).toEqual(
			[ resource.id ]
		);
	} );

	test( 'an upload is served by the web server, not by WordPress', async ( {
		anonymous,
		requestUtils,
	} ) => {
		const media = await requestUtils.uploadMedia( {
			name: 'e2e-pixel.png',
			mimeType: 'image/png',
			buffer: PIXEL,
		} );

		try {
			const response = await anonymous.get( media.source_url );

			expect( media.source_url ).toContain( '/wp-content/uploads/' );
			expect( response.status() ).toBe( 200 );
			expect( response.headers()[ 'content-type' ] ).toBe( 'image/png' );
			expect( response.headers()[ 'x-robots-tag' ] ).toBeUndefined();
		} finally {
			await requestUtils.deleteMedia( media.id );
		}
	} );
} );
