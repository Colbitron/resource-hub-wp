<?php
/**
 * `GET /resource-hub/v1/page?path=…`: which published page the front end serves at a public path.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\Pages\PagePath;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Answers `{ "page": { "id", "path" } | null }` (`page-response.schema.json`) for the public path the
 * front end was asked for (ADR 0051). Core REST exposes neither `page_on_front` to anonymous readers
 * nor a lookup by full path, so the plugin does both in one route, from the current state:
 *
 * 1. `/` is the static front page, when one is set and published.
 * 2. Otherwise the page whose parent chain is exactly the path (`get_page_by_path()`).
 * 3. Otherwise the one published page that has the last segment as its slug now: the page whose parent
 *    was moved or renamed, which core would also find with its own guess
 *    (`redirect_guess_404_permalink()`). Two or more such pages are ambiguous, and the answer is no page.
 *
 * There is no old-slug step, unlike the resolve route (ADR 0029): core records `_wp_old_slug` for
 * non-hierarchical post types only (`wp_check_for_changed_slugs()`), so a renamed page's old path is a
 * miss, while its children's old paths are found by step 3 when their slugs are unique.
 *
 * A page found by any step is answered with its canonical path now; the front end redirects when that
 * differs from what it asked for (ADRs 0025, 0035). The static front page's own path is therefore
 * answered as `/`, so `/home/` redirects to `/`. Unpublished pages and the posts page (`page_for_posts`)
 * are never answered.
 *
 * A miss is a 200 with `page` null rather than a 404: the front end's Data Cache stores only 200s, and
 * the site's root with no front page set, or any path a crawler tries, would otherwise reach the CMS
 * on every request. A malformed `path` is a 400 in core's `WP_Error` shape.
 */
final class PageRoute {
	/**
	 * The REST namespace shared with the other routes.
	 */
	public const NAMESPACE = 'resource-hub/v1';

	/**
	 * The route inside the namespace.
	 */
	public const ROUTE = '/page';

	/**
	 * The longest `path` accepted, in bytes as sent: ten segments at the 200-byte width of `post_name`,
	 * with their slashes. WordPress nests pages deeper only in theory.
	 */
	public const MAX_PATH_LENGTH = 2010;

	/**
	 * Registers the route. Hooked to `rest_api_init`.
	 */
	public function register(): void {
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'respond' ),
				// Public on purpose: the front end calls it anonymously, and it answers only for
				// published pages with the ID and path that `/wp/v2/pages` already shows anyone.
				'permission_callback' => '__return_true',
				'args'                => array(
					'path' => array(
						'description'       => __( 'A public path: / for the front page, else the page segments, with or without slashes.', 'resource-hub' ),
						'type'              => 'string',
						'default'           => '/',
						'validate_callback' => array( $this, 'validate_path' ),
						'sanitize_callback' => array( $this, 'sanitize_path' ),
					),
				),
			)
		);
	}

	/**
	 * Validates `path`: a string of at most {@see self::MAX_PATH_LENGTH} bytes whose segments, split on
	 * `/`, are each non-empty once sanitized. Core turns a `WP_Error` here into a 400 `rest_invalid_param`.
	 *
	 * @param mixed $value The raw parameter.
	 * @return true|WP_Error
	 */
	public function validate_path( mixed $value ): bool|WP_Error {
		if ( ! is_string( $value ) ) {
			return new WP_Error( 'rest_invalid_type', __( 'path must be a string.', 'resource-hub' ) );
		}

		if ( strlen( $value ) > self::MAX_PATH_LENGTH ) {
			/* translators: %d: the maximum path length in bytes. */
			return new WP_Error( 'rest_invalid_param', sprintf( __( 'path is longer than %d bytes.', 'resource-hub' ), self::MAX_PATH_LENGTH ) );
		}

		foreach ( self::segments( $value ) as $segment ) {
			if ( '' === $segment ) {
				return new WP_Error( 'rest_invalid_param', __( 'path has a segment that is empty once sanitized.', 'resource-hub' ) );
			}
		}

		return true;
	}

	/**
	 * Sanitizes `path` to its segments each run through `sanitize_title()`, joined by `/`, with no
	 * slashes at the ends: `''` for the root. A wrapper, because core passes the request as the second
	 * argument, which `sanitize_title()` would take as its fallback title.
	 *
	 * @param mixed $value The validated parameter.
	 */
	public function sanitize_path( mixed $value ): string {
		return implode( '/', self::segments( (string) $value ) );
	}

	/**
	 * The route callback.
	 *
	 * @param WP_REST_Request $request The request, its `path` already validated and sanitized.
	 */
	public function respond( WP_REST_Request $request ): WP_REST_Response {
		$path = (string) $request->get_param( 'path' );
		$page = '' === $path ? self::front_page() : self::by_path( $path );

		return new WP_REST_Response(
			array(
				'page' => null === $page ? null : array(
					'id'   => $page->ID,
					'path' => PagePath::of_post( $page ),
				),
			)
		);
	}

	/**
	 * A path's segments, each sanitized as WordPress sanitizes a slug on save, with the slashes at the
	 * ends dropped: `'/'` and `''` give no segments.
	 *
	 * @param string $path The path as sent.
	 * @return string[]
	 */
	private static function segments( string $path ): array {
		$trimmed = trim( $path, '/' );

		if ( '' === $trimmed ) {
			return array();
		}

		return array_map( 'sanitize_title', explode( '/', $trimmed ) );
	}

	/**
	 * The static front page, when one is set and published.
	 */
	private static function front_page(): ?WP_Post {
		$id   = PagePath::front_page_id();
		$post = $id > 0 ? get_post( $id ) : null;

		return $post instanceof WP_Post && PagePath::is_served( $post ) ? $post : null;
	}

	/**
	 * The served page a path names, by the steps in the class comment, or null.
	 *
	 * @param string $path Sanitized segments joined by `/`, at least one.
	 */
	private static function by_path( string $path ): ?WP_Post {
		$exact = get_page_by_path( $path, OBJECT, PagePath::POST_TYPE );

		if ( $exact instanceof WP_Post && PagePath::is_served( $exact ) ) {
			return $exact;
		}

		$segments = explode( '/', $path );

		return self::by_unique_slug( (string) end( $segments ) );
	}

	/**
	 * The one served page whose slug is `$slug` now, whatever its parent, or null when none or more than
	 * one has it. Two are asked for, so one answer means exactly one.
	 *
	 * @param string $slug A sanitized slug.
	 */
	private static function by_unique_slug( string $slug ): ?WP_Post {
		$query = new WP_Query(
			array(
				'post_type'              => PagePath::POST_TYPE,
				'post_status'            => 'publish',
				'name'                   => $slug,
				'posts_per_page'         => 2,
				'no_found_rows'          => true,
				'ignore_sticky_posts'    => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		$posts = array_values(
			array_filter(
				$query->posts,
				static fn( $post ): bool => $post instanceof WP_Post && PagePath::is_served( $post )
			)
		);

		return 1 === count( $posts ) ? $posts[0] : null;
	}
}
