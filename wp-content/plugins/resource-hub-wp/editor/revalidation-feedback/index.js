/**
 * Revalidation feedback in the block editor (ADR 0018).
 *
 * The send to the front end runs in cron after the save has returned, so the
 * save response cannot carry the result. After a save that is neither an
 * autosave nor a preview completes, this polls the post's read-only
 * `rh_last_revalidation` REST field about once a second for up to about ten
 * seconds, then puts the outcome in one `core/notices` notice. The record the
 * save response itself carried is the one from before this save (the hook
 * writes at `shutdown`, after the response), so a record counts as this save's
 * once its batch ID or time differs from that one.
 *
 * On load, a last result that was a failure is shown once. PHP enqueues this
 * only on the resource editor; the post-type check is a second guard.
 */
import apiFetch from '@wordpress/api-fetch';
import { dispatch, select, subscribe } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __, _n, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';

const POST_TYPE = 'resource';
const FIELD = 'rh_last_revalidation';
const NOTICE_ID = 'resource-hub-revalidation';
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 10;

// Mirrors ResultText::STALE_PENDING_SECONDS in PHP.
const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * The front end's `error` string from a stored 400 or 500 body, or an empty
 * string. The body is cut to about 1 KB, so the JSON may be truncated; then
 * there is no message to quote.
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
		return parsed && typeof parsed.error === 'string'
			? parsed.error.trim()
			: '';
	} catch {
		return '';
	}
}

/**
 * A sentence with the stored error, or the body's `error` string, after it.
 *
 * @param {string} sentence The sentence.
 * @param {Object} record   The stored record.
 * @return {string} The sentence with its detail.
 */
function withError( sentence, record ) {
	const detail =
		typeof record.error === 'string' && record.error.trim() !== ''
			? record.error.trim()
			: errorFromBody( record );

	return detail ? `${ sentence } ${ detail }` : sentence;
}

/**
 * Whether a pending record is old enough that the send evidently never ran.
 *
 * @param {Object} record The stored record.
 * @return {boolean} Whether it is a stale pending.
 */
function isStalePending( record ) {
	if ( record.status !== 'pending' ) {
		return false;
	}

	const time = Date.parse( record.time );
	return Number.isNaN( time ) || Date.now() - time > STALE_PENDING_MS;
}

/**
 * The notice for a stored record: its status and one plain sentence. The
 * wording matches ResultText::sentence() in PHP.
 *
 * @param {Object} record The stored record.
 * @return {{status: string, message: string}} What to show.
 */
