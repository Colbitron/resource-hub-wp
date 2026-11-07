<?php
/**
 * The salted object-cache entry behind the related route, and what empties it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Post;

/**
 * Stores each related list under `related:{id}:{count}` in the `resource_hub` group with
 * `wp_cache_set_salted()` and reads it back with `wp_cache_get_salted()` (WordPress 6.9, the
 * reason for the plugin's `Requires at least`), so an entry whose salt no longer matches is a miss
 * and nothing is ever deleted by key.
 *
 * The salt is the plugin's own `last_changed` stamp, in the `resource_hub` group, alone. It is
 * bumped here:
 *
 * - from `wp_after_insert_post` when a resource was or becomes published, which covers a publish,
 *   an unpublish, a trash, and a change of picks or topics saved with a published resource;
 * - from `before_delete_post` and `deleted_post` when a published resource is force-deleted;
 * - from `set_object_terms` and `deleted_term_relationships` when a published resource's topics
 *   change outside a post save (`wp_set_object_terms()`, `wp_remove_object_terms()` and the
 *   functions built on them). A draft's topics are left alone, because no list shows a draft;
 * - on every `resource_topic` term event (`created_`, `edited_`, `delete_`), so a topic made,
 *   renamed or removed empties the lists too. Deleting a topic reaches the relationship hook
 *   first: `wp_delete_term()` calls `wp_remove_object_terms()` for each resource that had the
 *   topic, which fires `deleted_term_relationships` once per resource, and only then fires
 *   `delete_resource_topic`. (Topics have no default term, so core never reassigns them through
 *   `wp_set_object_terms()` here; if one is ever added, `set_object_terms` covers that path.)
 *
 * Each bump empties every related list at once. Coarse, but cheap, and the lists are small. A
 * draft saved and left a draft changes no list, so it does not bump it. Core's `terms`
 * `last_changed` is deliberately not part of the salt: core bumps it from `clean_post_cache()` on
 * every post save of every type, autosaves included, so an entry would live only until the next
 * save anywhere on the site, the same churn that rules out core's query cache below.
 *
 * {@see RelatedCache::remember()} reads the salt once, before the lookup, and stores the computed
 * list under that same salt. A bump that lands while the list is being computed therefore leaves
 * an entry under the old salt, which the next read misses; reading the salt again at store time
 * would file a list computed from the old content under the new salt, and it would be served
 * until the next bump.
 *
 * Core's own query cache was not relied on because every autosave on the site empties it. A
 * transient was rejected because transients are ruled out as storage and land in the options table
 * without a persistent object cache. The expiry is one day: a longer-lived entry gains nothing once
 * the salt turns over, and a shorter one would trip the VIP ruleset's `LowExpiryCacheTime`.
 *
 * wp-env has no persistent object cache, so the tests check keys and salts within one request,
 * not that an entry survives one.
 */
final class RelatedCache {
	/**
	 * The cache group. Its `last_changed` is the salt.
	 */
	public const GROUP = 'resource_hub';

	/**
	 * How long an entry lives when nothing turns the salt over.
	 */
	public const EXPIRY = DAY_IN_SECONDS;

	/**
	 * Hooks the bumps.
	 */
	public function register(): void {
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert' ), 10, 4 );
		add_action( 'before_delete_post', array( $this, 'on_delete' ), 10, 2 );
		add_action( 'deleted_post', array( $this, 'on_delete' ), 10, 2 );
		add_action( 'set_object_terms', array( $this, 'on_set_terms' ), 10, 4 );
		add_action( 'deleted_term_relationships', array( $this, 'on_removed_terms' ), 10, 3 );

		foreach ( array( 'created_', 'edited_', 'delete_' ) as $prefix ) {
			add_action( $prefix . Taxonomies::TOPIC, array( $this, 'bump' ), 10, 0 );
		}
	}

	/**
	 * The list for a resource and count: the cached one, or `$compute`'s, which is then cached.
	 *
	 * The salt is read once, before the lookup, and the computed list is stored under it, so a bump
	 * during `$compute` makes the stored entry a miss rather than a stale hit (see the class comment).
	 *
	 * @param int      $post_id The resource.
	 * @param int      $count   The count asked for.
	 * @param callable $compute Builds the list on a miss; returns it in the same shape as this method.
	 * @return array<int, array{id: int, source: string}>
	 */
	public function remember( int $post_id, int $count, callable $compute ): array {
		$key   = self::key( $post_id, $count );
		$salt  = self::salt();
		$items = wp_cache_get_salted( $key, self::GROUP, $salt );

		if ( is_array( $items ) ) {
			return $items;
		}

		$items = $compute();
		wp_cache_set_salted( $key, $items, self::GROUP, $salt, self::EXPIRY );

		return $items;
	}

