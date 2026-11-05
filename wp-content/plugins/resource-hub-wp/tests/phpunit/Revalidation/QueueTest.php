<?php
/**
 * The queue: deduplication and merging.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\Revalidation\Queue;

/**
 * Tests for {@see Queue} with hand-built events (ADR 0014).
 */
final class QueueTest extends RevalidationTestCase {
	/**
	 * A resource event with the given fields.
	 *
	 * @param string                    $event    Event name.
	 * @param int                       $id       Post ID.
	 * @param string                    $slug     Slug.
	 * @param string[]                  $topics   Topics.
	 * @param array<string, mixed>|null $previous Previous state.
	 * @return array<string, mixed>
	 */
	private static function resource( string $event, int $id, string $slug, array $topics = array(), ?array $previous = null ): array {
		return array(
			'type'     => 'resource',
			'event'    => $event,
			'id'       => $id,
			'slug'     => $slug,
			'rest_url' => 'https://cms.example/wp-json/wp/v2/resources/' . $id,
			'types'    => array( 'webinar' ),
			'topics'   => $topics,
			'previous' => $previous,
		);
	}

	/**
	 * A term event with the given fields.
	 *
	 * @param string                    $event    Event name.
	 * @param int                       $id       Term ID.
	 * @param string                    $slug     Slug.
	 * @param array<string, mixed>|null $previous Previous state.
	 * @return array<string, mixed>
	 */
	private static function term( string $event, int $id, string $slug, ?array $previous = null ): array {
		return array(
			'type'     => 'term',
			'taxonomy' => 'resource_topic',
			'event'    => $event,
			'id'       => $id,
			'slug'     => $slug,
			'name'     => ucfirst( $slug ),
			'previous' => $previous,
		);
	}

	/**
	 * A resource state.
	 *
	 * @param string   $slug   Slug.
	 * @param string[] $topics Topics.
	 * @return array<string, mixed>
	 */
	private static function state( string $slug, array $topics = array() ): array {
		return array(
			'slug'   => $slug,
			'types'  => array( 'webinar' ),
			'topics' => $topics,
		);
	}

