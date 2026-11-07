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
	 * The salt is the plugin's own stamp alone, and the key names the ID and count.
	 */
	public function test_salt_and_key(): void {
		$this->assertSame( wp_cache_get_last_changed( 'resource_hub' ), RelatedCache::salt() );
		$this->assertSame( 'related:12:3', RelatedCache::key( 12, 3 ) );
		$this->assertSame( DAY_IN_SECONDS, RelatedCache::EXPIRY );
	}

	/**
	 * A computed list is stored and read back under the same salt, and computed again once the plugin's
	 * salt is bumped. Another count is another entry.
	 */
	public function test_remember_stores_then_hits_then_misses_after_a_bump(): void {
		$cache   = new RelatedCache();
		$calls   = 0;
		$items   = array(
			array(
				'id'     => 5,
				'source' => 'pick',
			),
		);
		$compute = static function () use ( &$calls, $items ): array {
			++$calls;

			return $items;
		};

		$this->assertSame( $items, $cache->remember( 12, 3, $compute ) );
		$this->assertSame( $items, $cache->remember( 12, 3, $compute ) );
		$this->assertSame( 1, $calls, 'The second read is a hit.' );

		$cache->remember( 12, 4, $compute );
		$this->assertSame( 2, $calls, 'Another count is another entry.' );

		$cache->bump();
		$cache->remember( 12, 3, $compute );
		$this->assertSame( 3, $calls, 'A bump makes the entry a miss.' );
	}

	/**
	 * An empty list is cached too: it is not a miss.
	 */
	public function test_an_empty_list_is_a_hit(): void {
		$cache = new RelatedCache();
		$calls = 0;
		$empty = static function () use ( &$calls ): array {
			++$calls;

			return array();
		};

		$this->assertSame( array(), $cache->remember( 12, 3, $empty ) );
		$this->assertSame( array(), $cache->remember( 12, 3, $empty ) );
		$this->assertSame( 1, $calls );
	}

	/**
	 * A bump that lands while a list is being computed leaves that list under the old salt, so the next
	 * read misses and computes again instead of serving what was computed from the old content.
	 */
	public function test_a_bump_during_the_compute_makes_the_next_read_miss(): void {
		$cache = new RelatedCache();
		$stale = array(
			array(
				'id'     => 5,
				'source' => 'topic',
			),
		);
		$fresh = array(
			array(
				'id'     => 6,
				'source' => 'topic',
			),
		);

		$during = $cache->remember(
			12,
			3,
			static function () use ( $cache, $stale ): array {
				$cache->bump();

				return $stale;
			}
		);

		$this->assertSame( $stale, $during, 'The request that computed the list still gets it.' );
		$this->assertSame( $fresh, $cache->remember( 12, 3, static fn(): array => $fresh ) );
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
	 * A force delete of a published resource bumps again once the row is gone and core has cleaned the
	 * post caches (`after_delete_post`), so a list computed while the delete ran is not served afterwards.
	 * The salt is recorded at the last `deleted_post` callback: the row is gone there, but core's
	 * `clean_post_cache()` has not run, so a bump there would come too early.
	 */
	public function test_force_delete_bumps_after_the_row_is_gone(): void {
		$published = $this->resource( 'publish' );
		$during    = '';
		$record    = static function () use ( &$during ): void {
			$during = RelatedCache::salt();
		};

		add_action( 'deleted_post', $record, PHP_INT_MAX );
		wp_delete_post( $published, true );
		remove_action( 'deleted_post', $record, PHP_INT_MAX );

		$this->assertNotSame( '', $during );
		$this->assertNull( get_post( $published ) );
		$this->assertNotSame( $during, RelatedCache::salt(), 'No bump after core cleaned the post caches.' );
	}

	/**
	 * A published resource saved as another post type bumps, since it leaves every list; a draft
	 * resource saved as another type does not.
	 */
	public function test_a_published_resource_changed_to_another_post_type_bumps(): void {
		$published = $this->resource( 'publish' );
		$draft     = $this->resource( 'draft' );

		$this->assert_bumps(
			static fn() => wp_update_post(
				array(
					'ID'        => $published,
					'post_type' => 'post',
				)
			),
			'a published resource saved as a post'
		);
		$this->assert_keeps(
			static fn() => wp_update_post(
				array(
					'ID'        => $draft,
					'post_type' => 'post',
				)
			),
			'a draft resource saved as a post'
		);
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
	 * Topics set on or removed from a published resource outside a post save bump. The same on a draft,
	 * a type set on a published resource, and a topic on another post type do not.
	 */
	public function test_topic_relationship_changes_bump_on_published_resources_only(): void {
		$topic     = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$type      = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$published = $this->resource( 'publish' );
		$draft     = $this->resource( 'draft' );
		$page      = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);

		$this->assert_bumps( static fn() => wp_set_object_terms( $published, $topic, Taxonomies::TOPIC ), 'topic set on a published resource' );
		$this->assert_bumps( static fn() => wp_remove_object_terms( $published, $topic, Taxonomies::TOPIC ), 'topic removed from a published resource' );
		$this->assert_keeps( static fn() => wp_set_object_terms( $draft, $topic, Taxonomies::TOPIC ), 'topic set on a draft' );
		$this->assert_keeps( static fn() => wp_remove_object_terms( $draft, $topic, Taxonomies::TOPIC ), 'topic removed from a draft' );
		$this->assert_keeps( static fn() => wp_set_object_terms( $published, $type, Taxonomies::TYPE ), 'type set on a published resource' );
		$this->assert_keeps( static fn() => wp_set_object_terms( $page, $topic, Taxonomies::TOPIC ), 'topic set on a page' );
	}

	/**
	 * Deleting a topic reaches `deleted_term_relationships` for each resource that had it, before
	 * `delete_resource_topic`, as the class comment says, and the plugin's relationship hook has
	 * already bumped the salt by then. The salt is recorded after every callback on the relationship
	 * hook and before every callback on the term hook, so the term hook's own bump is not counted.
	 */
	public function test_deleting_a_topic_removes_each_relationship_first(): void {
		$topic     = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$published = $this->resource( 'publish' );
		wp_set_object_terms( $published, $topic, Taxonomies::TOPIC );
		$before  = RelatedCache::salt();
		$order   = array();
		$removed = static function () use ( &$order ): void {
			$order[] = array( 'relationship', RelatedCache::salt() );
		};
		$deleted = static function () use ( &$order ): void {
			$order[] = array( 'term', RelatedCache::salt() );
		};

		add_action( 'deleted_term_relationships', $removed, PHP_INT_MAX );
		add_action( 'delete_' . Taxonomies::TOPIC, $deleted, PHP_INT_MIN );
		wp_delete_term( $topic, Taxonomies::TOPIC );
		remove_action( 'deleted_term_relationships', $removed, PHP_INT_MAX );
		remove_action( 'delete_' . Taxonomies::TOPIC, $deleted, PHP_INT_MIN );

		$this->assertSame( array( 'relationship', 'term' ), array_column( $order, 0 ) );
		$this->assertNotSame( $before, $order[0][1], 'The relationship hook did not bump the salt.' );
		$this->assertSame( $order[0][1], $order[1][1], 'The salt changed between the relationship and the term hook.' );
	}

	/**
	 * A save of anything but a resource leaves a stored list in place: core's `terms` stamp, which every
	 * post save bumps, is not part of the salt.
	 */
	public function test_an_unrelated_post_save_keeps_the_entry(): void {
		$cache   = new RelatedCache();
		$calls   = 0;
		$compute = static function () use ( &$calls ): array {
			++$calls;

			return array();
		};

		$cache->remember( 12, 3, $compute );
		$terms_before = wp_cache_get_last_changed( 'terms' );
		self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$cache->remember( 12, 3, $compute );

		$this->assertNotSame( $terms_before, wp_cache_get_last_changed( 'terms' ), 'Core no longer bumps its terms stamp on a save.' );
		$this->assertSame( 1, $calls, 'The save emptied the entry.' );
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
		$before = RelatedCache::salt();
		$change();
		$this->assertNotSame( $before, RelatedCache::salt(), "{$what} did not bump the salt." );
	}

	/**
	 * Asserts a change leaves the plugin's salt as it was.
	 *
	 * @param callable $change The change.
	 * @param string   $what   Named on failure.
	 */
	private function assert_keeps( callable $change, string $what ): void {
		$before = RelatedCache::salt();
		$change();
		$this->assertSame( $before, RelatedCache::salt(), "{$what} bumped the salt." );
	}
}
