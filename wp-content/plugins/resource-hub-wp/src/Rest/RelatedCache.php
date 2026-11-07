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
 * The salt is two `last_changed` stamps joined: the plugin's own, in the `resource_hub` group, and
 * core's for `terms`. The plugin's is bumped here, from `wp_after_insert_post` when a resource was
 * or becomes published, from `before_delete_post` when a published resource is force-deleted, and
 * on every `resource_topic` term event, so a publish, an unpublish, a trash, a delete, a change of
 * picks or topics on a published resource, and a topic made, renamed or removed each empty every
 * related list at once. Coarse, but cheap, and the lists are small. A draft saved and left a draft
 * changes no list, so it does not bump it. Core's `terms` stamp is added because core bumps it when
 * a resource's terms are set, so a topic assigned outside a post save is covered too. Core bumps
 * that stamp from `clean_post_cache()` as well, on every post save of every type, so while it is
 * part of the salt an entry lives until the next save anywhere on the site at most.
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
	 * The cache group. Its `last_changed` is the plugin's salt.
	 */
	public const GROUP = 'resource_hub';

	/**
	 * Core's group whose `last_changed` is the second salt.
	 */
	public const TERMS_GROUP = 'terms';

	/**
	 * How long an entry lives when nothing turns the salt over.
	 */
	public const EXPIRY = DAY_IN_SECONDS;

	/**
	 * Hooks the bumps.
	 */
	public function register(): void {
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert' ), 10, 4 );
		add_action( 'before_delete_post', array( $this, 'on_before_delete' ), 10, 2 );

		foreach ( array( 'created_', 'edited_', 'delete_' ) as $prefix ) {
			add_action( $prefix . Taxonomies::TOPIC, array( $this, 'bump' ), 10, 0 );
		}
	}

	/**
	 * The cached list for a resource and count, or null on a miss.
	 *
	 * @param int $post_id The resource.
	 * @param int $count   The count asked for.
	 * @return array<int, array{id: int, source: string}>|null
	 */
	public function get( int $post_id, int $count ): ?array {
		$items = wp_cache_get_salted( self::key( $post_id, $count ), self::GROUP, self::salt() );

		return is_array( $items ) ? $items : null;
	}

	/**
	 * Stores the list for a resource and count under the current salt.
	 *
	 * @param int                                        $post_id The resource.
	 * @param int                                        $count   The count asked for.
	 * @param array<int, array{id: int, source: string}> $items   The related list.
	 */
	public function set( int $post_id, int $count, array $items ): void {
		wp_cache_set_salted( self::key( $post_id, $count ), $items, self::GROUP, self::salt(), self::EXPIRY );
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
	 * The salt now: the plugin's `last_changed` and core's for terms. `wp_cache_get_last_changed()`
	 * creates a stamp when the group has none.
	 *
	 * @return string[]
	 */
	public static function salt(): array {
		return array(
			wp_cache_get_last_changed( self::GROUP ),
			wp_cache_get_last_changed( self::TERMS_GROUP ),
		);
	}

	/**
	 * The plugin's `last_changed` now.
	 */
	public static function last_changed(): string {
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
	 * `before_delete_post`: bumps when a published resource is force-deleted. One in the trash was
	 * already removed from every list by the bump its trashing caused.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    The post about to be deleted.
	 */
	public function on_before_delete( int $post_id, WP_Post $post ): void {
		unset( $post_id );

		if ( PostType::NAME === $post->post_type && 'publish' === $post->post_status ) {
			$this->bump();
		}
	}
}
