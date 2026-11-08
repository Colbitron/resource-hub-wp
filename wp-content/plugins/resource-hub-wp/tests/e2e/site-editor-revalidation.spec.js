/**
 * Page saves made in the Site Editor (Appearance > Editor > Pages) still
 * revalidate, but show no revalidation notice (issue #89's third note,
 * settled: page editing belongs in the post editor; see
 * `docs/architecture/revalidation.md`, "Reading results").
 *
 * `RevalidationAssets::enqueue()` loads the notice's script only on screens
 * whose post type is in `ResultStore::POST_TYPES`, and the Site Editor's
 * screen has none. This spec pins that behaviour, so a change that brings
 * the notice to the Site Editor, or stops its saves from sending, has to
 * update it on purpose.
 *
 * The tests site has no front-end URL or secret, so every send is recorded
 * as "not configured" at once, with no cron involved, as in
 * `revalidation-feedback.spec.js`.
 */
const { test, expect } = require( './fixtures' );

const NOT_CONFIGURED =
	'Revalidation skipped: the front-end URL or the secret is not configured.';
const NOTICE_ID = 'resource-hub-revalidation';
const SCRIPT_ID = 'resource-hub-revalidation-feedback-js';

/**
 * The REST route a request is for, with pretty or plain permalinks.
 *
 * @param {URL} url The request URL.
 * @return {string} The route, such as `/wp/v2/pages/12`.
 */
function restRoute( url ) {
	return (
		url.searchParams.get( 'rest_route' ) ??
		url.pathname.replace( /^.*\/wp-json/, '' )
	);
}

/**
 * Records every revalidation notice the editor shows, in order.
 *
 * @param {import('@playwright/test').Page} page The page.
 */
async function collectNotices( page ) {
	await page.evaluate( ( id ) => {
		window.rhNotices = [];
		let last = null;
		window.wp.data.subscribe( () => {
			const notice = window.wp.data
				.select( 'core/notices' )
				.getNotices()
				.find( ( item ) => item.id === id );

			if ( notice && notice !== last ) {
				window.rhNotices.push( {
					status: notice.status,
					content: notice.content,
				} );
			}

			last = notice ?? null;
		} );
	}, NOTICE_ID );
}

const shownNotices = ( page ) => page.evaluate( () => window.rhNotices );

/**
 * What the screen tells the browser about itself and the notice's script:
 * WordPress prints `typenow` from the current screen's post type.
 *
 * @param {import('@playwright/test').Page} page The page.
 */
const screenState = ( page ) =>
	page.evaluate( ( scriptId ) => {
		const editor = window.wp.data.select( 'core/editor' );
		return {
			pagenow: window.pagenow,
			typenow: window.typenow,
			script: document.getElementById( scriptId ) !== null,
			config: typeof window.resourceHubRevalidation,
			editing: {
				type: editor.getCurrentPostType(),
				id: editor.getCurrentPostId(),
			},
		};
	}, SCRIPT_ID );

test.describe( 'Revalidation from the Site Editor', () => {
	let servedPage;

	test.beforeAll( async ( { requestUtils } ) => {
		// Published with no password, so the front end serves it and every
		// save of it sends a `page` event.
		servedPage = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/pages',
			data: {
				title: `E2E Site Editor page ${ Date.now() }`,
				status: 'publish',
				content:
					'<!-- wp:paragraph --><p>A page the front end serves.</p><!-- /wp:paragraph -->',
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/pages/${ servedPage.id }`,
			params: { force: true },
		} );
	} );

	test( 'saving a page there sends its event and records the result, but shows no notice', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		// Creating the page through REST already sent its `publish` event.
		const before = await requestUtils.rest( {
			path: `/wp/v2/pages/${ servedPage.id }`,
			params: { context: 'edit', _fields: 'rh_last_revalidation' },
		} );
		expect( before.rh_last_revalidation.event ).toBe( 'publish' );

		await admin.visitSiteEditor( {
			postId: servedPage.id,
			postType: 'page',
			canvas: 'edit',
		} );

		// The Site Editor edits the page through the editor store, but its
		// screen has no post type, so the notice's script is never loaded.
		expect( await screenState( page ) ).toEqual( {
			pagenow: 'site-editor',
			typenow: '',
			script: false,
			config: 'undefined',
			editing: { type: 'page', id: servedPage.id },
		} );

		await collectNotices( page );

		const saves = [];
		const polls = [];
		page.on( 'request', ( request ) => {
			const url = new URL( request.url() );
			if ( request.method() === 'POST' ) {
				saves.push( restRoute( url ) );
			}
			if (
				request.method() === 'GET' &&
				url.searchParams.get( '_fields' ) === 'rh_last_revalidation'
			) {
				polls.push( restRoute( url ) );
			}
		} );

		await editor.canvas
			.getByRole( 'document', { name: 'Block: Paragraph' } )
			.click();
		await page.keyboard.press( 'End' );
		await page.keyboard.type( ' Edited in the Site Editor.' );
		await editor.saveSiteEditorEntities( {
			isOnlyCurrentEntityDirty: true,
		} );

		// The save went through the same pages route the post editor uses.
		expect( saves ).toContain( `/wp/v2/pages/${ servedPage.id }` );

		// The event was sent and its result recorded on the page, where the
		// Pages list's Revalidation column reads it.
		const after = await requestUtils.rest( {
			path: `/wp/v2/pages/${ servedPage.id }`,
			params: {
				context: 'edit',
				_fields: 'content,rh_last_revalidation',
			},
		} );
		expect( after.content.raw ).toContain( 'Edited in the Site Editor.' );
		expect( after.rh_last_revalidation ).toMatchObject( {
			status: 'failed',
			outcome: 'not_configured',
			event: 'update',
		} );
		expect( after.rh_last_revalidation.batch_id ).not.toBe(
			before.rh_last_revalidation.batch_id
		);

		// The post editor's script polls at once after a save that sent
		// something; give it well over one poll interval to show none runs.
		await page.waitForTimeout( 2500 );
		expect( polls ).toEqual( [] );
		expect( await shownNotices( page ) ).toEqual( [] );
		await expect( page.getByText( NOT_CONFIGURED ) ).toHaveCount( 0 );

		// Reopening it shows no notice either, where the post editor would
		// show a result that is not `sent` on load.
		await admin.visitSiteEditor( {
			postId: servedPage.id,
			postType: 'page',
			canvas: 'edit',
		} );
		await page.waitForTimeout( 1000 );
		expect(
			await page.evaluate(
				( id ) =>
					window.wp.data
						.select( 'core/notices' )
						.getNotices()
						.some( ( item ) => item.id === id ),
				NOTICE_ID
			)
		).toBe( false );
		await expect( page.getByText( NOT_CONFIGURED ) ).toHaveCount( 0 );
	} );
} );
