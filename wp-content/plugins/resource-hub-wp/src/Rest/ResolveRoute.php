<?php
/**
 * `GET /resource-hub/v1/resolve?slug=…`: a current or old slug to a published resource's identity.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\ReservedTypeSlugs;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\ResourceState;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Answers `{ "id", "type", "slug" }` (`resolve-response.schema.json`) for a published resource found by its
 * current slug or by one it had before, or core's `WP_Error` shape for a 400 or a 404 (ADR 0029). The front
 * end calls it only when its current-slug lookup misses, and sends the 308 itself (ADRs 0025, 0035).
 *
 * Old slugs come from core's own record, the `_wp_old_slug` post meta, read through core's private
 * `_find_post_by_old_slug()`. That function is guarded with `function_exists()`: without it, old slugs are
 * not found and current slugs still resolve. There is no fallback lookup, because the only public way to
 * find a post by meta value is a `meta_key`/`meta_value` query, which the VIP slow-query sniff flags, and
 * ADR 0029 rejects silencing it.
 */
final class ResolveRoute {
	/**
	 * The REST namespace shared with the related route.
	 */
	public const NAMESPACE = 'resource-hub/v1';

	/**
	 * The route inside the namespace.
	 */
	public const ROUTE = '/resolve';

	/**
	 * The error code of every 404.
	 */
	public const NOT_FOUND = 'resource_hub_not_found';

	/**
	 * The longest slug accepted, in bytes as sent: the width of WordPress's `post_name` column, and the
	 * `maxLength` of the contract's `slug`. Checked before sanitizing, so an ASCII slug, which
	 * `sanitize_title()` never lengthens, is looked up whole or refused, never shortened. It does not stop
	 * every cut: `sanitize_title()` percent-encodes non-ASCII characters, about three times their length in
	 * bytes, and cuts the encoded result to 200 characters, so a shorter non-ASCII slug can still be cut,
	 * and two that differ only past the cut look up the same slug. That is harmless: WordPress cuts a stored
	 * `post_name` the same way on save, so the lookup matches what is stored, and the front end redirects to
	 * the canonical slug the route returns.
	 */
	public const MAX_SLUG_LENGTH = 200;

	/**
	 * Core's private old-slug lookup.
	 */
	public const CORE_OLD_SLUG_FINDER = '_find_post_by_old_slug';

	/**
	 * The query vars core's old-slug lookup reads: `name`, and the date parts it narrows by when set.
	 */
	private const FINDER_QUERY_VARS = array( 'name', 'year', 'monthnum', 'day' );

	/**
	 * The name of the old-slug lookup function.
	 *
	 * @var string
	 */
	private string $old_slug_finder;

