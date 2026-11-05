<?php
/**
 * The revalidation payload carries the stored, decoded slug (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\Taxonomies;

/**
 * A slug typed with an escape the front end's router decodes reaches the payload decoded, because
 * the payload reads the slug core stored ({@see \ResourceHub\ContentModel\SlugEscapes}).
 */
final class SlugEscapesPayloadTest extends RevalidationTestCase {
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
}
