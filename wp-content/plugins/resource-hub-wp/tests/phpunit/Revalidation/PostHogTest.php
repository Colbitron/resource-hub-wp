<?php
/**
 * PostHog: on when configured, silent when not, never in the way.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\Revalidation\PostHog;
use ResourceHub\Revalidation\Result;
use WP_Error;

/**
 * Tests for {@see PostHog} (ADR 0032).
 */
final class PostHogTest extends RevalidationTestCase {
	/**
	 * Two events, one of each type.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	private static function events(): array {
		return array(
			array(
				'type'     => 'resource',
				'event'    => 'delete',
				'id'       => 9,
				'slug'     => 'gone',
				'rest_url' => 'https://cms.example/wp-json/wp/v2/resources/9',
				'types'    => array( 'webinar' ),
				'topics'   => array(),
				'previous' => null,
			),
			array(
				'type'     => 'term',
				'taxonomy' => 'resource_topic',
				'event'    => 'delete',
				'id'       => 4,
				'slug'     => 'old-topic',
				'name'     => 'Old topic',
				'previous' => null,
			),
		);
	}

	/**
	 * Without both constants nothing is sent; the plugin's own instance reads the undefined constants.
	 */
	public function test_unconfigured_sends_nothing(): void {
		$result = new Result( Result::SENT, Result::OK, 200, '{"revalidated":[]}', null, 12 );

		( new PostHog() )->capture( 'batch-1', self::events(), $result );
		( new PostHog( 'phc_key', '' ) )->capture( 'batch-1', self::events(), $result );
		( new PostHog( '', 'https://eu.i.posthog.com' ) )->capture( 'batch-1', self::events(), $result );

		$this->assertFalse( ( new PostHog() )->is_enabled() );
		$this->assertSame( array(), $this->requests );
	}

	/**
	 * Configured, it POSTs one anonymous `revalidation_result` event, with a namespaced `distinct_id`,
	 * no person profile, the CMS host as `site`, and the status, outcome, code, duration and a summary
	 * of every event, with a 3-second timeout.
	 */
	public function test_configured_sends_one_event(): void {
		$result  = new Result( Result::FAILED, Result::SERVER_ERROR, 500, '{"error":"boom"}', null, 250 );
		$posthog = new PostHog( 'phc_key', 'https://eu.i.posthog.com/' );

		$this->assertTrue( $posthog->is_enabled() );

		$posthog->capture( 'batch-2', self::events(), $result );

		$this->assertCount( 1, $this->requests );
		$request = $this->requests[0];
		$this->assertSame( 'https://eu.i.posthog.com/i/v0/e/', $request['url'] );
		$this->assertSame( 'POST', $request['args']['method'] );
		$this->assertSame( 3, $request['args']['timeout'] );
		$this->assertSame( PostHog::RESPONSE_LIMIT, $request['args']['limit_response_size'] );
		$this->assertSame( 'application/json', $request['args']['headers']['Content-Type'] );

		$body = json_decode( $request['args']['body'], true );
		$this->assertSame( 'phc_key', $body['api_key'] );
		$this->assertSame( PostHog::EVENT, $body['event'] );
		$site = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$this->assertNotSame( '', $site );
		$this->assertSame( 'resource-hub-cms:' . $site, $body['distinct_id'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $body['timestamp'] );

		$properties = $body['properties'];
		$this->assertArrayHasKey( '$process_person_profile', $properties );
		$this->assertFalse( $properties['$process_person_profile'] );
		$this->assertSame( $site, $properties['site'] );
		$this->assertSame( 'batch-2', $properties['batch_id'] );
		$this->assertSame( Result::FAILED, $properties['status'] );
		$this->assertSame( Result::SERVER_ERROR, $properties['outcome'] );
		$this->assertSame( 500, $properties['code'] );
		$this->assertSame( 250, $properties['duration_ms'] );
		$this->assertSame( 2, $properties['event_count'] );
		$this->assertSame(
			array(
				array(
					'type'  => 'resource',
					'event' => 'delete',
					'id'    => 9,
					'slug'  => 'gone',
				),
				array(
					'type'     => 'term',
					'event'    => 'delete',
					'id'       => 4,
					'slug'     => 'old-topic',
					'taxonomy' => 'resource_topic',
				),
			),
			$properties['events']
		);
		$this->assertArrayNotHasKey( 'body', $properties, 'The front end body is in meta, not PostHog.' );
	}

	/**
	 * The host with and without a trailing slash.
	 *
	 * @return array<string, array{0: string}>
	 */
	public function host_cases(): array {
		return array(
			'no trailing slash' => array( 'https://eu.i.posthog.com' ),
			'trailing slash'    => array( 'https://eu.i.posthog.com/' ),
		);
	}

	/**
	 * The documented single-event endpoint, with exactly one slash between the host and `i`.
	 *
	 * @dataProvider host_cases
	 *
	 * @param string $host The configured `RESOURCE_HUB_POSTHOG_HOST`.
	 */
	public function test_posts_to_the_single_event_endpoint( string $host ): void {
		( new PostHog( 'phc_key', $host ) )->capture( 'batch-4', self::events(), Result::not_configured() );

		$this->assertCount( 1, $this->requests );
		$this->assertSame( 'https://eu.i.posthog.com/i/v0/e/', $this->requests[0]['url'] );
	}

	/**
	 * A PostHog failure is ignored: no exception, no retry, one request.
	 */
	public function test_failure_is_ignored(): void {
		$this->responder = static fn(): WP_Error => new WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out' );

		( new PostHog( 'phc_key', 'https://eu.i.posthog.com' ) )->capture( 'batch-3', self::events(), Result::not_configured() );

		$this->assertCount( 1, $this->requests );
	}
}
