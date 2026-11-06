/**
 * Revalidation feedback in the block editor (see
 * `docs/architecture/revalidation.md`).
 *
 * The send to the front end runs in cron after the save has returned, so the
 * save response cannot carry the result. After a save that is neither an
 * autosave nor a preview completes, this polls the post's read-only
 * `rh_last_revalidation` REST field about once a second for up to about ten
 * seconds, then puts the outcome in one `core/notices` notice.
 *
 * Which record is this save's: the hook writes the record at `shutdown` and
 * again when the send finishes, stamping each write with the server's time,
 * so this save's records are never older than the save itself. A polled
 * record counts only if its `time` is at or after the saved post's
 * `modified_gmt` (the server's clock, like the record's) and its batch is not
 * the one the save response carried, which was the record from before this
 * save. The first record that passes fixes the batch, and later polls must
 * match it. An earlier save's late result therefore does not count: either it
 * landed before this save (too old), or the save response carried that
 * earlier save's own record, pending or final (same batch, excluded). The
 * store never writes a cron batch's final result over another batch's pending,
 * so a later save's records are not overwritten by an earlier send (the guard
 * is in PHP's `ResultStore`). A later save pauses the earlier poll while it
 * runs, and replaces it only if it succeeds and starts a poll of its own; a
 * save that fails, such as one refused for breaking the one-type rule, sent
 * nothing, so the earlier save's poll resumes.
 *
 * Which saves are polled for: only those that sent something, which the
 * server decides per post type. A resource sends an event when it was or is
 * published (`ResourceEvents::derive()`, status alone). A page sends one only
 * when it was or is served (`PageEvents::on_after_insert()`, through
 * `PagePath::is_served()`): published, with no password, and not the posts
 * page. `isServed()` below mirrors those two methods, with the posts page's ID
 * handed over by PHP, so saving a password-protected page or the posts page
 * waits for no answer that will never come.
 *
 * Whether a `pending` is stale is judged with the server's clock, from the
 * REST response's `Date` header, never the browser's. The sentences come from
 * PHP (`ResultText::sentences()`), so every screen uses the same words.
 *
 * On load, a last result that is not a success is shown once. PHP enqueues
 * this only on the resource and page editors, and hands over the REST route
 * of each post type it runs on (`restPaths`, from the post type's own
 * `rest_base`), so the list of post types lives in PHP alone; a post type
 * without a route here is a second guard, and the script does nothing for it.
 */
