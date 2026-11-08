/**
 * The `resource-hub` theme's stylesheets on a page with the Related
 * Resources block: the shared tokens load once, Figtree and the lockup are
 * applied, and the page follows the system colour scheme.
 *
 * The block and the theme both build on `tokens.css`. They share one
 * stylesheet handle, `resource-hub-tokens` (`src/Blocks/SharedTokens.php`):
 * the block lists it in its `block.json` and the theme enqueues it, and
 * WordPress prints a handle once. So on the CMS's own page, as a logged-in
 * editor previews it, and in the editor canvas, exactly one rule declares
 * the tokens. The count reads every stylesheet the document has, linked or
 * inline, through the CSSOM, so a second copy inlined into another file
 * would count too.
 */
const { test, expect } = require( './fixtures' );

/**
 * How many style rules in the document it runs in declare `--rh-color-text`,
 * the first token in `tokens.css`, as its `light-dark()` pair. Passed to
 * `evaluate()`, so it runs in the page or the frame and reads that document.
 * The value is checked, not only its presence, because Chromium answers
 * every custom property with `inherit` for a rule that sets `all: inherit`,
 * as one of core's editor rules for the RSS block does.
 *
 * @return {number} The count.
 */
function tokenDeclarations() {
	const count = ( rules ) =>
		[ ...rules ].reduce(
			( total, rule ) =>
				total +
				( rule.cssRules ? count( rule.cssRules ) : 0 ) +
				( rule.style
					?.getPropertyValue( '--rh-color-text' )
					.trim()
					.startsWith( 'light-dark(' )
					? 1
					: 0 ),
			0
		);
	return [ ...document.styleSheets ].reduce( ( total, sheet ) => {
		try {
			return total + count( sheet.cssRules );
		} catch {
			// A cross-origin sheet cannot be read; none of ours is one.
			return total;
		}
	}, 0 );
}

test.describe( "The theme's stylesheets", () => {
	let stamp;
	let type;
	let topic;
	let resource;
	let pageWithBlock;

	test.beforeAll( async ( { requestUtils } ) => {
		stamp = Date.now();
		// A published resource needs a title, exactly one type, a topic and a
		// summary (OneType, RequiredFields).
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: {
				name: `E2E assets type ${ stamp }`,
				slug: `e2e-assets-type-${ stamp }`,
			},
		} );
		topic = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_topic',
			data: {
				name: `E2E assets topic ${ stamp }`,
				slug: `e2e-assets-topic-${ stamp }`,
			},
		} );
		resource = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E assets resource ${ stamp }`,
				slug: `e2e-assets-resource-${ stamp }`,
				status: 'publish',
				resource_type: [ type.id ],
				resource_topic: [ topic.id ],
				meta: { summary: 'E2E summary.' },
			},
		} );
		pageWithBlock = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E assets page ${ stamp }`,
				slug: `e2e-assets-page-${ stamp }`,
				status: 'publish',
				content: `<!-- wp:resource-hub/related-resources {"topic":${ topic.id }} /-->`,
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/pages/${ pageWithBlock.id }`,
			params: { force: true },
		} );
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resources/${ resource.id }`,
			params: { force: true },
		} );
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

	test( 'a page with the block loads the tokens once, with Figtree and the lockup', async ( {
		page,
	} ) => {
		await page.goto( pageWithBlock.link );

		// The block rendered, so its stylesheet and its tokens handle are in play.
		await expect(
			page.locator( '[data-rh-block="related-resources"] .rh-card' )
		).toHaveCount( 1 );
		await expect(
			page.locator( 'link#resource-hub-tokens-css' )
		).toHaveAttribute(
			'href',
			/\/themes\/resource-hub\/build\/tokens\.css/
		);
		expect( await page.evaluate( tokenDeclarations ) ).toBe( 1 );

		// Figtree from theme.json's fontFace, first in the body's stack.
		await page.evaluate( () => document.fonts.ready );
		expect(
			await page.evaluate( () => document.fonts.check( '16px Figtree' ) )
		).toBe( true );
		expect(
			await page.evaluate(
				() => window.getComputedStyle( document.body ).fontFamily
			)
		).toMatch( /^"?Figtree"?,/ );

		// The lockup's stylesheet, from the package's brand.css.
		const lockup = page.locator( 'a.rh-brand' );
		await expect( lockup ).toHaveCSS( 'display', 'inline-flex' );
		await expect( lockup.locator( '.rh-brand__mark' ) ).toBeVisible();
	} );

	test( 'the page follows the system colour scheme', async ( { page } ) => {
		await page.goto( pageWithBlock.link );
		const surface = () =>
			page.evaluate(
				() => window.getComputedStyle( document.body ).backgroundColor
			);

		// tokens.css's --rh-color-surface, light and dark.
		await page.emulateMedia( { colorScheme: 'light' } );
		expect( await surface() ).toBe( 'rgb(246, 244, 239)' );
		await page.emulateMedia( { colorScheme: 'dark' } );
		expect( await surface() ).toBe( 'rgb(22, 21, 25)' );
	} );

	test( 'the editor canvas loads the tokens once, and the theme adds nothing around it', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.editPost( pageWithBlock.id );
		await expect(
			editor.canvas.locator(
				'[data-rh-block="related-resources"] .rh-card'
			)
		).toHaveCount( 1 );

		const canvas = page.frame( { name: 'editor-canvas' } );
		expect( canvas ).not.toBeNull();
		expect( await canvas.evaluate( tokenDeclarations ) ).toBe( 1 );
		expect(
			await canvas.evaluate(
				() => window.getComputedStyle( document.body ).fontFamily
			)
		).toMatch( /^"?Figtree"?,/ );

		// The admin page around the canvas gets none of the theme's own files.
		// It does get the tokens once, through the block's handle: core
		// enqueues every registered block's style there.
		await expect(
			page.locator(
				'#resource-hub-figtree-fallback-css, #resource-hub-brand-css'
			)
		).toHaveCount( 0 );
		expect( await page.evaluate( tokenDeclarations ) ).toBe( 1 );
	} );
} );
