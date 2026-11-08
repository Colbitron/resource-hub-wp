/**
 * Pixel baselines of the CMS theme: a page as a logged-in editor previews
 * it, and the 404 every anonymous visitor gets, at 1280 and 360 px, in the
 * light and the dark scheme.
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
 * The page is shot logged in, with the admin bar hidden and its margin on
 * `<html>` taken off by a style added to the page (`theme-screenshots.css`),
 * since the front end has no admin bar; the 404 is shot anonymously, as visitors get
 * it. Baselines are in `__snapshots__/` beside this file. A missing one
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
 * SIGINT, SIGTERM and SIGHUP, as the front end's `screenshots.mts` and
 * `render-brand-images.mts` do, so a crash or a Ctrl-C does not leave an
 * `rh-playwright-*` container running. A worker killed outright (SIGKILL)
 * cannot clean up; `docker ps --filter name=rh-playwright-` finds what is left.
 */
const path = require( 'node:path' );
const { chromium } = require( '@playwright/test' );
const { test, expect } = require( './fixtures' );

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

/** The worker's exit codes for the signals the container is stopped on. */
const SIGNAL_EXIT = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

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
	/** The process listeners that stop the container, removed in `afterAll`. */
	const listeners = [];

	/** Stops the container on the worker's exit or a signal, as well as in `afterAll`. */
	function stopOnExit() {
		const stop = () => container?.stop();
		listeners.push( [ 'exit', stop ] );
		for ( const [ signal, code ] of Object.entries( SIGNAL_EXIT ) ) {
			listeners.push( [
				signal,
				() => {
					stop();
					process.exit( code );
				},
			] );
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
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await browser?.close();
		container?.stop();
		for ( const [ event, listener ] of listeners.splice( 0 ) ) {
			process.off( event, listener );
		}
		if ( cmsPage ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/pages/${ cmsPage.id }`,
				params: { force: true },
			} );
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
