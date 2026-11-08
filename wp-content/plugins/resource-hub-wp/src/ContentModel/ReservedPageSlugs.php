<?php
/**
 * A top-level page never takes a slug the front end's own routes use.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use ResourceHub\Pages\PagePath;

/**
 * The front end serves every published page at its path (ADR 0052), but its own routes come first:
 * `/resources/…` is the library, `/api/…` its route handlers, `/media/…` the uploads rewrite,
 * `/_next/…` the framework's and `/search/` the search page (issue #115). A top-level page slugged
 * `resources`, `api`, `media`, `_next` or `search` could
 * never be reached there, so WordPress is told the slug is taken, the way core already treats
 * `embed` and the feed names for hierarchical post types: `wp_unique_post_slug()` appends a suffix
 * (`resources-2`) and the editor sees the slug it got. Only a page with no parent is affected, because
 * `/about/resources/` collides with nothing. The front end keeps the same list and answers a 404 for
 * such a path without asking the CMS, so a page saved before this rule is simply not served.
 */
final class ReservedPageSlugs {
	/**
	 * The first path segments the front end's own routes use.
	 */
	public const SLUGS = array( 'resources', 'api', 'media', '_next', 'search' );

	/**
	 * Hooks core's uniqueness check for hierarchical post types.
	 */
	public function register(): void {
		add_filter( 'wp_unique_post_slug_is_bad_hierarchical_slug', array( $this, 'is_bad_slug' ), 10, 4 );
	}

	/**
	 * `wp_unique_post_slug_is_bad_hierarchical_slug`: a reserved slug on a top-level page is bad, so core
	 * makes it unique with a suffix.
	 *
	 * @param mixed $is_bad      Whether an earlier filter already judged it bad.
	 * @param mixed $slug        The slug core is about to store.
	 * @param mixed $post_type   The post type.
	 * @param mixed $post_parent The parent post ID.
	 * @return bool
	 */
	public function is_bad_slug( $is_bad, $slug, $post_type, $post_parent ): bool {
		if ( true === $is_bad ) {
			return true;
		}

		return PagePath::POST_TYPE === $post_type
			&& 0 === (int) $post_parent
			&& is_string( $slug )
			&& self::is_reserved( $slug );
	}

	/**
	 * Whether a slug is one of {@see self::SLUGS}, as stored or once percent-decoded and sanitized
	 * (`%72esources`), in any case: the front end lower-cases a segment before it compares.
	 *
	 * @param string $slug A slug as `sanitize_title()` leaves it.
	 */
	public static function is_reserved( string $slug ): bool {
		foreach ( array( $slug, sanitize_title( rawurldecode( $slug ) ) ) as $form ) {
			if ( in_array( strtolower( $form ), self::SLUGS, true ) ) {
				return true;
			}
		}

		return false;
	}
}
