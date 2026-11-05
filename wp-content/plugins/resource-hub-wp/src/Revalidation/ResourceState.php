<?php
/**
 * The public state of a resource as the payload describes it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Post;

/**
 * Builds `{ slug, types, topics }` for a resource (`resourceState` in the request schema) and
 * the REST URL the front end refetches it from.
 */
final class ResourceState {
	/**
	 * The state a post is in now: its slug and its current type and topic terms.
	 *
	 * @param WP_Post $post The post.
	 * @return array{slug: string, types: string[], topics: string[]}
	 */
	public static function of_post( WP_Post $post ): array {
		return self::build( $post->post_name, self::term_slugs( $post, Taxonomies::TYPE ), self::term_slugs( $post, Taxonomies::TOPIC ) );
	}

	/**
	 * A state from its parts.
	 *
	 * @param string   $slug   The post's slug.
	 * @param string[] $types  Type slugs.
	 * @param string[] $topics Topic slugs.
	 * @return array{slug: string, types: string[], topics: string[]}
	 */
	public static function build( string $slug, array $types, array $topics ): array {
		return array(
			'slug'   => $slug,
			'types'  => array_values( array_unique( $types ) ),
			'topics' => array_values( array_unique( $topics ) ),
		);
	}

	/**
	 * Whether a resource event can be sent: its top-level `types` is exactly one element, as the schema's
	 * `typeList` requires. A REST save enforces one type, but a WP-CLI or PHP save, or a deleted type
	 * term, can still leave a resource with none or two. `previous` is not checked here; see
	 * {@see ResourceState::without_invalid_previous()}.
	 *
	 * @param array<string, mixed> $event A resource event.
	 */
	public static function has_one_type( array $event ): bool {
		return 1 === count( $event['types'] );
	}

	/**
	 * An `update` whose `previous.types` is not exactly one element, turned into a `publish` with
	 * `previous` null; any other event unchanged. The front end never had a valid page for a state
	 * without exactly one type, so there is nothing earlier to revalidate, and the save that fixes the
	 * resource's type is sent rather than held back.
	 *
	 * @param array<string, mixed> $event A resource event.
	 * @return array<string, mixed>
	 */
	public static function without_invalid_previous( array $event ): array {
		if ( is_array( $event['previous'] ) && 1 !== count( $event['previous']['types'] ) ) {
			$event['event']    = 'publish';
			$event['previous'] = null;
		}

		return $event;
	}

	/**
	 * The slugs of a post's terms in one taxonomy, in the order core returns them.
	 *
	 * @param WP_Post $post     The post.
	 * @param string  $taxonomy Taxonomy name.
	 * @return string[]
	 */
	public static function term_slugs( WP_Post $post, string $taxonomy ): array {
		$terms = get_the_terms( $post, $taxonomy );

		if ( ! is_array( $terms ) ) {
			return array();
		}

		return array_values( wp_list_pluck( $terms, 'slug' ) );
	}

	/**
	 * The absolute core REST URL of a resource, `{site}/wp-json/wp/v2/resources/{id}`.
	 *
	 * @param int $post_id Post ID.
	 */
	public static function rest_url( int $post_id ): string {
		return rest_url( 'wp/v2/' . PostType::REST_BASE . '/' . $post_id );
	}
}
