<?php
/**
 * The one HTTP request to the front end.
 *
 * This file is a critical path: it is read line by line before merge.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * POSTs a payload to `{FRONTEND_URL}/api/revalidate` with a 3-second timeout and no retries (ADR 0013),
 * and turns whatever happens into a {@see Result}.
 *
 * The secret travels only in the `Authorization` header of this request. It is never written to the
 * result, to meta, to PostHog or to WP-CLI output.
 */
final class Sender {
	/**
	 * Seconds to wait for the front end. The VIP ruleset's cap; nothing here needs more.
	 */
	public const TIMEOUT = 3;

	/**
	 * The route on the front end.
	 */
	public const PATH = '/api/revalidate';

	/**
	 * Most bytes of a response body read, so a misconfigured URL cannot make the cron request hold a
	 * large download in memory. Only {@see Result::BODY_LIMIT} bytes are stored, but a 200 is parsed
	 * whole to check its shape, and its `revalidated` list for a full batch of 25 can run to several KB.
	 */
	public const RESPONSE_LIMIT = 65536;

	/**
	 * Sends one batch and reports the outcome. When the URL or the secret is unset no request is made.
	 *
	 * Redirects are not followed: a 3xx comes back as an unexpected code, so the bearer token is only
	 * ever sent to the configured origin.
	 *
	 * @param array{version: int, events: array<int, array<string, mixed>>} $payload The body, from {@see Payload::build()}.
	 */
	public function send( array $payload ): Result {
		if ( ! Config::is_configured() ) {
			return Result::not_configured();
		}

		$json = wp_json_encode( $payload );

		if ( false === $json ) {
			return Result::encode_error();
		}

		$started  = microtime( true );
		$response = wp_remote_post(
			Config::frontend_url() . self::PATH,
			array(
				'timeout'             => self::TIMEOUT,
				'redirection'         => 0,
				'limit_response_size' => self::RESPONSE_LIMIT,
				'headers'             => array(
					'Authorization' => 'Bearer ' . Config::secret(),
					'Content-Type'  => 'application/json',
				),
				'body'                => $json,
			)
		);
		$duration = (int) round( ( microtime( true ) - $started ) * 1000 );

		if ( is_wp_error( $response ) ) {
			$message = $response->get_error_message();
			$outcome = 1 === preg_match( '/timed out|cURL error 28\b/i', $message ) ? Result::TIMEOUT : Result::TRANSPORT_ERROR;

			return new Result( Result::FAILED, $outcome, null, '', $message, $duration );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$raw  = (string) wp_remote_retrieve_body( $response );
		$body = self::cut( $raw );

		switch ( $code ) {
			case 200:
				if ( ! self::is_ok_body( $raw ) ) {
					return new Result( Result::FAILED, Result::BAD_BODY, $code, $body, Result::BAD_BODY_MESSAGE, $duration );
				}

				return new Result( Result::SENT, Result::OK, $code, $body, null, $duration );
			case 400:
				return new Result( Result::FAILED, Result::BAD_REQUEST, $code, $body, null, $duration );
			case 401:
				return new Result( Result::FAILED, Result::UNAUTHORIZED, $code, $body, null, $duration );
			case 500:
				return new Result( Result::FAILED, Result::SERVER_ERROR, $code, $body, null, $duration );
			default:
				return new Result( Result::FAILED, Result::UNEXPECTED_CODE, $code, $body, null, $duration );
		}
	}

	/**
	 * Whether a 200's body is the contract's: a JSON object whose `revalidated` is an array. Anything
	 * else (an HTML page, an empty body, another app's JSON) means the URL does not reach the route.
	 *
	 * @param string $body Response body, whole.
	 */
	public static function is_ok_body( string $body ): bool {
		// Decoded without `$associative`, so a JSON object is a stdClass and a JSON array a PHP array.
		$decoded = json_decode( $body );

		return $decoded instanceof \stdClass
			&& property_exists( $decoded, 'revalidated' )
			&& is_array( $decoded->revalidated );
	}

	/**
	 * The first {@see Result::BODY_LIMIT} bytes of a body, made valid UTF-8, because core refuses to
	 * store a meta value that is not, and the result would stay `pending`. The cut is by bytes; core's
	 * `wp_scrub_utf8()` then replaces each invalid sequence, a character split at the limit among them,
	 * with U+FFFD, so the stored body may run a few bytes past the limit. Core polyfills the scrub where
	 * mbstring is missing, so the plugin does not need the extension.
	 *
	 * @param string $body Response body.
	 */
	public static function cut( string $body ): string {
		return wp_scrub_utf8( substr( $body, 0, Result::BODY_LIMIT ) );
	}
}
