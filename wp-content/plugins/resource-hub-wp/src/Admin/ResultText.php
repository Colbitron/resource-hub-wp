<?php
/**
 * A stored revalidation result in plain words.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Admin;

use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;

/**
 * Turns a `_rh_last_revalidation` record into the words the admin screens show: a short label for
 * the Resources list column and a full sentence for the term notice and the status page (ADR 0018).
 * The block editor's notice has the same sentences in JavaScript. Nothing here prints the response
 * body: a sentence may quote the stored `error`, which is a transport message or one of the plugin's
 * own, never a body and never the secret.
 */
final class ResultText {
	/**
	 * How old a `pending` record may be before it is shown as "no answer recorded", in seconds.
	 *
	 * A scheduled batch is spawned at once and WP-Cron's own lock lasts 60 seconds, so a send that
	 * is going to run has run within a couple of minutes. Five minutes of `pending` means the cron
	 * request never ran: the loopback is blocked, or `DISABLE_WP_CRON` is set with no system cron.
	 * Display only; the record itself is never rewritten.
	 */
	public const STALE_PENDING_SECONDS = 300;

	/**
	 * Whether a record is a `pending` older than {@see ResultText::STALE_PENDING_SECONDS}.
	 *
	 * @param array<string, mixed> $record The stored record.
	 * @param int|null             $now    Unix time to compare against; null means now.
	 */
	public static function is_stale_pending( array $record, ?int $now = null ): bool {
		if ( ResultStore::PENDING !== ( $record['status'] ?? '' ) ) {
			return false;
		}

		$time = self::timestamp( $record );

		if ( null === $time ) {
			return true;
		}

		return ( $now ?? time() ) - $time > self::STALE_PENDING_SECONDS;
	}

	/**
	 * Whether a record is a success, a failure, or neither (pending). Maps to a notice class.
	 *
	 * @param array<string, mixed> $record The stored record.
	 * @return string `success`, `error` or `warning`.
	 */
	public static function level( array $record ): string {
		if ( Result::SENT === ( $record['status'] ?? '' ) ) {
			return 'success';
		}

		if ( ResultStore::PENDING === ( $record['status'] ?? '' ) ) {
			return 'warning';
		}

		return 'error';
	}

	/**
	 * A few words for the list column.
	 *
	 * @param array<string, mixed> $record The stored record.
	 * @param int|null             $now    Unix time for the stale check; null means now.
	 */
	public static function label( array $record, ?int $now = null ): string {
		if ( self::is_stale_pending( $record, $now ) ) {
			return __( 'No answer recorded', 'resource-hub' );
		}

		switch ( $record['outcome'] ?? '' ) {
			case ResultStore::PENDING:
				return __( 'Pending', 'resource-hub' );
			case Result::OK:
				return __( 'Accepted', 'resource-hub' );
			case Result::BAD_BODY:
				return __( 'Failed: unexpected body', 'resource-hub' );
			case Result::BAD_REQUEST:
				return __( 'Rejected (400)', 'resource-hub' );
			case Result::UNAUTHORIZED:
				return __( 'Rejected (401)', 'resource-hub' );
			case Result::SERVER_ERROR:
				return __( 'Failed (500)', 'resource-hub' );
			case Result::UNEXPECTED_CODE:
				/* translators: %d: HTTP status code. */
				return sprintf( __( 'Unexpected response (%d)', 'resource-hub' ), (int) ( $record['code'] ?? 0 ) );
			case Result::TIMEOUT:
				return __( 'Timed out', 'resource-hub' );
			case Result::TRANSPORT_ERROR:
				return __( 'Could not reach the front end', 'resource-hub' );
			case Result::NOT_CONFIGURED:
				return __( 'Not configured', 'resource-hub' );
			case Result::NO_SINGLE_TYPE:
				return __( 'Not sent: needs one type', 'resource-hub' );
			case Result::ENCODE_ERROR:
				return __( 'Not sent: encoding error', 'resource-hub' );
			default:
				return __( 'Failed', 'resource-hub' );
		}
	}

