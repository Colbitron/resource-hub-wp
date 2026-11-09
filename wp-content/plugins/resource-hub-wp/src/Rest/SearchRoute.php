<?php
/**
 * `GET /resource-hub/v1/search?q=…&page=n`: one page of the published resources and pages that match
 * a query, as IDs and kinds.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\Pages\PagePath;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Answers `{ "items": [ { "id", "type": "resource" | "page" } ], "total", "pages" }`
 * (`search-response.schema.json`), or core's `WP_Error` shape for a 400 (see `packages/ui/README.md`,
 * "Search"). The front end reads the objects per type with `include={ids}&orderby=include`, as it does
 * for the related route, so this route stays small and cacheable and the engine behind it can change
 * without changing the contract.
 *
 * The query is one `WP_Query`: `s`, published resources and pages with no password, and
 * `'relevanssi' => true`, which asks Relevanssi to answer it when that plugin is active (it otherwise
 * runs only on the main search query) and is an unknown query var core ignores when it is not, so core's
 * own search answers. It reads whole posts with their term and meta caches off, since each match's
 * type is the one field read. The order is the engine's. Core's relevance order ends with `post_date`
 * and has no ID tie-break, so two matches with the same rank and publish second can swap between pages;
 * core adds its relevance clause only when `orderby` is empty or exactly `relevance`, so no supported
 * `orderby` adds one, and a raw `posts_search_orderby` filter was ruled out. Relevanssi orders by its
 * own score. The password and the posts page are left out in the
 * query, because the front end serves neither ({@see PagePath::is_served()}), and in the query rather
 * than after it so `found_posts` counts only what is listed. Leaving them out also makes the answer the
 * same whoever asks: core's search drops password-protected posts only for a logged-out reader, and the
 * cache key does not name the reader.
 *
 * `total` is the true count, `found_posts` ({@see self::total()} for a page past the last). `pages` is `total` over {@see self::PER_PAGE}, rounded up
 * and capped at {@see self::MAX_PAGE}, the largest page accepted, so a query matching more than 120
 * still says how many it matched and offers the pages it can list. A page past the last is a 200 with no
 * items and the same `total` and `pages`, because it is a question with an answer, and a 200 is cached.
 *
 * Each page is cached in {@see SearchCache}, so a repeated query runs its search once until something it
 * can see changes. The CMS theme's own search page is not this route: it is core's main search query,
 * given this route's scope and its normalised words by {@see \ResourceHub\Search\MainSearchQuery}, and
 * is never cached here. The anonymous response carries the no-cache header, errors included, from
 * {@see NoCacheHeader}, which covers everything under this namespace.
 */
final class SearchRoute {
	/**
	 * The REST namespace shared with the other routes.
	 */
	public const NAMESPACE = 'resource-hub/v1';

	/**
	 * The route inside the namespace.
	 */
	public const ROUTE = '/search';

	/**
	 * Results per page: the same 12 as a listing page on the front end, so a page of results fills the
	 * same grid of two, three or four cards across.
	 */
	public const PER_PAGE = 12;

	/**
	 * The largest `page` accepted: ten pages are as deep as anyone reads results, and the cap bounds the
	 * number of cache entries one query can make.
	 */
	public const MAX_PAGE = 10;

	/**
	 * The shortest `q` accepted once normalised, in characters: a single character matches nearly
	 * everything and tells the engine nothing.
	 */
	public const MIN_QUERY_LENGTH = 2;

	/**
	 * The longest `q` accepted once normalised, in characters: longer than any real query, and short
	 * enough that the engine's work per request stays small.
	 */
	public const MAX_QUERY_LENGTH = 100;

	/**
	 * The post types searched, and the `type` each item carries.
	 */
	public const TYPES = array( PostType::NAME, PagePath::POST_TYPE );

	/**
	 * The cache the results are kept in.
	 *
	 * @var SearchCache
	 */
	private SearchCache $cache;

