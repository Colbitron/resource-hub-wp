/**
 * A CMS page, as a logged-in editor previews it, computes the styles the
 * front end's CSS gives the same markup.
 *
 * The owner chose full parity between the site and the CMS's previews
 * (issue #89). Both sides load the same stylesheets from the contract
 * package (`packages/ui/`: the tokens, `base.css`, `shell.css`,
 * `prose.css`, `page.css`), and PHPUnit holds the theme's copies to the
 * package byte for byte (`ThemeAssetsTest`). What can still part them is
 * WordPress: core's global styles from `theme.json`, core's block styles,
 * the block markup the templates print, and the order they all load in.
 * So this spec reads the computed styles of the key elements of a CMS page
 * and holds each to the value the package's rule should give it.
 *
 * It does not compare with the front end's computed styles, and it does
 * not read the package's stylesheets: each check is a selector on the CMS
 * page and the declarations the package's rule for that element makes,
 * written here by hand from `base.css`, `shell.css`, `prose.css`,
 * `page.css` and `welcome.css`. The values in those declarations are
 * tokens, resolved at runtime on the same page by a probe element in the
 * element's context, never a number written here, so a change to a token
 * moves the CMS and this spec together; a change to a rule's declarations
 * in the package needs the matching change here.
 *
 * It runs against the CMS alone (the front end has its own specs against
 * the mock CMS, `apps/web/e2e/`), at 1280 px, where the shell's width, the
 * measure and the gutters all show, and at 360 px for the gutter.
 *
 * The second describe does the same for a resource page: the article
 * `single-resource.html` renders, its header with the meta line the plugin's
 * block writes, the featured image, the summary, the body, the source line
 * and the related section, each held to `resource.css`, `card-labels.css`,
 * `related.css` and `card.css`, on a resource `resource-page-seed.js`
 * creates with a pick and a topic match.
 */
const { test, expect } = require( './fixtures' );
const {
	seedResourcePage,
	deleteResourcePage,
} = require( './resource-page-seed' );

/** The page's body: one of each element `prose.css` styles that a core block prints, with core's large quote and dots separator styles, and an image set to expand on click. */
const CONTENT = [
	'<!-- wp:paragraph --><p>An opening paragraph with <a href="/resources/">a link to the library</a>, long enough to run past the measure on a wide screen, so the column shows.</p><!-- /wp:paragraph -->',
	'<!-- wp:heading --><h2 class="wp-block-heading">A section heading</h2><!-- /wp:heading -->',
	'<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>One item</li><!-- /wp:list-item --><!-- wp:list-item --><li>Another item</li><!-- /wp:list-item --></ul><!-- /wp:list -->',
	'<!-- wp:table --><figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>First</td><td>1</td></tr><tr><td>Second</td><td>2</td></tr></tbody></table><figcaption class="wp-element-caption">Two rows of sample values</figcaption></figure><!-- /wp:table -->',
	'<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>A quoted line.</p><!-- /wp:paragraph --><cite>Someone</cite></blockquote><!-- /wp:quote -->',
	'<!-- wp:list {"ordered":true} --><ol class="wp-block-list"><!-- wp:list-item --><li>First step</li><!-- /wp:list-item --><!-- wp:list-item --><li>Second step</li><!-- /wp:list-item --></ol><!-- /wp:list -->',
	'<!-- wp:quote {"className":"is-style-large"} --><blockquote class="wp-block-quote is-style-large"><!-- wp:paragraph --><p>A quote in core\'s large style.</p><!-- /wp:paragraph --><cite>Someone else</cite></blockquote><!-- /wp:quote -->',
	'<!-- wp:paragraph --><p>A sentence with <code>inline code</code> in it.</p><!-- /wp:paragraph -->',
	'<!-- wp:code --><pre class="wp-block-code"><code>const answer = 42;</code></pre><!-- /wp:code -->',
	'<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->',
	'<!-- wp:separator {"className":"is-style-dots"} --><hr class="wp-block-separator has-alpha-channel-opacity is-style-dots"/><!-- /wp:separator -->',
	'<!-- wp:image {"lightbox":{"enabled":true},"sizeSlug":"large","linkDestination":"none"} --><figure class="wp-block-image size-large"><img src="/wp-includes/images/w-logo-blue.png" alt="A sample image"/><figcaption class="wp-element-caption">An image caption</figcaption></figure><!-- /wp:image -->',
].join( '\n\n' );

/**
 * Resolves CSS declarations on a probe element appended to the element
 * `selector` matches, and returns the probe's computed values: a token's
 * value as the package's rule would compute it in that context (a `ch` in
 * that element's font, an `em` in its size). Runs in the page.
 *
 * @param {{selector: string, declarations: Record<string, string>}} args The context and the declarations, as CSS property names.
 * @return {Record<string, string>} Each property's computed value.
 */
function resolveInPage( { selector, declarations } ) {
	const host = document.querySelector( selector );
	const probe = document.createElement( 'div' );
	probe.style.display = 'block';
	for ( const [ property, value ] of Object.entries( declarations ) ) {
		probe.style.setProperty( property, value );
	}
	host.append( probe );
	const style = window.getComputedStyle( probe );
	const values = Object.fromEntries(
		Object.keys( declarations ).map( ( property ) => [
			property,
			style.getPropertyValue( property ),
		] )
	);
	probe.remove();
	return values;
}

