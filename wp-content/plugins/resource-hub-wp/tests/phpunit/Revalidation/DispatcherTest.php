<?php
/**
 * The dispatcher: cron scheduling, synchronous delivery, the type guard and the 25-event split.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\Dispatcher;
use ResourceHub\Revalidation\PostHog;
use ResourceHub\Revalidation\Queue;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use ResourceHub\Revalidation\Revalidation;
use ResourceHub\Revalidation\Sender;
use WP_REST_Request;

/**
 * Tests for {@see Dispatcher} (ADRs 0012, 0014, 0019).
 */
final class DispatcherTest extends RevalidationTestCase {
	/**
	 * A dispatcher over the plugin's queue with a fresh store, PostHog off unless given, cron unless `$synchronous`.
	 *
	 * @param bool         $synchronous Deliver at flush instead of scheduling.
	 * @param PostHog|null $posthog     PostHog instance; null means off.
	 */
	private function dispatcher( bool $synchronous = false, ?PostHog $posthog = null ): Dispatcher {
		return new Dispatcher( $this->queue, new Sender(), new ResultStore(), $posthog ?? new PostHog( '', '' ), $synchronous );
	}

	/**
	 * Every scheduled cron event for the hook, as `[ batch_id, payload ]` argument pairs, in schedule order.
	 *
	 * @return array<int, array{0: string, 1: array<string, mixed>}>
	 */
	private static function scheduled(): array {
		$found = array();

		foreach ( _get_cron_array() as $hooks ) {
			foreach ( $hooks[ Dispatcher::CRON_HOOK ] ?? array() as $event ) {
				$found[] = $event['args'];
			}
		}

		return $found;
	}

	/**
	 * Adds `$count` valid resource update events straight to the queue.
	 *
	 * @param int $count How many.
	 */
	private function queue_events( int $count ): void {
		for ( $i = 1; $i <= $count; $i++ ) {
			$this->queue->add(
				array(
					'type'     => 'resource',
					'event'    => 'update',
					'id'       => 1000 + $i,
					'slug'     => 'resource-' . $i,
					'rest_url' => 'https://cms.example/wp-json/wp/v2/resources/' . ( 1000 + $i ),
					'types'    => array( 'webinar' ),
					'topics'   => array( 'performance' ),
					'previous' => array(
						'slug'   => 'resource-' . $i,
						'types'  => array( 'webinar' ),
						'topics' => array(),
					),
				)
			);
		}
	}

