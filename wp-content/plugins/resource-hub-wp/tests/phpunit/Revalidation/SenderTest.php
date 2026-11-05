<?php
/**
 * The sender: the request it makes and every outcome it reports.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\Revalidation\Payload;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\Sender;
use WP_Error;

/**
 * Tests for {@see Sender} with HTTP mocked (ADR 0013).
 */
final class SenderTest extends RevalidationTestCase {
	/**
	 * A one-event payload.
	 *
	 * @return array{version: int, events: array<int, array<string, mixed>>}
	 */
	private static function payload(): array {
		return Payload::build(
			array(
				array(
					'type'     => 'resource',
					'event'    => 'publish',
					'id'       => 5,
					'slug'     => 'five',
					'rest_url' => 'https://cms.example/wp-json/wp/v2/resources/5',
					'types'    => array( 'webinar' ),
					'topics'   => array(),
					'previous' => null,
				),
			)
		);
	}

	/**
	 * The request: POST to `{url}/api/revalidate/`, bearer and JSON headers, the payload as JSON, a 3-second
	 * timeout, no redirects, a bounded response size. The trailing slash on the configured URL is dropped.
	 */
	public function test_request_shape(): void {
		$this->configure( 'https://hub.example/', 's3cret' );

		( new Sender() )->send( self::payload() );

		$this->assertCount( 1, $this->requests );

		$request = $this->requests[0];
		$this->assertSame( 'https://hub.example/api/revalidate/', $request['url'] );
		$this->assertSame( 'POST', $request['args']['method'] );
		$this->assertSame( 3, $request['args']['timeout'] );
		$this->assertSame( 0, $request['args']['redirection'] );
		$this->assertSame( Sender::RESPONSE_LIMIT, $request['args']['limit_response_size'] );
		$this->assertSame( 'Bearer s3cret', $request['args']['headers']['Authorization'] );
		$this->assertSame( 'application/json', $request['args']['headers']['Content-Type'] );
		$this->assertSame( self::payload(), json_decode( $request['args']['body'], true ) );
	}

	/**
	 * The URL is the configured origin plus `/api/revalidate/` exactly once, with no double slash, whether
	 * the configured URL ends in a slash or not. The route keeps its own trailing slash because the front
	 * end's `trailingSlash: true` answers the slashless form with a 308, which the sender does not follow.
	 *
	 * @dataProvider frontend_urls
	 *
	 * @param string $configured The configured front-end URL.
	 * @param string $expected   The URL the request must go to.
	 */
	public function test_url_has_one_slash_before_the_path_and_one_after( string $configured, string $expected ): void {
		$this->configure( $configured );

		( new Sender() )->send( self::payload() );

		$this->assertCount( 1, $this->requests );
		$this->assertSame( $expected, $this->requests[0]['url'] );
		$this->assertStringNotContainsString( '//api', $this->requests[0]['url'] );
	}

	/**
	 * Cases for test_url_has_one_slash_before_the_path_and_one_after().
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function frontend_urls(): array {
		return array(
			'no trailing slash'        => array( 'https://hub.example', 'https://hub.example/api/revalidate/' ),
			'one trailing slash'       => array( 'https://hub.example/', 'https://hub.example/api/revalidate/' ),
			'several trailing slashes' => array( 'https://hub.example//', 'https://hub.example/api/revalidate/' ),
		);
	}

	/**
	 * Each response code maps to one status and outcome, and the body is kept.
	 *
	 * @dataProvider response_codes
	 *
	 * @param int    $code    HTTP status returned.
	 * @param string $status  Expected status.
	 * @param string $outcome Expected outcome.
	 */
	public function test_response_codes( int $code, string $status, string $outcome ): void {
		$this->configure();
		$this->responder = static fn(): array => self::http_response( $code, '{"revalidated":["/resources/"]}' );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( $status, $result->status );
		$this->assertSame( $outcome, $result->outcome );
		$this->assertSame( $code, $result->code );
		$this->assertSame( '{"revalidated":["/resources/"]}', $result->body );
		$this->assertNull( $result->error );
		$this->assertGreaterThanOrEqual( 0, $result->duration_ms );
	}

