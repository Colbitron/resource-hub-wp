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

		$started  = microtime( true );
		$response = wp_remote_post(
			Config::frontend_url() . self::PATH,
			array(
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
				'headers'     => array(
					'Authorization' => 'Bearer ' . Config::secret(),
					'Content-Type'  => 'application/json',
				),
				'body'        => wp_json_encode( $payload ),
			)
		);
		$duration = (int) round( ( microtime( true ) - $started ) * 1000 );

		if ( is_wp_error( $response ) ) {
			$message = $response->get_error_message();
			$outcome = 1 === preg_match( '/timed out|cURL error 28\b/i', $message ) ? Result::TIMEOUT : Result::TRANSPORT_ERROR;

			return new Result( Result::FAILED, $outcome, null, '', $message, $duration );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = self::cut( (string) wp_remote_retrieve_body( $response ) );

		switch ( $code ) {
			case 200:
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
	 * The first {@see Result::BODY_LIMIT} bytes of a body, never splitting a multibyte character.
	 *
	 * @param string $body Response body.
	 */
	public static function cut( string $body ): string {
		return mb_strcut( $body, 0, Result::BODY_LIMIT );
	}
}
