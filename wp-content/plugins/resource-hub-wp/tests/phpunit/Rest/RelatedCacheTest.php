<?php
/**
 * What turns the related cache's salt over, and what does not.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\RelatedCache;
use WP_UnitTestCase;

/**
 * The plugin's `last_changed` is read before and after each change. The hooks under test are the ones
 * `Plugin::boot()` registered for the run; wp-env has no persistent object cache, so each test stays
 * within one request.
 */
final class RelatedCacheTest extends WP_UnitTestCase {
	/**
	 * The salt is the plugin's and core's `terms` stamps, in that order, and the key names the ID and count.
	 */
	public function test_salt_and_key(): void {
		$this->assertSame( array( wp_cache_get_last_changed( 'resource_hub' ), wp_cache_get_last_changed( 'terms' ) ), RelatedCache::salt() );
		$this->assertSame( 'related:12:3', RelatedCache::key( 12, 3 ) );
		$this->assertSame( DAY_IN_SECONDS, RelatedCache::EXPIRY );
	}

	/**
	 * A set entry is read back under the same salt and missed once the plugin's salt is bumped.
	 */
	public function test_set_then_get_then_miss_after_a_bump(): void {
		$cache = new RelatedCache();
		$items = array(
			array(
				'id'     => 5,
				'source' => 'pick',
			),
		);

		$this->assertNull( $cache->get( 12, 3 ) );

		$cache->set( 12, 3, $items );

		$this->assertSame( $items, $cache->get( 12, 3 ) );
		$this->assertNull( $cache->get( 12, 4 ), 'Another count is another entry.' );

		$cache->bump();

		$this->assertNull( $cache->get( 12, 3 ) );
	}

	/**
	 * An empty list is cached too: it is not a miss.
	 */
	public function test_an_empty_list_is_a_hit(): void {
		$cache = new RelatedCache();
		$cache->set( 12, 3, array() );

		$this->assertSame( array(), $cache->get( 12, 3 ) );
	}

	/**
	 * Publishing a resource bumps; so does updating, unpublishing, trashing or force-deleting a published one.
	 */
	public function test_published_resource_changes_bump(): void {
		$id = $this->resource( 'draft' );

		$this->assert_bumps( static fn() => wp_publish_post( $id ), 'publish' );
		$this->assert_bumps(
			static fn() => wp_update_post(
				array(
					'ID'         => $id,
					'post_title' => 'Renamed',
				)
			),
			'update'
		);
		$this->assert_bumps(
			static fn() => wp_update_post(
				array(
					'ID'          => $id,
					'post_status' => 'draft',
				)
			),
			'unpublish'
		);
		$this->assert_bumps( static fn() => wp_publish_post( $id ), 'republish' );
		$this->assert_bumps( static fn() => wp_trash_post( $id ), 'trash' );
		$this->assert_keeps( static fn() => wp_delete_post( $id, true ), 'deleting a trashed resource' );

		$published = $this->resource( 'publish' );

		$this->assert_bumps( static fn() => wp_delete_post( $published, true ), 'force delete' );
	}

	/**
	 * A new published resource bumps.
	 */
	public function test_new_published_resource_bumps(): void {
		$this->assert_bumps( fn() => $this->resource( 'publish' ), 'new published' );
	}

	/**
	 * A resource that is unpublished before and after its save does not bump: nothing could have listed it.
	 */
	public function test_draft_only_changes_do_not_bump(): void {
		$id = 0;

		$this->assert_keeps(
			function () use ( &$id ): void {
				$id = $this->resource( 'draft' );
			},
			'new draft'
		);
		$this->assert_keeps(
			static fn() => wp_update_post(
				array(
					'ID'         => $id,
					'post_title' => 'Still a draft',
				)
			),
			'draft edit'
		);
		$this->assert_keeps(
			static fn() => wp_update_post(
				array(
					'ID'          => $id,
					'post_status' => 'pending',
				)
			),
			'draft to pending'
		);
		$this->assert_keeps( static fn() => wp_trash_post( $id ), 'trashing a draft' );
		$this->assert_keeps( static fn() => wp_delete_post( $id, true ), 'deleting a trashed draft' );
	}

	/**
	 * Other post types never bump, published or not.
	 */
	public function test_other_post_types_do_not_bump(): void {
		$this->assert_keeps(
			static fn() => self::factory()->post->create(
				array(
					'post_type'   => 'page',
					'post_status' => 'publish',
				)
			),
			'a published page'
		);
		$this->assert_keeps( static fn() => self::factory()->post->create( array( 'post_status' => 'publish' ) ), 'a published post' );
	}

	/**
	 * Topic terms bump when created, edited or deleted; type terms do not.
	 */
	public function test_topic_term_events_bump_and_type_term_events_do_not(): void {
		$topic = 0;

		$this->assert_bumps(
			function () use ( &$topic ): void {
				$topic = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
			},
			'topic created'
		);
		$this->assert_bumps( static fn() => wp_update_term( $topic, Taxonomies::TOPIC, array( 'name' => 'Renamed topic' ) ), 'topic edited' );
		$this->assert_bumps( static fn() => wp_delete_term( $topic, Taxonomies::TOPIC ), 'topic deleted' );

		$type = 0;

		$this->assert_keeps(
			function () use ( &$type ): void {
				$type = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
			},
			'type created'
		);
		$this->assert_keeps( static fn() => wp_update_term( $type, Taxonomies::TYPE, array( 'name' => 'Renamed type' ) ), 'type edited' );
		$this->assert_keeps( static fn() => wp_delete_term( $type, Taxonomies::TYPE ), 'type deleted' );
	}

	/**
	 * Creates a resource in a status.
	 *
	 * @param string $status Post status.
	 * @return int Post ID.
	 */
	private function resource( string $status ): int {
		return self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => $status,
			)
		);
	}

	/**
	 * Asserts a change turns the plugin's salt over.
	 *
	 * @param callable $change The change.
	 * @param string   $what   Named on failure.
	 */
	private function assert_bumps( callable $change, string $what ): void {
		$before = RelatedCache::last_changed();
		$change();
		$this->assertNotSame( $before, RelatedCache::last_changed(), "{$what} did not bump the salt." );
	}

	/**
	 * Asserts a change leaves the plugin's salt as it was.
	 *
	 * @param callable $change The change.
	 * @param string   $what   Named on failure.
	 */
	private function assert_keeps( callable $change, string $what ): void {
		$before = RelatedCache::last_changed();
		$change();
		$this->assertSame( $before, RelatedCache::last_changed(), "{$what} bumped the salt." );
	}
}