	/**
	 * Constructor.
	 *
	 * @param string $old_slug_finder The old-slug lookup's function name. Core's by default; a test passes a
	 *                                name that does not exist to stand in for a WordPress without it.
	 */
	public function __construct( string $old_slug_finder = self::CORE_OLD_SLUG_FINDER ) {
		$this->old_slug_finder = $old_slug_finder;
	}

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
				// Public on purpose: the front end calls it anonymously, and it answers only for published
				// resources with the ID, type and slug that `/wp/v2/resources` already shows anyone.
				'permission_callback' => '__return_true',
				'args'                => array(
					'slug' => array(
						'description'       => __( 'A current or old slug of a published resource.', 'resource-hub' ),
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( $this, 'validate_slug' ),
						'sanitize_callback' => array( $this, 'sanitize_slug' ),
					),
				),
			)
		);
	}

	/**
	 * Validates `slug`: a string of at most {@see self::MAX_SLUG_LENGTH} bytes that is not empty once sanitized.
	 * Core turns a `WP_Error` here into a 400 `rest_invalid_param`.
	 *
	 * @param mixed $value The raw parameter.
	 * @return true|WP_Error
	 */
	public function validate_slug( mixed $value ): bool|WP_Error {
		if ( ! is_string( $value ) ) {
			return new WP_Error( 'rest_invalid_type', __( 'slug must be a string.', 'resource-hub' ) );
		}

		if ( strlen( $value ) > self::MAX_SLUG_LENGTH ) {
			/* translators: %d: the maximum slug length in bytes. */
			return new WP_Error( 'rest_invalid_param', sprintf( __( 'slug is longer than %d bytes.', 'resource-hub' ), self::MAX_SLUG_LENGTH ) );
		}

		if ( '' === sanitize_title( $value ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'slug is empty once sanitized.', 'resource-hub' ) );
		}

		return true;
	}

	/**
	 * Sanitizes `slug` the way WordPress sanitizes a post slug on save. A wrapper, because core passes the
	 * request as the second argument, which `sanitize_title()` would take as its fallback title.
	 *
	 * @param mixed $value The validated parameter.
	 */
	public function sanitize_slug( mixed $value ): string {
		return sanitize_title( (string) $value );
	}

	/**
	 * The route callback.
	 *
	 * @param WP_REST_Request $request The request, its `slug` already validated and sanitized.
	 * @return WP_REST_Response|WP_Error
	 */
	public function respond( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$slug = (string) $request->get_param( 'slug' );
		$post = $this->by_current_slug( $slug ) ?? $this->by_old_slug( $slug );

		if ( null === $post ) {
			return self::not_found();
		}

		$type = self::single_type( $post );

		if ( null === $type ) {
			return self::not_found();
		}

		return new WP_REST_Response(
			array(
				'id'   => $post->ID,
				'type' => $type,
				'slug' => $post->post_name,
			)
		);
	}

	/**
	 * The published resource whose current slug this is, if there is one.
	 *
	 * @param string $slug A sanitized slug.
	 */
	private function by_current_slug( string $slug ): ?WP_Post {
		$query = new WP_Query(
			array(
				'post_type'              => PostType::NAME,
				'post_status'            => 'publish',
				'name'                   => $slug,
				'posts_per_page'         => 1,
				'no_found_rows'          => true,
				'ignore_sticky_posts'    => true,
				'update_post_meta_cache' => false,
			)
		);

		$post = $query->posts[0] ?? null;

		return $post instanceof WP_Post ? $post : null;
	}

	/**
	 * The published resource that once had this slug, through core's `_wp_old_slug` record. Core's lookup
	 * is not status-filtered and returns one match with no ordering, so the status is checked here; when two
	 * resources once shared the slug, the match is core's, and an unpublished one can hide a published one
	 * (ADR 0029).
	 *
	 * @param string $slug A sanitized slug.
	 */
	private function by_old_slug( string $slug ): ?WP_Post {
		if ( ! function_exists( $this->old_slug_finder ) ) {
			return null;
		}

		$id = $this->find_old_slug( $slug );

		// Checked before `get_post()`, which reads 0 as "the global post" and would return that instead.
		if ( $id <= 0 ) {
			return null;
		}

		$post = get_post( $id );

		if ( ! $post instanceof WP_Post || PostType::NAME !== $post->post_type || 'publish' !== $post->post_status ) {
			return null;
		}

		return $post;
	}

	/**
	 * Calls core's old-slug lookup, which reads the slug from the main query's `name` var and narrows by its
	 * date vars when set. The vars are set for the call and put back afterwards exactly, a var that was
	 * absent removed again, so the main query is left as it was.
	 *
	 * @param string $slug A sanitized slug.
	 * @return int The post ID, or 0 when the lookup returns anything but a positive int.
	 */
	private function find_old_slug( string $slug ): int {
		global $wp_query;

		if ( ! $wp_query instanceof WP_Query ) {
			return 0;
		}

		$saved = array();

		foreach ( self::FINDER_QUERY_VARS as $var ) {
			if ( array_key_exists( $var, $wp_query->query_vars ) ) {
				$saved[ $var ] = $wp_query->query_vars[ $var ];
			}

			$wp_query->set( $var, 'name' === $var ? $slug : '' );
		}

		try {
			$id = ( $this->old_slug_finder )( PostType::NAME );
		} finally {
			foreach ( self::FINDER_QUERY_VARS as $var ) {
				if ( array_key_exists( $var, $saved ) ) {
					$wp_query->set( $var, $saved[ $var ] );
				} else {
					unset( $wp_query->query_vars[ $var ] );
				}
			}
		}

		return is_int( $id ) && $id > 0 ? $id : 0;
	}

	/**
	 * The resource's one type slug, or null when it has none, more than one, or a reserved one, any of which
	 * the response schema would reject. Reserved means what the type guards refuse: `topic`, `page`, or a
	 * percent-encoded form that decodes to one.
	 *
	 * @param WP_Post $post The resource.
	 */
	private static function single_type( WP_Post $post ): ?string {
		$types = ResourceState::term_slugs( $post, Taxonomies::TYPE );

		if ( 1 !== count( $types ) || '' !== ReservedTypeSlugs::reserved( $types[0], '' ) ) {
			return null;
		}

		return $types[0];
	}

	/**
	 * The 404 for every slug that does not resolve.
	 */
	private static function not_found(): WP_Error {
		return new WP_Error(
			self::NOT_FOUND,
			__( 'No published resource has or had that slug.', 'resource-hub' ),
			array( 'status' => 404 )
		);
	}
}
