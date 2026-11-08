/**
 * The CMS theme's System / Light / Dark control, as a logged-in editor sees
 * it: the footer part's radios (`parts/footer.html`), the theme's inline
 * script (`js/theme-control.js`, printed by `inc/theme-control.php`), the
 * stored choice, the first paint, and what each kind of reader gets. The
 * front end's `apps/web/e2e/theme.spec.ts` checks the same things on the
 * site; this spec holds the CMS to the same behaviour, on a page and across
 * a navigation, with the differences the CMS has: the admin bar above the
 * shell, the 404 that has no control, and the editor canvas, which stays on
 * the system preference.
 *
 * The values are never written down here: the dark and the light surface
 * are read from a page that follows the emulated system scheme, and every
 * other page's colour is compared with those.
 */
const { request } = require( '@playwright/test' );
const { default: AxeBuilder } = require( '@axe-core/playwright' );
const { test, expect } = require( './fixtures' );

const STORAGE_KEY = 'rh-theme';
const SCRIPT_ID = 'resource-hub-theme-control-js';
const NO_CONTROL_RULE = '.rh-footer__theme{display:none}';

/** The front end's accessibility gate's tags (`apps/web/e2e/axe.mts`): every WCAG 2.x A and AA rule axe has. */
const WCAG_TAGS = [ 'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa' ];

const NAMES = {
	system: 'System theme',
	light: 'Light theme',
	dark: 'Dark theme',
};
const CHOICES = [ 'system', 'light', 'dark' ];

const NO_SESSION = { cookies: [], origins: [] };

const group = ( page ) => page.getByRole( 'group', { name: 'Theme' } );
const radio = ( page, choice ) =>
	page.getByRole( 'radio', { name: NAMES[ choice ], exact: true } );
const html = ( page ) => page.locator( 'html' );
const surface = ( page ) =>
	page.evaluate(
		() => window.getComputedStyle( document.body ).backgroundColor
	);
const colorScheme = ( page ) =>
	page.evaluate(
		() => window.getComputedStyle( document.documentElement ).colorScheme
	);
const stored = ( page ) =>
	page.evaluate( ( key ) => localStorage.getItem( key ), STORAGE_KEY );
/**
 * Waits for the page's fonts, Figtree among them; `evaluate` runs with the page's own scripts off too.
 *
 * @param {import('@playwright/test').Page} page The page.
 * @return {Promise<void>} Once the fonts are ready.
 */
const fontsReady = ( page ) =>
	page.evaluate( () => document.fonts.ready.then( () => undefined ) );

/**
 * Stores a choice before any page script runs, as a reader's earlier visit
 * would have.
 *
 * @param {import('@playwright/test').Page} page  The page.
 * @param {string|null}                     value `light`, `dark` or `null` for System.
 */
function store( page, value ) {
	return page.addInitScript(
		( [ key, choice ] ) => {
			if ( choice === null ) {
				localStorage.removeItem( key );
			} else {
				localStorage.setItem( key, choice );
			}
		},
		[ STORAGE_KEY, value ]
	);
}

/**
 * Tabs from the footer's last link into the control, so the focus is the
 * keyboard's (`:focus-visible`) without walking the admin bar first.
 *
 * @param {import('@playwright/test').Page} page The page.
 */
async function tabToTheme( page ) {
	await page
		.getByRole( 'contentinfo' )
		.getByRole( 'link', { name: 'Colbination' } )
		.focus();
	await page.keyboard.press( 'Tab' );
}

