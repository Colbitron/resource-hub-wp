<?php
/**
 * `GET /resource-hub/v1/related/{id}?count=n`: the resources related to a published resource, as IDs.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\MetaRules;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Answers `{ "items": [ { "id", "source": "pick" | "topic" } ] }` (`related-response.schema.json`)
 * for a published resource, or core's `WP_Error` shape for a 400 or a 404 (see
 * `packages/ui/README.md`). The front end's related section reads it, then reads the objects
 * with `GET /wp/v2/resources?include={ids}&orderby=include&_embed`, so one code path renders a
 * resource everywhere and this route stays small and cacheable.
 *
 * The list is merged here, in one PHPUnit-tested place, so the picks never have to be public:
 *
 * 1. The editor's picks (`related_picks` meta, {@see Meta}) first, in the editor's order. A pick
 *    that is not a published resource now is skipped and left in the meta, so it returns when the
 *    pick is republished. Picks are one-way.
 * 2. Then the newest published resources sharing any of the resource's topics, newest first by
 *    publish date, with no ranking by how many topics overlap: picks say what an editor means, and
 *    the fill keeps every resource covered without curation. A resource that is both a pick and in
 *    the fill appears once, as a pick. Ranking by overlap, raw SQL with `GROUP BY`, and merging two
 *    core queries on the front end were rejected (issue #50); the scale path if the topic query is
 *    ever slow is a search index or a precomputed list, never raw SQL.
 * 3. The list stops at `count`, never holds the resource itself, is the picks alone for a resource
 *    with no topics, and is empty for one with neither.
 *
 * The fill asks for `count + 1` IDs and drops the resource itself and the picks already placed in
 * PHP. That is enough: when `p` picks are shown and `p < count`, every published pick is among them,
 * so at most `1 + p` of the IDs are dropped and at least `count - p` remain. `post__not_in` would do
 * the same in SQL, and the VIP ruleset flags it as slow. The topic query is a `tax_query`, which the
 * WordPress slow-query sniff flags too. It stays, because the alternatives are the same query under
 * a different key or raw SQL, and its result is cached ({@see RelatedCache}) so the query runs once
 * per resource and count until something changes. A `phpcs:ignore` on that one line silences the
 * sniff, so every other query, in this file and elsewhere, stays under it.
 *
 * `count` is 1 to 10, default 3, and a value outside that is a 400 from core's argument validation;
 * an `id` that is not a published resource is a 404, whoever asks, like the resolve route.
 *
 * A password-protected resource is still a published one: it gets a 200 of its own, and it is
 * listed as a pick or a topic match like any other. That matches the resolve route and core's
 * `/wp/v2/resources` list, which shows it with its content withheld, and nothing protected leaks,
 * because this route returns IDs only and the front end reads the objects from core.
 */
final class RelatedRoute {
	/**
	 * The REST namespace shared with the other routes.
	 */
	public const NAMESPACE = 'resource-hub/v1';

	/**
	 * The route inside the namespace: `{id}` is one or more digits.
	 */
	public const ROUTE = '/related/(?P<id>[\d]+)';

	/**
	 * The error code of every 404.
	 */
	public const NOT_FOUND = 'resource_hub_not_found';

	/**
	 * The `count` when the request gives none.
	 */
	public const DEFAULT_COUNT = 3;

	/**
	 * The smallest `count` accepted.
	 */
	public const MIN_COUNT = 1;

	/**
	 * The largest `count` accepted: the schema's `maxItems`, and as many picks as a resource stores.
	 */
	public const MAX_COUNT = MetaRules::RELATED_PICKS_MAX;

	/**
	 * The `source` of an item an editor chose.
	 */
	public const SOURCE_PICK = 'pick';

	/**
	 * The `source` of an item the topic fill chose.
	 */
	public const SOURCE_TOPIC = 'topic';

	/**
	 * The cache the lists are kept in.
	 *
	 * @var RelatedCache
	 */
	private RelatedCache $cache;

