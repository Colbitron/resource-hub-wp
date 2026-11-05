<?php
/**
 * The revalidation payload never carries an escape the front end's router decodes (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\SlugEscapes;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\Dispatcher;
use ResourceHub\Revalidation\Payload;
use ResourceHub\Revalidation\PostHog;
use ResourceHub\Revalidation\ResultStore;
use ResourceHub\Revalidation\Sender;
use ResourceHub\Tests\LegacySlugRows;

/**
 * A slug typed with such an escape reaches the payload decoded because core stores it decoded
 * ({@see SlugEscapes}); a slug stored with one before that rule reaches it decoded because the
 * dispatcher decodes every slug field ({@see Payload::decode_slugs()}). Each case sends a real
 * batch through a synchronous dispatcher, checks the body against the shared schema, and checks
 * that no slug field in it has such an escape, which the front end would answer with a 400.
 */
final class SlugEscapesPayloadTest extends RevalidationTestCase {
	use LegacySlugRows;

	/**
	 * Publishing a resource typed as `case%2dstudy` sends `case-study`, and so does its `previous`
	 * on the next update.
	 */
	public function test_resource_events_carry_the_decoded_slug(): void {
		$post_id = $this->make_resource( 'draft', 'case%2dstudy' );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'publish',
			)
		);
		$this->assertSame( 'case-study', $this->assert_single_queued_event()['slug'] );
		$this->queue->clear();

		wp_update_post(
			array(
				'ID'        => $post_id,
				'post_name' => 'renamed%2Dstudy',
			)
		);
		$event = $this->assert_single_queued_event();

		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'renamed-study', $event['slug'] );
		$this->assertSame( 'case-study', $event['previous']['slug'] );
	}

	/**
	 * Creating a topic typed as `%41i` sends `ai`.
	 */
	public function test_term_events_carry_the_decoded_slug(): void {
		wp_insert_term( 'AI', Taxonomies::TOPIC, array( 'slug' => '%41i' ) );

		$this->assertSame( 'ai', $this->assert_single_queued_event()['slug'] );
	}

	/**
	 * The save that decodes a legacy slug sends an `update` whose `previous.slug` is decoded too, and
	 * a clean resource saved in the same request goes out in the same batch.
	 */
	public function test_update_that_decodes_a_legacy_slug(): void {
		$legacy = $this->legacy_resource( 'case%2dstudy' );
		$clean  = $this->make_resource( 'publish', 'clean-one' );

		wp_update_post(
			array(
				'ID'         => $legacy,
				'post_title' => 'Retitled',
			)
		);
		wp_update_post(
			array(
				'ID'         => $clean,
				'post_title' => 'Also retitled',
			)
		);
		$this->assertSame( 'case-study', $this->stored_post_slug( $legacy ), 'The save did not decode the stored slug.' );

		$events = $this->sent_events( 2 );

		$this->assertSame( 'update', $events[0]['event'] );
		$this->assertSame( 'case-study', $events[0]['slug'] );
		$this->assertSame( 'case-study', $events[0]['previous']['slug'] );
		$this->assertSame( 'clean-one', $events[1]['slug'] );
	}

	/**
	 * A legacy `previous.slug` that decodes to nothing stands in with the current slug: the escaped
	 * path was never servable, and the listings in `previous` are still revalidated.
	 */
	public function test_previous_slug_that_decodes_to_nothing_falls_back_to_the_current_slug(): void {
		$post_id = $this->legacy_resource( '%2d' );

		wp_update_post(
			array(
				'ID'        => $post_id,
				'post_name' => 'named-at-last',
			)
		);

		$events = $this->sent_events( 1 );

		$this->assertSame( 'named-at-last', $events[0]['slug'] );
		$this->assertSame( 'named-at-last', $events[0]['previous']['slug'] );
	}

	/**
	 * Trashing a legacy resource sends `trash` under the decoded form of its last public slug.
	 */
	public function test_trash_of_a_legacy_resource(): void {
		$post_id = $this->legacy_resource( 'case%2dstudy' );

		wp_trash_post( $post_id );

		$events = $this->sent_events( 1 );

		$this->assertSame( 'trash', $events[0]['event'] );
		$this->assertSame( 'case-study', $events[0]['slug'] );
	}

	/**
	 * Trashing a legacy resource whose slug needs more than one decoding pass, because core's
	 * sanitising after the first makes a new escape, sends the fully decoded slug.
	 */
	public function test_trash_of_a_legacy_resource_needing_two_passes(): void {
		$post_id = $this->legacy_resource( '%69%51-%20%57-%2d-%32d%3a' );

		wp_trash_post( $post_id );

		$events = $this->sent_events( 1 );

		$this->assertSame( 'trash', $events[0]['event'] );
		$this->assertSame( 'iq-%20w-3a', $events[0]['slug'] );
	}

	/**
	 * Force-deleting a legacy resource sends `delete` under the decoded slug.
	 */
	public function test_force_delete_of_a_legacy_resource(): void {
		$post_id = $this->legacy_resource( 'case%2Dstudy' );

		wp_delete_post( $post_id, true );

		$events = $this->sent_events( 1 );

		$this->assertSame( 'delete', $events[0]['event'] );
		$this->assertSame( 'case-study', $events[0]['slug'] );
	}

	/**
	 * A clean resource that lists a legacy topic sends the topic decoded, in `topics` and in
	 * `previous.topics`.
	 */
	public function test_clean_resource_with_a_legacy_topic(): void {
		$this->with_legacy_term_slug( 'ai%2dtools', fn(): int => $this->make_term( Taxonomies::TOPIC, 'ai-tools', 'AI tools' ) );
		$post_id = $this->make_resource( 'publish', 'clean-resource', 'webinar', array( 'ai%2dtools' ) );
		$topics  = get_the_terms( $post_id, Taxonomies::TOPIC );
		$this->assertIsArray( $topics );
		$this->assertSame( array( 'ai%2dtools' ), wp_list_pluck( $topics, 'slug' ), 'The legacy topic was not stored.' );

		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Retitled',
			)
		);

		$events = $this->sent_events( 1 );

		$this->assertSame( array( 'ai-tools' ), $events[0]['topics'] );
		$this->assertSame( array( 'ai-tools' ), $events[0]['previous']['topics'] );
	}

	/**
	 * An edit of a legacy topic that touches only its description decodes the slug, which is a
	 * slug change, so it sends an `update` whose `previous.slug` is decoded too.
	 */
	public function test_term_update_of_a_legacy_term(): void {
		$term_id = $this->with_legacy_term_slug( 'case%2dstudy', fn(): int => $this->make_term( Taxonomies::TOPIC, 'case-study', 'Case study' ) );

		wp_update_term( $term_id, Taxonomies::TOPIC, array( 'description' => 'Now described.' ) );
		$this->assertSame( 'case-study', $this->stored_term_slug( $term_id ), 'The edit did not decode the stored slug.' );

		$events = $this->sent_events( 1 );

		$this->assertSame( 'term', $events[0]['type'] );
		$this->assertSame( 'update', $events[0]['event'] );
		$this->assertSame( 'case-study', $events[0]['slug'] );
		$this->assertSame( 'case-study', $events[0]['previous']['slug'] );
	}

	/**
	 * The pass on its own: every slug field decoded; a top-level slug that decodes to nothing becomes
	 * the ID; empty and repeated list entries are dropped; clean slugs are left exactly as stored.
	 */
	public function test_decode_slugs(): void {
		$event = Payload::decode_slugs(
			array(
				'type'     => 'resource',
				'event'    => 'update',
				'id'       => 12,
				'slug'     => '%2d',
				'rest_url' => 'https://cms.example/wp-json/wp/v2/resources/12',
				'types'    => array( 'web%69nar' ),
				'topics'   => array( 'ai%2dtools', 'ai-tools', '%2e', '%e6%97%a5' ),
				'previous' => array(
					'slug'   => 'old%2Dslug',
					'types'  => array( '%2d' ),
					'topics' => array(),
				),
			)
		);

		$this->assertSame( '12', $event['slug'] );
		$this->assertSame( array( 'webinar' ), $event['types'] );
		$this->assertSame( array( 'ai-tools', '%e6%97%a5' ), $event['topics'] );
		$this->assertSame( 'old-slug', $event['previous']['slug'] );
		$this->assertSame( array(), $event['previous']['types'] );

		$term = Payload::decode_slugs(
			array(
				'type'     => 'term',
				'taxonomy' => Taxonomies::TOPIC,
				'event'    => 'update',
				'id'       => 45,
				'slug'     => 'clean',
				'name'     => 'Clean',
				'previous' => array(
					'slug' => '%2e',
					'name' => 'Clean',
				),
			)
		);

		$this->assertSame( 'clean', $term['slug'] );
		$this->assertSame( 'clean', $term['previous']['slug'] );
	}

	/**
	 * A published `webinar` resource whose stored slug is the given legacy slug, with nothing queued.
	 *
	 * @param string $slug The legacy slug.
	 */
	private function legacy_resource( string $slug ): int {
		$post_id = $this->with_legacy_post_slug( $slug, fn(): int => $this->make_resource( 'publish', 'placeholder' ) );
		$this->assertSame( $slug, $this->stored_post_slug( $post_id ), 'The legacy slug was not stored.' );

		return $post_id;
	}

	/**
	 * Flushes the queue through a synchronous dispatcher, asserts one request went out with a body
	 * the schema accepts and no router-decoded escape in any slug, and returns its events.
	 *
	 * @param int $count How many events the batch must hold.
	 * @return array<int, array<string, mixed>>
	 */
	private function sent_events( int $count ): array {
		$this->configure();

		( new Dispatcher( $this->queue, new Sender(), new ResultStore(), new PostHog( '', '' ), true ) )->flush();

		$requests = $this->revalidate_requests();
		$this->assertCount( 1, $requests, 'Expected one batch.' );

		$payload = json_decode( (string) $requests[0]['args']['body'], true );
		$this->assert_valid_request( $payload );
		$this->assertCount( $count, $payload['events'] );

		foreach ( $payload['events'] as $event ) {
			foreach ( self::slugs_of( $event ) as $slug ) {
				$this->assertFalse( SlugEscapes::has_router_escape( $slug ), "The payload carries {$slug}: " . wp_json_encode( $event ) );
			}
		}

		return $payload['events'];
	}

	/**
	 * Every slug field of an event.
	 *
	 * @param array<string, mixed> $event The event.
	 * @return string[]
	 */
	private static function slugs_of( array $event ): array {
		$previous = is_array( $event['previous'] ) ? $event['previous'] : array();

		return array_merge(
			array( $event['slug'] ),
			$event['types'] ?? array(),
			$event['topics'] ?? array(),
			isset( $previous['slug'] ) ? array( $previous['slug'] ) : array(),
			$previous['types'] ?? array(),
			$previous['topics'] ?? array()
		);
	}
}