/**
 * The computed values of `properties` on the element `selector` matches.
 *
 * @param {import('@playwright/test').Page} page       The page.
 * @param {string}                          selector   A selector that matches one element.
 * @param {string[]}                        properties CSS property names.
 * @return {Promise<Record<string, string>>} Each property's computed value.
 */
async function computed( page, selector, properties ) {
	const element = page.locator( selector );
	await expect( element ).toHaveCount( 1 );
	return element.evaluate(
		( node, names ) =>
			Object.fromEntries(
				names.map( ( name ) => [
					name,
					window.getComputedStyle( node ).getPropertyValue( name ),
				] )
			),
		properties
	);
}

/**
 * Resolves `declarations` in the context of `selector` (`resolveInPage`).
 *
 * @param {import('@playwright/test').Page} page         The page.
 * @param {string}                          selector     The element whose context the tokens resolve in.
 * @param {Record<string, string>}          declarations CSS property names and values.
 * @return {Promise<Record<string, string>>} Each property's computed value.
 */
function resolve( page, selector, declarations ) {
	return page.evaluate( resolveInPage, { selector, declarations } );
}

/**
 * An element's border box in CSS pixels.
 *
 * @param {import('@playwright/test').Page} page     The page.
 * @param {string}                          selector A selector that matches one element.
 * @return {Promise<{x: number, width: number, height: number}>} The box.
 */
async function box( page, selector ) {
	const element = page.locator( selector );
	await expect( element ).toHaveCount( 1 );
	return element.evaluate( ( node ) => {
		const rect = node.getBoundingClientRect();
		return { x: rect.x, width: rect.width, height: rect.height };
	} );
}

