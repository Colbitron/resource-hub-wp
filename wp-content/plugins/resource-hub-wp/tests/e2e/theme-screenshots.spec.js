/**
 * Pixel baselines of the CMS theme: a page, a resource, the library with its
 * lead, a topic collection and a page of search results as a logged-in editor
 * previews them, and the 404 every anonymous visitor gets, at 1280 and 360
 * px, in the light and the dark scheme.
 *
 * The second of the two parity checks the owner chose (issue #89), beside
 * the computed styles in `theme-parity.spec.js`: a template, a part, a
 * block's markup or a stylesheet that moves pixels on the CMS shows here as
 * a diff in review. The baselines are the CMS's own, never compared with the
 * front end's; the front end has its own in `apps/web/e2e/__screenshots__/`.
 *
 * Every shot is drawn by Chromium in Playwright's official Linux Docker
 * image, pinned by digest, the image the front end's screenshot gate uses,
 * so the pixels are the same on a laptop and in CI whatever the host's OS
 * and fonts. The spec starts that container itself, with the front end's
 * `BrowserContainer` (`apps/web/e2e/browser-container.mts`, which says how
 * it is pinned and locked down), and connects to it, so it runs inside the
 * plugin's ordinary `pnpm test:e2e`, locally and in CI's plugin gate, with
 * Docker, which wp-env needs anyway. Only the browser runs in the
 * container; it reaches the tests site's port on the host, and only that,
 * through the connection (`exposeNetwork`). Starting it under amd64
 * emulation on Apple silicon, or pulling the image on a cold machine, takes
 * a while, hence the long timeouts.
 *
 * The page, the resource and the collections are shot logged in, with the
 * admin bar hidden and its margin on `<html>` taken off by a style added to
 * the page (`theme-screenshots.css`), since the front end has no admin bar;
 * the 404 is shot anonymously, as visitors get it. The resource is the one
 * `resource-page-seed.js` makes, with fixed titles, dates, a drawn image and
 * a pick and a topic match in its related section, so its baseline moves
 * only when the design does. The collections' content is
 * `collection-content.js`'s: fixed titles, dates and summaries, a type, two
 * topics and thirteen resources, the newest featured with a drawn image, on
 * the tests site, which has plain permalinks, so the library is
 * `/?post_type=resource` and the topic `/?resource_topic=…`. The library
 * lists every published resource on the site, the resource page's seed
 * included, so a spec that left resources behind moves its baseline. The
 * search is `/?s=revalidation`: the two collection resources with the word
 * in their titles and a page made here, so the results show both row
 * shapes; it too lists whatever else on the site holds the word (a topic's
 * name is indexed too, so a search for "caching" would list the whole
 * topic). Every logged-in
 * shot has the header's search control, closed; the 404 has none.
 * Baselines are in `__snapshots__/` beside this file. A missing one
 * fails in CI and is written locally; to change one on purpose, run
 * `pnpm test:e2e -- --update-snapshots` with the same `WP_BASE_URL`, look at
 * the images and commit them with the change. No retry: a difference that
 * comes and goes must fail and be looked at.
 *
 * WordPress is not pinned: wp-env, and so CI, runs the latest release, as the
 * host does with major updates on. So a WordPress release that changes core's
 * markup or CSS can move these pixels with no change here, as a Playwright
 * upgrade (a new pinned image) can; the failure message says so. Look at the
 * diff in the run's artifacts, and when it is core's change and the page still
 * matches the design, regenerate the baselines as above.
 *
 * The container is stopped in `afterAll`, and also on the worker's exit and on
 * SIGINT, SIGTERM and SIGHUP, so a crash or a Ctrl-C does not leave an
 * `rh-playwright-*` container running. Unlike the front end's
 * `screenshots.mts`, which is its own process, a signal here never exits
 * the worker, so `afterAll` still deletes the test page (`stopOnExit`). A
 * worker killed outright (SIGKILL) cannot clean up; `docker ps --filter
 * name=rh-playwright-` finds a container left, and the tests site a page
 * titled "A sample page".
 */