	/**
	 * Cases for test_response_codes().
	 *
	 * @return array<string, array{0: int, 1: string, 2: string}>
	 */
	public function response_codes(): array {
		return array(
			'200 accepted'      => array( 200, Result::SENT, Result::OK ),
			'400 bad request'   => array( 400, Result::FAILED, Result::BAD_REQUEST ),
			'401 unauthorized'  => array( 401, Result::FAILED, Result::UNAUTHORIZED ),
			'500 server error'  => array( 500, Result::FAILED, Result::SERVER_ERROR ),
			'404 is unexpected' => array( 404, Result::FAILED, Result::UNEXPECTED_CODE ),
			'308 is unexpected' => array( 308, Result::FAILED, Result::UNEXPECTED_CODE ),
			'204 is unexpected' => array( 204, Result::FAILED, Result::UNEXPECTED_CODE ),
		);
	}

	/**
	 * A 200 whose body is not a JSON object with a `revalidated` array is a failure with its own outcome
	 * and a plain message: the URL reaches something, but not the revalidate route.
	 *
	 * @dataProvider wrong_ok_bodies
	 *
	 * @param string $body The body returned with the 200.
	 */
	public function test_200_with_the_wrong_body_is_bad_body( string $body ): void {
		$this->configure();
		$this->responder = static fn(): array => self::http_response( 200, $body );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( Result::FAILED, $result->status );
		$this->assertSame( Result::BAD_BODY, $result->outcome );
		$this->assertSame( 200, $result->code );
		$this->assertSame( Sender::cut( $body ), $result->body );
		$this->assertSame( 'The front end answered 200 but not with the expected body; check the front-end URL.', $result->error );
	}

	/**
	 * Cases for test_200_with_the_wrong_body_is_bad_body().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function wrong_ok_bodies(): array {
		return array(
			'empty'                    => array( '' ),
			'an HTML page'             => array( '<!doctype html><title>Home</title>' ),
			'plain text'               => array( 'OK' ),
			'another JSON object'      => array( '{"answer":"body"}' ),
			'a JSON array'             => array( '[{"revalidated":[]}]' ),
			'revalidated not an array' => array( '{"revalidated":"/resources/"}' ),
			'revalidated an object'    => array( '{"revalidated":{"0":"/resources/"}}' ),
		);
	}

	/**
	 * A payload `wp_json_encode()` cannot encode is never sent: no request, and a failure with a plain message.
	 */
	public function test_unencodable_payload_sends_nothing(): void {
		$this->configure();
		$payload                    = self::payload();
		$payload['events'][0]['id'] = INF;

		$result = ( new Sender() )->send( $payload );

		$this->assertSame( Result::FAILED, $result->status );
		$this->assertSame( Result::ENCODE_ERROR, $result->outcome );
		$this->assertNull( $result->code );
		$this->assertSame( 'Not sent: the events could not be encoded as JSON.', $result->error );
		$this->assertSame( array(), $this->requests );
	}

	/**
	 * A timed-out request is its own outcome, distinct from other transport errors.
	 */
	public function test_timeout(): void {
		$this->configure();
		$this->responder = static fn(): WP_Error => new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out after 3001 milliseconds with 0 bytes received' );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( Result::FAILED, $result->status );
		$this->assertSame( Result::TIMEOUT, $result->outcome );
		$this->assertNull( $result->code );
		$this->assertSame( '', $result->body );
		$this->assertStringContainsString( 'timed out', $result->error );
	}

	/**
	 * Any other transport failure is a transport error carrying the message.
	 */
	public function test_transport_error(): void {
		$this->configure();
		$this->responder = static fn(): WP_Error => new WP_Error( 'http_request_failed', 'cURL error 6: Could not resolve host: hub.example' );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( Result::FAILED, $result->status );
		$this->assertSame( Result::TRANSPORT_ERROR, $result->outcome );
		$this->assertNull( $result->code );
		$this->assertSame( 'cURL error 6: Could not resolve host: hub.example', $result->error );
	}

