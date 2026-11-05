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
	 * The request: POST to `{url}/api/revalidate`, bearer and JSON headers, the payload as JSON, a 3-second
	 * timeout, no redirects. The trailing slash on the configured URL is dropped.
	 */
	public function test_request_shape(): void {
		$this->configure( 'https://hub.example/', 's3cret' );

		( new Sender() )->send( self::payload() );

		$this->assertCount( 1, $this->requests );

		$request = $this->requests[0];
		$this->assertSame( 'https://hub.example/api/revalidate', $request['url'] );
		$this->assertSame( 'POST', $request['args']['method'] );
		$this->assertSame( 3, $request['args']['timeout'] );
		$this->assertSame( 0, $request['args']['redirection'] );
		$this->assertSame( 'Bearer s3cret', $request['args']['headers']['Authorization'] );
		$this->assertSame( 'application/json', $request['args']['headers']['Content-Type'] );
		$this->assertSame( self::payload(), json_decode( $request['args']['body'], true ) );
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
		$this->responder = static fn(): array => self::http_response( $code, '{"answer":"body"}' );

		$result = ( new Sender() )->send( self::payload() );

		$this->assertSame( $status, $result->status );
		$this->assertSame( $outcome, $result->outcome );
		$this->assertSame( $code, $result->code );
		$this->assertSame( '{"answer":"body"}', $result->body );
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
	 * The stored body is cut to about 1 KB without splitting a multibyte character.
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
		$outcomes = array( Result::OK, Result::BAD_REQUEST, Result::UNAUTHORIZED, Result::SERVER_ERROR, Result::UNEXPECTED_CODE, Result::TIMEOUT, Result::TRANSPORT_ERROR, Result::NOT_CONFIGURED );
		$seen     = array();

		foreach ( $outcomes as $outcome ) {
			$seen[] = ( new Result( Result::FAILED, $outcome, 418, '', 'boom', 1 ) )->describe();
		}

		$this->assertCount( count( $outcomes ), array_unique( $seen ) );
		$this->assertStringContainsString( '418', $seen[4] );
		$this->assertStringContainsString( 'boom', $seen[6] );
	}
}
