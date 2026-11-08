<?php
/**
 * The salted object-cache entry behind the search route, and what else empties it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Pages\PagePath;
use ResourceHub\Revalidation\PageEvents;
use WP_Post;

/**
 * Stores each page of search results under `search:{md5(q)}:{page}` in the `resource_hub` group with
 * `wp_cache_set_salted()`, as {@see RelatedCache} stores the related lists; its class comment has the
 * reasoning for salting rather than deleting, for reading the salt once before the lookup, and for the
 * one-day expiry. `q` is the normalised query, so the key's hash is of what the engine searched for, and
 * the hash keeps the key short whatever `q` holds.
 *
 * The salt is two stamps. The first is the plugin's own `last_changed` in the `resource_hub` group,
 * the related lists' salt, which RelatedCache turns over on every save, delete or topic change of a
 * resource that was or becomes published: everything about resources a search can see. The second is
 * the `last_changed` of the `resource_hub_search` group, which this class turns over for what search
 * sees and the related lists do not:
 *
 * - from `wp_after_insert_post` when a page an anonymous reader may see whole was or becomes one
 *   ({@see PagePath::is_public()}), which covers a publish, an unpublish, a trash, a password put on
 *   or taken off, and an edit of a published page's title or content;
 * - from `before_delete_post` and `after_delete_post` when such a page is force-deleted, for the same
 *   reasons RelatedCache bumps at both;
 * - when Settings > Reading changes ({@see PageEvents::OPTIONS}), because the posts page is left out
 *   of the results and those options say which page it is;
 * - on every `resource_type` term event, because a search engine that indexes term names (the plan
 *   for this route) matches a resource by its type's name; `resource_topic` events already turn the
 *   first stamp over.
 *
 * A second stamp, rather than bumping the first, keeps a page save or a type rename from emptying
 * every related list, which can see neither. Either stamp moving makes every search entry a miss.
 *
 * Not seen, so an entry can be a day old after them: a published resource's `summary` or type changed
 * outside a post save (`update_post_meta()`, `wp_set_object_terms()` from WP-CLI or a script), the
 * same gap the related lists have for `related_picks`. A save from the editor always bumps.
 */
final class SearchCache {
	/**
	 * The group whose `last_changed` is the search-only stamp. Nothing is stored in it.
	 */
	public const STAMP_GROUP = 'resource_hub_search';

	/**
	 * Hooks the bumps.
	 */
	public function register(): void {
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert' ), 10, 4 );
		add_action( 'before_delete_post', array( $this, 'on_delete' ), 10, 2 );
		add_action( 'after_delete_post', array( $this, 'on_delete' ), 10, 2 );

		foreach ( PageEvents::OPTIONS as $option ) {
			add_action( 'add_option_' . $option, array( $this, 'bump' ), 10, 0 );
			add_action( 'update_option_' . $option, array( $this, 'bump' ), 10, 0 );
			add_action( 'delete_option_' . $option, array( $this, 'bump' ), 10, 0 );
		}

		foreach ( array( 'created_', 'edited_', 'delete_' ) as $prefix ) {
			add_action( $prefix . Taxonomies::TYPE, array( $this, 'bump' ), 10, 0 );
		}
	}

	/**
	 * The results for a query and page: the cached ones, or `$compute`'s, which are then cached.
	 *
	 * @param string   $query   The normalised query.
	 * @param int      $page    The page asked for.
	 * @param callable $compute Builds the results on a miss; returns them in the same shape as this method.
	 * @return array{items: array<int, array{id: int, type: string}>, total: int, pages: int}
	 */
	public function remember( string $query, int $page, callable $compute ): array {
		$key     = self::key( $query, $page );
		$salt    = self::salt();
		$results = wp_cache_get_salted( $key, RelatedCache::GROUP, $salt );

		if ( is_array( $results ) ) {
			return $results;
		}

		$results = $compute();
		wp_cache_set_salted( $key, $results, RelatedCache::GROUP, $salt, RelatedCache::EXPIRY );

		return $results;
	}

	/**
	 * The key for a query and page.
	 *
	 * @param string $query The normalised query.
	 * @param int    $page  The page asked for.
	 */
	public static function key( string $query, int $page ): string {
		return 'search:' . md5( $query ) . ':' . $page;
	}

	/**
	 * The salt now: the related lists' stamp, then the search-only stamp.
	 *
	 * @return string[]
	 */
	public static function salt(): array {
		return array( RelatedCache::salt(), wp_cache_get_last_changed( self::STAMP_GROUP ) );
	}

	/**
	 * Turns the search-only stamp over, which makes every search entry a miss and leaves the related
	 * lists alone.
	 */
	public function bump(): void {
		wp_cache_set_last_changed( self::STAMP_GROUP );
	}

	/**
	 * `wp_after_insert_post`: bumps when a page was or becomes public. Autosaves and revisions are
	 * their own post type and never public pages.
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        The post as saved.
	 * @param bool         $update      Whether this is an update of an existing post.
	 * @param WP_Post|null $post_before The post before the save, or null for a new post.
	 */
	public function on_after_insert( int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before ): void {
		unset( $post_id, $update );

		if ( PagePath::is_public( $post ) || ( $post_before instanceof WP_Post && PagePath::is_public( $post_before ) ) ) {
			$this->bump();
		}
	}

	/**
	 * `before_delete_post` and `after_delete_post`: bumps when a public page is force-deleted.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    The post being deleted, as it was before the delete.
	 */
	public function on_delete( int $post_id, WP_Post $post ): void {
		unset( $post_id );

		if ( PagePath::is_public( $post ) ) {
			$this->bump();
		}
	}
}
