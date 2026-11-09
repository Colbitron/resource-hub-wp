/**
 * The CMS theme's header search control, as a logged-in editor sees it: the
 * header part's link (`parts/header.html`), the theme's inline script
 * (`js/header-search.js`, printed by `inc/header-search.php`), the bar it
 * opens, and what each kind of reader gets. The front end's
 * `apps/web/e2e/header-search.spec.ts` checks the same control on the site;
 * this spec holds the CMS to the same behaviour, with the differences the CMS
 * has: the admin bar above the shell, core's query var `s`, the stylesheets
 * added as `<link>`s rather than a module, and the 404 that has no control.
 *
 * The tests site has plain permalinks, so `/search/` on its own is not a
 * path it answers (PHPUnit's `SearchPathTest` covers the plugin's rewrite
 * rules under pretty permalinks); a submitted form lands on `/search/?s=…`,
 * which core answers whatever the permalink structure, and the search page
 * is reached that way here.
 */
const { request } = require( '@playwright/test' );
const { default: AxeBuilder } = require( '@axe-core/playwright' );
const { test, expect } = require( './fixtures' );

const SCRIPT_ID = 'resource-hub-header-search-js';
const NO_CONTROL_RULE = '.rh-header-search{display:none}';
const PANEL_ID = 'rh-header-search-panel';

/** The front end's accessibility gate's tags (`apps/web/e2e/axe.mts`). */
const WCAG_TAGS = [ 'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa' ];

const NO_SESSION = { cookies: [], origins: [] };

const banner = ( page ) => page.getByRole( 'banner' );
const toggle = ( page ) =>
	banner( page ).getByRole( 'button', { name: 'Search', exact: true } );
const link = ( page ) =>
	banner( page ).getByRole( 'link', { name: 'Search', exact: true } );
const bar = ( page ) => page.locator( `#${ PANEL_ID }` );
const barField = ( page ) =>
	banner( page ).getByRole( 'searchbox', {
		name: 'Search resources and pages',
	} );

async function expectClosed( page ) {
	await expect( toggle( page ) ).toHaveAttribute( 'aria-expanded', 'false' );
	await expect( bar( page ) ).toBeHidden();
}

async function expectOpen( page ) {
	await expect( toggle( page ) ).toHaveAttribute( 'aria-expanded', 'true' );
	await expect( bar( page ) ).toBeVisible();
	await expect( barField( page ) ).toBeFocused();
}