	/**
	 * Constructor.
	 *
	 * @param RelatedCache $cache The cache the lists are kept in.
	 */
	public function __construct( RelatedCache $cache ) {
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
				// Public on purpose: the front end calls it anonymously, and it answers only for published
				// resources with IDs that `/wp/v2/resources` already shows anyone. Which of them are picks
				// is the one thing it adds, and the merged order needs that.
				'permission_callback' => '__return_true',
				'args'                => array(
					'id'    => array(
						'description' => __( 'The post ID of a published resource.', 'resource-hub' ),
						'type'        => 'integer',
					),
					'count' => array(
						'description' => __( 'How many related resources to return, 1 to 10.', 'resource-hub' ),
						'type'        => 'integer',
						'default'     => self::DEFAULT_COUNT,
						'minimum'     => self::MIN_COUNT,
						'maximum'     => self::MAX_COUNT,
					),
				),
			)
		);
	}

	/**
	 * The route callback.
	 *
	 * @param WP_REST_Request $request The request, its `id` and `count` already validated and cast.
	 * @return WP_REST_Response|WP_Error
	 */
	public function respond( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id    = (int) $request->get_param( 'id' );
		$count = (int) $request->get_param( 'count' );

		// Checked before `get_post()`, which reads 0 as "the global post" and would return that instead.
		$post = $id > 0 ? get_post( $id ) : null;

		if ( ! $post instanceof WP_Post || PostType::NAME !== $post->post_type || 'publish' !== $post->post_status ) {
			return new WP_Error(
				self::NOT_FOUND,
				__( 'No published resource has that ID.', 'resource-hub' ),
				array( 'status' => 404 )
			);
		}

		$items = $this->cache->remember( $post->ID, $count, static fn(): array => self::related( $post, $count ) );

		return new WP_REST_Response( array( 'items' => $items ) );
	}

	/**
	 * The merged list for a resource, by the steps in the class comment.
	 *
	 * @param WP_Post $post  The published resource.
	 * @param int     $count How many items at most.
	 * @return array<int, array{id: int, source: string}>
	 */
	private static function related( WP_Post $post, int $count ): array {
		$picks = array_slice( self::published_picks( $post ), 0, $count );
		$items = array_map( static fn( int $id ): array => self::item( $id, self::SOURCE_PICK ), $picks );

		if ( count( $items ) >= $count ) {
			return $items;
		}

		$excluded = array_merge( array( $post->ID ), $picks );

		foreach ( self::newest_by_topic( $post, $count + 1 ) as $id ) {
			if ( in_array( $id, $excluded, true ) ) {
				continue;
			}

			$items[] = self::item( $id, self::SOURCE_TOPIC );

			if ( count( $items ) >= $count ) {
				break;
			}
		}

		return $items;
	}

	/**
	 * The resource's picks that are published resources now, in the editor's order. The stored list is
	 * run through its own rule again, so a row written before the rule or outside it is read the same way.
	 *
	 * @param WP_Post $post The resource.
	 * @return int[]
	 */
	private static function published_picks( WP_Post $post ): array {
		$picks = MetaRules::without_self( MetaRules::sanitize_related_picks( get_post_meta( $post->ID, Meta::RELATED_PICKS, true ) ), $post->ID );

		if ( array() === $picks ) {
			return array();
		}

		$query = new WP_Query(
			array(
				'post_type'           => PostType::NAME,
				'post_status'         => 'publish',
				'post__in'            => $picks,
				'posts_per_page'      => count( $picks ),
				'fields'              => 'ids',
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
			)
		);

		$published = array_map( 'intval', $query->posts );

		return array_values( array_intersect( $picks, $published ) );
	}

	/**
	 * The IDs of the newest published resources sharing any of the resource's topics, newest first,
	 * the resource itself possibly among them. Empty when it has no topics.
	 *
	 * @param WP_Post $post  The resource.
	 * @param int     $limit How many IDs at most.
	 * @return int[]
	 */
	private static function newest_by_topic( WP_Post $post, int $limit ): array {
		$terms = get_the_terms( $post, Taxonomies::TOPIC );

		if ( ! is_array( $terms ) || array() === $terms ) {
			return array();
		}

		$query = new WP_Query(
			array(
				'post_type'           => PostType::NAME,
				'post_status'         => 'publish',
				'posts_per_page'      => $limit,
				'orderby'             => array(
					'date' => 'DESC',
					'ID'   => 'DESC',
				),
				'fields'              => 'ids',
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
				'tax_query'           => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- The topic fill is the route's one job and a tax query by definition; its result is cached under the salted key for a day, and the scale path is a search index or a precomputed list (issue #87), never raw SQL.
					array(
						'taxonomy' => Taxonomies::TOPIC,
						'field'    => 'term_id',
						'terms'    => array_map( 'intval', wp_list_pluck( $terms, 'term_id' ) ),
					),
				),
			)
		);

		return array_map( 'intval', $query->posts );
	}

	/**
	 * One item of the response.
	 *
	 * @param int    $id     The related resource's post ID.
	 * @param string $source Why it is in the list.
	 * @return array{id: int, source: string}
	 */
	private static function item( int $id, string $source ): array {
		return array(
			'id'     => $id,
			'source' => $source,
		);
	}
}