	/**
	 * The key for a resource and count.
	 *
	 * @param int $post_id The resource.
	 * @param int $count   The count asked for.
	 */
	public static function key( int $post_id, int $count ): string {
		return "related:{$post_id}:{$count}";
	}

	/**
	 * The salt now: the plugin's `last_changed`. `wp_cache_get_last_changed()` creates the stamp when
	 * the group has none.
	 */
	public static function salt(): string {
		return wp_cache_get_last_changed( self::GROUP );
	}

	/**
	 * Turns the plugin's salt over, which makes every related entry a miss.
	 */
	public function bump(): void {
		wp_cache_set_last_changed( self::GROUP );
	}

	/**
	 * `wp_after_insert_post`: bumps when a resource was or becomes published. Autosaves and revisions
	 * are their own post type and are ignored; so is a save that leaves a resource unpublished before
	 * and after, since no list could have shown it.
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        The post as saved.
	 * @param bool         $update      Whether this is an update of an existing post.
	 * @param WP_Post|null $post_before The post before the save, or null for a new post.
	 */
	public function on_after_insert( int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before ): void {
		unset( $post_id, $update );

		if ( PostType::NAME !== $post->post_type || wp_is_post_autosave( $post ) || wp_is_post_revision( $post ) ) {
			return;
		}

		if ( 'publish' === $post->post_status || 'publish' === $post_before?->post_status ) {
			$this->bump();
		}
	}

	/**
	 * `set_object_terms`: bumps when a published resource's topics were set. Core fires it after the
	 * relationships are written, whether or not they changed.
	 *
	 * @param int    $object_id The object whose terms were set.
	 * @param mixed  $terms     The terms as passed: an array, an ID or a slug. Unused.
	 * @param array  $tt_ids    The term taxonomy IDs now set. Unused.
	 * @param string $taxonomy  The taxonomy.
	 */
	public function on_set_terms( int $object_id, mixed $terms, array $tt_ids, string $taxonomy ): void {
		unset( $terms, $tt_ids );

		$this->bump_for_published_topics( $object_id, $taxonomy );
	}

	/**
	 * `deleted_term_relationships`: bumps when topics were removed from a published resource. Core
	 * fires it after the relationships are deleted.
	 *
	 * @param int    $object_id The object whose terms were removed.
	 * @param array  $tt_ids    The term taxonomy IDs removed. Unused.
	 * @param string $taxonomy  The taxonomy.
	 */
	public function on_removed_terms( int $object_id, array $tt_ids, string $taxonomy ): void {
		unset( $tt_ids );

		$this->bump_for_published_topics( $object_id, $taxonomy );
	}

	/**
	 * Bumps when a term change is to `resource_topic` on a published resource. Terms of other
	 * taxonomies, other post types and unpublished resources change no list.
	 *
	 * @param int    $object_id The object whose terms changed.
	 * @param string $taxonomy  The taxonomy.
	 */
	private function bump_for_published_topics( int $object_id, string $taxonomy ): void {
		if ( Taxonomies::TOPIC !== $taxonomy ) {
			return;
		}

		$post = get_post( $object_id );

		if ( $post instanceof WP_Post && PostType::NAME === $post->post_type && 'publish' === $post->post_status ) {
			$this->bump();
		}
	}

	/**
	 * `before_delete_post` and `deleted_post`: bumps when a published resource is force-deleted. One
	 * in the trash was already removed from every list by the bump its trashing caused.
	 *
	 * Both hooks bump. `deleted_post` runs once the row is gone, so it is the bump that makes the
	 * delete correct: a list computed while the delete ran, with the row still there, was stored
	 * under a salt that this bump turns over. `before_delete_post` runs before core removes the
	 * resource's meta, terms and comments, so the cached lists stop being served the moment the
	 * delete starts rather than when it ends. Both get the post as it was before the delete.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    The post being deleted, as it was before the delete.
	 */
	public function on_delete( int $post_id, WP_Post $post ): void {
		unset( $post_id );

		if ( PostType::NAME === $post->post_type && 'publish' === $post->post_status ) {
			$this->bump();
		}
	}
}
