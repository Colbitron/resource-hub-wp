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
 * The public path of a page as both sites serve it (ADR 0052): `/` for the static front page
 * (Settings > Reading, `show_on_front=page` and `page_on_front`), else one segment per page in its
 * parent chain and a trailing slash (`/about/team/`), which is the CMS's own permalink path under
 * pretty permalinks and the front end's route. Read from the options and the post, never from
 * `get_permalink()`, which depends on the permalink structure.
 *
 * What the front end serves is a published page with no password ({@see PagePath::is_public()}): a
 * password-protected page's body is empty for an anonymous reader, and the owner's rule is that such
 * a page is never served. The posts page (`page_for_posts`) stands in for the posts listing WordPress
 * renders with its theme; the front end has no such listing and never serves it either
 * ({@see PagePath::is_served()}).
 */
final class PagePath {
	/**
	 * The post type the front end serves at its own paths. Posts never are.
	 */
	public const POST_TYPE = 'page';

	/**
	 * The ID the front-page option names while `show_on_front` is `page`, else 0, whatever the state of
	 * the page it names.
	 */
	public static function named_front_page_id(): int {
		return 'page' === get_option( 'show_on_front' ) ? (int) get_option( 'page_on_front' ) : 0;
	}

	/**
	 * The ID of the public page set as the static front page, or 0 when none is: `show_on_front` is
	 * `posts`, `page_on_front` is unset, or the page it names is missing, not a page, not published or
	 * password-protected.
	 */
	public static function front_page_id(): int {
		$id   = self::named_front_page_id();
		$post = $id > 0 ? get_post( $id ) : null;

		return $post instanceof WP_Post && self::is_public( $post ) ? $post->ID : 0;
	}

	/**
	 * The ID the posts page option names while `show_on_front` is `page`, else 0: core reads
	 * `page_for_posts` only then, and with `show_on_front` on `posts` the page it names is an ordinary
	 * page. Whether it is published does not matter here: the page it names is never served either way.
	 */
	public static function posts_page_id(): int {
		return 'page' === get_option( 'show_on_front' ) ? (int) get_option( 'page_for_posts' ) : 0;
	}

	/**
	 * Whether a post is a page an anonymous reader may see whole: published, with no password.
	 *
	 * @param WP_Post $post The post.
	 */
	public static function is_public( WP_Post $post ): bool {
		return self::POST_TYPE === $post->post_type
			&& 'publish' === $post->post_status
			&& '' === $post->post_password;
	}

	/**
	 * Whether a post is a page the front end serves: a public page that is not the posts page.
	 *
	 * @param WP_Post $post The post.
	 */
	public static function is_served( WP_Post $post ): bool {
		return self::is_public( $post ) && self::posts_page_id() !== $post->ID;
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
	 * The public path a page had before a save, from `$post_before` and the options as they stand: `/`
	 * when the options name it as the front page, whatever its state now (the saved post may just have
	 * left `publish`, which {@see PagePath::front_page_id()} would read as "no front page"), else its
	 * own path from the slug and parent it had.
	 *
	 * @param WP_Post $post_before The page as it was before the save.
	 */
	public static function of_post_before( WP_Post $post_before ): string {
		return self::named_front_page_id() === $post_before->ID ? '/' : self::own_path( $post_before );
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