import apiFetch from '@wordpress/api-fetch';
import { dispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useEffect, useRef, useState } from '@wordpress/element';
import { _n, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import { registerPlugin } from '@wordpress/plugins';
import { addQueryArgs } from '@wordpress/url';

const FIELD = 'rh_last_revalidation';
const NOTICE_ID = 'resource-hub-revalidation';
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 10;

// Mirrors ResultText::STALE_PENDING_SECONDS, ResultText::WITH_ERROR and
// ResultText::INVALID_SECRET in PHP.
const STALE_PENDING_MS = 5 * 60 * 1000;
const WITH_ERROR = [ 'bad_request', 'server_error', 'transport_error' ];
const INVALID_SECRET = 'not_configured_invalid_secret';

// Handed over by RevalidationAssets through wp_localize_script().
const SENTENCES = window.resourceHubRevalidation?.sentences ?? {};
// The REST route, without the ID, of each post type the notice runs on:
// `{ resource: '/wp/v2/resources', page: '/wp/v2/pages' }`.
const REST_PATHS = window.resourceHubRevalidation?.restPaths ?? {};
// The posts page's ID while `show_on_front` is `page`, else 0, from
// `PagePath::posts_page_id()`. wp_localize_script() hands it over as a string.
const POSTS_PAGE_ID =
	Number( window.resourceHubRevalidation?.postsPageId ) || 0;

/**
 * The REST route of a post type's objects, or null for a post type the
 * notice does not run on.
 *
 * @param {string|undefined} postType The post type.
 * @return {string|null} The route, without the ID.
 */
function restPathFor( postType ) {
	const path =
		typeof postType === 'string' &&
		Object.prototype.hasOwnProperty.call( REST_PATHS, postType )
			? REST_PATHS[ postType ]
			: null;

	return typeof path === 'string' && path !== '' ? path : null;
}

/**
 * Whether the front end serves a post in the given state, so that a save
 * which finds it served or leaves it served sends an event. Mirrors
 * `ResourceEvents::derive()` for a resource (published) and
 * `PagePath::is_served()` for a page (published, no password, not the posts
 * page); any other post type sends nothing.
 *
 * @param {string|undefined} postType      The post type.
 * @param {Object}           post          The post's saved state.
 * @param {number|string}    post.id       The post's ID.
 * @param {string|undefined} post.status   Its status.
 * @param {string|undefined} post.password Its password, empty for none.
 * @return {boolean} Whether it is served.
 */
function isServed( postType, { id, status, password } ) {
	if ( status !== 'publish' ) {
		return false;
	}

	switch ( postType ) {
		case 'resource':
			return true;
		case 'page':
			return ( password ?? '' ) === '' && Number( id ) !== POSTS_PAGE_ID;
		default:
			return false;
	}
}

/**
 * A sentence from PHP, or an empty string when the script runs without them.
 *
 * @param {string} key The sentence's key.
 * @return {string} The sentence.
 */
const sentence = ( key ) => SENTENCES[ key ] ?? '';

/**
 * A server timestamp in milliseconds, or NaN. WordPress gives `modified_gmt`
 * without a zone; it is UTC.
 *
 * @param {string|undefined} value An ISO 8601 time, with or without a zone.
 * @return {number} Milliseconds since the epoch.
 */
function serverTime( value ) {
	if ( typeof value !== 'string' || value === '' ) {
		return NaN;
	}

	return Date.parse(
		/[zZ]|[+-]\d\d:?\d\d$/.test( value ) ? value : `${ value }Z`
	);
}

/**
 * The front end's `error` string from a stored 400 or 500 body, or an empty
 * string. The body is cut to about 1 KB, so the JSON may be truncated; then
 * there is no message to quote. Mirrors ResultText::error_from_body().
 *
 * @param {Object} record The stored record.
 * @return {string} The message, if any.
 */
function errorFromBody( record ) {
	if ( typeof record.body !== 'string' || record.body === '' ) {
		return '';
	}

	try {
		const parsed = JSON.parse( record.body );
		return parsed && typeof parsed.error === 'string' ? parsed.error : '';
	} catch {
		return '';
	}
}

/**
 * Whether a pending record is old enough that the send evidently never ran,
 * judged against the server's clock. Without a server time there is no
 * judging, so it is not stale. Mirrors ResultText::is_stale_pending().
 *
 * @param {Object} record    The stored record.
 * @param {number} serverNow The server's time in milliseconds, or NaN.
 * @return {boolean} Whether it is a stale pending.
 */
function isStalePending( record, serverNow ) {
	if ( record.status !== 'pending' ) {
		return false;
	}

	const time = serverTime( record.time );

	if ( Number.isNaN( time ) ) {
		return true;
	}

	return ! Number.isNaN( serverNow ) && serverNow - time > STALE_PENDING_MS;
}

/**
 * The notice for a stored record: its status and the sentence ResultText
 * gives in PHP, built the same way.
 *
 * @param {Object} record    The stored record.
 * @param {number} serverNow The server's time in milliseconds, or NaN.
 * @return {{status: string, message: string}} What to show.
 */
function describe( record, serverNow ) {
	if ( isStalePending( record, serverNow ) ) {
		return { status: 'warning', message: sentence( 'stale' ) };
	}

	if ( record.outcome === 'pending' ) {
		return { status: 'warning', message: sentence( 'pending' ) };
	}

	const known =
		typeof record.outcome === 'string' &&
		! [ 'stale', 'failed', 'no_answer', INVALID_SECRET ].includes(
			record.outcome
		) &&
		SENTENCES[ record.outcome ];
	let message = known ? sentence( record.outcome ) : sentence( 'failed' );

	// Only an invalid secret stores an error on a `not_configured` record; the
	// message is not shown, the sentence points to the settings instead.
	// Mirrors ResultText::is_invalid_secret().
	if (
		record.outcome === 'not_configured' &&
		typeof record.error === 'string' &&
		record.error.trim() !== ''
	) {
		message = sentence( INVALID_SECRET );
	}

	if ( record.outcome === 'unexpected_code' ) {
		message = sprintf( message, Number( record.code ) || 0 );
	}

	if ( WITH_ERROR.includes( record.outcome ) ) {
		const detail = (
			typeof record.error === 'string' && record.error.trim() !== ''
				? record.error
				: errorFromBody( record )
		).trim();

		if ( detail ) {
			message += ` ${ detail }`;
		}
	}

	const others = Number( record.others ) || 0;

	if ( others > 0 ) {
		// The same msgids as ResultText::with_others() in PHP.
		message +=
			' ' +
			sprintf(
				/* translators: %d: how many other changes travelled in the same request. */
				_n(
					'It was sent with %d other change.',
					'It was sent with %d other changes.',
					others,
					'resource-hub'
				),
				others
			);
	}

	return {
		status: record.status === 'sent' ? 'success' : 'error',
		message,
	};
}

/**
 * Replaces the plugin's one notice. A success is a snackbar, which goes away on
 * its own; anything else stays in the editor's notice list until dismissed.
 *
 * @param {{status: string, message: string}} notice What to show.
 */
function notify( { status, message } ) {
	dispatch( noticesStore ).createNotice( status, message, {
		id: NOTICE_ID,
		type: status === 'success' ? 'snackbar' : 'default',
		isDismissible: true,
	} );
}

/**
 * Reads the post's record and the server's time from the response's `Date`
 * header.
 *
 * @param {string}      restPath The post type's REST route, without the ID.
 * @param {number}      postId   The post.
 * @param {AbortSignal} signal   Aborts the request.
 * @return {Promise<{record: Object|null, serverNow: number}>} The record, if any, and the server's time.
 */
async function fetchRecord( restPath, postId, signal ) {
	const response = await apiFetch( {
		path: addQueryArgs( `${ restPath }/${ postId }`, {
			context: 'edit',
			_fields: FIELD,
		} ),
		parse: false,
		signal,
	} );
	const body = await response.json();

	return {
		record: body?.[ FIELD ] ?? null,
		// An HTTP date, such as "Thu, 05 Nov 2026 10:00:00 GMT"; NaN if absent.
		serverNow: Date.parse( response.headers.get( 'Date' ) ?? '' ),
	};
}

/**
 * Resolves after `ms`, or rejects at once when the signal aborts.
 *
 * @param {number}      ms     How long to wait.
 * @param {AbortSignal} signal Cancels the wait.
 * @return {Promise<void>} The wait.
 */
function wait( ms, signal ) {
	return new Promise( ( resolve, reject ) => {
		const timer = setTimeout( resolve, ms );
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout( timer );
				reject( signal.reason );
			},
			{ once: true }
		);
	} );
}