	/**
	 * Constructor.
	 *
	 * @param SearchCache $cache The cache the results are kept in.
	 */
	public function __construct( SearchCache $cache ) {
		$this->cache = $cache;
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
				// Public on purpose: the front end calls it anonymously, and it answers only with the IDs of
				// published resources and pages that `/wp/v2/resources` and `/wp/v2/pages` already show anyone.
				'permission_callback' => '__return_true',
				'args'                => array(
					'q'    => array(
						'description'       => __( 'The search query, 2 to 100 characters once its whitespace is collapsed.', 'resource-hub' ),
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( $this, 'validate_query' ),
						'sanitize_callback' => array( $this, 'sanitize_query' ),
					),
					'page' => array(
						'description' => __( 'The page of results, 1 to 10.', 'resource-hub' ),
						'type'        => 'integer',
						'default'     => 1,
						'minimum'     => 1,
						'maximum'     => self::MAX_PAGE,
					),
				),
			)
		);
	}

	/**
	 * The query as searched: every run of whitespace made one space and the ends trimmed. `\s` with the
	 * `u` flag matches Unicode whitespace, no-break spaces included. Null when the value is not a string
	 * or not valid UTF-8, which `preg_replace()` refuses.
	 *
	 * @param mixed $value The raw parameter.
	 */
	public static function normalize_query( mixed $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}

		$collapsed = preg_replace( '/\s+/u', ' ', $value );

		return is_string( $collapsed ) ? trim( $collapsed, ' ' ) : null;
	}

	/**
	 * Validates `q`: a string of valid UTF-8 that is 2 to 100 characters once normalised. Core turns a
	 * `WP_Error` here into a 400 `rest_invalid_param`.
	 *
	 * @param mixed $value The raw parameter.
	 * @return true|WP_Error
	 */
	public function validate_query( mixed $value ): bool|WP_Error {
		$query = self::normalize_query( $value );

		if ( null === $query ) {
			return new WP_Error( 'rest_invalid_param', __( 'q must be a string of valid UTF-8.', 'resource-hub' ) );
		}

		$length = mb_strlen( $query, 'UTF-8' );

		if ( $length < self::MIN_QUERY_LENGTH || $length > self::MAX_QUERY_LENGTH ) {
			/* translators: 1: the shortest query in characters, 2: the longest. */
			return new WP_Error( 'rest_invalid_param', sprintf( __( 'q must be %1$d to %2$d characters once its whitespace is collapsed.', 'resource-hub' ), self::MIN_QUERY_LENGTH, self::MAX_QUERY_LENGTH ) );
		}

		return true;
	}

	/**
	 * Sanitizes `q` to its normalised form. Runs after {@see self::validate_query()}, so the value is a
	 * valid string here.
	 *
	 * @param mixed $value The validated parameter.
	 */
	public function sanitize_query( mixed $value ): string {
		return (string) self::normalize_query( $value );
	}

	/**
	 * The route callback.
	 *
	 * @param WP_REST_Request $request The request, its `q` and `page` already validated and sanitized.
	 */
	public function respond( WP_REST_Request $request ): WP_REST_Response {
		$query = (string) $request->get_param( 'q' );
		$page  = (int) $request->get_param( 'page' );

		return new WP_REST_Response( $this->cache->remember( $query, $page, static fn(): array => self::search( $query, $page ) ) );
	}

	/**
	 * One page of results, by the rules in the class comment.
	 *
	 * @param string $query The normalised query.
	 * @param int    $page  The page, 1 to {@see self::MAX_PAGE}.
	 * @return array{items: array<int, array{id: int, type: string}>, total: int, pages: int}
	 */
	private static function search( string $query, int $page ): array {
		$args = array_merge(
			self::scope(),
			array(
				's'                      => $query,
				'paged'                  => $page,
				// Whole posts rather than `ids`, for each match's type; their terms and meta are never read.
				'update_post_term_cache' => false,
				'update_post_meta_cache' => false,
				'ignore_sticky_posts'    => true,
				'relevanssi'             => true,
			)
		);

		$results = new WP_Query( $args );
		$items   = array();

		foreach ( $results->posts as $post ) {
			if ( $post instanceof WP_Post && in_array( $post->post_type, self::TYPES, true ) ) {
				$items[] = array(
					'id'   => $post->ID,
					'type' => $post->post_type,
				);
			}
		}

		$total = self::total( $results, $args );

		return array(
			'items' => $items,
			'total' => $total,
			'pages' => min( (int) ceil( $total / self::PER_PAGE ), self::MAX_PAGE ),
		);
	}

	/**
	 * What the route searches, as `WP_Query` arguments: published resources and pages with no password,
	 * twelve to a page, never the posts page. The CMS theme's search page puts the same scope on core's
	 * main search query (`ResourceHub\Search\MainSearchQuery`), so a logged-in preview lists what the
	 * front end lists; a change here changes both.
	 *
	 * @return array<string, mixed>
	 */
	public static function scope(): array {
		$scope = array(
			'post_type'      => self::TYPES,
			'post_status'    => 'publish',
			'has_password'   => false,
			'posts_per_page' => self::PER_PAGE,
		);

		$posts_page = PagePath::posts_page_id();

		if ( $posts_page > 0 ) {
			$scope['post__not_in'] = array( $posts_page ); // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_post__not_in -- One ID, set only while a posts page is: leaving it out after the query would make found_posts count a result that is never listed.
		}

		return $scope;
	}

	/**
	 * Every match, counted. `found_posts` is the count, except on a page past the last: core does not
	 * count when the page it fetched is empty and leaves `found_posts` at 0, so the count comes from a
	 * one-row query for the first page instead. Public for the CMS theme's search page, whose main query
	 * has the same gap (`MainSearchQuery::count_and_cap()`).
	 *
	 * @param WP_Query             $results The page's query, run.
	 * @param array<string, mixed> $args    Its arguments: the scope, `s`, `paged` and `relevanssi`.
	 */
	public static function total( WP_Query $results, array $args ): int {
		if ( array() !== $results->posts || 1 === $args['paged'] ) {
			return (int) $results->found_posts;
		}

		$first = new WP_Query(
			array_merge(
				$args,
				array(
					'paged'          => 1,
					'posts_per_page' => 1,
					'fields'         => 'ids',
				)
			)
		);

		return (int) $first->found_posts;
	}
}