	/**
	 * With no URL, no secret, or neither, nothing is sent and the result says not configured.
	 */
	public function test_not_configured_sends_nothing(): void {
		foreach ( array( array( '', '' ), array( 'https://hub.example', '' ), array( '', 'secret' ) ) as $pair ) {
			$this->configure( $pair[0], $pair[1] );

			$result = ( new Sender() )->send( self::payload() );

			$this->assertSame( Result::FAILED, $result->status );
			$this->assertSame( Result::NOT_CONFIGURED, $result->outcome );
			$this->assertNull( $result->code );
			$this->assertSame( 0, $result->duration_ms );
		}

		$this->assertSame( array(), $this->requests );
	}

	/**
	 * The stored body is cut to about 1 KB; a cut that falls between characters keeps them all whole.
	 */
	public function test_body_is_cut_to_about_one_kilobyte(): void {
		$this->configure();
		$long            = str_repeat( 'é', 1000 );
		$this->responder = static fn(): array => self::http_response( 500, $long );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( Result::BODY_LIMIT, strlen( $result->body ) );
		$this->assertSame( 512, mb_strlen( $result->body ) );
		$this->assertSame( str_repeat( 'é', 512 ), $result->body );
		$this->assertSame( 'short', Sender::cut( 'short' ) );
	}

	/**
	 * A cut that falls inside a multibyte character leaves valid UTF-8: the character's first byte,
	 * left alone at the limit, becomes U+FFFD, and every whole character before it is kept.
	 */
	public function test_cut_through_a_multibyte_character_is_made_valid(): void {
		$this->configure();
		$long            = 'a' . str_repeat( 'é', 1000 );
		$this->responder = static fn(): array => self::http_response( 500, $long );

		$this->assertSame( "\xc3", substr( $long, Result::BODY_LIMIT - 1, 1 ), 'The limit falls inside an é.' );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertTrue( wp_is_valid_utf8( $result->body ) );
		$this->assertSame( 'a' . str_repeat( 'é', 511 ) . "\u{FFFD}", $result->body );
		$this->assertSame( Result::BODY_LIMIT + 2, strlen( $result->body ) );
	}

	/**
	 * A body that is not valid UTF-8 is made valid as it is cut, so it can be stored as meta.
	 */
	public function test_invalid_utf8_body_is_made_valid(): void {
		$this->configure();
		$this->responder = static fn(): array => self::http_response( 500, "\xff\xfe bin \xc3" );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( Result::SERVER_ERROR, $result->outcome );
		$this->assertTrue( wp_is_valid_utf8( $result->body ) );
		$this->assertStringContainsString( ' bin ', $result->body );
	}

	/**
	 * The secret appears nowhere in the result.
	 */
	public function test_result_never_holds_the_secret(): void {
		$this->configure( 'https://hub.example', 'do-not-leak' );
		$this->responder = static fn(): array => self::http_response( 401, '{"error":"unauthorized"}' );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertStringNotContainsString( 'do-not-leak', wp_json_encode( $result->to_array() ) );
		$this->assertStringNotContainsString( 'do-not-leak', $result->describe() );
	}

	/**
	 * Every outcome has one plain sentence for WP-CLI.
	 */
	public function test_describe_covers_every_outcome(): void {
		$seen = array();

		foreach ( Result::OUTCOMES as $outcome ) {
			$seen[ $outcome ] = ( new Result( Result::FAILED, $outcome, 418, '', 'boom', 1 ) )->describe();
		}

		$this->assertCount( 11, Result::OUTCOMES );
		$this->assertCount( count( Result::OUTCOMES ), array_unique( $seen ) );
		$this->assertStringContainsString( '418', $seen[ Result::UNEXPECTED_CODE ] );
		$this->assertStringContainsString( 'boom', $seen[ Result::TRANSPORT_ERROR ] );
		$this->assertStringContainsString( 'check the front-end URL', $seen[ Result::BAD_BODY ] );
		$this->assertStringContainsString( 'encoded as JSON', $seen[ Result::ENCODE_ERROR ] );
	}
}
