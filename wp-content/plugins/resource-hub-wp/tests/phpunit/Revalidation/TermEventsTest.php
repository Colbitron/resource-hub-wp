<?php
/**
 * Term events: topic and type changes, and the flag taxonomy's silence.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\Taxonomies;

/**
 * Tests for {@see \ResourceHub\Revalidation\TermEvents} through core's term functions (ADR 0017).
 */
final class TermEventsTest extends RevalidationTestCase {
	/**
	 * Creating a topic sends `create` with the term's slug and name and no `previous`.
	 */
	public function test_creating_a_topic_sends_create(): void {
		$created = wp_insert_term( 'Core Web Vitals', Taxonomies::TOPIC, array( 'slug' => 'core-web-vitals' ) );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'term', $event['type'] );
		$this->assertSame( Taxonomies::TOPIC, $event['taxonomy'] );
		$this->assertSame( 'create', $event['event'] );
		$this->assertSame( $created['term_id'], $event['id'] );
		$this->assertSame( 'core-web-vitals', $event['slug'] );
		$this->assertSame( 'Core Web Vitals', $event['name'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * Renaming and re-slugging a type sends `update` with the old slug and name in `previous`.
	 */
	public function test_editing_a_type_sends_update_with_previous(): void {
		$term_id = $this->make_term( Taxonomies::TYPE, 'web-inar', 'Web inar' );

		wp_update_term(
			$term_id,
			Taxonomies::TYPE,
			array(
				'name' => 'Webinar',
				'slug' => 'webinar',
			)
		);

		$event = $this->assert_single_queued_event();

		$this->assertSame( Taxonomies::TYPE, $event['taxonomy'] );
		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'webinar', $event['slug'] );
		$this->assertSame( 'Webinar', $event['name'] );
		$this->assertSame(
			array(
				'slug' => 'web-inar',
				'name' => 'Web inar',
			),
			$event['previous']
		);
	}

	/**
	 * Changing only the name still sends `update`; `previous` carries the same slug and the old name.
	 */
	public function test_renaming_only_sends_update(): void {
		$term_id = $this->make_term( Taxonomies::TOPIC, 'a11y', 'A11y' );

		wp_update_term( $term_id, Taxonomies::TOPIC, array( 'name' => 'Accessibility' ) );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'a11y', $event['slug'] );
		$this->assertSame( 'Accessibility', $event['name'] );
		$this->assertSame( 'A11y', $event['previous']['name'] );
	}

	/**
	 * An edit that changes neither slug nor name, such as a description, sends nothing.
	 */
	public function test_editing_the_description_sends_nothing(): void {
		$term_id = $this->make_term( Taxonomies::TOPIC, 'performance', 'Performance' );

		wp_update_term( $term_id, Taxonomies::TOPIC, array( 'description' => 'Making it fast.' ) );

		$this->assertTrue( $this->queue->is_empty() );
	}

	/**
	 * Deleting a topic sends `delete` with the slug and name it had.
	 */
	public function test_deleting_a_topic_sends_delete(): void {
		$term_id = $this->make_term( Taxonomies::TOPIC, 'obsolete', 'Obsolete' );

		wp_delete_term( $term_id, Taxonomies::TOPIC );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'delete', $event['event'] );
		$this->assertSame( $term_id, $event['id'] );
		$this->assertSame( 'obsolete', $event['slug'] );
		$this->assertSame( 'Obsolete', $event['name'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * `resource_flag` and core taxonomies send nothing.
	 */
	public function test_flags_and_other_taxonomies_send_nothing(): void {
		// The core test suite deletes every term between test classes, so make sure the flag exists.
		$flag = ( new Taxonomies() )->ensure_featured_flag();
		$this->queue->clear();
		$this->assertGreaterThan( 0, $flag );

		wp_update_term( $flag, Taxonomies::FLAG, array( 'name' => 'Renamed flag' ) );
		wp_insert_term( 'A category', 'category' );

		$this->assertTrue( $this->queue->is_empty() );
	}

	/**
	 * Assigning a topic to a resource is an `update` of the resource, not a term event.
	 */
	public function test_assigning_a_term_is_a_resource_update(): void {
		$post_id = $this->make_resource( 'publish', 'gets-a-topic', 'article' );
		$topic   = $this->term_id( Taxonomies::TOPIC, 'performance' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		wp_update_post(
			array(
				'ID'        => $post_id,
				'tax_input' => array( Taxonomies::TOPIC => array( $topic ) ),
			)
		);

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'resource', $event['type'] );
		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertSame( array(), $event['previous']['topics'] );
	}
}
