<?php
/**
 * `GET /resource-hub/v1/related/{id}?count=n`: the resources related to a published resource, as IDs.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\PostType;
use WP_Error;
use WP_Post;
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
 * The list itself, picks first and then the newest sharing a topic, is {@see RelatedItems}'s,
 * which the CMS theme's related block renders too, from the same cache, so the route and the
 * block never disagree. This class is the HTTP shape around it: the arguments, the 404 and the
 * response.
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
	 * The `count` when the request gives none: the selection's default.
	 */
	public const DEFAULT_COUNT = RelatedItems::DEFAULT_COUNT;

	/**
	 * The smallest `count` accepted.
	 */
	public const MIN_COUNT = RelatedItems::MIN_COUNT;

	/**
	 * The largest `count` accepted: the schema's `maxItems`, and as many picks as a resource stores.
	 */
	public const MAX_COUNT = RelatedItems::MAX_COUNT;

	/**
	 * The `source` of an item an editor chose.
	 */
	public const SOURCE_PICK = RelatedItems::SOURCE_PICK;

	/**
	 * The `source` of an item the topic fill chose.
	 */
	public const SOURCE_TOPIC = RelatedItems::SOURCE_TOPIC;

	/**
	 * The selection the route answers with.
	 *
	 * @var RelatedItems
	 */
	private RelatedItems $items;

	/**
	 * Constructor.
	 *
	 * @param RelatedItems $items The selection, with its cache.
	 */
	public function __construct( RelatedItems $items ) {
		$this->items = $items;
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

		return new WP_REST_Response( array( 'items' => $this->items->for_resource( $post, $count ) ) );
	}
}