test.describe( "The theme's header search control", () => {
	let first;
	let caching;

	test.beforeAll( async ( { requestUtils } ) => {
		const stamp = Date.now();
		first = await requestUtils.createPage( {
			title: `E2E header search ${ stamp }`,
			content:
				"<!-- wp:paragraph --><p>A page with the header's control.</p><!-- /wp:paragraph -->",
			status: 'publish',
		} );
		caching = await requestUtils.createPage( {
			title: `Quokka on the CMS ${ stamp }`,
			content:
				'<!-- wp:paragraph --><p>A page the search finds.</p><!-- /wp:paragraph -->',
			excerpt: 'Where the CMS keeps its cache.',
			status: 'publish',
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const created of [ first, caching ] ) {
			if ( created?.id ) {
				await requestUtils.rest( {
					method: 'DELETE',
					path: `/wp/v2/pages/${ created.id }`,
					params: { force: true },
				} );
			}
		}
	} );

	test( "is a link in the HTML, with the script inline at the end of the body carrying the form's action and the bar's stylesheets, and only the button's stylesheet loaded", async ( {
		page,
	} ) => {
		const body = await ( await page.request.get( first.link ) ).text();

		expect( body ).toContain(
			'<div class="rh-header-search"><a class="rh-header-search__toggle" href="/search/" aria-label="Search">'
		);
		expect( body ).not.toContain( 'aria-expanded' );
		expect( body ).not.toContain( PANEL_ID );

		const script = body.match(
			new RegExp( `<script[^>]*id="${ SCRIPT_ID }"[^>]*>` )
		)?.[ 0 ];
		expect( script ).toBeDefined();
		expect( body.indexOf( script ) ).toBeGreaterThan(
			body.indexOf( '</main>' )
		);
		expect( script ).toMatch( /data-action="[^"]*\/search\/"/ );
		const styles = JSON.parse(
			script
				.match( /data-styles="([^"]*)"/ )[ 1 ]
				.replace( /&quot;/g, '"' )
				.replace( /&amp;/g, '&' )
		);
		expect( Object.keys( styles ) ).toEqual( [
			'resource-hub-header-search-bar',
			'resource-hub-search',
		] );
		expect( styles[ 'resource-hub-header-search-bar' ] ).toMatch(
			/build\/header-search-bar\.css\?ver=/
		);
		expect( styles[ 'resource-hub-search' ] ).toMatch(
			/build\/search\.css\?ver=/
		);

		expect( body ).toContain( "id='resource-hub-header-search-css'" );
		expect( body ).not.toContain( 'resource-hub-header-search-bar-css' );
		expect( body ).not.toContain( "id='resource-hub-search-css'" );
		expect( body ).not.toContain( NO_CONTROL_RULE );
	} );

	test( 'without JavaScript it is a plain link named Search to /search/', async ( {
		browser,
		baseURL,
	} ) => {
		const context = await browser.newContext( {
			baseURL,
			javaScriptEnabled: false,
			storageState: process.env.STORAGE_STATE_PATH,
		} );
		const page = await context.newPage();
		await page.goto( first.link );
		await expect( link( page ) ).toHaveAttribute( 'href', '/search/' );
		await expect( toggle( page ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'search' ) ).toHaveCount( 0 );
		await context.close();
	} );

	test( 'with JavaScript it is a disclosure button, closed at first, that opens and closes by mouse with focus in the field and back on the button', async ( {
		page,
	} ) => {
		await page.goto( first.link );
		await expectClosed( page );
		await expect( toggle( page ) ).toHaveAttribute(
			'aria-controls',
			PANEL_ID
		);
		await expect( link( page ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'search' ) ).toHaveCount( 0 );

		await toggle( page ).click();
		await expectOpen( page );
		await expect( page.getByRole( 'search' ) ).toHaveCount( 1 );
		// The bar's two stylesheets were added by the script, as core would print them.
		await expect(
			page.locator( 'link#resource-hub-header-search-bar-css' )
		).toHaveCount( 1 );
		await expect(
			page.locator( 'link#resource-hub-search-css' )
		).toHaveCount( 1 );
		// The field is the bar's own, named s, in a GET form to the search path.
		await expect( barField( page ) ).toHaveAttribute( 'name', 's' );
		await expect( barField( page ) ).toHaveAttribute(
			'id',
			'rh-header-search-q'
		);
		await expect( bar( page ).locator( 'form' ) ).toHaveAttribute(
			'action',
			/\/search\/$/
		);
		await expect( bar( page ).locator( 'form' ) ).toHaveAttribute(
			'method',
			'get'
		);

		await toggle( page ).click();
		await expectClosed( page );
		await expect( toggle( page ) ).toBeFocused();
	} );

	test( 'opens from the keyboard after the lockup, closes on Escape with focus back on the button, and closes when Tab leaves it', async ( {
		page,
	} ) => {
		await page.goto( first.link );
		await banner( page )
			.getByRole( 'link', { name: 'Resource Hub', exact: true } )
			.focus();
		await page.keyboard.press( 'Tab' );
		await expect( toggle( page ) ).toBeFocused();
		await page.keyboard.press( 'Enter' );
		await expectOpen( page );

		await page.keyboard.press( 'Escape' );
		await expectClosed( page );
		await expect( toggle( page ) ).toBeFocused();

		await page.keyboard.press( 'Space' );
		await expectOpen( page );
		// Tab from the field to the submit button stays inside; Tab again leaves the control and closes it.
		await page.keyboard.press( 'Tab' );
		await expect(
			bar( page ).getByRole( 'button', { name: 'Search', exact: true } )
		).toBeFocused();
		await page.keyboard.press( 'Tab' );
		await expectClosed( page );
		await expect( toggle( page ) ).not.toBeFocused();
		await expect(
			page.getByRole( 'main' ).getByRole( 'heading', { level: 1 } )
		).toBeVisible();
	} );

	test( 'closes on a press outside it, and Escape from the page closes it too', async ( {
		page,
	} ) => {
		await page.goto( first.link );
		await toggle( page ).click();
		await expectOpen( page );
		await page
			.getByRole( 'contentinfo' )
			.click( { position: { x: 5, y: 5 } } );
		await expectClosed( page );

		await toggle( page ).click();
		await expectOpen( page );
		// A click on the bar's blank space keeps it open; Escape from there closes it.
		await bar( page ).click( { position: { x: 5, y: 5 } } );
		await expect( bar( page ) ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expectClosed( page );
		await expect( toggle( page ) ).toBeFocused();
	} );

	test( 'submits a query to the search page, which lists the match as a page row with its excerpt', async ( {
		page,
	} ) => {
		await page.goto( first.link );
		await toggle( page ).click();
		await barField( page ).fill( 'quokka' );
		await page.keyboard.press( 'Enter' );

		await expect( page ).toHaveURL( /\/search\/\?s=quokka$/ );
		await expect(
			page.getByRole( 'main' ).getByRole( 'heading', { level: 1 } )
		).toHaveText( 'Search' );
		await expect( page.locator( '.rh-search__summary' ) ).toContainText(
			'for “quokka”'
		);
		const row = page.locator( 'article.rh-card', {
			hasText: caching.title.raw,
		} );
		await expect( row ).toHaveCount( 1 );
		await expect( row.locator( '.rh-card__kind' ) ).toHaveText( 'Page' );
		await expect( row.locator( '.rh-card__summary' ) ).toHaveText(
			'Where the CMS keeps its cache.'
		);
		// The page's own field shows the query, and the header's control is a link to it.
		await expect(
			page.getByRole( 'main' ).getByRole( 'searchbox' )
		).toHaveValue( 'quokka' );
		await expect( link( page ) ).toHaveAttribute( 'href', '#rh-search-q' );
		await expect( toggle( page ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'search' ) ).toHaveCount( 1 );
		await link( page ).click();
		await expect(
			page.getByRole( 'main' ).getByRole( 'searchbox' )
		).toBeFocused();
	} );

	test( 'the anonymous 404 has no control shown, no script and no control stylesheet', async ( {
		baseURL,
		browser,
	} ) => {
		const anonymous = await request.newContext( {
			baseURL,
			maxRedirects: 0,
			storageState: NO_SESSION,
		} );
		const response = await anonymous.get( '/no-such-page/' );
		expect( response.status() ).toBe( 404 );
		const body = await response.text();
		expect( body ).not.toContain( SCRIPT_ID );
		expect( body ).not.toContain( 'resource-hub-header-search-css' );
		expect( body ).toContain( NO_CONTROL_RULE );
		await anonymous.dispose();

		const context = await browser.newContext( {
			baseURL,
			storageState: NO_SESSION,
		} );
		const page = await context.newPage();
		await page.goto( '/no-such-page/' );
		await expect( link( page ) ).toBeHidden();
		await expect( toggle( page ) ).toHaveCount( 0 );
		await context.close();
	} );

	test( 'opening the bar moves nothing and nothing scrolls sideways at 360 px', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 360, height: 700 } );
		await page.goto( first.link );
		const before = await page
			.getByRole( 'main' )
			.evaluate( ( node ) => node.getBoundingClientRect().top );
		await toggle( page ).click();
		await expectOpen( page );
		const after = await page
			.getByRole( 'main' )
			.evaluate( ( node ) => node.getBoundingClientRect().top );
		expect( after ).toBe( before );
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth
			)
		).toBe( true );
		const box = await bar( page ).boundingBox();
		expect( box.x ).toBeGreaterThanOrEqual( 0 );
		expect( box.x + box.width ).toBeLessThanOrEqual( 360 );
	} );

	for ( const colorScheme of [ 'light', 'dark' ] ) {
		test( `has no WCAG A or AA violation closed and open in the ${ colorScheme } scheme`, async ( {
			page,
		} ) => {
			await page.emulateMedia( { colorScheme } );
			await page.goto( first.link );
			await expectClosed( page );
			const closed = await new AxeBuilder( { page } )
				.withTags( WCAG_TAGS )
				.exclude( '#wpadminbar' )
				.analyze();
			expect( closed.violations ).toEqual( [] );

			await toggle( page ).click();
			await expectOpen( page );
			const open = await new AxeBuilder( { page } )
				.withTags( WCAG_TAGS )
				.exclude( '#wpadminbar' )
				.analyze();
			expect( open.violations ).toEqual( [] );
		} );
	}
} );
