/**
 * Revalidation feedback for editors (ADRs 0018, 0019): publishing a resource
 * in the block editor shows the revalidation notice, a save's poll shows that
 * save's result only, and the status page's "Send test revalidation" button is
 * disabled until a resource is published.
 *
 * The tests site has no front-end URL or secret, so every send is recorded
 * as "not configured" straight away, with no cron involved. That is the
 * outcome these tests expect. The status page test assumes no other
 * published resource is left on the tests site; PHPUnit resets it before the
 * suite, and every spec deletes what it creates.
 */
const { test, expect } = require( './fixtures' );

const NOT_CONFIGURED =
	'Revalidation skipped: the front-end URL or the secret is not configured.';
const INVALID_SECRET =
	'Revalidation skipped: the front-end URL or the secret is not configured; the secret is set but not valid, so check Settings > Resource Hub.';
const ACCEPTED = 'The front end accepted the revalidation (200).';
const NOTICE_ID = 'resource-hub-revalidation';

/**
 * The REST route a request is for, with pretty or plain permalinks.
 *
 * @param {URL} url The request URL.
 * @return {string} The route, such as `/wp/v2/resources/12`.
 */
function restRoute( url ) {
	return (
		url.searchParams.get( 'rest_route' ) ??
		url.pathname.replace( /^.*\/wp-json/, '' )
	);
}

/**
 * A stored record as the hook writes it.
 *
 * @param {Object} fields Fields to set: status, outcome, batch_id, time and more.
 * @return {Object} The record.
 */
function storedRecord( fields ) {
	return {
		code: null,
		event: 'update',
		others: 0,
		body: '',
		error: null,
		duration_ms: 0,
		...fields,
	};
}

/**
 * A server time, from a response's `Date` header, as the hook stamps records.
 *
 * @param {string} date      The `Date` header.
 * @param {number} offsetSec Seconds to add.
 * @return {string} An ISO 8601 UTC time without milliseconds.
 */
function serverStamp( date, offsetSec = 0 ) {
	return new Date( Date.parse( date ) + offsetSec * 1000 )
		.toISOString()
		.replace( /\.\d{3}Z$/, 'Z' );
}

/**
 * Stubs the resource's REST route: `onPoll` answers the editor's polls of the
 * `rh_last_revalidation` field, and `onSave` may rewrite
 * a save's response. Each gets the real response's `Date`.
 *
 * @param {import('@playwright/test').Page}      page              The page.
 * @param {Object}                               handlers
 * @param {(date: string) => (Object|undefined)} handlers.onPoll   Returns the record for a poll, or undefined to pass through.
 * @param {(date: string) => (Object|undefined)} [handlers.onSave] Returns the record for a save response, or undefined.
 */