	/**
	 * One plain sentence, the same wording as the block editor's notice.
	 *
	 * @param array<string, mixed> $record The stored record.
	 * @param int|null             $now    Unix time for the stale check; null means now.
	 */
	public static function sentence( array $record, ?int $now = null ): string {
		if ( self::is_stale_pending( $record, $now ) ) {
			return __( 'No answer recorded: the send may not have run.', 'resource-hub' );
		}

		switch ( $record['outcome'] ?? '' ) {
			case ResultStore::PENDING:
				return __( 'Revalidation is pending: no answer has arrived from the front end yet.', 'resource-hub' );
			case Result::OK:
				return __( 'The front end accepted the revalidation (200).', 'resource-hub' );
			case Result::BAD_BODY:
				return __( 'Revalidation failed: the front end answered 200 but not with the expected body. Check the front-end URL.', 'resource-hub' );
			case Result::BAD_REQUEST:
				return self::with_error( __( 'Revalidation rejected: the front end could not read the request (400).', 'resource-hub' ), $record );
			case Result::UNAUTHORIZED:
				return __( 'Revalidation rejected: the secret does not match (401).', 'resource-hub' );
			case Result::SERVER_ERROR:
				return self::with_error( __( 'Revalidation failed on the front end (500).', 'resource-hub' ), $record );
			case Result::UNEXPECTED_CODE:
				/* translators: %d: HTTP status code. */
				return sprintf( __( 'Revalidation got an unexpected response (%d).', 'resource-hub' ), (int) ( $record['code'] ?? 0 ) );
			case Result::TIMEOUT:
				return __( 'Revalidation timed out: the front end did not answer within 3 seconds.', 'resource-hub' );
			case Result::TRANSPORT_ERROR:
				return self::with_error( __( 'Revalidation could not reach the front end.', 'resource-hub' ), $record );
			case Result::NOT_CONFIGURED:
				return __( 'Revalidation skipped: the front-end URL or the secret is not configured.', 'resource-hub' );
			case Result::NO_SINGLE_TYPE:
				return __( 'Revalidation not sent: a resource needs exactly one type.', 'resource-hub' );
			case Result::ENCODE_ERROR:
				return __( 'Revalidation not sent: the events could not be encoded as JSON.', 'resource-hub' );
			default:
				return __( 'Revalidation failed.', 'resource-hub' );
		}
	}

	/**
	 * The record's time as "5 mins ago", or an empty string when it has none.
	 *
	 * @param array<string, mixed> $record The stored record.
	 * @param int|null             $now    Unix time; null means now.
	 */
	public static function relative_time( array $record, ?int $now = null ): string {
		$time = self::timestamp( $record );

		if ( null === $time ) {
			return '';
		}

		/* translators: %s: a human-readable time difference, such as "5 mins". */
		return sprintf( __( '%s ago', 'resource-hub' ), human_time_diff( $time, $now ?? time() ) );
	}

	/**
	 * The record's time in the site's date and time format and timezone, or an empty string.
	 *
	 * @param array<string, mixed> $record The stored record.
	 */
	public static function local_time( array $record ): string {
		$time = self::timestamp( $record );

		if ( null === $time ) {
			return '';
		}

		return (string) wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $time );
	}

	/**
	 * The record's `time` as a Unix timestamp, or null when it is missing or unreadable.
	 *
	 * @param array<string, mixed> $record The stored record.
	 */
	public static function timestamp( array $record ): ?int {
		$time = $record['time'] ?? '';

		if ( ! is_string( $time ) || '' === $time ) {
			return null;
		}

		$parsed = strtotime( $time );

		return false === $parsed ? null : $parsed;
	}

	/**
	 * A sentence with the record's error message after it, when there is one: the stored `error` (a
	 * transport message or one of the plugin's own), else the front end's `error` string when the
	 * stored body is its JSON `{ "error": "…" }`. The raw body itself is never printed. Escaped on output.
	 *
	 * @param string               $sentence The sentence.
	 * @param array<string, mixed> $record   The stored record.
	 */
	private static function with_error( string $sentence, array $record ): string {
		$error = $record['error'] ?? null;

		if ( ! is_string( $error ) || '' === trim( $error ) ) {
			$error = self::error_from_body( $record );
		}

		return '' === trim( $error ) ? $sentence : $sentence . ' ' . trim( $error );
	}

	/**
	 * The front end's `error` string from a stored 400 or 500 body, or an empty string. The body is
	 * cut to about 1 KB, so a long one no longer parses; then there is nothing to quote.
	 *
	 * @param array<string, mixed> $record The stored record.
	 */
	public static function error_from_body( array $record ): string {
		$body = $record['body'] ?? '';

		if ( ! is_string( $body ) || '' === $body ) {
			return '';
		}

		$decoded = json_decode( $body, true );

		return is_array( $decoded ) && isset( $decoded['error'] ) && is_string( $decoded['error'] ) ? $decoded['error'] : '';
	}
}
