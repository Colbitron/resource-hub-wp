<?php
/**
 * Where a WordPress page is served on the front end.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Pages;

use WP_Post;

/**
 * The public path of a page as both sites serve it (ADR 0051): `/` for the static front page
 * (Settings > Reading, `show_on_front=page` and `page_on_front`), else one segment per page in its
 * parent chain and a trailing slash (`/about/team/`), which is the CMS's own permalink path under
 * pretty permalinks and the front end's route. Read from the options and the post, never from
 * `get_permalink()`, which depends on the permalink structure.
 *
 * The posts page (`page_for_posts`) stands in for the posts listing WordPress renders with its theme;
 * the front end has no such listing and never serves it ({@see PagePath::is_served()}).
 */
final class PagePath {
	/**
	 * The post type the front end serves at its own paths. Posts never are.
	 */
	public const POST_TYPE = 'page';

	/**
	 * The ID of the published page set as the static front page, or 0 when none is: `show_on_front` is
	 * `posts`, `page_on_front` is unset, or the page it names is missing, not a page or not published.
	 */
	public static function front_page_id(): int {
		if ( 'page' !== get_option( 'show_on_front' ) ) {
			return 0;
		}

		$id   = (int) get_option( 'page_on_front' );
		$post = $id > 0 ? get_post( $id ) : null;

		if ( ! $post instanceof WP_Post || self::POST_TYPE !== $post->post_type || 'publish' !== $post->post_status ) {
			return 0;
		}

		return $post->ID;
	}

	/**
	 * The ID the posts page option names, or 0. Whether it is published does not matter: the page it
	 * names is never served by the front end either way.
	 */
	public static function posts_page_id(): int {
		return (int) get_option( 'page_for_posts' );
	}

	/**
	 * Whether a post is a page the front end serves: a published page that is not the posts page.
	 *
	 * @param WP_Post $post The post.
	 */
	public static function is_served( WP_Post $post ): bool {
		return self::POST_TYPE === $post->post_type
			&& 'publish' === $post->post_status
			&& self::posts_page_id() !== $post->ID;
	}

	/**
	 * The public path of a page as it stands now: `/` when it is the static front page, else its own
	 * path ({@see PagePath::own_path()}). The post's status is not checked here; callers decide what an
	 * unpublished page's path means.
	 *
	 * @param WP_Post $post The page.
	 */
	public static function of_post( WP_Post $post ): string {
		return self::front_page_id() === $post->ID ? '/' : self::own_path( $post );
	}

	/**
	 * A page's path from its parent chain and slug, `/about/team/`, whether or not it is the front
	 * page: `get_page_uri()` with a slash on each side. Ancestors are read as they are now, so a parent
	 * renamed in the same request already shows its new slug here; its own event covers the old one.
	 *
	 * @param WP_Post $post The page.
	 */
	public static function own_path( WP_Post $post ): string {
		$uri = get_page_uri( $post );

		return '/' . ( is_string( $uri ) && '' !== $uri ? $uri . '/' : $post->post_name . '/' );
	}
}
