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
 * creates with a pick and a topic match. A second resource, made here with a
 * topic of its own so the seeded page's related rows and its screenshots do
 * not change, holds a featured image narrower than the column to its own
 * width and a related-resources block in its body to `related.css`'s
 * heading, and a page with the same block holds `related.css` to a page's
 * body too, the one page outside the resource template that loads it. The
 * first describe also checks the resource page's two stylesheets stay off a
 * page without the block, the welcome and the 404.
 *
 * The fourth describe does the same for the search page, rendered by the
 * theme's search template and the plugin's search blocks (`listing.css`,
 * `search.css` and `card.css` over the head, the form, the count, both row
 * shapes, the empty state and core's pagination block), as `/?s=…`, the
 * form the tests site's plain permalinks give it, with the collections'
 * content and a few pages made for it; its last test holds `search.css` to
 * the search page alone and `header-search.css` to every page but the 404.
 *
 * The third describe does the same for the collection pages, rendered by
 * the theme's collection templates and the plugin's collection blocks
 * (`listing.css`, `lead.css`, `card.css`, and the theme's `assets/pagination.css`
 * over core's pagination block): the library with its lead, a type and a
 * topic collection, the filter bar's state, the rows' levels and the
 * pagination. The tests site has plain permalinks, so each collection is
 * requested by the query vars the plugin's rewrite rules map to
 * (`?post_type=resource`, `?resource_type=…`, `?resource_topic=…`, `&paged=2`);
 * the rules themselves are PHPUnit's (`RoutesTest`). Its last test holds
 * `listing.css` to the collections and `lead.css` to the library's first
 * page, and keeps both off a page, the welcome, the 404 and a resource.
 */
const { test, expect } = require( './fixtures' );
const {
	seedResourcePage,
	deleteResourcePage,
	flatPng,
} = require( './resource-page-seed' );
const {
	createCollection,
	deleteCollection,
	COUNT,
} = require( './collection-content' );

/** Resources to a page on a collection, the front end's `RESOURCES_PER_PAGE`. */
const PER_PAGE = 12;

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

	test( "the resource page's stylesheets stay off a page, the welcome and the 404", async ( {
		page,
	} ) => {
		// `?p=` with an ID no post has is a 404 under any permalink structure;
		// the tests site has none, so an unknown path would be the welcome.
		for ( const [ url, status ] of [
			[ cmsPage.link, 200 ],
			[ '/', 200 ],
			[ '/?p=999999999', 404 ],
		] ) {
			const response = await page.goto( url );
			expect( response.status(), url ).toBe( status );
			for ( const id of [
				'resource-hub-resource',
				'resource-hub-related',
			] ) {
				await expect(
					page.locator( `link#${ id }-css` ),
					`${ id } on ${ url }`
				).toHaveCount( 0 );
			}
		}
		// The 404 is the theme's, with its own stylesheet.
		await expect(
			page.locator( 'link#resource-hub-not-found-css' )
		).toHaveCount( 1 );
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

/**
 * related.css's rule for a related-resources block's heading inside a body
 * (`.rh-prose .rh-related > h2`), which outranks prose.css's h2 margins and
 * size, on a resource and on a page alike. The probe takes the heading's
 * size, so the tracking and the leading resolve in it.
 */
const BODY_RELATED_HEADING = {
	'margin-top': '0px',
	'margin-bottom': '0px',
	'padding-bottom': 'var(--rh-space-2)',
	'border-bottom-width': 'var(--rh-border-width-strong)',
	'border-bottom-style': 'solid',
	'border-bottom-color': 'var(--rh-color-text)',
	'font-size': 'var(--rh-text-md)',
	'font-weight': 'var(--rh-weight-heading)',
	'letter-spacing': 'var(--rh-tracking-heading)',
	'line-height': 'calc(var(--rh-leading-tight) * var(--rh-text-md))',
};

test.describe( "A CMS resource page computes the front end's styles", () => {
	let seed;
	/** A resource with a narrow featured image and a related-resources block in its body, with its own topic and image. */
	let narrow;
	/** A page with a related-resources block in its body, listing the seeded topic. */
	let blockPage;

	test.beforeAll( async ( { requestUtils } ) => {
		seed = await seedResourcePage( requestUtils );
		const stamp = Date.now();
		const topic = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_topic',
			data: { name: 'Narrow topic', slug: `narrow-topic-${ stamp }` },
		} );
		const media = await requestUtils.uploadMedia( {
			name: `narrow-featured-${ stamp }.png`,
			mimeType: 'image/png',
			buffer: flatPng( 240, 135, [ 0x6b, 0x9e, 0x9a ] ),
		} );
		const resource = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				status: 'publish',
				title: 'A resource with a narrow image',
				slug: `narrow-resource-${ stamp }`,
				resource_type: [ seed.type.id ],
				resource_topic: [ topic.id ],
				featured_media: media.id,
				// The seeded topic's resources, under a body block's heading.
				content: `<!-- wp:paragraph --><p>A paragraph before the block.</p><!-- /wp:paragraph -->\n\n<!-- wp:resource-hub/related-resources {"topic":${ seed.topic.id }} /-->`,
				meta: {
					summary:
						'A resource whose image is narrower than the column.',
				},
			},
		} );
		narrow = { topic, media, resource };
		blockPage = await requestUtils.createPage( {
			title: `Related block page ${ stamp }`,
			status: 'publish',
			content: `<!-- wp:paragraph --><p>A paragraph before the block.</p><!-- /wp:paragraph -->\n\n<!-- wp:resource-hub/related-resources {"topic":${ seed.topic.id }} /-->`,
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		const remove = ( path ) =>
			requestUtils.rest( {
				method: 'DELETE',
				path,
				params: { force: true },
			} );
		if ( blockPage ) {
			await remove( `/wp/v2/pages/${ blockPage.id }` );
		}
		if ( narrow ) {
			await remove( `/wp/v2/resources/${ narrow.resource.id }` );
			await remove( `/wp/v2/media/${ narrow.media.id }` );
			await remove( `/wp/v2/resource_topic/${ narrow.topic.id }` );
		}
		if ( seed ) {
			await deleteResourcePage( requestUtils, seed );
		}
	} );

	test( 'a featured image narrower than the column keeps its own width, as resource.css draws it', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( narrow.resource.link );

		// Its own size inside the wider column: core's post-featured-image
		// style, which the theme leaves out, would stretch it to `width: 100%`.
		const image = await box( page, '.rh-resource__media img' );
		const article = await box( page, 'article.rh-resource' );
		expect( article.width ).toBeGreaterThan( 240 );
		expect( image.width ).toBeCloseTo( 240, 1 );
		expect( image.height ).toBeCloseTo( 135, 1 );
		await expect(
			page.locator(
				'#wp-block-post-featured-image-css, #wp-block-post-featured-image-inline-css'
			)
		).toHaveCount( 0 );
	} );

	test( "a related-resources block in the body takes related.css's heading, which the theme loads for the page", async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( narrow.resource.link );

		const block = page.locator(
			'.rh-resource__body.rh-prose > .rh-related[data-rh-block="related-resources"]'
		);
		await expect( block ).toHaveCount( 1 );
		await expect( block.locator( 'article.rh-card' ) ).toHaveCount( 3 );
		// No related section of the page's own: nothing shares its topic.
		await expect(
			page.locator( 'article.rh-resource > section.rh-related' )
		).toHaveCount( 0 );

		// related.css's heading rule, which outranks prose.css's h2 margins
		// and size; the probe takes the heading's size, so the tracking and
		// the leading resolve in it.
		const selector =
			'.rh-resource__body .rh-related[data-rh-block="related-resources"] > h2';
		expect(
			await computed(
				page,
				selector,
				Object.keys( BODY_RELATED_HEADING )
			)
		).toEqual(
			await resolve(
				page,
				'.rh-resource__body .rh-related[data-rh-block="related-resources"]',
				BODY_RELATED_HEADING
			)
		);
	} );

	test( "a page with a related-resources block in its body loads related.css, and only it of the resource page's two, so its heading takes the same rule", async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		const response = await page.goto( blockPage.link );
		expect( response.status() ).toBe( 200 );

		// The page's stylesheets, with related.css for the block; not resource.css.
		for ( const [ id, count ] of [
			[ 'resource-hub-page', 1 ],
			[ 'resource-hub-prose', 1 ],
			[ 'resource-hub-related', 1 ],
			[ 'resource-hub-resource', 0 ],
		] ) {
			await expect( page.locator( `link#${ id }-css` ), id ).toHaveCount(
				count
			);
		}

		const block = page.locator(
			'.rh-page__body.rh-prose > .rh-related[data-rh-block="related-resources"]'
		);
		await expect( block ).toHaveCount( 1 );
		await expect( block.locator( 'article.rh-card' ) ).toHaveCount( 3 );

		const selector =
			'.rh-page__body .rh-related[data-rh-block="related-resources"] > h2';
		expect(
			await computed(
				page,
				selector,
				Object.keys( BODY_RELATED_HEADING )
			)
		).toEqual(
			await resolve(
				page,
				'.rh-page__body .rh-related[data-rh-block="related-resources"]',
				BODY_RELATED_HEADING
			)
		);
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

test.describe( "A CMS collection computes the front end's styles", () => {
	let content;

	test.beforeAll( async ( { requestUtils } ) => {
		content = await createCollection( requestUtils, Date.now() );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		if ( content ) {
			await deleteCollection( requestUtils, content );
		}
	} );

	/**
	 * Holds the element `selector` matches to `declarations`, resolved on a
	 * probe inside `context`.
	 *
	 * @param {import('@playwright/test').Page} page         The page.
	 * @param {string}                          selector     The element on the CMS page.
	 * @param {Record<string, string>}          declarations What the package's rule declares.
	 * @param {string}                          [context]    Where the tokens resolve; `main` by default.
	 */
	async function holds(
		page,
		selector,
		declarations,
		context = 'main.rh-main'
	) {
		expect(
			await computed( page, selector, Object.keys( declarations ) ),
			selector
		).toEqual( await resolve( page, context, declarations ) );
	}

	for ( const colorScheme of [ 'light', 'dark' ] ) {
		test( `the library: the head, the filters, the lead, the list and the pagination (${ colorScheme })`, async ( {
			page,
		} ) => {
			await page.emulateMedia( { colorScheme } );
			await page.setViewportSize( { width: 1280, height: 900 } );
			await page.goto( '/?post_type=resource' );

			// The head: listing.css's header row, the one h1 and the muted count.
			await expect( page.locator( 'h1' ) ).toHaveCount( 1 );
			await expect( page.locator( 'h1#rh-listing-heading' ) ).toHaveText(
				'Resources'
			);
			await holds( page, '.rh-listing__header', {
				display: 'flex',
				'flex-wrap': 'wrap',
				'align-items': 'baseline',
				'column-gap': 'var(--rh-space-4)',
				'row-gap': 'var(--rh-space-1)',
				'margin-bottom': 'var(--rh-space-4)',
			} );
			await expect( page.locator( '.rh-listing__count' ) ).toContainText(
				'resources'
			);
			await holds( page, '.rh-listing__count', {
				color: 'var(--rh-color-text-muted)',
				'margin-top': '0px',
			} );

			// The filters: two labelled rows between hairlines, plain links at
			// least 2rem tall, the current one heavier with the strong underline.
			const nav = page.getByRole( 'navigation', {
				name: 'Filter resources',
			} );
			await expect( nav ).toHaveCount( 1 );
			await holds( page, 'nav.rh-filters', {
				'border-top-width': 'var(--rh-border-width)',
				'border-top-color': 'var(--rh-color-border)',
				'border-bottom-width': 'var(--rh-border-width)',
				'margin-bottom': 'var(--rh-space-6)',
			} );
			await holds( page, '#rh-filter-type.rh-filters__name', {
				'text-transform': 'uppercase',
				'font-size': 'var(--rh-text-sm)',
				'letter-spacing': 'var(--rh-tracking-label)',
				color: 'var(--rh-color-text-muted)',
			} );
			await holds(
				page,
				'#rh-filter-type + .rh-filters__list li:nth-child(2) .rh-filters__link',
				{
					display: 'inline-flex',
					'min-height': '2rem',
					'font-size': 'var(--rh-text-sm)',
					color: 'var(--rh-color-text)',
					'text-decoration-line': 'none',
					'font-weight': '400',
				}
			);
			const currentAll = page.locator(
				'.rh-filters__link[aria-current="true"]'
			);
			await expect( currentAll ).toHaveCount( 2 );
			await expect( currentAll.first() ).toHaveText( 'All types' );
			await holds(
				page,
				'#rh-filter-type + .rh-filters__list .rh-filters__link[aria-current="true"]',
				{
					'font-weight': '600',
					'text-decoration-line': 'underline',
					'text-decoration-thickness':
						'var(--rh-border-width-strong)',
				}
			);
			expect(
				(
					await page
						.locator( '.rh-filters__link' )
						.first()
						.boundingBox()
				).height
			).toBeGreaterThanOrEqual( 32 );

			// The lead: the Featured heading over its strong rule, then the
			// lead's two columns, the image's box and the title at xl.
			await expect( page.locator( '.rh-listing__lead' ) ).toHaveCount(
				1
			);
			await holds( page, '.rh-listing__lead', {
				'margin-bottom': 'var(--rh-space-7)',
			} );
			await holds( page, '.rh-listing__lead > .rh-listing__section', {
				'border-bottom-width': 'var(--rh-border-width-strong)',
				'border-bottom-color': 'var(--rh-color-text)',
				'font-size': 'var(--rh-text-md)',
				'margin-bottom': 'var(--rh-space-5)',
				'padding-bottom': 'var(--rh-space-2)',
			} );
			await expect( page.locator( '.rh-lead' ) ).toHaveCount( 1 );
			await holds( page, '.rh-lead', {
				display: 'flex',
				'flex-wrap': 'wrap',
				'column-gap': 'var(--rh-space-6)',
				'row-gap': 'var(--rh-space-5)',
			} );
			await holds( page, '.rh-lead__media', {
				'aspect-ratio': '16 / 9',
				'border-top-left-radius': 'var(--rh-radius)',
				'background-color': 'var(--rh-color-surface-raised)',
				overflow: 'hidden',
			} );
			const img = page.locator( '.rh-lead__media > img' );
			await expect( img ).toHaveAttribute( 'width', /^[1-9][0-9]*$/ );
			await expect( img ).toHaveAttribute( 'height', /^[1-9][0-9]*$/ );
			await expect( img ).toHaveAttribute( 'fetchpriority', 'high' );
			await expect( img ).toHaveAttribute( 'loading', 'eager' );
			await expect( img ).toHaveAttribute(
				'sizes',
				'(min-width: 72rem) 39rem, (min-width: 44rem) 58vw, 100vw'
			);
			await expect( img ).toHaveJSProperty( 'complete', true );
			const media = await box( page, '.rh-lead__media' );
			const body = await box( page, '.rh-lead__body' );
			expect( body.x, 'two columns at 1280 px' ).toBeGreaterThan(
				media.x + media.width
			);
			expect( media.width / media.height ).toBeCloseTo( 16 / 9, 1 );
			await holds(
				page,
				'.rh-lead__title',
				{
					'font-size': 'var(--rh-text-xl)',
					'margin-top': '0px',
					'margin-bottom': '0px',
				},
				'.rh-lead__body'
			);
			await holds(
				page,
				'.rh-lead__summary',
				{
					'font-size': 'var(--rh-text-md)',
					color: 'var(--rh-color-text-muted)',
					'max-width': 'var(--rh-measure)',
				},
				'.rh-lead__body'
			);
			await expect( page.locator( 'h3.rh-lead__title' ) ).toHaveText(
				content.lead.title.raw
			);
			// The lead's meta line is the row's, laid as one line.
			await expect(
				page.locator( '.rh-lead .rh-card__type' )
			).toHaveText( 'Guide' );
			await holds( page, '.rh-lead .rh-card__meta', {
				'flex-grow': '0',
				'flex-shrink': '0',
			} );

			// The list under "Latest": the heading's rule with no space under
			// it, eleven rows at h3, the lead not among them, and the page's one
			// image is the lead's.
			const latest = page.locator( '.rh-listing__latest' );
			await expect( latest ).toHaveCount( 1 );
			await expect(
				latest.locator( '> .rh-listing__section' )
			).toHaveText( 'Latest' );
			await holds( page, '.rh-listing__latest > .rh-listing__section', {
				'margin-bottom': '0px',
				'border-bottom-width': 'var(--rh-border-width-strong)',
			} );
			// Twelve on the page, one of them the lead, so eleven rows.
			const rows = latest.locator( 'ul.rh-card-grid > li' );
			await expect( rows ).toHaveCount( PER_PAGE - 1 );
			await expect( latest.locator( 'h3.rh-card__title' ) ).toHaveCount(
				PER_PAGE - 1
			);
			await expect( latest.locator( 'h2.rh-card__title' ) ).toHaveCount(
				0
			);
			await expect(
				latest.getByRole( 'link', { name: content.lead.title.raw } )
			).toHaveCount( 0 );
			await expect( page.locator( 'main img' ) ).toHaveCount( 1 );
			// card.css's rows: a hairline under each, the first row's top
			// padding its own, and no margin from core's flow layout.
			await holds( page, 'ul.rh-card-grid > li:first-child', {
				'border-bottom-width': 'var(--rh-border-width)',
				'border-bottom-color': 'var(--rh-color-border)',
				'margin-top': '0px',
				'margin-bottom': '0px',
			} );
			await holds( page, 'ul.rh-card-grid > li:nth-child(2)', {
				'margin-top': '0px',
			} );
			await holds( page, 'ul.rh-card-grid', {
				'margin-top': '0px',
				'margin-bottom': '0px',
				'padding-left': '0px',
			} );

			// The pagination: core's block as listing.css's, on a strong rule,
			// each link a box at least 2.5rem square, the current number heavier
			// with the strong underline, Next at the right edge and no Previous.
			const pagination = page.getByRole( 'navigation', {
				name: 'Pagination',
			} );
			await expect( pagination ).toHaveCount( 1 );
			await expect( pagination ).toHaveClass( /rh-pagination/ );
			await holds( page, 'nav.rh-pagination', {
				'margin-top': 'var(--rh-space-7)',
				'padding-top': 'var(--rh-space-3)',
				'border-top-width': 'var(--rh-border-width-strong)',
				'border-top-color': 'var(--rh-color-text)',
				display: 'flex',
				'align-items': 'center',
				'column-gap': 'var(--rh-space-1)',
			} );
			await holds( page, '.rh-pagination .page-numbers.current', {
				'font-weight': 'var(--rh-weight-heading)',
				'text-decoration-line': 'underline',
				'text-decoration-thickness': 'var(--rh-border-width-strong)',
				'min-width': '2.5rem',
				'min-height': '2.5rem',
				'font-variant-numeric': 'tabular-nums',
				color: 'var(--rh-color-text)',
			} );
			await expect(
				page.locator( '.rh-pagination .page-numbers.current' )
			).toHaveText( '1' );
			await holds( page, '.rh-pagination a.page-numbers', {
				'font-weight': '600',
				'text-decoration-line': 'none',
				'min-height': '2.5rem',
			} );
			await expect(
				page.locator(
					'.rh-pagination .wp-block-query-pagination-previous'
				)
			).toHaveCount( 0 );
			const next = page.locator(
				'.rh-pagination .wp-block-query-pagination-next'
			);
			await expect( next ).toHaveText( 'Next' );
			const navBox = await box( page, 'nav.rh-pagination' );
			const nextBox = await box(
				page,
				'.rh-pagination .wp-block-query-pagination-next'
			);
			expect( nextBox.x + nextBox.width ).toBeCloseTo(
				navBox.x + navBox.width,
				0
			);
			expect( nextBox.height ).toBeGreaterThanOrEqual( 40 );
		} );
	}

	test( 'a type collection: its heading, its current filters, no lead, rows at h2', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( `/?resource_type=${ content.type.slug }` );

		await expect( page.locator( 'h1#rh-listing-heading' ) ).toHaveText(
			'Guide resources'
		);
		await expect( page.locator( '.rh-listing__count' ) ).toHaveText(
			`${ COUNT } resources`
		);
		const current = page.locator(
			'.rh-filters__link[aria-current="true"]'
		);
		await expect( current ).toHaveCount( 2 );
		await expect( current.nth( 0 ) ).toHaveText( 'Guide' );
		await expect( current.nth( 1 ) ).toHaveText( 'All topics' );
		// A topic link keeps the type; "All types" clears it.
		await expect(
			page.getByRole( 'link', { name: 'Caching', exact: true } )
		).toHaveAttribute(
			'href',
			new RegExp(
				`/resources/${ content.type.slug }/topic/${ content.topics[ 0 ].slug }/$`
			)
		);
		await expect(
			page.getByRole( 'link', { name: 'All types' } )
		).toHaveAttribute( 'href', /\/resources\/$/ );
		await expect( page.locator( '.rh-lead' ) ).toHaveCount( 0 );
		await expect( page.locator( '.rh-listing__latest' ) ).toHaveCount( 0 );
		await expect( page.locator( 'h2.rh-card__title' ) ).toHaveCount(
			PER_PAGE
		);
		await expect( page.locator( 'h3.rh-card__title' ) ).toHaveCount( 0 );
		await expect( page.locator( 'main img' ) ).toHaveCount( 0 );
	} );

	test( 'a topic collection, and its second page', async ( { page } ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		const topic = content.topics[ 0 ];
		await page.goto( `/?resource_topic=${ topic.slug }` );

		await expect( page.locator( 'h1#rh-listing-heading' ) ).toHaveText(
			'Resources on Caching'
		);
		const current = page.locator(
			'.rh-filters__link[aria-current="true"]'
		);
		await expect( current.nth( 0 ) ).toHaveText( 'All types' );
		await expect( current.nth( 1 ) ).toHaveText( 'Caching' );
		await expect( page.locator( '.rh-lead' ) ).toHaveCount( 0 );
		await expect( page.locator( 'article.rh-card' ) ).toHaveCount(
			PER_PAGE
		);

		// Page 2: Previous at the left edge, the current number 2, no Next, and the one row left.
		await page.goto( `/?resource_topic=${ topic.slug }&paged=2` );
		await expect( page.locator( 'h1#rh-listing-heading' ) ).toHaveText(
			'Resources on Caching'
		);
		await expect( page.locator( 'article.rh-card' ) ).toHaveCount(
			COUNT - PER_PAGE
		);
		await expect(
			page.locator( '.rh-pagination .page-numbers.current' )
		).toHaveText( '2' );
		await expect(
			page.locator( '.rh-pagination .wp-block-query-pagination-next' )
		).toHaveCount( 0 );
		const previous = page.locator(
			'.rh-pagination .wp-block-query-pagination-previous'
		);
		await expect( previous ).toHaveText( 'Previous' );
		const navBox = await box( page, 'nav.rh-pagination' );
		const previousBox = await box(
			page,
			'.rh-pagination .wp-block-query-pagination-previous'
		);
		expect( previousBox.x ).toBeCloseTo( navBox.x, 0 );
	} );

	test( 'the library at 360 px: one column, the lead stacked, nothing sideways', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 360, height: 800 } );
		await page.goto( '/?post_type=resource' );

		const media = await box( page, '.rh-lead__media' );
		const body = await box( page, '.rh-lead__body' );
		const gutter = parseFloat(
			( await resolve( page, 'body', { width: 'var(--rh-space-4)' } ) )
				.width
		);
		expect( media.x ).toBeCloseTo( gutter, 1 );
		expect( media.width ).toBeCloseTo( 360 - 2 * gutter, 1 );
		expect( body.x ).toBeCloseTo( media.x, 1 );
		expect(
			await page.evaluate( () => document.documentElement.scrollWidth )
		).toBeLessThanOrEqual( 360 );
	} );

	test( "the collections' stylesheets load on the collections only, and the lead's on the library's first page only", async ( {
		page,
		requestUtils,
	} ) => {
		const cmsPage = await requestUtils.createPage( {
			title: `Collection styles sample ${ Date.now() }`,
			content:
				'<!-- wp:paragraph --><p>A page.</p><!-- /wp:paragraph -->',
			status: 'publish',
		} );
		const topic = content.topics[ 0 ];
		try {
			// [ url, status, listing.css, lead.css ]. `?p=` with an ID no post
			// has is a 404 under any permalink structure; the tests site has
			// none, so an unknown path would be the welcome.
			for ( const [ url, status, listing, lead ] of [
				[ cmsPage.link, 200, false, false ],
				[ '/', 200, false, false ],
				[ '/?p=999999999', 404, false, false ],
				[ content.lead.link, 200, false, false ],
				[ '/?post_type=resource', 200, true, true ],
				[ '/?post_type=resource&paged=2', 200, true, false ],
				[ `/?resource_type=${ content.type.slug }`, 200, true, false ],
				[ `/?resource_topic=${ topic.slug }`, 200, true, false ],
			] ) {
				const response = await page.goto( url );
				expect( response.status(), url ).toBe( status );
				await expect(
					page.locator( 'link#resource-hub-listing-css' ),
					`listing.css on ${ url }`
				).toHaveCount( listing ? 1 : 0 );
				await expect(
					page.locator( 'link#resource-hub-lead-css' ),
					`lead.css on ${ url }`
				).toHaveCount( lead ? 1 : 0 );
			}
		} finally {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/pages/${ cmsPage.id }`,
				params: { force: true },
			} );
		}
	} );
} );

test.describe( "A CMS search page computes the front end's styles", () => {
	let content;
	let pages = [];
	/** Enough pages with one word for a second page of results. */
	const PAGES = PER_PAGE + 1;

	test.beforeAll( async ( { requestUtils } ) => {
		const stamp = Date.now();
		content = await createCollection( requestUtils, stamp );
		pages = [];
		for ( let i = 1; i <= PAGES; i++ ) {
			pages.push(
				await requestUtils.createPage( {
					title:
						i === 1
							? `Caching quokka page ${ stamp }`
							: `Quokka page ${ i } ${ stamp }`,
					content:
						'<!-- wp:paragraph --><p>A page the search finds.</p><!-- /wp:paragraph -->',
					excerpt: `What quokka page ${ i } is about.`,
					status: 'publish',
				} )
			);
		}
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const page of pages ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/pages/${ page.id }`,
				params: { force: true },
			} );
		}
		if ( content ) {
			await deleteCollection( requestUtils, content );
		}
	} );

	/**
	 * Holds the element `selector` matches to `declarations`, resolved on a
	 * probe inside `context`.
	 *
	 * @param {import('@playwright/test').Page} page         The page.
	 * @param {string}                          selector     The element on the CMS page.
	 * @param {Record<string, string>}          declarations What the package's rule declares.
	 * @param {string}                          [context]    Where the tokens resolve; `main` by default.
	 */
	async function holds(
		page,
		selector,
		declarations,
		context = 'main.rh-main'
	) {
		expect(
			await computed( page, selector, Object.keys( declarations ) ),
			selector
		).toEqual( await resolve( page, context, declarations ) );
	}

	for ( const colorScheme of [ 'light', 'dark' ] ) {
		test( `the results: the head, the form, the count, a page row beside the resource rows (${ colorScheme })`, async ( {
			page,
		} ) => {
			await page.emulateMedia( { colorScheme } );
			await page.setViewportSize( { width: 1280, height: 900 } );
			// Two collection resources and one page hold "caching" in their titles.
			await page.goto( '/?s=caching' );

			// The head: listing.css's header row and the one h1.
			await expect( page.locator( 'h1' ) ).toHaveCount( 1 );
			await expect(
				page.getByRole( 'main' ).getByRole( 'heading', { level: 1 } )
			).toHaveText( 'Search' );
			await holds( page, '.rh-listing__header', {
				display: 'flex',
				'align-items': 'baseline',
				'margin-bottom': 'var(--rh-space-4)',
			} );

			// The form: search.css's column at the measure, the label's weight,
			// the row that wraps, the field's strong edge and the filled button.
			const form = page.getByRole( 'search' );
			await expect( form ).toHaveCount( 1 );
			await expect( form ).toHaveAttribute( 'method', 'get' );
			await holds( page, 'form.rh-search', {
				display: 'flex',
				'flex-direction': 'column',
				'row-gap': 'var(--rh-space-2)',
				'max-width': 'var(--rh-measure)',
				'margin-bottom': 'var(--rh-space-6)',
			} );
			await holds( page, '.rh-search__label', { 'font-weight': '600' } );
			await holds( page, '.rh-search__row', {
				display: 'flex',
				'flex-wrap': 'wrap',
				'column-gap': 'var(--rh-space-2)',
			} );
			await holds( page, '.rh-search__input', {
				'min-height': '2.5rem',
				'padding-top': 'var(--rh-space-2)',
				'padding-left': 'var(--rh-space-3)',
				'border-top-width': 'var(--rh-border-width)',
				'border-top-color': 'var(--rh-color-border-strong)',
				'border-top-left-radius': 'var(--rh-radius-sm)',
				'background-color': 'var(--rh-color-surface)',
				color: 'var(--rh-color-text)',
				'font-family': 'var(--rh-font-sans)',
				'font-size': 'var(--rh-text-base)',
			} );
			await expect( page.locator( '.rh-search__input' ) ).toHaveValue(
				'caching'
			);
			await expect( page.locator( '.rh-search__input' ) ).toHaveAttribute(
				'aria-describedby',
				'rh-search-message'
			);
			await holds( page, '.rh-search__button', {
				'min-height': '2.5rem',
				'padding-left': 'var(--rh-space-4)',
				'border-top-color': 'var(--rh-color-text)',
				'border-top-left-radius': 'var(--rh-radius-sm)',
				'background-color': 'var(--rh-color-text)',
				color: 'var(--rh-color-surface)',
				'font-weight': '600',
				'font-family': 'var(--rh-font-sans)',
			} );

			// The count: muted, tabular, under the form.
			await expect( page.locator( '#rh-search-message' ) ).toHaveText(
				'3 results for “caching”'
			);
			await holds( page, '.rh-search__summary', {
				color: 'var(--rh-color-text-muted)',
				'margin-top': '0px',
				'margin-bottom': 'var(--rh-space-2)',
				'font-variant-numeric': 'tabular-nums',
			} );

			// Three rows at h2, one of them a page's: the "Page" label as the
			// type's label without its mark, and no type, date or topics.
			const rows = page.locator( 'ul.rh-card-grid > li' );
			await expect( rows ).toHaveCount( 3 );
			await expect( page.locator( 'h2.rh-card__title' ) ).toHaveCount(
				3
			);
			const pageRow = page.locator( 'article.rh-card', {
				has: page.locator( '.rh-card__kind' ),
			} );
			await expect( pageRow ).toHaveCount( 1 );
			await expect( pageRow.locator( '.rh-card__kind' ) ).toHaveText(
				'Page'
			);
			await expect( pageRow.locator( '.rh-card__type' ) ).toHaveCount(
				0
			);
			await expect( pageRow.locator( 'time' ) ).toHaveCount( 0 );
			await expect( pageRow.locator( '.rh-card__topics' ) ).toHaveCount(
				0
			);
			await holds( page, '.rh-card__kind', {
				'text-transform': 'uppercase',
				'font-weight': '600',
				'letter-spacing': 'var(--rh-tracking-label)',
				color: 'var(--rh-color-text)',
			} );
			await expect(
				page.locator( 'article.rh-card .rh-card__type' )
			).toHaveCount( 2 );
			await holds( page, 'ul.rh-card-grid > li:first-child', {
				'border-bottom-width': 'var(--rh-border-width)',
				'border-bottom-color': 'var(--rh-color-border)',
				'margin-top': '0px',
			} );
			await expect( page.locator( 'nav.rh-pagination' ) ).toHaveCount(
				0
			);
			await expect( page.locator( '.rh-listing__empty' ) ).toHaveCount(
				0
			);
		} );
	}

	test( 'many results paginate as the collections do, and none shows the empty state', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 1280, height: 900 } );
		await page.goto( '/?s=quokka' );
		await expect( page.locator( '#rh-search-message' ) ).toHaveText(
			`${ PAGES } results for “quokka”`
		);
		await expect( page.locator( 'ul.rh-card-grid > li' ) ).toHaveCount(
			PER_PAGE
		);
		await expect( page.locator( '.rh-card__kind' ) ).toHaveCount(
			PER_PAGE
		);

		// The pagination: core's block as listing.css's, the current number
		// heavier with the strong underline, Next at the right edge.
		const pagination = page.getByRole( 'navigation', {
			name: 'Pagination',
		} );
		await expect( pagination ).toHaveCount( 1 );
		await expect( pagination ).toHaveClass( /rh-pagination/ );
		await holds( page, 'nav.rh-pagination', {
			'margin-top': 'var(--rh-space-7)',
			'padding-top': 'var(--rh-space-3)',
			'border-top-width': 'var(--rh-border-width-strong)',
			'border-top-color': 'var(--rh-color-text)',
			display: 'flex',
		} );
		await holds( page, '.rh-pagination .page-numbers.current', {
			'font-weight': 'var(--rh-weight-heading)',
			'text-decoration-line': 'underline',
			'text-decoration-thickness': 'var(--rh-border-width-strong)',
			'min-width': '2.5rem',
			'min-height': '2.5rem',
		} );
		await expect(
			page.locator( '.rh-pagination .page-numbers.current' )
		).toHaveText( '1' );
		await expect(
			page.locator( '.rh-pagination .wp-block-query-pagination-previous' )
		).toHaveCount( 0 );
		const next = page.locator(
			'.rh-pagination .wp-block-query-pagination-next'
		);
		await expect( next ).toHaveText( 'Next' );
		await expect( next ).toHaveAttribute( 'href', /s=quokka/ );

		// The second page: one row, Previous, the count unchanged.
		await next.click();
		await expect( page ).toHaveURL( /paged=2/ );
		await expect( page.locator( 'ul.rh-card-grid > li' ) ).toHaveCount(
			PAGES - PER_PAGE
		);
		await expect( page.locator( '#rh-search-message' ) ).toHaveText(
			`${ PAGES } results for “quokka”`
		);
		await expect(
			page.locator( '.rh-pagination .wp-block-query-pagination-previous' )
		).toHaveText( 'Previous' );

		// A page past the last: a 200, the count kept, the sentence and the way back.
		const past = await page.goto( '/?s=quokka&paged=3' );
		expect( past.status() ).toBe( 200 );
		await expect( page.locator( '#rh-search-message' ) ).toHaveText(
			`${ PAGES } results for “quokka”`
		);
		await expect( page.locator( '.rh-listing__empty' ) ).toHaveText(
			'There are no results on page 3.Go to the first page of results'
		);
		await expect( page.locator( 'nav.rh-pagination' ) ).toHaveCount( 0 );

		// No results: listing.css's empty state, with the way to the library.
		await page.goto( '/?s=zebraxyz' );
		await expect( page.locator( 'ul.rh-card-grid' ) ).toHaveCount( 0 );
		await expect( page.locator( '.rh-search__summary' ) ).toHaveCount( 0 );
		await expect( page.locator( '#rh-search-message' ) ).toHaveText(
			'No results for “zebraxyz”.'
		);
		await holds( page, '.rh-listing__empty', {
			'max-width': 'var(--rh-measure)',
			'padding-top': 'var(--rh-space-6)',
		} );
		await expect( page.locator( '.rh-listing__empty a' ) ).toHaveAttribute(
			'href',
			/\/resources\/$/
		);

		// No query: the form alone.
		await page.goto( '/?s=' );
		await expect( page.getByRole( 'search' ) ).toHaveCount( 1 );
		await expect( page.locator( '.rh-listing__empty' ) ).toHaveCount( 0 );
		await expect( page.locator( 'article.rh-card' ) ).toHaveCount( 0 );
		await expect( page.locator( '.rh-search__input' ) ).not.toHaveAttribute(
			'aria-describedby',
			/.+/
		);

		// A query too short: the field marked invalid and the sentence.
		await page.goto( '/?s=a' );
		await expect( page.locator( '.rh-search__input' ) ).toHaveAttribute(
			'aria-invalid',
			'true'
		);
		await expect( page.locator( '#rh-search-message' ) ).toHaveText(
			'Enter at least 2 characters to search.'
		);
		await expect( page.locator( 'article.rh-card' ) ).toHaveCount( 0 );
	} );

	test( 'the search page at 360 px: the form in the gutter, nothing sideways', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 360, height: 800 } );
		await page.goto( '/?s=caching' );
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth
			)
		).toBe( true );
		const main = await box( page, 'main.rh-main' );
		const form = await box( page, 'form.rh-search' );
		expect( form.x ).toBeCloseTo( main.x, 0 );
		expect( form.width ).toBeLessThanOrEqual( 360 - 2 * 16 + 0.5 );
		const input = await box( page, '.rh-search__input' );
		expect( input.width ).toBeGreaterThanOrEqual( 12 * 16 );
		await expect( page.locator( 'ul.rh-card-grid > li' ) ).toHaveCount( 3 );
	} );

	test( "search.css loads on the search page alone, and the header control's stylesheet on every page but the 404", async ( {
		page,
	} ) => {
		for ( const [ url, status, search, control ] of [
			[ '/?s=caching', 200, true, true ],
			[ '/?s=', 200, true, true ],
			[ '/', 200, false, true ],
			[ '/?post_type=resource', 200, false, true ],
			[ content.lead.link, 200, false, true ],
			[ '/?p=999999999', 404, false, false ],
		] ) {
			const response = await page.goto( url );
			expect( response.status(), url ).toBe( status );
			await expect(
				page.locator( 'link#resource-hub-search-css' ),
				`search.css on ${ url }`
			).toHaveCount( search ? 1 : 0 );
			await expect(
				page.locator( 'link#resource-hub-listing-css' ),
				`listing.css on ${ url }`
			).toHaveCount( search || url === '/?post_type=resource' ? 1 : 0 );
			await expect(
				page.locator( 'link#resource-hub-header-search-css' ),
				`header-search.css on ${ url }`
			).toHaveCount( control ? 1 : 0 );
			await expect(
				page.locator( 'link#resource-hub-header-search-bar-css' ),
				`the bar's stylesheet is never in the HTML, on ${ url }`
			).toHaveCount( 0 );
		}
	} );
} );