const path = require( 'node:path' );
const { chromium } = require( '@playwright/test' );
const { test, expect } = require( './fixtures' );
const {
	seedResourcePage,
	deleteResourcePage,
} = require( './resource-page-seed' );
const {
	createCollection,
	deleteCollection,
} = require( './collection-content' );

const WIDTHS = [ 1280, 360 ];
const SCHEMES = [ 'light', 'dark' ];

/** The admin bar off and its push on `<html>` undone, added to the page before a logged-in shot. */
const HIDE_ADMIN_BAR = path.join( __dirname, 'theme-screenshots.css' );

/**
 * As the front end's screenshot gate: any change in a pixel's colour counts,
 * and at most 50 pixels of a full page may differ.
 */
const SCREENSHOT = {
	fullPage: true,
	animations: 'disabled',
	threshold: 0,
	maxDiffPixels: 50,
	timeout: 30_000,
};

/** What a failed comparison says, besides the diff. */
const BASELINE_HINT =
	"A CMS screenshot differs from its baseline. If WordPress or Playwright was updated (wp-env runs the latest WordPress; apps/web/e2e/playwright-image.mts pins the image) and the diff in the artifacts is core's change, not a regression, regenerate the baselines with `WP_BASE_URL=<the tests site> pnpm test:e2e -- --update-snapshots` from the repository root, look at the images and commit them";

/** The signals the container is stopped on, besides the worker's exit. */
const SIGNALS = [ 'SIGINT', 'SIGTERM', 'SIGHUP' ];

/** The page's body: fixed copy, so the baseline moves only when the design does. */
const CONTENT = [
	'<!-- wp:paragraph --><p>An opening paragraph with <a href="/resources/">a link to the library</a>, long enough to run past the measure on a wide screen, so the column shows.</p><!-- /wp:paragraph -->',
	'<!-- wp:heading --><h2 class="wp-block-heading">A section heading</h2><!-- /wp:heading -->',
	'<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>One item</li><!-- /wp:list-item --><!-- wp:list-item --><li>Another item</li><!-- /wp:list-item --></ul><!-- /wp:list -->',
	'<!-- wp:table --><figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>First</td><td>1</td></tr><tr><td>Second</td><td>2</td></tr></tbody></table><figcaption class="wp-element-caption">Two rows of sample values</figcaption></figure><!-- /wp:table -->',
	'<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>A quoted line.</p><!-- /wp:paragraph --><cite>Someone</cite></blockquote><!-- /wp:quote -->',
].join( '\n\n' );