function describe( record ) {
	if ( isStalePending( record ) ) {
		return {
			status: 'warning',
			message: __(
				'No answer recorded: the send may not have run.',
				'resource-hub'
			),
		};
	}

	let message;

	switch ( record.outcome ) {
		case 'pending':
			return {
				status: 'warning',
				message: __(
					'Revalidation is pending: no answer has arrived from the front end yet. Reload later to check, or save again to retry.',
					'resource-hub'
				),
			};
		case 'ok':
			message = __(
				'The front end accepted the revalidation (200).',
				'resource-hub'
			);
			break;
		case 'bad_body':
			message = __(
				'Revalidation failed: the front end answered 200 but not with the expected body. Check the front-end URL.',
				'resource-hub'
			);
			break;
		case 'bad_request':
			message = withError(
				__(
					'Revalidation rejected: the front end could not read the request (400).',
					'resource-hub'
				),
				record
			);
			break;
		case 'unauthorized':
			message = __(
				'Revalidation rejected: the secret does not match (401).',
				'resource-hub'
			);
			break;
		case 'server_error':
			message = withError(
				__(
					'Revalidation failed on the front end (500).',
					'resource-hub'
				),
				record
			);
			break;
		case 'unexpected_code':
			message = sprintf(
				/* translators: %d: HTTP status code. */
				__(
					'Revalidation got an unexpected response (%d).',
					'resource-hub'
				),
				Number( record.code ) || 0
			);
			break;
		case 'timeout':
			message = __(
				'Revalidation timed out: the front end did not answer within 3 seconds.',
				'resource-hub'
			);
			break;
		case 'transport_error':
			message = withError(
				__(
					'Revalidation could not reach the front end.',
					'resource-hub'
				),
				record
			);
			break;
		case 'not_configured':
			message = __(
				'Revalidation skipped: the front-end URL or the secret is not configured.',
				'resource-hub'
			);
			break;
		case 'no_single_type':
			message = __(
				'Revalidation not sent: a resource needs exactly one type.',
				'resource-hub'
			);
			break;
		case 'encode_error':
			message = __(
				'Revalidation not sent: the events could not be encoded as JSON.',
				'resource-hub'
			);
			break;
		default:
			message = __( 'Revalidation failed.', 'resource-hub' );
	}

	if ( Number( record.others ) > 0 ) {
		message +=
			' ' +
			sprintf(
				/* translators: %d: how many other changes travelled in the same request. */
				_n(
					'It was sent with %d other change.',
					'It was sent with %d other changes.',
					Number( record.others ),
					'resource-hub'
				),
				Number( record.others )
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
 * Whether a polled record is a different one from the record known before the
 * save.
 *
 * @param {Object}      record The polled record.
 * @param {Object|null} known  The record from before the save, if any.
 * @return {boolean} Whether it is new.
 */
function isNew( record, known ) {
	return (
		! known ||
		record.batch_id !== known.batch_id ||
		record.time !== known.time
	);
}

const wait = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

let pollToken = 0;

/**
 * Polls the post's field until a record for this save that is no longer
 * pending appears, or the window closes. A later save cancels an earlier poll.
 *
 * @param {number}      postId The post.
 * @param {Object|null} known  The record from before the save, if any.
 */
async function pollAfterSave( postId, known ) {
	const token = ++pollToken;
	let latest = null;

	for ( let attempt = 0; attempt < POLL_ATTEMPTS; attempt++ ) {
		try {
			const response = await apiFetch( {
				path: `/wp/v2/resources/${ postId }?context=edit&_fields=${ FIELD }`,
			} );
			const record = response?.[ FIELD ] ?? null;

			if ( record && isNew( record, known ) ) {
				latest = record;

				if ( record.status !== 'pending' ) {
					break;
				}
			}
		} catch {
			// A failed poll is retried on the next tick; the window still closes.
		}

		if ( token !== pollToken ) {
			return;
		}

		await wait( POLL_INTERVAL_MS );
	}

	if ( token !== pollToken ) {
		return;
	}

	if ( latest ) {
		notify( describe( latest ) );
		return;
	}

	notify( {
		status: 'warning',
		message: __(
			'No answer has arrived from the front end yet for this save. Reload later to check, or save again to retry.',
			'resource-hub'
		),
	} );
}

let shownOnLoad = false;
let wasSaving = false;
let saveIsSilent = false;
let statusBeforeSave = '';

subscribe( () => {
	const editor = select( editorStore );

	if ( editor.getCurrentPostType() !== POST_TYPE ) {
		return;
	}

	if ( ! shownOnLoad && editor.getCurrentPostId() ) {
		shownOnLoad = true;
		const last = editor.getCurrentPostAttribute( FIELD );

		if ( last && last.status !== 'sent' ) {
			notify( describe( last ) );
		}
	}

	const isSaving = editor.isSavingPost();

	if ( isSaving && ! wasSaving ) {
		saveIsSilent = editor.isAutosavingPost() || editor.isPreviewingPost();
		statusBeforeSave = editor.getCurrentPostAttribute( 'status' );
	}

	if ( ! isSaving && wasSaving ) {
		const statusAfter = editor.getCurrentPostAttribute( 'status' );
		const touchesPublic =
			statusBeforeSave === 'publish' || statusAfter === 'publish';

		if (
			! saveIsSilent &&
			touchesPublic &&
			editor.didPostSaveRequestSucceed()
		) {
			pollAfterSave(
				editor.getCurrentPostId(),
				editor.getCurrentPostAttribute( FIELD ) ?? null
			);
		}
	}

	wasSaving = isSaving;
}, editorStore );