/**
 * Polls the post's field until this save's record is no longer pending, or
 * the window closes, then shows it. Does nothing more once aborted.
 *
 * @param {Object}      save          The save to poll for.
 * @param {string}      save.restPath The post type's REST route, without the ID.
 * @param {number}      save.postId   The post.
 * @param {Object|null} save.known    The record the save response carried.
 * @param {number}      save.since    The saved post's `modified_gmt`, in milliseconds.
 * @param {AbortSignal} signal        Aborts the poll.
 */
async function pollAfterSave( { restPath, postId, known, since }, signal ) {
	let batch = null;
	let latest = null;
	let serverNow = NaN;

	const isThisSave = ( record ) => {
		if ( batch !== null ) {
			return record.batch_id === batch;
		}

		const time = serverTime( record.time );

		if (
			Number.isNaN( time ) ||
			( ! Number.isNaN( since ) && time < since )
		) {
			return false;
		}

		return ! known || record.batch_id !== known.batch_id;
	};

	for ( let attempt = 0; attempt < POLL_ATTEMPTS; attempt++ ) {
		if ( attempt > 0 ) {
			await wait( POLL_INTERVAL_MS, signal );
		}

		try {
			const read = await fetchRecord( restPath, postId, signal );
			serverNow = read.serverNow;

			if ( read.record && isThisSave( read.record ) ) {
				batch = read.record.batch_id;
				latest = read.record;

				if ( latest.status !== 'pending' ) {
					break;
				}
			}
		} catch {
			if ( signal.aborted ) {
				return;
			}
			// A failed poll is retried on the next tick; the window still closes.
		}
	}

	if ( signal.aborted ) {
		return;
	}

	notify(
		latest
			? describe( latest, serverNow )
			: { status: 'warning', message: sentence( 'no_answer' ) }
	);
}

