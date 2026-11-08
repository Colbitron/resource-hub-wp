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
 * and compares each with what the package's rule resolves to on the same
 * page: every expected value is a token resolved at runtime by a probe
 * element, never a number written here, so a change to a token moves both
 * sides and this spec with them.
 *
 * It runs against the CMS alone (the front end has its own specs against
 * the mock CMS, `apps/web/e2e/`), at 1280 px, where the shell's width, the
 * measure and the gutters all show, and at 360 px for the gutter.
 */
const { test, expect } = require( './fixtures' );

/** The page's body: a paragraph with a link, a section heading, a list, a captioned table and a quote. */
const CONTENT = [
	'<!-- wp:paragraph --><p>An opening paragraph with <a href="/resources/">a link to the library</a>, long enough to run past the measure on a wide screen, so the column shows.</p><!-- /wp:paragraph -->',
	'<!-- wp:heading --><h2 class="wp-block-heading">A section heading</h2><!-- /wp:heading -->',
	'<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>One item</li><!-- /wp:list-item --><!-- wp:list-item --><li>Another item</li><!-- /wp:list-item --></ul><!-- /wp:list -->',
	'<!-- wp:table --><figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>First</td><td>1</td></tr><tr><td>Second</td><td>2</td></tr></tbody></table><figcaption class="wp-element-caption">Two rows of sample values</figcaption></figure><!-- /wp:table -->',
	'<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>A quoted line.</p><!-- /wp:paragraph --><cite>Someone</cite></blockquote><!-- /wp:quote -->',
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