test.describe( "A CMS page computes the front end's styles", () => {
	let cmsPage;

	test.beforeAll( async ( { requestUtils } ) => {
		cmsPage = await requestUtils.createPage( {
			title: `Parity sample ${ Date.now() }`,
			content: CONTENT,
			status: 'publish',
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		if ( cmsPage ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/pages/${ cmsPage.id }`,
				params: { force: true },
			} );
		}
	} );

	for ( const colorScheme of [ 'light', 'dark' ] ) {
		test( `the document: body, link and headings (${ colorScheme })`, async ( {
			page,
		} ) => {
			await page.emulateMedia( { colorScheme } );
			await page.setViewportSize( { width: 1280, height: 900 } );
			await page.goto( cmsPage.link );

			// The body: base.css's `body` rule. Its font-family is the token's
			// stack exactly, which also pins the load order: theme.json's
			// preset, `"Figtree", var(--rh-font-sans)`, would win if core's
			// global styles printed after base.css.
			expect(
				await computed( page, 'body', [
					'font-family',
					'font-size',
					'line-height',
					'color',
					'background-color',
					'margin-top',
				] )
			).toEqual(
				await resolve( page, 'body', {
					'font-family': 'var(--rh-font-sans)',
					'font-size': 'var(--rh-text-base)',
					'line-height':
						'calc(var(--rh-leading-body) * var(--rh-text-base))',
					color: 'var(--rh-color-text)',
					'background-color': 'var(--rh-color-surface)',
					'margin-top': '0px',
				} )
			);

			// The title: base.css's `h1` and page.css's `.rh-page__title`.
			const titleExpected = await resolve( page, '.rh-page__title', {
				'font-size': 'var(--rh-text-2xl)',
				'font-weight': 'var(--rh-weight-heading)',
				'letter-spacing': 'var(--rh-tracking-heading)',
				'line-height':
					'calc(var(--rh-leading-tight) * var(--rh-text-2xl))',
				'margin-top': '0px',
				'margin-bottom': 'var(--rh-space-3)',
				color: 'var(--rh-color-text)',
			} );
			// The probe inherits the h1's size, so its tracking resolves in it.
			expect(
				await computed(
					page,
					'h1.rh-page__title',
					Object.keys( titleExpected )
				)
			).toEqual( titleExpected );
			await expect( page.locator( 'h1' ) ).toHaveCount( 1 );

			// A body heading: prose.css's `.rh-prose h2`.
			const h2Expected = await resolve( page, '.rh-prose h2', {
				'font-size': 'var(--rh-text-xl)',
				'font-weight': 'var(--rh-weight-heading)',
				'margin-top': 'var(--rh-space-6)',
				'margin-bottom': 'var(--rh-space-3)',
			} );
			expect(
				await computed(
					page,
					'.rh-prose h2',
					Object.keys( h2Expected )
				)
			).toEqual( h2Expected );

			// A body link: base.css's colour and prose.css's hairline underline.
			const linkExpected = await resolve(
				page,
				'.rh-prose > p:first-child',
				{
					color: 'var(--rh-color-accent)',
					'text-decoration-thickness': 'var(--rh-border-width)',
				}
			);
			expect(
				await computed(
					page,
					'.rh-prose > p:first-child a',
					Object.keys( linkExpected )
				)
			).toEqual( linkExpected );

			// A body paragraph: its margin, and the measure in its own font.
			const paragraphExpected = await resolve( page, '.rh-prose', {
				'max-width': 'var(--rh-measure)',
				'margin-bottom': 'var(--rh-space-4)',
				'margin-top': '0px',
			} );
			expect(
				await computed(
					page,
					'.rh-prose > p:first-child',
					Object.keys( paragraphExpected )
				)
			).toEqual( paragraphExpected );
		} );
	}

	test( "the body's other elements: lists, quotes, code, the rule, an image and the captions", async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( cmsPage.link );

		/**
		 * Holds the element `selector` matches to `declarations`, resolved
		 * on a probe inside `context` (by default the element's parent's
		 * context, the body).
		 *
		 * @param {string}                 selector     The element on the CMS page.
		 * @param {Record<string, string>} declarations What the package's rule declares.
		 * @param {string}                 [context]    Where the tokens resolve.
		 */
		const holds = async ( selector, declarations, context = '.rh-prose' ) =>
			expect(
				await computed( page, selector, Object.keys( declarations ) ),
				selector
			).toEqual( await resolve( page, context, declarations ) );

		// Lists: prose.css's margins, indent and item spacing, and the
		// markers in the muted ink.
		for ( const list of [ '.rh-prose > ul', '.rh-prose > ol' ] ) {
			await holds( list, {
				'margin-top': '0px',
				'margin-bottom': 'var(--rh-space-4)',
				'padding-left': 'var(--rh-space-5)',
			} );
			await holds( `${ list } > li:first-child`, {
				'margin-bottom': 'var(--rh-space-1)',
			} );
			expect(
				await page
					.locator( `${ list } > li:first-child` )
					.evaluate(
						( node ) =>
							window.getComputedStyle( node, '::marker' ).color
					)
			).toBe(
				(
					await resolve( page, '.rh-prose', {
						color: 'var(--rh-color-text-muted)',
					} )
				).color
			);
		}

		// Both quotes are prose.css's inset: core's large style, which the
		// front end never loads, changes nothing.
		for ( const quote of [
			'.rh-prose > blockquote:not(.is-style-large)',
			'.rh-prose > blockquote.is-style-large',
		] ) {
			await holds( quote, {
				'margin-top': 'var(--rh-space-5)',
				'margin-bottom': 'var(--rh-space-5)',
				'padding-top': 'var(--rh-space-4)',
				'padding-left': 'var(--rh-space-5)',
				'padding-right': 'var(--rh-space-5)',
				'border-top-width': 'var(--rh-border-width)',
				'border-top-color': 'var(--rh-color-border)',
				'border-left-width': 'var(--rh-border-width-strong)',
				'border-left-color': 'var(--rh-mark-coral)',
				'border-top-left-radius': 'var(--rh-radius)',
				'background-color': 'var(--rh-color-surface-raised)',
				'font-size': 'var(--rh-text-md)',
			} );
			await holds(
				`${ quote } > p`,
				{
					'font-size': 'var(--rh-text-md)',
					'font-style': 'normal',
					'line-height':
						'calc(var(--rh-leading-body) * var(--rh-text-md))',
					// Not its last child: the cite follows.
					'margin-bottom': 'var(--rh-space-4)',
					'padding-left': '0px',
				},
				quote
			);
			await holds(
				`${ quote } > cite`,
				{
					display: 'block',
					'margin-top': 'var(--rh-space-2)',
					color: 'var(--rh-color-text-muted)',
					'font-size': 'var(--rh-text-sm)',
					'font-style': 'normal',
					'text-align': 'start',
				},
				quote
			);
		}

		// Code: the inline inset, and the block inset whose code takes the
		// browser's monospace at the block's size.
		await holds(
			'.rh-prose > p > code',
			{
				'font-size': '0.9em',
				'padding-left': '0.2em',
				'border-top-left-radius': 'var(--rh-radius-sm)',
				'background-color': 'var(--rh-color-surface-raised)',
				'font-family': 'monospace',
			},
			'.rh-prose > p:has(> code)'
		);
		await holds( '.rh-prose > pre', {
			'margin-top': '0px',
			'margin-bottom': 'var(--rh-space-5)',
			'padding-top': 'var(--rh-space-3)',
			'padding-left': 'var(--rh-space-4)',
			'border-top-width': 'var(--rh-border-width)',
			'border-top-color': 'var(--rh-color-border)',
			'border-top-left-radius': 'var(--rh-radius)',
			'background-color': 'var(--rh-color-surface-raised)',
			'font-size': 'var(--rh-text-sm)',
			'font-family': 'monospace',
			'white-space': 'pre-wrap',
		} );
		await holds(
			'.rh-prose > pre > code',
			{
				display: 'inline',
				'padding-left': '0px',
				'background-color': 'rgba(0, 0, 0, 0)',
				'font-size': 'var(--rh-text-sm)',
				'font-family': 'monospace',
			},
			'.rh-prose > pre'
		);

		// The rule: one hairline, in core's dots style too, which the front
		// end draws as the same rule.
		for ( const rule of [
			'.rh-prose > hr:not(.is-style-dots)',
			'.rh-prose > hr.is-style-dots',
		] ) {
			await holds( rule, {
				'margin-top': 'var(--rh-space-6)',
				'margin-bottom': 'var(--rh-space-6)',
				'border-top-width': 'var(--rh-border-width)',
				'border-top-style': 'solid',
				'border-top-color': 'var(--rh-color-border)',
				'border-bottom-width': '0px',
				'border-left-width': '0px',
			} );
			expect(
				await page
					.locator( rule )
					.evaluate(
						( node ) =>
							window.getComputedStyle( node, '::before' ).content
					),
				rule
			).toBe( 'none' );
		}

		// The image: the figure's margins, the image's corners, and both
		// captions small and muted, with no margin below (core's default
		// caption style gives it one; the front end loads none).
		await holds( '.rh-prose > figure.wp-block-image', {
			'margin-top': 'var(--rh-space-5)',
			'margin-bottom': 'var(--rh-space-5)',
			'margin-left': '0px',
		} );
		await holds(
			'.rh-prose > figure.wp-block-image > img',
			{
				display: 'block',
				'border-top-left-radius': 'var(--rh-radius)',
				'max-width': '100%',
			},
			'.rh-prose > figure.wp-block-image'
		);
		// Set to expand on click, it renders as the front end shows it: the
		// image alone, no trigger button and no overlay.
		await expect(
			page.locator( '.rh-prose figure.wp-block-image button' )
		).toHaveCount( 0 );
		await expect( page.locator( '.wp-lightbox-overlay' ) ).toHaveCount( 0 );
		for ( const caption of [
			'.rh-prose > figure.wp-block-image > figcaption',
			'.rh-prose > figure.wp-block-table > figcaption',
		] ) {
			await holds( caption, {
				'margin-top': 'var(--rh-space-2)',
				'margin-bottom': '0px',
				color: 'var(--rh-color-text-muted)',
				'font-size': 'var(--rh-text-sm)',
			} );
		}
	} );

	test( 'the shell, the header and the article column at 1280 px', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( cmsPage.link );

		// The shell's column: `--rh-measure-wide`, centred, with one gutter
		// a side, the same box for the header's row, `main` and the footer's.
		const tokens = await resolve( page, 'body', {
			width: 'var(--rh-measure-wide)',
			'padding-left': 'var(--rh-space-4)',
			'padding-top': 'var(--rh-space-3)',
			'border-top-width': 'var(--rh-border-width)',
			'border-top-color': 'var(--rh-color-border)',
			'border-top-style': 'solid',
		} );
		const wide = parseFloat( tokens.width );
		const gutter = parseFloat( tokens[ 'padding-left' ] );
		const viewport = page.viewportSize().width;
		const column = Math.min( wide, viewport );
		for ( const selector of [
			'.rh-header__inner',
			'main.rh-main',
			'.rh-footer__inner',
		] ) {
			const shell = await box( page, selector );
			expect( shell.width, selector ).toBeCloseTo( column, 1 );
			expect( shell.x, selector ).toBeCloseTo(
				( viewport - column ) / 2,
				1
			);
			expect(
				parseFloat(
					( await computed( page, selector, [ 'padding-left' ] ) )[
						'padding-left'
					]
				),
				selector
			).toBeCloseTo( gutter, 1 );
		}

		// The header: one flex row, centred, with a step less than the
		// gutter above and below, over a hairline; as tall as the lockup
		// and that padding.
		expect(
			await computed( page, '.rh-header__inner', [
				'display',
				'align-items',
				'padding-top',
				'padding-bottom',
			] )
		).toEqual( {
			display: 'flex',
			'align-items': 'center',
			'padding-top': tokens[ 'padding-top' ],
			'padding-bottom': tokens[ 'padding-top' ],
		} );
		expect(
			await computed( page, 'header.rh-header', [
				'border-bottom-width',
				'border-bottom-style',
				'border-bottom-color',
			] )
		).toEqual( {
			'border-bottom-width': tokens[ 'border-top-width' ],
			'border-bottom-style': 'solid',
			'border-bottom-color': tokens[ 'border-top-color' ],
		} );
		const headerRow = await box( page, '.rh-header__inner' );
		const lockup = await box( page, '.rh-header__inner > a.rh-brand' );
		expect( headerRow.height ).toBeCloseTo(
			lockup.height + 2 * parseFloat( tokens[ 'padding-top' ] ),
			1
		);
		// The lockup sits at the column's content edge, as on the front end.
		expect( lockup.x ).toBeCloseTo( headerRow.x + gutter, 1 );

		// The article: the measure in its own font, centred in `main`'s
		// content box, so the title lines up with the body, not the header.
		const measure = parseFloat(
			(
				await resolve( page, '.rh-page', {
					width: 'var(--rh-measure)',
				} )
			).width
		);
		const main = await box( page, 'main.rh-main' );
		const article = await box( page, 'article.rh-page' );
		expect( article.width ).toBeCloseTo( measure, 1 );
		expect( article.x ).toBeCloseTo(
			main.x + gutter + ( main.width - 2 * gutter - measure ) / 2,
			1
		);
		const title = await box( page, '.rh-page__title' );
		expect( title.x ).toBeCloseTo( article.x, 1 );
		expect( title.width ).toBeCloseTo( article.width, 1 );
	} );

	test( '/ is the welcome page while the front page shows posts', async ( {
		page,
		requestUtils,
	} ) => {
		// The tests site is a fresh install, so Settings > Reading shows
		// posts, the state the front end answers with its welcome page.
		const settings = await requestUtils.rest( { path: '/wp/v2/settings' } );
		expect( settings.show_on_front ).toBe( 'posts' );

		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( '/' );
		await expect( page.locator( 'h1' ) ).toHaveCount( 1 );
		await expect(
			page.locator( '.rh-page.rh-welcome > h1.rh-page__title' )
		).toHaveText( 'Resource Hub' );
		await expect(
			page.locator( 'link#resource-hub-welcome-css' )
		).toHaveAttribute(
			'href',
			/\/themes\/resource-hub\/build\/welcome\.css/
		);

		// welcome.css's lead: the sentence a step larger, in the article's
		// column of page.css.
		await expect( async () => {
			const expected = await resolve( page, '.rh-welcome', {
				'font-size': 'var(--rh-text-md)',
			} );
			expect(
				await computed( page, '.rh-welcome > p:first-of-type', [
					'font-size',
				] )
			).toEqual( expected );
		} ).toPass();
		const measure = parseFloat(
			(
				await resolve( page, '.rh-welcome', {
					width: 'var(--rh-measure)',
				} )
			).width
		);
		expect( ( await box( page, '.rh-welcome' ) ).width ).toBeCloseTo(
			measure,
			1
		);
	} );

	test( 'a short page under the admin bar does not scroll', async ( {
		page,
	} ) => {
		// The shell is at least the viewport's height, and core pushes the
		// page down by the admin bar's (32 px, or 46 px at 782 px and under),
		// which the theme subtracts under `body.admin-bar`.
		for ( const width of [ 1280, 600 ] ) {
			await page.setViewportSize( { width, height: 800 } );
			await page.goto( '/' );
			await expect( page.locator( 'body.admin-bar' ) ).toHaveCount( 1 );
			const { scroll, viewport, footerBottom } = await page.evaluate(
				() => ( {
					scroll: document.documentElement.scrollHeight,
					viewport: window.innerHeight,
					footerBottom: document
						.querySelector( 'footer.rh-footer' )
						.getBoundingClientRect().bottom,
				} )
			);
			expect( scroll, `at ${ width } px` ).toBe( viewport );
			// The footer still meets the bottom of the window.
			expect( footerBottom, `at ${ width } px` ).toBeCloseTo(
				viewport,
				0
			);
		}
	} );

	test( 'the gutter at 360 px', async ( { page } ) => {
		await page.setViewportSize( { width: 360, height: 800 } );
		await page.goto( cmsPage.link );
		const gutter = parseFloat(
			( await resolve( page, 'body', { width: 'var(--rh-space-4)' } ) )
				.width
		);
		const article = await box( page, 'article.rh-page' );
		expect( article.x ).toBeCloseTo( gutter, 1 );
		expect( article.width ).toBeCloseTo( 360 - 2 * gutter, 1 );
		// Nothing scrolls sideways.
		expect(
			await page.evaluate( () => document.documentElement.scrollWidth )
		).toBeLessThanOrEqual( 360 );
	} );

	test( "a table block is drawn in the front end's scroll region", async ( {
		page,
		requestUtils,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( cmsPage.link );

		// The region the front end's pass renders around a table, inside the
		// block's figure, named by the figure's caption.
		const region = page.getByRole( 'region', {
			name: 'Two rows of sample values',
		} );
		await expect( region ).toHaveAttribute( 'tabindex', '0' );
		await expect( region ).toHaveClass( 'rh-table-scroll' );
		await expect(
			page.locator( 'figure.wp-block-table > .rh-table-scroll > table' )
		).toHaveCount( 1 );

		// prose.css's box, and none of core's table block styles: no border
		// on a cell's sides, no fixed layout, no rule under the last row.
		const tokens = await resolve( page, '.rh-prose', {
			'border-top-width': 'var(--rh-border-width)',
			'border-top-color': 'var(--rh-color-border)',
			'border-bottom-width': 'var(--rh-border-width-strong)',
			'border-bottom-color': 'var(--rh-color-border-strong)',
			'border-top-left-radius': 'var(--rh-radius)',
			'margin-bottom': 'var(--rh-space-5)',
		} );
		expect(
			await computed( page, '.rh-table-scroll', [
				'border-top-width',
				'border-top-color',
				'border-top-left-radius',
				'overflow-x',
				'margin-bottom',
			] )
		).toEqual( {
			'border-top-width': tokens[ 'border-top-width' ],
			'border-top-color': tokens[ 'border-top-color' ],
			'border-top-left-radius': tokens[ 'border-top-left-radius' ],
			'overflow-x': 'auto',
			'margin-bottom': tokens[ 'margin-bottom' ],
		} );
		expect(
			await computed( page, '.rh-table-scroll table', [ 'table-layout' ] )
		).toEqual( { 'table-layout': 'auto' } );
		expect(
			await computed(
				page,
				'.rh-prose tbody tr:first-child td:first-child',
				[
					'border-left-width',
					'border-top-width',
					'border-bottom-width',
					'border-bottom-color',
				]
			)
		).toEqual( {
			'border-left-width': '0px',
			'border-top-width': '0px',
			'border-bottom-width': tokens[ 'border-top-width' ],
			'border-bottom-color': tokens[ 'border-top-color' ],
		} );
		expect(
			await computed( page, '.rh-prose thead th:first-child', [
				'border-bottom-width',
				'border-bottom-color',
			] )
		).toEqual( {
			'border-bottom-width': tokens[ 'border-bottom-width' ],
			'border-bottom-color': tokens[ 'border-bottom-color' ],
		} );
		expect(
			await computed(
				page,
				'.rh-prose tbody tr:last-child td:first-child',
				[ 'border-bottom-width' ]
			)
		).toEqual( { 'border-bottom-width': '0px' } );

		// The wrapper is the theme's presentation only: the page's REST
		// `content.rendered`, which the front end reads, is core's markup.
		const rest = await requestUtils.rest( {
			path: `/wp/v2/pages/${ cmsPage.id }`,
		} );
		expect( rest.content.rendered ).toContain( 'wp-block-table' );
		expect( rest.content.rendered ).not.toContain( 'rh-table-scroll' );
	} );
} );

test.describe( "A CMS resource page computes the front end's styles", () => {
	let seed;

	test.beforeAll( async ( { requestUtils } ) => {
		seed = await seedResourcePage( requestUtils );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		if ( seed ) {
			await deleteResourcePage( requestUtils, seed );
		}
	} );

	for ( const colorScheme of [ 'light', 'dark' ] ) {
		test( `the article: header, meta line, image, summary, body and source (${ colorScheme })`, async ( {
			page,
		} ) => {
			await page.emulateMedia( { colorScheme } );
			await page.setViewportSize( { width: 1280, height: 900 } );
			await page.goto( seed.host.link );

			/**
			 * Holds the element `selector` matches to `declarations`, resolved
			 * on a probe inside `context` (by default the article).
			 *
			 * @param {string}                 selector     The element on the CMS page.
			 * @param {Record<string, string>} declarations What the package's rule declares.
			 * @param {string}                 [context]    Where the tokens resolve.
			 */
			const holds = async (
				selector,
				declarations,
				context = 'article.rh-resource'
			) =>
				expect(
					await computed(
						page,
						selector,
						Object.keys( declarations )
					),
					selector
				).toEqual( await resolve( page, context, declarations ) );

			// The template's stylesheets: the resource's and the related
			// section's, from the theme, and the rows', from the plugin's
			// blocks, as links; the meta block's labels, which core inlines as
			// a block style; not the page's.
			for ( const id of [
				'resource-hub-resource',
				'resource-hub-related',
				'resource-hub-card',
			] ) {
				await expect(
					page.locator( `link[rel="stylesheet"]#${ id }-css` ),
					id
				).toHaveCount( 1 );
			}
			await expect(
				page.locator( '[id^="resource-hub-resource-meta-style"]' )
			).toHaveCount( 1 );
			await expect(
				page.locator( 'link#resource-hub-page-css' )
			).toHaveCount( 0 );

			// The article: the measure in its own font, centred in main's
			// content box (resource.css), as the page's article is.
			await expect( page.locator( 'h1' ) ).toHaveCount( 1 );
			const tokens = await resolve( page, 'body', {
				'padding-left': 'var(--rh-space-4)',
			} );
			const gutter = parseFloat( tokens[ 'padding-left' ] );
			const measure = parseFloat(
				(
					await resolve( page, 'article.rh-resource', {
						width: 'var(--rh-measure)',
					} )
				).width
			);
			const main = await box( page, 'main.rh-main' );
			const article = await box( page, 'article.rh-resource' );
			expect( article.width ).toBeCloseTo( measure, 1 );
			expect( article.x ).toBeCloseTo(
				main.x + gutter + ( main.width - 2 * gutter - measure ) / 2,
				1
			);

			// The header and the title: resource.css's margins over base.css's h1.
			await holds( 'header.rh-resource__header', {
				'margin-bottom': 'var(--rh-space-5)',
			} );
			await holds(
				'h1.rh-resource__title',
				{
					'font-size': 'var(--rh-text-2xl)',
					'font-weight': 'var(--rh-weight-heading)',
					'margin-top': '0px',
					'margin-bottom': 'var(--rh-space-3)',
					color: 'var(--rh-color-text)',
				},
				'h1.rh-resource__title'
			);
			await expect( page.locator( 'h1.rh-resource__title' ) ).toHaveText(
				seed.host.title.raw
			);

			// The meta line: one wrapping row in the muted ink at the small size.
			await holds( '.rh-resource__meta', {
				display: 'flex',
				'flex-wrap': 'wrap',
				'align-items': 'baseline',
				'row-gap': 'var(--rh-space-2)',
				'column-gap': 'var(--rh-space-3)',
				color: 'var(--rh-color-text-muted)',
				'font-size': 'var(--rh-text-sm)',
			} );
			// The type's label (card-labels.css) around a link that keeps the
			// label's ink and is underlined at the hairline (resource.css); the
			// mark is the span's ::before, in the ink, since the type has no
			// accent row.
			await holds(
				'.rh-resource__meta .rh-card__type',
				{
					display: 'inline-flex',
					color: 'var(--rh-color-text)',
					'text-transform': 'uppercase',
					'font-weight': '600',
					'letter-spacing': 'var(--rh-tracking-label)',
				},
				'.rh-resource__meta'
			);
			await holds(
				'.rh-resource__meta a.rh-resource__type',
				{
					color: 'var(--rh-color-text)',
					'text-decoration-line': 'underline',
					'text-decoration-thickness': 'var(--rh-border-width)',
					'text-underline-offset': '0.3em',
				},
				'.rh-resource__meta .rh-card__type'
			);
			const mark = await page
				.locator( '.rh-resource__meta .rh-card__type' )
				.evaluate( ( node ) => {
					const style = window.getComputedStyle( node, '::before' );
					return {
						width: style.width,
						'background-color': style.backgroundColor,
					};
				} );
			expect( mark ).toEqual(
				await resolve( page, '.rh-resource__meta', {
					width: 'var(--rh-space-2)',
					'background-color': 'var(--rh-color-text)',
				} )
			);
			await expect(
				page.locator( '.rh-resource__meta a.rh-resource__type' )
			).toHaveAttribute(
				'href',
				new RegExp( `/resources/${ seed.type.slug }/$` )
			);
			await expect(
				page.locator( '.rh-resource__meta time' )
			).toHaveAttribute( 'datetime', '2026-11-01T09:30:00Z' );
			await expect(
				page.locator( '.rh-resource__meta time' )
			).toHaveText( 'Nov 1, 2026' );
			// The topics: the row's small labels, each a link to its listing.
			const topics = page.locator(
				'.rh-resource__meta ul.rh-card__topics'
			);
			await expect( topics ).toHaveAttribute( 'aria-label', 'Topics' );
			await expect( topics ).toHaveAttribute( 'role', 'list' );
			await holds(
				'.rh-resource__meta ul.rh-card__topics',
				{
					display: 'flex',
					'list-style-type': 'none',
					'margin-top': '0px',
					'padding-left': '0px',
					color: 'var(--rh-color-text-muted)',
					'font-size': 'var(--rh-text-sm)',
				},
				'.rh-resource__meta'
			);
			await holds(
				'.rh-resource__meta a.rh-resource__topic',
				{
					color: 'var(--rh-color-accent)',
					'text-decoration-thickness': 'var(--rh-border-width)',
				},
				'.rh-resource__meta ul.rh-card__topics'
			);
			await expect(
				page.locator( '.rh-resource__meta a.rh-resource__topic' )
			).toHaveAttribute(
				'href',
				new RegExp( `/resources/topic/${ seed.topic.slug }/$` )
			);

			// The featured image: at the column's width, never wider, with
			// the article's corners, on the raised plate, with its box
			// reserved by its attributes (resource.css).
			await holds( '.rh-resource__media', {
				'margin-top': '0px',
				'margin-bottom': 'var(--rh-space-5)',
				'margin-left': '0px',
			} );
			await holds(
				'.rh-resource__media img',
				{
					display: 'block',
					'max-width': '100%',
					'border-top-left-radius': 'var(--rh-radius)',
					'background-color': 'var(--rh-color-surface-raised)',
				},
				'.rh-resource__media'
			);
			const image = page.locator( '.rh-resource__media img' );
			await expect( image ).toHaveAttribute( 'width', /^\d+$/ );
			await expect( image ).toHaveAttribute( 'height', /^\d+$/ );
			const imageBox = await box( page, '.rh-resource__media img' );
			expect( imageBox.width ).toBeCloseTo( article.width, 1 );
			expect( imageBox.height ).toBeCloseTo(
				( imageBox.width * 675 ) / 1200,
				0
			);

			// The summary as the lead paragraph: a step larger, muted.
			await holds( 'p.rh-resource__summary', {
				'margin-top': '0px',
				'margin-bottom': 'var(--rh-space-5)',
				color: 'var(--rh-color-text-muted)',
				'font-size': 'var(--rh-text-md)',
			} );
			await expect( page.locator( 'p.rh-resource__summary' ) ).toHaveText(
				seed.host.meta.summary
			);

			// The body: prose.css, as on a page.
			await holds(
				'.rh-resource__body.rh-prose > p:first-child',
				{
					'margin-top': '0px',
					'margin-bottom': 'var(--rh-space-4)',
					'max-width': 'var(--rh-measure)',
				},
				'.rh-resource__body'
			);
			await holds(
				'.rh-resource__body.rh-prose h2',
				{
					'font-size': 'var(--rh-text-xl)',
					'margin-top': 'var(--rh-space-6)',
				},
				'.rh-resource__body'
			);

			// The source line: small and muted, set off from the body by a
			// hairline, its link the host of the external URL.
			await holds( 'footer.rh-resource__source', {
				'margin-top': 'var(--rh-space-6)',
				'padding-top': 'var(--rh-space-4)',
				'border-top-width': 'var(--rh-border-width)',
				'border-top-style': 'solid',
				'border-top-color': 'var(--rh-color-border)',
				color: 'var(--rh-color-text-muted)',
				'font-size': 'var(--rh-text-sm)',
			} );
			await holds(
				'footer.rh-resource__source > p',
				{ 'margin-top': '0px', 'margin-bottom': '0px' },
				'footer.rh-resource__source'
			);
			await expect(
				page.locator( 'footer.rh-resource__source' )
			).toHaveText( 'Source: example.com' );
			await expect(
				page.locator( 'footer.rh-resource__source a' )
			).toHaveAttribute( 'rel', 'noopener noreferrer' );
		} );
	}

	test( 'the related section: the heading on its rule and the rows, picks first', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( seed.host.link );

		const holds = async (
			selector,
			declarations,
			context = '.rh-related'
		) =>
			expect(
				await computed( page, selector, Object.keys( declarations ) ),
				selector
			).toEqual( await resolve( page, context, declarations ) );

		// The section, last in the article, named by its heading.
		const section = page.locator(
			'article.rh-resource > section.rh-related'
		);
		await expect( section ).toHaveCount( 1 );
		await expect( section ).toHaveAttribute(
			'aria-labelledby',
			'rh-related-heading'
		);
		await expect(
			page.locator( 'article.rh-resource > :last-child' )
		).toHaveClass( /(^| )rh-related( |$)/ );
		await holds( 'section.rh-related', {
			position: 'relative',
			'margin-top': 'var(--rh-space-7)',
		} );

		// The heading: small, over the strong rule in the ink (related.css).
		const heading = section.locator( 'h2.rh-related__heading' );
		await expect( heading ).toHaveText( 'Related resources' );
		await expect( heading ).toHaveId( 'rh-related-heading' );
		await holds( 'h2.rh-related__heading', {
			'margin-top': '0px',
			'margin-bottom': '0px',
			'padding-bottom': 'var(--rh-space-2)',
			'border-bottom-width': 'var(--rh-border-width-strong)',
			'border-bottom-style': 'solid',
			'border-bottom-color': 'var(--rh-color-text)',
			'font-size': 'var(--rh-text-md)',
			'font-weight': 'var(--rh-weight-heading)',
		} );

		// The rows: the pick first, then the newest sharing the topic, each
		// the listing's row (card.css) at h3 under the section's h2, between
		// hairlines.
		const rows = section.locator(
			'ul.rh-card-grid > li > article.rh-card'
		);
		await expect( rows ).toHaveCount( 2 );
		await expect( rows.getByRole( 'heading', { level: 3 } ) ).toHaveText( [
			seed.pick.title.raw,
			seed.match.title.raw,
		] );
		await expect( rows.nth( 0 ).getByRole( 'link' ) ).toHaveAttribute(
			'href',
			seed.pick.link
		);
		await holds( 'section.rh-related ul.rh-card-grid', {
			display: 'flex',
			'flex-direction': 'column',
			'margin-top': '0px',
			'padding-left': '0px',
			'list-style-type': 'none',
		} );
		await holds( 'section.rh-related ul.rh-card-grid > li:first-child', {
			'border-bottom-width': 'var(--rh-border-width)',
			'border-bottom-style': 'solid',
			'border-bottom-color': 'var(--rh-color-border)',
		} );
		await holds(
			'section.rh-related ul.rh-card-grid > li:first-child > article.rh-card',
			{
				display: 'flex',
				'flex-wrap': 'wrap',
				'padding-top': 'var(--rh-space-5)',
				'padding-bottom': 'var(--rh-space-5)',
				'row-gap': 'var(--rh-space-2)',
				'column-gap': 'var(--rh-space-6)',
			}
		);
		await holds(
			'section.rh-related li:first-child h3.rh-card__title',
			{
				'margin-top': '0px',
				'margin-bottom': '0px',
				'font-size': 'var(--rh-text-lg)',
				'font-weight': 'var(--rh-weight-heading)',
			},
			'section.rh-related li:first-child article.rh-card'
		);
		await holds(
			'section.rh-related li:first-child a.rh-card__link',
			{
				color: 'var(--rh-color-text)',
				'text-decoration-line': 'none',
			},
			'section.rh-related li:first-child article.rh-card'
		);
		await holds(
			'section.rh-related li:first-child p.rh-card__summary',
			{
				'margin-top': '0px',
				'margin-bottom': '0px',
				color: 'var(--rh-color-text-muted)',
			},
			'section.rh-related li:first-child article.rh-card'
		);
		await expect(
			rows.nth( 0 ).locator( '.rh-card__meta time' )
		).toHaveText( 'Oct 1, 2026' );
	} );

	test( 'the resource page at 360 px', async ( { page } ) => {
		await page.setViewportSize( { width: 360, height: 800 } );
		await page.goto( seed.host.link );
		const gutter = parseFloat(
			( await resolve( page, 'body', { width: 'var(--rh-space-4)' } ) )
				.width
		);
		const article = await box( page, 'article.rh-resource' );
		expect( article.x ).toBeCloseTo( gutter, 1 );
		expect( article.width ).toBeCloseTo( 360 - 2 * gutter, 1 );
		// The image fills the column and never passes it.
		expect(
			( await box( page, '.rh-resource__media img' ) ).width
		).toBeCloseTo( article.width, 1 );
		expect(
			await page.evaluate( () => document.documentElement.scrollWidth )
		).toBeLessThanOrEqual( 360 );
	} );
} );
