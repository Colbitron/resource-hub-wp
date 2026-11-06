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
 * the list column on the Resources and Pages lists and a full sentence for the term notice and the status page.
 * The block editor's notice reads the same sentences, handed to its script by
 * {@see \ResourceHub\Editor\RevalidationAssets}. Nothing here prints the raw response body. For a
 * 400, a 500 or a transport failure a sentence may quote one message: the stored `error` (a transport
 * message or one of the plugin's own), else the `error` string of the front end's JSON body, which the
 * route words to name a path and never a value. When a JSON body was cut and no message could be read
 * from it, the sentence says the reply was too long to show. The plugin never writes the secret to a
 * record; a quoted `error` is the front end's own text, trusted not to echo the `Authorization` header
 * back (a front-end URL pointing at some other host that echoes it would be quoted). Every caller
 * escapes the sentence on output.
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
	 * The outcomes whose sentence is followed by the record's error message, when there is one.
	 */
	public const WITH_ERROR = array( Result::BAD_REQUEST, Result::SERVER_ERROR, Result::TRANSPORT_ERROR );

	/**
	 * The sentence key for a `not_configured` record whose cause is an invalid secret: a key of
	 * {@see ResultText::sentences()}, not an outcome.
	 */
	public const INVALID_SECRET = 'not_configured_invalid_secret';

	/**
	 * The sentence key for the note that follows a 400 or 500 whose body was cut at
	 * {@see Result::BODY_LIMIT} bytes before any message could be read from it: a key of
	 * {@see ResultText::sentences()}, not an outcome.
	 */
	public const BODY_TOO_LONG = 'body_too_long';

	/**
	 * Whether a record is a `not_configured` skipped because the secret in force breaks the rule. Only
	 * that cause stores an `error` on a `not_configured` result ({@see Result::not_configured()}), so
	 * any non-empty `error` there means it; the message itself is never shown, the sentence says where
	 * to look instead.
	 *
	 * @param array<string, mixed> $record The stored record.
	 */
	public static function is_invalid_secret( array $record ): bool {
		$error = $record['error'] ?? null;

		return Result::NOT_CONFIGURED === ( $record['outcome'] ?? '' ) && is_string( $error ) && '' !== trim( $error );
	}

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
				return self::is_invalid_secret( $record ) ? __( 'Not configured: invalid secret', 'resource-hub' ) : __( 'Not configured', 'resource-hub' );
			case Result::NO_SINGLE_TYPE:
				return __( 'Not sent: needs one type', 'resource-hub' );
			case Result::RESERVED_TYPE:
				return __( 'Not sent: reserved type slug', 'resource-hub' );
			case Result::ENCODE_ERROR:
				return __( 'Not sent: encoding error', 'resource-hub' );
			default:
				return __( 'Failed', 'resource-hub' );
		}
	}

	/**
	 * The sentence for each outcome, keyed by outcome, plus `stale` for a stale pending, `failed` for
	 * an outcome this version does not know, {@see ResultText::INVALID_SECRET} for a `not_configured`
	 * caused by an invalid secret, {@see ResultText::BODY_TOO_LONG} for the note after a reply too long
	 * to quote, and `no_answer`, which only the block editor uses, for a
	 * poll window that closed with no record for the save. `unexpected_code` holds `%d` for the HTTP
	 * code. This is the one source of the wording: {@see ResultText::sentence()} reads it here, and the
	 * block editor's script receives it through `wp_localize_script()`. Nothing in it is
	 * configuration, so the secret can never reach the browser this way.
	 *
	 * @return array<string, string>
	 */
	public static function sentences(): array {
		return array(
			'stale'                 => __( 'No answer recorded: the send may not have run.', 'resource-hub' ),
			ResultStore::PENDING    => __( 'Revalidation is pending: no answer has arrived from the front end yet.', 'resource-hub' ),
			Result::OK              => __( 'The front end accepted the revalidation (200).', 'resource-hub' ),
			Result::BAD_BODY        => __( 'Revalidation failed: the front end answered 200 but not with the expected body. Check the front-end URL.', 'resource-hub' ),
			Result::BAD_REQUEST     => __( 'Revalidation rejected: the front end could not read the request (400).', 'resource-hub' ),
			Result::UNAUTHORIZED    => __( 'Revalidation rejected: the secret does not match (401).', 'resource-hub' ),
			Result::SERVER_ERROR    => __( 'Revalidation failed on the front end (500).', 'resource-hub' ),
			/* translators: %d: HTTP status code. */
			Result::UNEXPECTED_CODE => __( 'Revalidation got an unexpected response (%d).', 'resource-hub' ),
			Result::TIMEOUT         => __( 'Revalidation timed out: the front end did not answer within 3 seconds.', 'resource-hub' ),
			Result::TRANSPORT_ERROR => __( 'Revalidation could not reach the front end.', 'resource-hub' ),
			Result::NOT_CONFIGURED  => __( 'Revalidation skipped: the front-end URL or the secret is not configured.', 'resource-hub' ),
			self::INVALID_SECRET    => __( 'Revalidation skipped: the front-end URL or the secret is not configured; the secret is set but not valid, so check Settings > Resource Hub.', 'resource-hub' ),
			/* translators: %d: how many kilobytes of a reply are kept, 1 today. */
			self::BODY_TOO_LONG     => sprintf( __( 'The front end\'s reply was too long to show (over %d KB).', 'resource-hub' ), intdiv( Result::BODY_LIMIT, 1024 ) ),
			Result::NO_SINGLE_TYPE  => __( 'Revalidation not sent: a resource needs exactly one type.', 'resource-hub' ),
			Result::RESERVED_TYPE   => __( 'Revalidation not sent: a type\'s slug cannot be topic or page. Give this type a different slug and save it again.', 'resource-hub' ),
			Result::ENCODE_ERROR    => __( 'Revalidation not sent: the events could not be encoded as JSON.', 'resource-hub' ),
			'failed'                => __( 'Revalidation failed.', 'resource-hub' ),
			'no_answer'             => __( 'No answer has arrived from the front end yet for this save. Reload later to check, or save again to retry.', 'resource-hub' ),
		);
	}

	/**
	 * One plain sentence, from {@see ResultText::sentences()}, the wording the block editor's notice
	 * also uses: the error message after it for the outcomes in {@see ResultText::WITH_ERROR}, a pointer
	 * to the settings for a `not_configured` caused by an invalid secret, and how
	 * many other changes travelled in the same request, when any did.
	 *
	 * @param array<string, mixed> $record The stored record.
	 * @param int|null             $now    Unix time for the stale check; null means now.
	 */
	public static function sentence( array $record, ?int $now = null ): string {
		$sentences = self::sentences();

		if ( self::is_stale_pending( $record, $now ) ) {
			return $sentences['stale'];
		}

		$outcome = $record['outcome'] ?? '';
		$outcome = is_string( $outcome ) ? $outcome : '';

		if ( ResultStore::PENDING === $outcome ) {
			return $sentences[ ResultStore::PENDING ];
		}

		$sentence = in_array( $outcome, Result::OUTCOMES, true ) && isset( $sentences[ $outcome ] ) ? $sentences[ $outcome ] : $sentences['failed'];

		if ( self::is_invalid_secret( $record ) ) {
			$sentence = $sentences[ self::INVALID_SECRET ];
		}

		if ( Result::UNEXPECTED_CODE === $outcome ) {
			$sentence = sprintf( $sentence, (int) ( $record['code'] ?? 0 ) );
		}

		if ( in_array( $outcome, self::WITH_ERROR, true ) ) {
			$sentence = self::with_error( $sentence, $record );
		}

		return self::with_others( $sentence, $record );
	}

	/**
	 * A sentence with "It was sent with N other changes." after it, when the record travelled with
	 * others. The block editor's script has the same two msgids in `_n()`, since a plural rule cannot
	 * be handed from PHP to JavaScript.
	 *
	 * @param string               $sentence The sentence.
	 * @param array<string, mixed> $record   The stored record.
	 */
	private static function with_others( string $sentence, array $record ): string {
		$others = (int) ( $record['others'] ?? 0 );

		if ( $others < 1 ) {
			return $sentence;
		}

		/* translators: %d: how many other changes travelled in the same request. */
		return $sentence . ' ' . sprintf( _n( 'It was sent with %d other change.', 'It was sent with %d other changes.', $others, 'resource-hub' ), $others );
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
	 * stored body is its JSON `{ "error": "…" }`. When neither gives a message, the record says its
	 * body was cut ({@see Result::$truncated}) and the body starts like a JSON object, the
	 * {@see ResultText::BODY_TOO_LONG} note follows instead, so a long reply is not mistaken for one with
	 * nothing to say. A cut body that does not start with `{` (a proxy's HTML error page) gets no note,
	 * like a short one: it never held a message to show. The raw body itself is never printed. Escaped
	 * on output.
	 *
	 * @param string               $sentence The sentence.
	 * @param array<string, mixed> $record   The stored record.
	 */
	private static function with_error( string $sentence, array $record ): string {
		$error = $record['error'] ?? null;

		if ( ! is_string( $error ) || '' === trim( $error ) ) {
			$error = self::error_from_body( $record );
		}

		if ( '' === trim( $error ) && true === ( $record['truncated'] ?? false ) && self::starts_like_json_object( $record['body'] ?? '' ) ) {
			$error = self::sentences()[ self::BODY_TOO_LONG ];
		}

		return '' === trim( $error ) ? $sentence : $sentence . ' ' . trim( $error );
	}

	/**
	 * The front end's `error` string from a stored 400 or 500 body, or an empty string. The body is
	 * cut to about 1 KB, so a long one no longer parses; then there is nothing to quote, and the
	 * record's `truncated` flag lets {@see ResultText::with_error()} say why.
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

	/**
	 * Whether a stored body starts like a JSON object: its first character after JSON's own whitespace
	 * (space, tab, line feed, carriage return) is `{`. The block editor's script has the same test.
	 *
	 * @param mixed $body The stored body.
	 */
	private static function starts_like_json_object( mixed $body ): bool {
		return is_string( $body ) && str_starts_with( ltrim( $body, " \t\n\r" ), '{' );
	}
}