test.describe( "The theme's System / Light / Dark control", () => {
	let first;
	let second;

	test.beforeAll( async ( { requestUtils } ) => {
		const stamp = Date.now();
		first = await requestUtils.createPage( {
			title: `E2E theme control ${ stamp }`,
			content:
				"<!-- wp:paragraph --><p>A page with the footer's control.</p><!-- /wp:paragraph -->",
			status: 'publish',
		} );
		second = await requestUtils.createPage( {
			title: `E2E theme control, next ${ stamp }`,
			content:
				'<!-- wp:paragraph --><p>Another page, for the navigation.</p><!-- /wp:paragraph -->',
			status: 'publish',
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const created of [ first, second ] ) {
			if ( created?.id ) {
				await requestUtils.rest( {
					method: 'DELETE',
					path: `/wp/v2/pages/${ created.id }`,
					params: { force: true },
				} );
			}
		}
	} );

	test( 'is in the footer: pending in the HTML with the inline script before any stylesheet, and live in the browser', async ( {
		page,
	} ) => {
		const body = await ( await page.request.get( first.link ) ).text();

		// The server renders nothing checked and the group pending, as the front end does.
		const fieldset = body.match(
			/<fieldset class="rh-theme[^"]*">[\s\S]*?<\/fieldset>/
		)?.[ 0 ];
		expect( fieldset ).toBeDefined();
		expect( fieldset ).toContain( 'rh-theme--pending' );
		expect( fieldset ).not.toMatch( /\schecked\b/ );
		expect( fieldset.match( /type="radio"/g ) ).toHaveLength( 3 );
		expect( fieldset ).not.toMatch( /\son[a-z]+=/i );

		// The script is inline, in <head>, before the first stylesheet; the
		// <noscript> rule beside it; the control's stylesheet from the theme's build.
		const script = body.indexOf( `id="${ SCRIPT_ID }"` );
		expect( script ).toBeGreaterThan( 0 );
		expect( script ).toBeLessThan( body.indexOf( "rel='stylesheet'" ) );
		expect( script ).toBeLessThan( body.indexOf( '<body' ) );
		expect( body ).toContain(
			`<noscript><style>${ NO_CONTROL_RULE }</style></noscript>`
		);
		// And only there: the page does not hide the slot by a style of its own.
		expect( body.split( NO_CONTROL_RULE ) ).toHaveLength( 2 );
		expect( body ).toMatch(
			/id='resource-hub-theme-toggle-css'[^>]*href='[^']*\/themes\/resource-hub\/build\/theme-toggle\.css/
		);

		await page.goto( first.link );
		await expect( group( page ) ).toBeVisible();
		await expect(
			page
				.getByRole( 'contentinfo' )
				.getByRole( 'group', { name: 'Theme' } )
		).toBeVisible();
		await expect( page.getByRole( 'radio' ) ).toHaveCount( 3 );
		for ( const choice of CHOICES ) {
			await expect( radio( page, choice ) ).toBeVisible();
		}
		await expect( radio( page, 'system' ) ).toBeChecked();
		await expect( page.locator( 'fieldset.rh-theme' ) ).not.toHaveClass(
			/rh-theme--pending/
		);
	} );

	test( 'System is the default: nothing stored, nothing on <html>, and the page follows the system scheme live', async ( {
		page,
	} ) => {
		await page.emulateMedia( { colorScheme: 'dark' } );
		await page.goto( first.link );
		await expect( group( page ) ).toBeVisible();
		await expect( radio( page, 'system' ) ).toBeChecked();
		await expect( html( page ) ).not.toHaveAttribute( 'data-theme' );
		expect( await colorScheme( page ) ).toBe( 'light dark' );
		expect( await stored( page ) ).toBeNull();
		const dark = await surface( page );
		await page.emulateMedia( { colorScheme: 'light' } );
		const light = await surface( page );
		expect( light ).not.toBe( dark );
		await expect( radio( page, 'system' ) ).toBeChecked();
	} );

	test( 'Dark applies at once, is stored, survives a reload and a navigation, and System removes the key', async ( {
		page,
	} ) => {
		await page.emulateMedia( { colorScheme: 'light' } );
		await page.goto( first.link );
		await expect( group( page ) ).toBeVisible();
		const light = await surface( page );

		await radio( page, 'dark' ).check();
		await expect( html( page ) ).toHaveAttribute( 'data-theme', 'dark' );
		expect( await colorScheme( page ) ).toBe( 'dark' );
		expect( await stored( page ) ).toBe( 'dark' );
		const dark = await surface( page );
		expect( dark ).not.toBe( light );

		await page.reload();
		await expect( group( page ) ).toBeVisible();
		await expect( radio( page, 'dark' ) ).toBeChecked();
		await expect( html( page ) ).toHaveAttribute( 'data-theme', 'dark' );
		expect( await surface( page ) ).toBe( dark );

		await page.goto( second.link );
		await expect( page.getByRole( 'heading', { level: 1 } ) ).toHaveText(
			second.title.raw
		);
		await expect( radio( page, 'dark' ) ).toBeChecked();
		await expect( html( page ) ).toHaveAttribute( 'data-theme', 'dark' );
		expect( await surface( page ) ).toBe( dark );

		await radio( page, 'light' ).check();
		await expect( html( page ) ).toHaveAttribute( 'data-theme', 'light' );
		expect( await stored( page ) ).toBe( 'light' );
		expect( await surface( page ) ).toBe( light );

		await radio( page, 'system' ).check();
		await expect( html( page ) ).not.toHaveAttribute( 'data-theme' );
		expect( await stored( page ) ).toBeNull();
		expect( await colorScheme( page ) ).toBe( 'light dark' );
	} );

	test( 'a stored choice beats the system scheme on load', async ( {
		page,
	} ) => {
		await store( page, 'light' );
		await page.emulateMedia( { colorScheme: 'dark' } );
		await page.goto( first.link );
		await expect( group( page ) ).toBeVisible();
		await expect( radio( page, 'light' ) ).toBeChecked();
		expect( await colorScheme( page ) ).toBe( 'light' );
	} );

	test( 'the first paint is themed by the inline script alone, with every script file blocked', async ( {
		page,
	} ) => {
		// The surfaces, from a page that follows the emulated scheme.
		await page.emulateMedia( { colorScheme: 'dark' } );
		await page.goto( first.link );
		const dark = await surface( page );
		await page.emulateMedia( { colorScheme: 'light' } );
		const light = await surface( page );
		expect( dark ).not.toBe( light );

		// Dark stored, the system scheme light, and no script file loads: the
		// inline script in <head> is all there is. Unlike the front end, where
		// the control waits for React, it is live too: the same script wires it.
		await page.evaluate(
			( key ) => localStorage.setItem( key, 'dark' ),
			STORAGE_KEY
		);
		await page.route(
			( url ) => url.pathname.endsWith( '.js' ),
			( route ) => route.abort()
		);
		await page.goto( first.link, { waitUntil: 'domcontentloaded' } );
		await expect( html( page ) ).toHaveAttribute( 'data-theme', 'dark' );
		await page.waitForLoadState( 'load' );
		expect( await colorScheme( page ) ).toBe( 'dark' );
		expect( await surface( page ) ).toBe( dark );
		await expect( radio( page, 'dark' ) ).toBeChecked();
	} );

	test.describe( 'without JavaScript', () => {
		for ( const width of [ 360, 1280 ] ) {
			test( `the control is absent and the footer keeps no space for it at ${ width }px`, async ( {
				browser,
				baseURL,
				page,
			} ) => {
				// The reference: a page with JavaScript, with the control's slot taken out.
				await page.setViewportSize( { width, height: 800 } );
				await page.emulateMedia( { colorScheme: 'dark' } );
				await page.goto( first.link );
				await expect( group( page ) ).toBeVisible();
				// Both footers are measured once Figtree has landed: its
				// fallback faces wrap the footer's sentence differently at
				// this width, and the second context starts with a cold cache.
				await fontsReady( page );
				const reference = await surface( page );
				const withControl = await page
					.locator( '.rh-footer' )
					.evaluate(
						( node ) => node.getBoundingClientRect().height
					);
				const withoutControl = await page.evaluate( () => {
					document.querySelector( '.rh-footer__theme' )?.remove();
					return document
						.querySelector( '.rh-footer' )
						.getBoundingClientRect().height;
				} );
				expect( withControl ).toBeGreaterThan( withoutControl );

				const context = await browser.newContext( {
					baseURL,
					javaScriptEnabled: false,
					colorScheme: 'dark',
					viewport: { width, height: 800 },
					storageState: process.env.STORAGE_STATE_PATH,
				} );
				const plain = await context.newPage();
				await plain.goto( first.link );
				await expect(
					plain.getByRole( 'heading', { level: 1 } )
				).toHaveText( first.title.raw );
				await fontsReady( plain );
				await expect( plain.getByRole( 'radio' ) ).toHaveCount( 0 );
				await expect( group( plain ) ).toHaveCount( 0 );
				await expect(
					plain.locator( 'fieldset.rh-theme' )
				).toBeHidden();
				expect(
					await plain.locator( '.rh-footer__theme' ).boundingBox()
				).toBeNull();
				expect(
					await plain
						.locator( '.rh-footer' )
						.evaluate(
							( node ) => node.getBoundingClientRect().height
						)
				).toBe( withoutControl );
				await expect( html( plain ) ).not.toHaveAttribute(
					'data-theme'
				);
				expect( await surface( plain ) ).toBe( reference );
				await context.close();
			} );
		}
	} );

	test.describe( 'keyboard', () => {
		test( "is one Tab stop after the footer's link; the arrows move the choice and wrap, applying each at once", async ( {
			page,
		} ) => {
			await page.goto( first.link );
			await expect( group( page ) ).toBeVisible();

			await tabToTheme( page );
			await expect( radio( page, 'system' ) ).toBeFocused();

			// One more Tab leaves the group: Light and Dark are not stops of their own.
			await page.keyboard.press( 'Tab' );
			await expect(
				page.locator( 'fieldset.rh-theme :focus' )
			).toHaveCount( 0 );
			await page.keyboard.press( 'Shift+Tab' );
			await expect( radio( page, 'system' ) ).toBeFocused();

			await page.keyboard.press( 'ArrowRight' );
			await expect( radio( page, 'light' ) ).toBeFocused();
			await expect( radio( page, 'light' ) ).toBeChecked();
			await expect( html( page ) ).toHaveAttribute(
				'data-theme',
				'light'
			);
			expect( await stored( page ) ).toBe( 'light' );

			await page.keyboard.press( 'ArrowDown' );
			await expect( radio( page, 'dark' ) ).toBeChecked();
			await expect( html( page ) ).toHaveAttribute(
				'data-theme',
				'dark'
			);

			await page.keyboard.press( 'ArrowRight' );
			await expect( radio( page, 'system' ) ).toBeChecked();
			await expect( html( page ) ).not.toHaveAttribute( 'data-theme' );
			expect( await stored( page ) ).toBeNull();

			await page.keyboard.press( 'ArrowLeft' );
			await expect( radio( page, 'dark' ) ).toBeChecked();
			await expect( html( page ) ).toHaveAttribute(
				'data-theme',
				'dark'
			);

			// The focused segment shows a focus ring.
			const label = page.locator( 'label[for]', { hasText: 'Dark' } );
			const outline = await label.evaluate( ( node ) => {
				const style = window.getComputedStyle( node );
				return { style: style.outlineStyle, width: style.outlineWidth };
			} );
			expect( outline.style ).toBe( 'solid' );
			expect( outline.width ).not.toBe( '0px' );
		} );
	} );

	test.describe( 'other tabs', () => {
		test( 'follow a choice made in one tab', async ( { context } ) => {
			const one = await context.newPage();
			const two = await context.newPage();
			await one.goto( first.link );
			await two.goto( second.link );
			await expect( group( one ) ).toBeVisible();
			await expect( group( two ) ).toBeVisible();

			await radio( one, 'dark' ).check();
			await expect( html( two ) ).toHaveAttribute( 'data-theme', 'dark' );
			await expect( radio( two, 'dark' ) ).toBeChecked();

			await radio( two, 'system' ).check();
			await expect( html( one ) ).not.toHaveAttribute( 'data-theme' );
			await expect( radio( one, 'system' ) ).toBeChecked();
		} );
	} );

	test.describe( 'forced colours', () => {
		// As on the front end: no comparison of two segments' colours with
		// each other, since what a forced palette resolves to differs by
		// platform. The selection is a shape only the checked segment has, a
		// bar of real width in CanvasText, and every colour is checked
		// against the system colour it should resolve to.
		test( 'the checked segment and the focus ring are still shown', async ( {
			page,
		} ) => {
			await page.emulateMedia( { forcedColors: 'active' } );
			await page.goto( first.link );
			await expect( group( page ) ).toBeVisible();
			await expect( radio( page, 'system' ) ).toBeChecked();
			expect(
				await page.evaluate(
					() => window.matchMedia( '(forced-colors: active)' ).matches
				)
			).toBe( true );
			const system = await page.evaluate( () => {
				const probe = document.createElement( 'span' );
				document.body.append( probe );
				const resolve = ( keyword ) => {
					probe.style.color = keyword;
					return window.getComputedStyle( probe ).color;
				};
				const colours = {
					canvas: resolve( 'Canvas' ),
					canvasText: resolve( 'CanvasText' ),
					selectedItem: resolve( 'SelectedItem' ),
					selectedItemText: resolve( 'SelectedItemText' ),
					highlight: resolve( 'Highlight' ),
				};
				probe.remove();
				return colours;
			} );
			expect( system.canvasText ).not.toBe( system.canvas );

			const read = ( choice ) =>
				page
					.locator( 'label.rh-theme__label', {
						hasText: NAMES[ choice ].split( ' ' )[ 0 ],
					} )
					.evaluate( ( node ) => {
						const style = window.getComputedStyle( node );
						return {
							fill: style.backgroundColor,
							ink: style.color,
							bar: style.borderBottomColor,
							barStyle: style.borderBottomStyle,
							barWidth: Number.parseFloat(
								style.borderBottomWidth
							),
							height: node.getBoundingClientRect().height,
							outline: style.outlineStyle,
							outlineWidth: Number.parseFloat(
								style.outlineWidth
							),
							outlineColour: style.outlineColor,
						};
					} );
			const checked = await read( 'system' );
			expect( checked.barStyle ).toBe( 'solid' );
			expect( checked.barWidth ).toBeGreaterThanOrEqual( 2 );
			expect( checked.bar ).toBe( system.canvasText );
			expect( checked.fill ).toBe( system.selectedItem );
			expect( checked.ink ).toBe( system.selectedItemText );
			for ( const choice of [ 'light', 'dark' ] ) {
				const unchecked = await read( choice );
				expect( unchecked.barWidth, choice ).toBe( 0 );
				expect( unchecked.fill, choice ).not.toBe(
					system.selectedItem
				);
				expect( unchecked.height, choice ).toBe( checked.height );
			}

			await tabToTheme( page );
			await expect( radio( page, 'system' ) ).toBeFocused();
			const focused = await read( 'system' );
			expect( focused.outline ).toBe( 'solid' );
			expect( focused.outlineWidth ).toBeGreaterThan( 0 );
			expect( focused.outlineColour ).toBe( system.highlight );
		} );
	} );

	test.describe( 'axe', () => {
		for ( const choice of [ 'light', 'dark' ] ) {
			test( `finds no WCAG A or AA violation with ${ choice } chosen`, async ( {
				page,
			} ) => {
				await store( page, choice );
				await page.goto( first.link );
				await expect( group( page ) ).toBeVisible();
				await expect( radio( page, choice ) ).toBeChecked();
				const results = await new AxeBuilder( { page } )
					.withTags( WCAG_TAGS )
					.analyze();
				expect(
					results.violations.map( ( violation ) => ( {
						rule: violation.id,
						impact: violation.impact,
						nodes: violation.nodes
							.slice( 0, 5 )
							.map( ( node ) => node.target.join( ' ' ) ),
					} ) )
				).toEqual( [] );
			} );
		}
	} );

	test( 'the 404 has no script, no control stylesheet, and no control for an anonymous visitor', async ( {
		browser,
		baseURL,
	} ) => {
		const anonymous = await request.newContext( {
			baseURL,
			maxRedirects: 0,
			storageState: NO_SESSION,
		} );
		const response = await anonymous.get( '/e2e-no-such-page/' );
		const body = await response.text();
		expect( response.status() ).toBe( 404 );
		expect( body ).toContain( 'Page not found' );
		expect( body ).not.toContain( SCRIPT_ID );
		expect( body ).not.toContain( 'theme-toggle.css' );
		expect( body ).not.toContain( '<noscript>' );
		// The slot is removed by a style rule, the same one the <noscript> carries elsewhere.
		expect( body ).toMatch(
			new RegExp(
				`<style[^>]*>[^<]*${ NO_CONTROL_RULE.replace( /[.{}]/g, '\\$&' ) }`
			)
		);
		// The markup is still in the shared footer part, so a listing check
		// still reads a fixed-content block there (ThemeFilesTest).
		expect( body ).toContain( 'class="rh-theme rh-theme--pending"' );
		await anonymous.dispose();

		const context = await browser.newContext( {
			baseURL,
			storageState: NO_SESSION,
		} );
		const page = await context.newPage();
		await page.goto( '/e2e-no-such-page/' );
		await expect(
			page.getByRole( 'heading', { level: 1, name: 'Page not found' } )
		).toBeVisible();
		await expect( page.getByRole( 'radio' ) ).toHaveCount( 0 );
		await expect( group( page ) ).toHaveCount( 0 );
		expect(
			await page.locator( '.rh-footer__theme' ).boundingBox()
		).toBeNull();
		await expect( html( page ) ).not.toHaveAttribute( 'data-theme' );
		await context.close();
	} );

	test( 'the editor canvas stays on the system preference, with no script and no attribute', async ( {
		admin,
		editor,
		page,
	} ) => {
		await store( page, 'dark' );
		await admin.editPost( first.id );
		await expect( editor.canvas.locator( 'body' ) ).toBeVisible();

		const canvas = page.frame( { name: 'editor-canvas' } );
		expect( canvas ).not.toBeNull();
		expect( await canvas.locator( `#${ SCRIPT_ID }` ).count() ).toBe( 0 );
		expect(
			await canvas.evaluate( () =>
				document.documentElement.hasAttribute( 'data-theme' )
			)
		).toBe( false );
		expect( await canvas.locator( 'fieldset.rh-theme' ).count() ).toBe( 0 );
		// Nor the admin page around it.
		await expect( page.locator( `#${ SCRIPT_ID }` ) ).toHaveCount( 0 );
		await expect( html( page ) ).not.toHaveAttribute( 'data-theme' );
	} );
} );
