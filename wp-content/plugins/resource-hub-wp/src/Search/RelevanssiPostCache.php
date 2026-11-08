<?php
/**
 * Keeps Relevanssi's in-request post cache in step with core's.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

/**
 * Drops a post from Relevanssi's own post cache whenever core cleans its cache for that post.
 *
 * Relevanssi keeps the post objects it has read in a global, `$relevanssi_post_array`, for the rest
 * of the request (4.28.8, `relevanssi_get_post()` at `lib/utils.php:508` and
 * `relevanssi_populate_array()` at `lib/common.php:288`), and nothing clears it when a post
 * changes. A search judges each match's status from that copy (`relevanssi_get_post_status()`,
 * `lib/common.php:746`), so within one request a post read while it was a draft stays a draft:
 * saving a draft and then publishing it, or a search, a publish and a second search, leaves the
 * published post out of the results. One request rarely does both outside a test or a WP-CLI
 * script, but a long-running script can, so the copy goes when core's does: on
 * `clean_post_cache`, which every core write path runs. Relevanssi keys the copy both by the ID
 * and by `{blog ID}|{ID}`, so both are dropped.
 */
final class RelevanssiPostCache {
	/**
	 * Hooks `clean_post_cache`.
	 */
	public function register(): void {
		add_action( 'clean_post_cache', array( $this, 'forget' ) );
	}

	/**
	 * Drops one post from Relevanssi's cache. Hooked to `clean_post_cache`.
	 *
	 * @param mixed $post_id The post.
	 */
	public function forget( $post_id ): void {
		global $relevanssi_post_array;

		if ( ! is_array( $relevanssi_post_array ) || ! is_numeric( $post_id ) ) {
			return;
		}

		$post_id = (int) $post_id;

		unset( $relevanssi_post_array[ $post_id ], $relevanssi_post_array[ get_current_blog_id() . '|' . $post_id ] );
	}
}
