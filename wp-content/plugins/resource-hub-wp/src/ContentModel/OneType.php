<?php
/**
 * A resource has exactly one `resource_type` once it is public (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use stdClass;
use WP_Error;
use WP_REST_Request;
use WP_Term;

/**
 * Refuses a REST save that would leave a resource with the wrong number of types.
 *
 * The type is a path segment, `/resources/{type}/{slug}/`, and a segment holds one value. The
 * rule, checked on the state the save would leave:
 * - never more than one type, at any status;
 * - exactly one type to be published or scheduled (`publish` or `future`), and to stay that way.
 * A draft, pending or private resource may have no type yet.
 *
 * The block editor saves through REST and nothing else, so the check runs on
 * `rest_pre_insert_resource`: before WordPress writes the post or its terms, with the request's
 * terms if it sends any and the stored ones if it does not. A refusal is a 400 whose message the
 * editor shows in its "Publishing failed" or "Updating failed" notice, worded to fit both a first
 * publish and an edit of a resource already published. Quick Edit and Bulk Edit on the Resources
 * list do not show the taxonomy (`show_in_quick_edit` is off), so they cannot change the type.
 * Saves that do not go through REST (PHP calls to `wp_insert_post()`, the seeder, WP-CLI) are not
 * checked.
 */
final class OneType {
	/**
	 * Statuses that need exactly one type.
	 */
	public const PUBLIC_STATUSES = array( 'publish', 'future' );

	/**
	 * Error code when a public resource would have no type.
	 */
	public const MISSING = 'resource_hub_type_missing';

	/**
	 * Error code when a resource would have more than one type.
	 */
	public const TOO_MANY = 'resource_hub_type_too_many';

	/**
	 * Hooks the check onto REST saves of `resource`.
	 */
	public function register(): void {
		add_filter( 'rest_pre_insert_' . PostType::NAME, array( $this, 'check_rest_save' ), 10, 2 );
	}

	/**
	 * Rule: the post as the save would leave it passes `problem()`, or the save is refused.
	 *
	 * The status is the request's if it sends one, else the stored one. The types are the IDs the
	 * request sends in `resource_type` that name existing types (core skips the others when it
	 * assigns them), else the stored types.
	 *
	 * @param stdClass|WP_Error $prepared_post The post core is about to save, or an earlier error.
	 * @param WP_REST_Request   $request       The REST request.
	 * @return stdClass|WP_Error The post unchanged, or the refusal.
	 */
	public function check_rest_save( $prepared_post, WP_REST_Request $request ) {
		if ( ! $prepared_post instanceof stdClass ) {
			return $prepared_post;
		}

		$existing = isset( $prepared_post->ID ) ? get_post( (int) $prepared_post->ID ) : null;

		if ( ! empty( $prepared_post->post_status ) ) {
			$status = (string) $prepared_post->post_status;
		} else {
			$status = $existing ? $existing->post_status : 'draft';
		}

		if ( isset( $request[ Taxonomies::TYPE ] ) ) {
			$count = count( self::existing_type_ids( (array) $request[ Taxonomies::TYPE ] ) );
		} else {
			$count = $existing ? count( self::stored_type_ids( $existing->ID ) ) : 0;
		}

		return self::problem( $status, $count ) ?? $prepared_post;
	}

	/**
	 * Rule: more than one type is refused at any status; no type is refused for a public status.
	 *
	 * @param string $status Post status after the save.
	 * @param int    $count  Number of types after the save.
	 * @return WP_Error|null The refusal, with HTTP status 400, or null when the save may go ahead.
	 */
	public static function problem( string $status, int $count ): ?WP_Error {
		if ( $count > 1 ) {
			return new WP_Error(
				self::TOO_MANY,
				__( 'A resource can have only one type. Choose one in the Types panel.', 'resource-hub' ),
				array( 'status' => 400 )
			);
		}

		if ( 0 === $count && in_array( $status, self::PUBLIC_STATUSES, true ) ) {
			return new WP_Error(
				self::MISSING,
				__( 'A resource needs a type to be published or scheduled. Choose one in the Types panel.', 'resource-hub' ),
				array( 'status' => 400 )
			);
		}

		return null;
	}

	/**
	 * The distinct IDs in the list that name an existing `resource_type` term.
	 *
	 * @param array<mixed> $ids Term IDs from the request.
	 * @return int[]
	 */
	private static function existing_type_ids( array $ids ): array {
		$ids = array_values( array_unique( array_filter( array_map( 'absint', $ids ) ) ) );

		if ( array() === $ids ) {
			return array();
		}

		$found = get_terms(
			array(
				'taxonomy'               => Taxonomies::TYPE,
				'include'                => $ids,
				'hide_empty'             => false,
				'fields'                 => 'ids',
				'update_term_meta_cache' => false,
			)
		);

		return is_array( $found ) ? array_map( 'intval', $found ) : array();
	}

	/**
	 * The IDs of the types stored on a post.
	 *
	 * @param int $post_id Post ID.
	 * @return int[]
	 */
	private static function stored_type_ids( int $post_id ): array {
		$terms = get_the_terms( $post_id, Taxonomies::TYPE );

		if ( ! is_array( $terms ) ) {
			return array();
		}

		return array_map( static fn( WP_Term $term ): int => $term->term_id, $terms );
	}
}