async function stubRecord( page, { onPoll, onSave = () => undefined } ) {
	await page.route(
		( url ) => /^\/wp\/v2\/resources\/\d+\/?$/.test( restRoute( url ) ),
		async ( route ) => {
			const request = route.request();
			const isPoll =
				request.method() === 'GET' &&
				new URL( request.url() ).searchParams.get( '_fields' ) ===
					'rh_last_revalidation';
			const isSave = request.method() !== 'GET';

			if ( ! isPoll && ! isSave ) {
				return route.fallback();
			}

			const response = await route.fetch();
			const json = await response.json();
			const date = response.headers().date;
			const stubbed = isPoll ? onPoll( date ) : onSave( date );

			if ( stubbed === undefined ) {
				return route.fulfill( { response, json } );
			}

			json.rh_last_revalidation = stubbed;
			return route.fulfill( { response, json } );
		}
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

test.describe( 'Revalidation feedback', () => {
	let type;
	const createdIds = [];

	test.beforeAll( async ( { requestUtils } ) => {
		const stamp = Date.now();
		type = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resource_type',
			data: { name: `E2E type ${ stamp }`, slug: `e2e-type-${ stamp }` },
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		for ( const id of createdIds ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}

		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_type/${ type.id }`,
			params: { force: true },
		} );
	} );

	test( 'publishing in the editor shows the revalidation notice, and reloading shows it again', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E revalidation ${ Date.now() }`,
		} );
		await editor.openDocumentSettingsSidebar();

		const typesPanel = page.getByRole( 'button', {
			name: 'Types',
			exact: true,
		} );
		if ( ( await typesPanel.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
			await typesPanel.click();
		}
		await page.getByRole( 'radio', { name: type.name } ).check();
		await editor.publishPost();

		const postId = await page.evaluate( () =>
			window.wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		createdIds.push( postId );

		// The editor's own notice list, not the screen-reader copy of it.
		const content = page.getByRole( 'region', { name: 'Editor content' } );
		await expect( content.getByText( NOT_CONFIGURED ) ).toBeVisible();

		// The record is on the resource, readable in the edit context only.
		const saved = await requestUtils.rest( {
			path: `/wp/v2/resources/${ postId }`,
			params: { context: 'edit', _fields: 'rh_last_revalidation' },
		} );
		expect( saved.rh_last_revalidation.outcome ).toBe( 'not_configured' );
		expect( saved.rh_last_revalidation.event ).toBe( 'publish' );

		// A failure is shown again when the editor loads the resource.
		await admin.editPost( postId );
		await expect(
			page
				.getByRole( 'region', { name: 'Editor content' } )
				.getByText( NOT_CONFIGURED )
		).toBeVisible();
	} );

	test( 'a poll that reads pending, then sent, shows one success notice', async ( {
		admin,
		page,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E pending then sent ${ Date.now() }`,
		} );

		let polls = 0;
		let stubbing = false;

		await stubRecord( page, {
			onPoll: ( date ) => {
				if ( ! stubbing ) {
					return undefined;
				}

				polls++;

				return polls === 1
					? storedRecord( {
							status: 'pending',
							outcome: 'pending',
							batch_id: 'stub-batch',
							time: serverStamp( date ),
						} )
					: storedRecord( {
							status: 'sent',
							outcome: 'ok',
							code: 200,
							batch_id: 'stub-batch',
							time: serverStamp( date ),
						} );
			},
		} );
		await collectNotices( page );

		stubbing = true;
		const postId = await page.evaluate( async ( typeId ) => {
			const { dispatch, select } = window.wp.data;
			dispatch( 'core/editor' ).editPost( {
				status: 'publish',
				resource_type: [ typeId ],
			} );
			await dispatch( 'core/editor' ).savePost();
			return select( 'core/editor' ).getCurrentPostId();
		}, type.id );
		createdIds.push( postId );

		await expect
			.poll( () => shownNotices( page ), { timeout: 15000 } )
			.toEqual( [ { status: 'success', content: ACCEPTED } ] );
		expect( polls ).toBe( 2 );
		await expect(
			page.locator( '.components-snackbar' ).getByText( ACCEPTED )
		).toBeVisible();
	} );

	test( 'a skip caused by an invalid secret points to the settings and never quotes the stored message', async ( {
		admin,
		page,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E invalid secret ${ Date.now() }`,
		} );

		const stored = 'The stored cause, which the notice does not quote.';
		let stubbing = false;

		await stubRecord( page, {
			onPoll: ( date ) =>
				stubbing
					? storedRecord( {
							status: 'failed',
							outcome: 'not_configured',
							error: stored,
							batch_id: 'stub-batch',
							time: serverStamp( date ),
						} )
					: undefined,
		} );
		await collectNotices( page );

		stubbing = true;
		const postId = await page.evaluate( async ( typeId ) => {
			const { dispatch, select } = window.wp.data;
			dispatch( 'core/editor' ).editPost( {
				status: 'publish',
				resource_type: [ typeId ],
			} );
			await dispatch( 'core/editor' ).savePost();
			return select( 'core/editor' ).getCurrentPostId();
		}, type.id );
		createdIds.push( postId );

		await expect
			.poll( () => shownNotices( page ), { timeout: 15000 } )
			.toEqual( [ { status: 'error', content: INVALID_SECRET } ] );
		await expect(
			page
				.getByRole( 'region', { name: 'Editor content' } )
				.getByText( INVALID_SECRET )
		).toBeVisible();
	} );

	test( "a second save shows its own result, never the first save's late one", async ( {
		admin,
		page,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E double save ${ Date.now() }`,
		} );

		// What the store would hold: the first save's batch is still pending
		// when the second save's response is built; its late result lands
		// after the second save, then the second save's own pending and result.
		let phase = 0;
		let firstPolls = 0;
		let secondPolls = 0;

		await stubRecord( page, {
			onSave: ( date ) => {
				phase++;

				return phase === 2
					? storedRecord( {
							status: 'pending',
							outcome: 'pending',
							batch_id: 'batch-1',
							time: serverStamp( date ),
						} )
					: undefined;
			},
			onPoll: ( date ) => {
				if ( phase === 1 ) {
					firstPolls++;

					return storedRecord( {
						status: 'pending',
						outcome: 'pending',
						batch_id: 'batch-1',
						time: serverStamp( date ),
					} );
				}

				if ( phase !== 2 ) {
					return undefined;
				}

				secondPolls++;

				return [
					// The first save's late result: same batch as the response's record.
					storedRecord( {
						status: 'failed',
						outcome: 'server_error',
						code: 500,
						batch_id: 'batch-1',
						time: serverStamp( date ),
					} ),
					// An older result from a batch the response never showed.
					storedRecord( {
						status: 'failed',
						outcome: 'timeout',
						batch_id: 'batch-0',
						time: serverStamp( date, -3600 ),
					} ),
					storedRecord( {
						status: 'pending',
						outcome: 'pending',
						batch_id: 'batch-2',
						time: serverStamp( date ),
					} ),
					storedRecord( {
						status: 'sent',
						outcome: 'ok',
						code: 200,
						batch_id: 'batch-2',
						time: serverStamp( date ),
					} ),
				][ Math.min( secondPolls, 4 ) - 1 ];
			},
		} );
		await collectNotices( page );

		const postId = await page.evaluate( async ( typeId ) => {
			const { dispatch, select } = window.wp.data;
			dispatch( 'core/editor' ).editPost( {
				status: 'publish',
				resource_type: [ typeId ],
			} );
			await dispatch( 'core/editor' ).savePost();
			return select( 'core/editor' ).getCurrentPostId();
		}, type.id );
		createdIds.push( postId );

		// The first save's poll is running and reading pending; save again.
		await expect.poll( () => firstPolls ).toBeGreaterThan( 0 );
		await page.evaluate( async () => {
			const { dispatch } = window.wp.data;
			dispatch( 'core/editor' ).editPost( { excerpt: 'Saved again' } );
			await dispatch( 'core/editor' ).savePost();
		} );

		await expect
			.poll( () => shownNotices( page ), { timeout: 15000 } )
			.toEqual( [ { status: 'success', content: ACCEPTED } ] );
		expect( secondPolls ).toBe( 4 );
		await expect(
			page.getByText( 'Revalidation failed on the front end (500).' )
		).toHaveCount( 0 );
	} );

	test( "a refused save leaves the earlier save's poll to show its result", async ( {
		admin,
		page,
	} ) => {
		await admin.createNewPost( {
			postType: 'resource',
			title: `E2E refused save ${ Date.now() }`,
		} );

		// Phase 1: the first save's batch is pending. Phase 2: the second save
		// is refused, so nothing new is sent. Phase 3: the first save's result.
		let phase = 0;
		let pendingPolls = 0;
		let refusals = 0;

		await stubRecord( page, {
			onPoll: ( date ) => {
				if ( phase === 0 ) {
					return undefined;
				}

				if ( phase === 1 ) {
					pendingPolls++;
				}

				return phase < 3
					? storedRecord( {
							status: 'pending',
							outcome: 'pending',
							batch_id: 'batch-1',
							time: serverStamp( date ),
						} )
					: storedRecord( {
							status: 'sent',
							outcome: 'ok',
							code: 200,
							batch_id: 'batch-1',
							time: serverStamp( date ),
						} );
			},
		} );

		// Registered last, so it sees the second save before stubRecord does.
		await page.route(
			( url ) => /^\/wp\/v2\/resources\/\d+\/?$/.test( restRoute( url ) ),
			( route ) => {
				if ( phase !== 2 || route.request().method() === 'GET' ) {
					return route.fallback();
				}

				refusals++;

				return route.fulfill( {
					status: 400,
					json: {
						code: 'resource_hub_type_too_many',
						message:
							'A resource can have only one type. Choose one in the Types panel.',
						data: { status: 400 },
					},
				} );
			}
		);
		await collectNotices( page );

		phase = 1;
		const postId = await page.evaluate( async ( typeId ) => {
			const { dispatch, select } = window.wp.data;
			dispatch( 'core/editor' ).editPost( {
				status: 'publish',
				resource_type: [ typeId ],
			} );
			await dispatch( 'core/editor' ).savePost();
			return select( 'core/editor' ).getCurrentPostId();
		}, type.id );
		createdIds.push( postId );

		// The first save's poll is reading pending; the second save is refused.
		await expect.poll( () => pendingPolls ).toBeGreaterThan( 0 );
		phase = 2;
		const refused = await page.evaluate( async () => {
			const { dispatch, select } = window.wp.data;
			dispatch( 'core/editor' ).editPost( { excerpt: 'Refused' } );
			try {
				await dispatch( 'core/editor' ).savePost();
			} catch {
				// Some editor versions reject; the failure is read below.
			}
			return ! select( 'core/editor' ).didPostSaveRequestSucceed();
		} );
		expect( refused ).toBe( true );
		expect( refusals ).toBe( 1 );

		phase = 3;
		await expect
			.poll( () => shownNotices( page ), { timeout: 15000 } )
			.toEqual( [ { status: 'success', content: ACCEPTED } ] );
		await expect(
			page.locator( '.components-snackbar' ).getByText( ACCEPTED )
		).toBeVisible();
	} );

	test( 'the status page enables the test button only when a resource is published, and the test records its result', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const visit = () =>
			admin.visitAdminPage( 'options-general.php', 'page=resource-hub' );

		// Leave the resources the first test made out of the picture.
		for ( const id of createdIds.splice( 0 ) ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/resources/${ id }`,
				params: { force: true },
			} );
		}

		await visit();
		await expect(
			page.getByRole( 'heading', { name: 'Revalidation status' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Send test revalidation' } )
		).toBeDisabled();
		await expect(
			page.getByText(
				'The button is disabled because no resource is published'
			)
		).toBeVisible();

		const stamp = Date.now();
		const published = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				title: `E2E status page ${ stamp }`,
				slug: `e2e-status-page-${ stamp }`,
				status: 'publish',
				resource_type: [ type.id ],
			},
		} );
		createdIds.push( published.id );

		await visit();
		const button = page.getByRole( 'button', {
			name: 'Send test revalidation',
		} );
		await expect( button ).toBeEnabled();
		await expect( page.getByLabel( 'Resource to send' ) ).toContainText(
			`Most recently modified: E2E status page ${ stamp }`
		);

		await button.click();
		await expect( page.getByText( NOT_CONFIGURED ).first() ).toBeVisible();
		await expect(
			page.getByRole( 'link', { name: `E2E status page ${ stamp }` } )
		).toBeVisible();

		const record = await requestUtils.rest( {
			path: `/wp/v2/resources/${ published.id }`,
			params: { context: 'edit', _fields: 'rh_last_revalidation' },
		} );
		expect( record.rh_last_revalidation.event ).toBe( 'update' );
		expect( record.rh_last_revalidation.outcome ).toBe( 'not_configured' );
	} );

	test( 'Enter in the picker search runs the search and sends nothing', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const stamp = Date.now();

		for ( const name of [ 'Searched', 'Newest' ] ) {
			const created = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/resources',
				data: {
					title: `E2E ${ name } ${ stamp }`,
					status: 'publish',
					resource_type: [ type.id ],
				},
			} );
			createdIds.push( created.id );
		}

		const sends = [];
		page.on( 'request', ( request ) => {
			if ( request.url().includes( 'admin-post.php' ) ) {
				sends.push( request.url() );
			}
		} );

		await admin.visitAdminPage(
			'options-general.php',
			'page=resource-hub'
		);
		const search = page.getByRole( 'searchbox', {
			name: 'Find a resource',
		} );
		await expect( search ).toHaveAccessibleDescription(
			/Type to search the published resources/
		);

		await search.fill( `E2E Searched ${ stamp }` );
		await search.press( 'Enter' );

		const status = page.getByRole( 'status' );
		await expect( status ).toHaveText( '1 resource found' );
		await expect( page.getByLabel( 'Resource to send' ) ).toContainText(
			`E2E Searched ${ stamp }`
		);
		expect( sends ).toEqual( [] );
		await expect( page ).not.toHaveURL( /rh_test=/ );

		await search.fill( `no-such-resource-${ stamp }` );
		await search.press( 'Enter' );
		await expect( status ).toHaveText( 'No matches' );
		expect( sends ).toEqual( [] );
	} );
} );