/**
 * Shows the last result when the editor opens a resource or a page, unless it
 * was a success.
 *
 * @param {string}      restPath The post type's REST route, without the ID.
 * @param {number}      postId   The post.
 * @param {AbortSignal} signal   Aborts the request.
 */
async function showLastOnLoad( restPath, postId, signal ) {
	try {
		const { record, serverNow } = await fetchRecord(
			restPath,
			postId,
			signal
		);

		if ( ! signal.aborted && record && record.status !== 'sent' ) {
			notify( describe( record, serverNow ) );
		}
	} catch {
		// Nothing to show; the next save polls again.
	}
}

/**
 * Renders nothing; watches the editor's saves and polls after each one.
 *
 * @return {null} Nothing.
 */
function RevalidationFeedback() {
	const {
		postType,
		restPath,
		postId,
		isSaving,
		isSilentSave,
		saveSucceeded,
		status,
		password,
		modifiedGmt,
		known,
	} = useSelect( ( select ) => {
		const editor = select( editorStore );
		const type = editor.getCurrentPostType();

		return {
			postType: type,
			restPath: restPathFor( type ),
			postId: editor.getCurrentPostId(),
			isSaving: editor.isSavingPost(),
			isSilentSave:
				editor.isAutosavingPost() || editor.isPreviewingPost(),
			saveSucceeded: editor.didPostSaveRequestSucceed(),
			status: editor.getCurrentPostAttribute( 'status' ),
			password: editor.getCurrentPostAttribute( 'password' ),
			modifiedGmt: editor.getCurrentPostAttribute( 'modified_gmt' ),
			known: editor.getCurrentPostAttribute( FIELD ) ?? null,
		};
	}, [] );

	const [ save, setSave ] = useState( null );
	const tracking = useRef( {
		wasSaving: false,
		silent: false,
		// Whether the post was served when the save started, as saved then.
		servedBefore: false,
		// The save whose poll had not finished when this save started.
		interrupted: null,
	} );
	// The save whose poll is running, until it shows its result.
	const running = useRef( null );

	// The last result, once per post.
	useEffect( () => {
		if ( ! restPath || ! postId ) {
			return undefined;
		}

		const controller = new AbortController();
		showLastOnLoad( restPath, postId, controller.signal );

		return () => controller.abort();
	}, [ restPath, postId ] );

	// A save starting pauses the running poll. A save ending starts a poll of
	// its own, or, when it starts none (it failed, or sent nothing), resumes
	// the paused one.
	useEffect( () => {
		const track = tracking.current;

		if ( ! restPath || isSaving === track.wasSaving ) {
			return;
		}

		track.wasSaving = isSaving;

		if ( isSaving ) {
			track.silent = isSilentSave;
			track.servedBefore = isServed( postType, {
				id: postId,
				status,
				password,
			} );

			if ( ! isSilentSave ) {
				track.interrupted = running.current;
				setSave( null );
			}

			return;
		}

		if ( track.silent ) {
			return;
		}

		// The save sent an event if the post was served before it or is now.
		const touchesPublic =
			track.servedBefore ||
			isServed( postType, { id: postId, status, password } );
		const interrupted = track.interrupted;
		track.interrupted = null;

		if ( touchesPublic && saveSucceeded ) {
			setSave( {
				restPath,
				postId,
				known,
				since: serverTime( modifiedGmt ),
			} );
		} else if ( interrupted ) {
			// A new object, so the poll effect runs again for the same save.
			setSave( { ...interrupted } );
		}
	}, [
		postType,
		restPath,
		isSaving,
		isSilentSave,
		saveSucceeded,
		status,
		password,
		modifiedGmt,
		known,
		postId,
	] );

	// One poll per save, aborted when the next save starts or the editor closes.
	useEffect( () => {
		if ( ! save ) {
			return undefined;
		}

		const controller = new AbortController();
		running.current = save;

		pollAfterSave( save, controller.signal ).then(
			() => {
				if ( ! controller.signal.aborted ) {
					running.current = null;
				}
			},
			// Aborted while waiting between polls: nothing to show.
			() => {}
		);

		return () => controller.abort();
	}, [ save ] );

	return null;
}

registerPlugin( 'resource-hub-revalidation-feedback', {
	render: RevalidationFeedback,
} );