test.describe( 'The CMS theme matches its screenshot baselines', () => {
	test.describe.configure( { mode: 'serial', retries: 0, timeout: 120_000 } );

	let container;
	let browser;
	let cmsPage;
	let searchPage;
	let seed;
	let collection;
	/** The process listeners that stop the container, removed in `afterAll`. */
	const listeners = [];

	/**
	 * Stops the container on the worker's exit or a signal, as well as in
	 * `afterAll`. A signal only stops the container: it never exits the
	 * worker, so Playwright's own shutdown still runs `afterAll`, which
	 * deletes the test page (a Ctrl-C reaches the worker as SIGINT while the
	 * runner stops it). Listening for SIGTERM and SIGHUP also takes away
	 * Node's default of exiting on them, so a worker sent one directly keeps
	 * running: its shots fail on the closed browser and `afterAll` cleans up.
	 * `BrowserContainer.stop()` is synchronous and does nothing the second
	 * time.
	 */
	function stopOnExit() {
		const stop = () => container?.stop();
		listeners.push( [ 'exit', stop ] );
		for ( const signal of SIGNALS ) {
			listeners.push( [ signal, stop ] );
		}
		for ( const [ event, listener ] of listeners ) {
			process.on( event, listener );
		}
	}

	test.beforeAll( async ( { requestUtils } ) => {
		// The first start may pull the image and runs Chromium under
		// emulation on Apple silicon.
		test.setTimeout( 600_000 );

		const { BrowserContainer, LAUNCH_HEADERS } =
			await import( '../../../../../apps/web/e2e/browser-container.mts' );
		const { PLAYWRIGHT_IMAGE_VERSION } =
			await import( '../../../../../apps/web/e2e/playwright-image.mts' );
		// The container serves the front end's playwright-core; this runner
		// must be the same version to talk to it.
		expect(
			require( '@playwright/test/package.json' ).version,
			"the plugin's @playwright/test must be the screenshot image's version (apps/web/e2e/playwright-image.mts)"
		).toBe( PLAYWRIGHT_IMAGE_VERSION );

		container = new BrowserContainer();
		stopOnExit();
		container.start();
		const endpoint = await container.endpoint();
		const site = new URL( requestUtils.baseURL );
		browser = await chromium.connect( endpoint, {
			headers: LAUNCH_HEADERS,
			exposeNetwork: site.host,
			timeout: 120_000,
		} );

		cmsPage = await requestUtils.createPage( {
			title: 'A sample page',
			content: CONTENT,
			status: 'publish',
		} );
		searchPage = await requestUtils.createPage( {
			title: 'Revalidation on the CMS',
			content:
				'<!-- wp:paragraph --><p>How the CMS tells the front end what changed, and when.</p><!-- /wp:paragraph -->',
			excerpt:
				'How the CMS tells the front end what changed, and when, in a paragraph.',
			status: 'publish',
		} );
		seed = await seedResourcePage( requestUtils );
		collection = await createCollection( requestUtils, Date.now() );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		// The page first: a browser whose container a signal stopped can
		// throw on close, and the page must go whatever happens to it.
		try {
			for ( const created of [ cmsPage, searchPage ] ) {
				if ( created ) {
					await requestUtils.rest( {
						method: 'DELETE',
						path: `/wp/v2/pages/${ created.id }`,
						params: { force: true },
					} );
				}
			}
			if ( seed ) {
				await deleteResourcePage( requestUtils, seed );
			}
			if ( collection ) {
				await deleteCollection( requestUtils, collection );
			}
		} finally {
			await browser?.close().catch( () => undefined );
			container?.stop();
			for ( const [ event, listener ] of listeners.splice( 0 ) ) {
				process.off( event, listener );
			}
		}
	} );

	/**
	 * A page in the container's browser, at `width`, in `colorScheme`.
	 *
	 * @param {Object}  options
	 * @param {string}  options.baseURL     The tests site.
	 * @param {number}  options.width       The viewport's width.
	 * @param {string}  options.colorScheme `light` or `dark`.
	 * @param {boolean} options.loggedIn    Whether the context carries the admin's session.
	 * @return {Promise<import('@playwright/test').Page>} The page.
	 */
	async function open( { baseURL, width, colorScheme, loggedIn } ) {
		const context = await browser.newContext( {
			baseURL,
			viewport: { width, height: 800 },
			colorScheme,
			reducedMotion: 'reduce',
			storageState: loggedIn ? process.env.STORAGE_STATE_PATH : undefined,
		} );
		return context.newPage();
	}

	/**
	 * Loads `url` twice, so Figtree is in the cache and drawn from the first
	 * paint of the load that is captured, and waits for the fonts.
	 *
	 * @param {import('@playwright/test').Page} page The page.
	 * @param {string}                          url  The path.
	 */
	async function load( page, url ) {
		await page.goto( url );
		await page.evaluate( () =>
			document.fonts.ready.then( () => undefined )
		);
		await page.goto( url );
		await page.evaluate( () =>
			document.fonts.ready.then( () => undefined )
		);
	}

	for ( const width of WIDTHS ) {
		for ( const colorScheme of SCHEMES ) {
			test( `a page at ${ width }px, ${ colorScheme }`, async ( {
				requestUtils,
			} ) => {
				const page = await open( {
					baseURL: requestUtils.baseURL,
					width,
					colorScheme,
					loggedIn: true,
				} );
				// The link in full: the tests site has plain permalinks, so the
				// page is `/?page_id=…`.
				await load( page, cmsPage.link );
				await expect( page.locator( '#wpadminbar' ) ).toHaveCount( 1 );
				await page.addStyleTag( { path: HIDE_ADMIN_BAR } );
				await expect( page.locator( '#wpadminbar' ) ).toBeHidden();
				await expect(
					page.getByRole( 'heading', { level: 1 } )
				).toHaveText( cmsPage.title.raw );
				await expect( page, BASELINE_HINT ).toHaveScreenshot(
					`page-${ width }-${ colorScheme }.png`,
					SCREENSHOT
				);
				await page.context().close();
			} );

			test( `a resource at ${ width }px, ${ colorScheme }`, async ( {
				requestUtils,
			} ) => {
				const page = await open( {
					baseURL: requestUtils.baseURL,
					width,
					colorScheme,
					loggedIn: true,
				} );
				await load( page, seed.host.link );
				await expect( page.locator( '#wpadminbar' ) ).toHaveCount( 1 );
				await page.addStyleTag( { path: HIDE_ADMIN_BAR } );
				await expect( page.locator( '#wpadminbar' ) ).toBeHidden();
				await expect(
					page.getByRole( 'heading', { level: 1 } )
				).toHaveText( seed.host.title.raw );
				// The related rows are in the shot, so the selection is too.
				await expect(
					page.locator( 'section.rh-related article.rh-card' )
				).toHaveCount( 2 );
				await expect( page, BASELINE_HINT ).toHaveScreenshot(
					`resource-${ width }-${ colorScheme }.png`,
					SCREENSHOT
				);
				await page.context().close();
			} );
			for ( const [ name, url, heading ] of [
				[ 'library', '/?post_type=resource', 'Resources' ],
				[
					'topic',
					() => `/?resource_topic=${ collection.topics[ 0 ].slug }`,
					'Resources on Caching',
				],
				// Two resources and the page made above hold "revalidation" in their titles.
				[ 'search', '/?s=revalidation', 'Search' ],
			] ) {
				test( `the ${ name } at ${ width }px, ${ colorScheme }`, async ( {
					requestUtils,
				} ) => {
					const page = await open( {
						baseURL: requestUtils.baseURL,
						width,
						colorScheme,
						loggedIn: true,
					} );
					await load( page, typeof url === 'function' ? url() : url );
					await expect( page.locator( '#wpadminbar' ) ).toHaveCount(
						1
					);
					await page.addStyleTag( { path: HIDE_ADMIN_BAR } );
					await expect( page.locator( '#wpadminbar' ) ).toBeHidden();
					await expect(
						page.getByRole( 'heading', { level: 1 } )
					).toHaveText( heading );
					// The lead's image is drawn before the shot.
					for ( const img of await page
						.locator( 'main img' )
						.all() ) {
						await expect( img ).toHaveJSProperty(
							'complete',
							true
						);
					}
					await expect( page, BASELINE_HINT ).toHaveScreenshot(
						`${ name }-${ width }-${ colorScheme }.png`,
						SCREENSHOT
					);
					await page.context().close();
				} );
			}

			test( `the 404 at ${ width }px, ${ colorScheme }`, async ( {
				requestUtils,
			} ) => {
				const page = await open( {
					baseURL: requestUtils.baseURL,
					width,
					colorScheme,
					loggedIn: false,
				} );
				await load( page, '/no-such-page/' );
				await expect(
					page.getByRole( 'heading', { level: 1 } )
				).toHaveText( 'Page not found' );
				await expect( page, BASELINE_HINT ).toHaveScreenshot(
					`404-${ width }-${ colorScheme }.png`,
					SCREENSHOT
				);
				await page.context().close();
			} );
		}
	}
} );