	/**
	 * Configured and not under WP-CLI, `flush()` marks every object pending, schedules one cron event
	 * whose arguments are the batch ID and the full payload, spawns cron, and makes no request to the
	 * front end itself.
	 */
	public function test_flush_schedules_cron_with_the_payload(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'cron-bound', 'webinar', array( 'performance' ) );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Changed',
			)
		);

		$results = $this->dispatcher()->flush();

		$this->assertSame( array(), $results );
		$this->assertTrue( $this->queue->is_empty() );

		$scheduled = self::scheduled();
		$this->assertCount( 1, $scheduled );
		list( $batch_id, $payload ) = $scheduled[0];

		$this->assertMatchesRegularExpression( '/^[0-9a-f-]{36}$/', $batch_id );
		$this->assertSame( 1, $payload['version'] );
		$this->assertCount( 1, $payload['events'] );
		$this->assertSame( 'update', $payload['events'][0]['event'] );
		$this->assertSame( $post_id, $payload['events'][0]['id'] );
		$this->assert_valid_request( $payload );

		$pending = ResultStore::read_post( $post_id );
		$this->assertSame( ResultStore::PENDING, $pending['status'] );
		$this->assertSame( $batch_id, $pending['batch_id'] );
		$this->assertSame( 0, $pending['others'] );

		$this->assertSame( array(), $this->revalidate_requests() );
		$this->assertCount( 1, $this->requests, 'Expected only the cron spawn request.' );
		$this->assertStringContainsString( 'wp-cron.php', $this->requests[0]['url'] );
	}

	/**
	 * A published post inserted first and given its terms afterwards, as plain PHP and the seeder do, is
	 * sent with those terms: the state is read again at flush, not frozen at the hook.
	 */
	public function test_flush_reads_terms_assigned_after_the_insert(): void {
		$this->configure();
		$ebook       = $this->term_id( Taxonomies::TYPE, 'ebook' );
		$performance = $this->term_id( Taxonomies::TOPIC, 'performance' );
		$post_id     = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_name'   => 'terms-came-later',
			)
		);
		wp_set_object_terms( $post_id, array( $ebook ), Taxonomies::TYPE );
		wp_set_object_terms( $post_id, array( $performance ), Taxonomies::TOPIC );

		$this->assertSame( array(), $this->queue->events()[0]['types'], 'The hook ran before the terms existed.' );

		$results = $this->dispatcher()->flush();

		$this->assertSame( array(), $results, 'Nothing was held back.' );
		$scheduled = self::scheduled();
		$this->assertCount( 1, $scheduled );
		$event = $scheduled[0][1]['events'][0];
		$this->assertSame( 'publish', $event['event'] );
		$this->assertSame( array( 'ebook' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assert_valid_request( $scheduled[0][1] );
	}

	/**
	 * Running the cron callback with the scheduled arguments sends the payload and records the result.
	 */
	public function test_cron_callback_sends_and_records(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'delivered-by-cron' );
		wp_trash_post( $post_id );

		$this->dispatcher()->flush();
		list( $batch_id, $payload ) = self::scheduled()[0];

		$this->responder = static fn(): array => self::http_response( 200, '{"revalidated":["/resources/"]}' );
		$this->requests  = array();

		$this->assertSame( 'resource_hub_send_revalidation', Dispatcher::CRON_HOOK );
		do_action( 'resource_hub_send_revalidation', $batch_id, $payload );

		$sent = $this->revalidate_requests();
		$this->assertCount( 1, $sent );
		$this->assertSame( $payload, json_decode( $sent[0]['args']['body'], true ) );
		$this->assertSame( 'Bearer test-secret', $sent[0]['args']['headers']['Authorization'] );

		$record = ResultStore::read_post( $post_id );
		$this->assertSame( Result::SENT, $record['status'] );
		$this->assertSame( 200, $record['code'] );
		$this->assertSame( 'trash', $record['event'] );
		$this->assertSame( $batch_id, $record['batch_id'] );
		$this->assertSame( '{"revalidated":["/resources/"]}', $record['body'] );
	}

	/**
	 * When core refuses to schedule the cron event, the batch is delivered at once instead of being lost:
	 * one request, a finished record rather than `pending`, and the result returned.
	 */
	public function test_schedule_failure_falls_back_to_sending_now(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'cron-refused' );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Cron says no',
			)
		);
		$refuse = static fn(): \WP_Error => new \WP_Error( 'schedule_event_false', 'Refused for the test.' );
		add_filter( 'pre_schedule_event', $refuse );

		$results = $this->dispatcher()->flush();

		remove_filter( 'pre_schedule_event', $refuse );

		$this->assertCount( 1, $results );
		$this->assertSame( Result::OK, $results[0]->outcome );
		$this->assertSame( array(), self::scheduled() );

		$sent = $this->revalidate_requests();
		$this->assertCount( 1, $sent );
		$this->assert_valid_request( json_decode( $sent[0]['args']['body'], true ) );
		$this->assertCount( 1, $this->requests, 'No cron spawn when nothing was scheduled.' );

		$record = ResultStore::read_post( $post_id );
		$this->assertSame( Result::SENT, $record['status'] );
		$this->assertSame( Result::OK, $record['outcome'] );
		$this->assertSame( 'update', $record['event'] );
		$this->assertSame( 200, $record['code'] );
	}

	/**
	 * Through a whole flush and cron run, with a held-back event in the same request, the secret reaches
	 * the front end's `Authorization` header and nowhere in any PostHog request, body or headers.
	 */
	public function test_secret_never_reaches_posthog(): void {
		$secret = 'never-in-posthog-7f3a';
		$this->configure( 'https://hub.example/', $secret );
		$posthog  = new PostHog( 'phc_key', 'https://eu.i.posthog.com' );
		$fine     = $this->make_resource( 'publish', 'logged' );
		$typeless = $this->make_resource( 'publish', 'typeless-logged' );
		wp_set_object_terms( $typeless, array(), Taxonomies::TYPE );
		$this->queue->clear();

		foreach ( array( $fine, $typeless ) as $id ) {
			wp_update_post(
				array(
					'ID'         => $id,
					'post_title' => 'Logged',
				)
			);
		}

		$dispatcher = $this->dispatcher( false, $posthog );
		$dispatcher->flush();
		list( $batch_id, $payload ) = self::scheduled()[0];
		$dispatcher->run( $batch_id, $payload );

		$this->assertSame( 'Bearer ' . $secret, $this->revalidate_requests()[0]['args']['headers']['Authorization'] );

		$posthog_requests = array_values( array_filter( $this->requests, static fn( array $request ): bool => str_contains( $request['url'], 'posthog' ) ) );
		$this->assertCount( 2, $posthog_requests, 'One for the held-back event, one for the sent batch.' );

		foreach ( $posthog_requests as $request ) {
			$this->assertStringNotContainsString( $secret, $request['url'] );
			$this->assertStringNotContainsString( $secret, (string) $request['args']['body'] );
			$this->assertStringNotContainsString( $secret, (string) wp_json_encode( $request['args']['headers'] ) );
			$this->assertArrayNotHasKey( 'Authorization', $request['args']['headers'] );
		}
	}

	/**
	 * More than 25 events become several cron events of at most 25, each a valid payload, in order.
	 */
	public function test_flush_splits_into_batches_of_twenty_five(): void {
		$this->configure();
		$this->queue_events( 51 );

		$this->dispatcher()->flush();

		$scheduled = self::scheduled();
		$this->assertCount( 3, $scheduled );
		$this->assertSame( array( 25, 25, 1 ), array_map( static fn( array $args ): int => count( $args[1]['events'] ), $scheduled ) );
		$this->assertSame( 1001, $scheduled[0][1]['events'][0]['id'] );
		$this->assertSame( 1051, $scheduled[2][1]['events'][0]['id'] );
		$this->assertCount( 3, array_unique( array_column( $scheduled, 0 ) ), 'Each batch has its own ID.' );

		foreach ( $scheduled as $args ) {
			$this->assert_valid_request( $args[1] );
		}
	}

	/**
	 * Two batches with the same payload in one request are both scheduled: the batch ID keeps core from
	 * dropping the second as a duplicate.
	 */
	public function test_identical_payloads_are_both_scheduled(): void {
		$this->configure();
		$dispatcher = $this->dispatcher();

		$this->queue_events( 1 );
		$dispatcher->flush();
		$this->queue_events( 1 );
		$dispatcher->flush();

		$scheduled = self::scheduled();
		$this->assertCount( 2, $scheduled );
		$this->assertSame( $scheduled[0][1], $scheduled[1][1] );
		$this->assertNotSame( $scheduled[0][0], $scheduled[1][0] );
	}

	/**
	 * Under WP-CLI the batch is sent at `flush()`, nothing is scheduled, and the result is recorded and returned.
	 */
	public function test_synchronous_flush_sends_at_once(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'cli-saved' );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'From the CLI',
			)
		);
		$this->responder = static fn(): array => self::http_response( 401, '{"error":"unauthorized"}' );

		$results = $this->dispatcher( true )->flush();

		$this->assertCount( 1, $results );
		$this->assertSame( Result::UNAUTHORIZED, $results[0]->outcome );
		$this->assertSame( array(), self::scheduled() );
		$this->assertCount( 1, $this->revalidate_requests() );
		$this->assertSame( Result::FAILED, ResultStore::read_post( $post_id )['status'] );
		$this->assertSame( 401, ResultStore::read_post( $post_id )['code'] );
	}

	/**
	 * Not configured: no cron event, no request of any kind, and a `not_configured` failure on every object.
	 */
	public function test_not_configured_records_without_cron_or_requests(): void {
		$post_id = $this->make_resource( 'publish', 'quiet' );
		$topic   = $this->make_term( Taxonomies::TOPIC, 'silent', 'Silent' );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Nobody listens',
			)
		);
		wp_update_term( $topic, Taxonomies::TOPIC, array( 'name' => 'Still silent' ) );

		$results = $this->dispatcher()->flush();

		$this->assertCount( 1, $results );
		$this->assertSame( Result::NOT_CONFIGURED, $results[0]->outcome );
		$this->assertSame( array(), self::scheduled() );
		$this->assertSame( array(), $this->requests );

		$record = ResultStore::read_post( $post_id );
		$this->assertSame( Result::FAILED, $record['status'] );
		$this->assertSame( Result::NOT_CONFIGURED, $record['outcome'] );
		$this->assertSame( 1, $record['others'] );
		$this->assertSame( Result::NOT_CONFIGURED, ResultStore::read_term( $topic )['outcome'] );
	}

	/**
	 * An empty queue does nothing.
	 */
	public function test_empty_flush_does_nothing(): void {
		$this->configure();

		$this->assertSame( array(), $this->dispatcher()->flush() );
		$this->assertSame( array(), self::scheduled() );
		$this->assertSame( array(), $this->requests );
	}

	/**
	 * A resource with no type, or two, is held back from the batch: recorded as a failure with a plain
	 * message, sent to PostHog, and never put in a payload. The rest of the batch still goes.
	 *
	 * @dataProvider type_counts
	 *
	 * @param string[] $types Type slugs to assign.
	 */
	public function test_resource_without_exactly_one_type_is_held_back( array $types ): void {
		$this->configure();
		$fine  = $this->make_resource( 'publish', 'fine', 'webinar' );
		$wrong = $this->make_resource( 'publish', 'wrong', 'webinar' );
		wp_set_object_terms( $wrong, array_map( fn( string $slug ): int => $this->term_id( Taxonomies::TYPE, $slug ), $types ), Taxonomies::TYPE );
		$this->queue->clear();

		foreach ( array( $fine, $wrong ) as $id ) {
			wp_update_post(
				array(
					'ID'         => $id,
					'post_title' => 'Edited',
				)
			);
		}

		$results = $this->dispatcher( false, new PostHog( 'phc_key', 'https://eu.i.posthog.com' ) )->flush();

		$this->assertCount( 1, $results );
		$this->assertSame( Result::NO_SINGLE_TYPE, $results[0]->outcome );

		$record = ResultStore::read_post( $wrong );
		$this->assertSame( Result::FAILED, $record['status'] );
		$this->assertSame( Result::NO_SINGLE_TYPE, $record['outcome'] );
		$this->assertSame( 'Not sent: a resource needs exactly one type.', $record['error'] );
		$this->assertSame( 0, $record['others'] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_post( $fine )['status'] );

		$scheduled = self::scheduled();
		$this->assertCount( 1, $scheduled );
		$this->assertSame( array( $fine ), array_column( $scheduled[0][1]['events'], 'id' ) );
		$this->assert_valid_request( $scheduled[0][1] );

		$posthog = array_values( array_filter( $this->requests, static fn( array $request ): bool => str_contains( $request['url'], 'posthog' ) ) );
		$this->assertCount( 1, $posthog );
		$properties = json_decode( $posthog[0]['args']['body'], true )['properties'];
		$this->assertSame( Result::NO_SINGLE_TYPE, $properties['outcome'] );
		$this->assertSame( $wrong, $properties['events'][0]['id'] );
	}

	/**
	 * Cases for test_resource_without_exactly_one_type_is_held_back().
	 *
	 * @return array<string, array{0: string[]}>
	 */
	public function type_counts(): array {
		return array(
			'no type'   => array( array() ),
			'two types' => array( array( 'webinar', 'podcast' ) ),
		);
	}

	/**
	 * An update whose `previous` had two types but whose current state has one is sent, as a `publish`
	 * with no `previous`: the front end never had a valid page for the earlier state.
	 */
	public function test_update_with_two_previous_types_is_sent_as_publish(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'fixed-now', 'webinar' );
		wp_set_object_terms( $post_id, array( $this->term_id( Taxonomies::TYPE, 'webinar' ), $this->term_id( Taxonomies::TYPE, 'podcast' ) ), Taxonomies::TYPE );
		$this->queue->clear();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		wp_update_post(
			array(
				'ID'        => $post_id,
				'tax_input' => array( Taxonomies::TYPE => array( $this->term_id( Taxonomies::TYPE, 'podcast' ) ) ),
			)
		);

		$this->assertSame( array( 'podcast' ), $this->queue->events()[0]['types'] );
		$this->assertCount( 2, $this->queue->events()[0]['previous']['types'] );

		$results = $this->dispatcher()->flush();

		$this->assertSame( array(), $results, 'Nothing was held back.' );
		$scheduled = self::scheduled();
		$this->assertCount( 1, $scheduled );
		$event = $scheduled[0][1]['events'][0];
		$this->assertSame( 'publish', $event['event'] );
		$this->assertSame( $post_id, $event['id'] );
		$this->assertSame( array( 'podcast' ), $event['types'] );
		$this->assertNull( $event['previous'] );
		$this->assert_valid_request( $scheduled[0][1] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_post( $post_id )['status'] );
	}

	/**
	 * A REST save that gives a typeless published resource its type is sent as a `publish` with the new
	 * state, not held back for the typeless state it left.
	 */
	public function test_rest_save_that_gives_a_typeless_resource_a_type_is_sent(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'was-typeless', 'webinar', array( 'performance' ) );
		wp_set_object_terms( $post_id, array(), Taxonomies::TYPE );
		$podcast = $this->term_id( Taxonomies::TYPE, 'podcast' );
		$this->queue->clear();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$request = new WP_REST_Request( 'POST', '/wp/v2/resources/' . $post_id );
		$request->set_body_params( array( Taxonomies::TYPE => array( $podcast ) ) );
		$this->assertSame( 200, rest_get_server()->dispatch( $request )->get_status() );

		$this->assertSame( array(), $this->queue->events()[0]['previous']['types'], 'The update saw the typeless state.' );

		$results = $this->dispatcher()->flush();

		$this->assertSame( array(), $results, 'Nothing was held back.' );
		$scheduled = self::scheduled();
		$this->assertCount( 1, $scheduled );
		$event = $scheduled[0][1]['events'][0];
		$this->assertSame( 'publish', $event['event'] );
		$this->assertSame( 'was-typeless', $event['slug'] );
		$this->assertSame( array( 'podcast' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
		$this->assert_valid_request( $scheduled[0][1] );
	}

	/**
	 * A removal whose top-level state has no type is still held back.
	 */
	public function test_removal_without_one_type_is_held_back(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'typeless-trash', 'webinar' );
		wp_set_object_terms( $post_id, array(), Taxonomies::TYPE );
		$this->queue->clear();

		wp_trash_post( $post_id );

		$results = $this->dispatcher()->flush();

		$this->assertCount( 1, $results );
		$this->assertSame( Result::NO_SINGLE_TYPE, $results[0]->outcome );
		$this->assertSame( array(), self::scheduled() );
		$this->assertSame( 'trash', ResultStore::read_post( $post_id )['event'] );
	}

	/**
	 * The test button's entry point sends one real `update` at once and records it; it returns null for
	 * a draft or a non-resource, and holds back a resource without one type.
	 */
	public function test_send_update_for(): void {
		$this->configure();
		$revalidation = Revalidation::instance();
		$post_id      = $this->make_resource( 'publish', 'ping-me', 'webinar', array( 'performance' ) );

		$result = $revalidation->send_update_for( $post_id );

		$this->assertSame( Result::OK, $result->outcome );
		$this->assertCount( 1, $this->revalidate_requests() );
		$body = json_decode( $this->revalidate_requests()[0]['args']['body'], true );
		$this->assertSame( 'update', $body['events'][0]['event'] );
		$this->assertSame( 'ping-me', $body['events'][0]['previous']['slug'] );
		$this->assert_valid_request( $body );
		$this->assertSame( Result::SENT, ResultStore::read_post( $post_id )['status'] );
		$this->assertTrue( $this->queue->is_empty(), 'The test send must not also queue an event.' );

		$this->assertNull( $revalidation->send_update_for( $this->make_resource( 'draft', 'not-yet' ) ) );
		$this->assertNull( $revalidation->send_update_for( self::factory()->post->create( array( 'post_status' => 'publish' ) ) ) );
		$this->assertNull( $revalidation->send_update_for( 999999 ) );

		$typeless = $this->make_resource( 'publish', 'typeless' );
		wp_set_object_terms( $typeless, array(), Taxonomies::TYPE );
		$this->assertSame( Result::NO_SINGLE_TYPE, $revalidation->send_update_for( $typeless )->outcome );
		$this->assertCount( 1, $this->revalidate_requests(), 'A held-back event makes no request.' );
	}

	/**
	 * The plugin registers the hooks: `shutdown` flushes, and the cron hook runs the callback.
	 */
	public function test_hooks_are_registered(): void {
		$dispatcher = Revalidation::instance()->dispatcher();

		$this->assertSame( 10, has_action( 'shutdown', array( $dispatcher, 'flush' ) ) );
		$this->assertSame( 10, has_action( Dispatcher::CRON_HOOK, array( $dispatcher, 'run' ) ) );
		$this->assertSame( 10, has_action( 'rest_api_init', array( Revalidation::instance()->store(), 'register_rest_fields' ) ) );
	}
}