	/**
	 * Distinct resources, terms, and a term that shares an ID with a resource all stay separate, in order.
	 */
	public function test_distinct_items_keep_their_order(): void {
		$queue = new Queue();
		$queue->add( self::resource( 'publish', 7, 'seven' ) );
		$queue->add( self::term( 'create', 7, 'seven-topic' ) );
		$queue->add( self::resource( 'publish', 8, 'eight' ) );

		$events = $queue->events();

		$this->assertCount( 3, $events );
		$this->assertSame( array( 'resource', 'term', 'resource' ), array_column( $events, 'type' ) );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $events,
			)
		);
	}

	/**
	 * A publish followed by an update in one request is one `publish` with the latest state and no `previous`.
	 */
	public function test_publish_then_update_is_publish(): void {
		$queue = new Queue();
		$queue->add( self::resource( 'publish', 1, 'draft-slug', array( 'a' ) ) );
		$queue->add( self::resource( 'update', 1, 'final-slug', array( 'a', 'b' ), self::state( 'draft-slug', array( 'a' ) ) ) );

		$event = $queue->events()[0];

		$this->assertCount( 1, $queue->events() );
		$this->assertSame( 'publish', $event['event'] );
		$this->assertSame( 'final-slug', $event['slug'] );
		$this->assertSame( array( 'a', 'b' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $queue->events(),
			)
		);
	}

	/**
	 * Two updates keep the earliest `previous` and the latest state.
	 */
	public function test_two_updates_keep_earliest_previous_and_latest_state(): void {
		$queue = new Queue();
		$queue->add( self::resource( 'update', 1, 'second', array( 'b' ), self::state( 'first', array( 'a' ) ) ) );
		$queue->add( self::resource( 'update', 1, 'third', array( 'c' ), self::state( 'second', array( 'b' ) ) ) );

		$event = $queue->events()[0];

		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'third', $event['slug'] );
		$this->assertSame( array( 'c' ), $event['topics'] );
		$this->assertSame( self::state( 'first', array( 'a' ) ), $event['previous'] );
	}

	/**
	 * An update followed by a trash is the trash, with the state from before the update at the top level,
	 * the one the front end can have cached, and no `previous`.
	 */
	public function test_update_then_trash_is_trash(): void {
		$queue = new Queue();
		$queue->add( self::resource( 'update', 1, 'renamed', array( 'b' ), self::state( 'original', array( 'a' ) ) ) );
		$queue->add( self::resource( 'trash', 1, 'renamed', array( 'b' ) ) );

		$event = $queue->events()[0];

		$this->assertSame( 'trash', $event['event'] );
		$this->assertSame( 'original', $event['slug'] );
		$this->assertSame( array( 'a' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $queue->events(),
			)
		);
	}

	/**
	 * An unpublish followed by a publish is an update from the state before the unpublish.
	 */
	public function test_unpublish_then_publish_is_update(): void {
		$queue = new Queue();
		$queue->add( self::resource( 'unpublish', 1, 'before', array( 'a' ) ) );
		$queue->add( self::resource( 'publish', 1, 'after', array( 'b' ) ) );

		$event = $queue->events()[0];

		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'after', $event['slug'] );
		$this->assertSame( self::state( 'before', array( 'a' ) ), $event['previous'] );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $queue->events(),
			)
		);
	}

	/**
	 * A publish followed by a trash still sends the trash; the front end's refetch simply finds nothing.
	 */
	public function test_publish_then_trash_is_trash(): void {
		$queue = new Queue();
		$queue->add( self::resource( 'publish', 1, 'brief' ) );
		$queue->add( self::resource( 'trash', 1, 'brief' ) );

		$this->assertSame( 'trash', $queue->events()[0]['event'] );
		$this->assertNull( $queue->events()[0]['previous'] );
	}

	/**
	 * Term groups merge the same way: create then update is create; update then update keeps the earliest
	 * previous; update then delete is delete, under the slug and name from before the update.
	 */
	public function test_term_events_merge(): void {
		$queue = new Queue();
		$queue->add( self::term( 'create', 1, 'one' ) );
		$queue->add(
			self::term(
				'update',
				1,
				'uno',
				array(
					'slug' => 'one',
					'name' => 'One',
				)
			)
		);
		$queue->add(
			self::term(
				'update',
				2,
				'second',
				array(
					'slug' => 'first',
					'name' => 'First',
				)
			)
		);
		$queue->add(
			self::term(
				'update',
				2,
				'third',
				array(
					'slug' => 'second',
					'name' => 'Second',
				)
			)
		);
		$queue->add(
			self::term(
				'update',
				3,
				'renamed',
				array(
					'slug' => 'named',
					'name' => 'Named',
				)
			)
		);
		$queue->add( self::term( 'delete', 3, 'renamed' ) );

		$events = $queue->events();

		$this->assertCount( 3, $events );
		$this->assertSame( 'create', $events[0]['event'] );
		$this->assertSame( 'uno', $events[0]['slug'] );
		$this->assertNull( $events[0]['previous'] );
		$this->assertSame( 'update', $events[1]['event'] );
		$this->assertSame( 'third', $events[1]['slug'] );
		$this->assertSame(
			array(
				'slug' => 'first',
				'name' => 'First',
			),
			$events[1]['previous']
		);
		$this->assertSame( 'delete', $events[2]['event'] );
		$this->assertSame( 'named', $events[2]['slug'] );
		$this->assertSame( 'Named', $events[2]['name'] );
		$this->assertNull( $events[2]['previous'] );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $events,
			)
		);
	}

	/**
	 * `clear()` empties the queue and `is_empty()` reports it.
	 */
	public function test_clear(): void {
		$queue = new Queue();
		$this->assertTrue( $queue->is_empty() );

		$queue->add( self::resource( 'publish', 1, 'x' ) );
		$this->assertFalse( $queue->is_empty() );

		$queue->clear();
		$this->assertTrue( $queue->is_empty() );
		$this->assertSame( array(), $queue->events() );
	}
}
