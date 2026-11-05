<?php
/**
 * A type that resources still have cannot be deleted (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use WP_Error;
use WP_HTTP_Response;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;
use WP_Term;

/**
 * Denies `delete_term` for a `resource_type` term while a resource still has it.
 *
 * Deleting a type removes it from its resources, and a published resource with no type has no
 * `/resources/{type}/{slug}/` path, no revalidation payload and no resolve response. So the
 * capability is denied while any resource has the type in a status other than `trash` or
 * `auto-draft`: drafts, pending, private and scheduled resources count, because each is a
 * publish away from being public. A trashed resource does not hold its type: core restores it as
 * a draft, which may have no type until it is published again.
 *
 * Every admin and REST path that deletes one term checks `delete_term` for it, so `map_meta_cap`
 * covers them:
 * - the Types screen hides the Delete row action and the bulk-select checkbox, and its delete
 *   link and the row action's AJAX request are refused with core's own message;
 * - REST answers 403, with the message below in place of core's.
 * Not covered: the Types screen's bulk delete checks only the taxonomy's `delete_terms`, not each
 * term, so a request that names a used type (a crafted one, or a page loaded before a resource
 * took the type) still deletes it. WP-CLI and PHP calls to `wp_delete_term()` check no
 * capability, so they are out of reach of `map_meta_cap` too.
 */
final class UsedTypes {
	/**
	 * Error code of the REST refusal.
	 */
	public const ERROR_CODE = 'resource_hub_type_in_use';

	/**
	 * Statuses in which a resource does not hold its type.
	 */
	public const IGNORED_STATUSES = array( 'trash', 'auto-draft' );

	/**
	 * Hooks the capability check and the REST message.
	 */
	public function register(): void {
		add_filter( 'map_meta_cap', array( $this, 'deny_delete' ), 10, 4 );
		add_filter( 'rest_request_after_callbacks', array( $this, 'rest_message' ), 10, 3 );
	}

	/**
	 * Rule: a type is in use when at least one resource has it, or one of its child types, in a
	 * status other than IGNORED_STATUSES. The lookup goes through the taxonomy's query var, which
	 * includes child types; types are a flat list in practice, and counting children only ever
	 * refuses more, never less.
	 *
	 * @param WP_Term $term A `resource_type` term.
	 */
	public static function in_use( WP_Term $term ): bool {
		$query = new WP_Query(
			array(
				'post_type'              => PostType::NAME,
				'post_status'            => array_values( array_diff( get_post_stati(), self::IGNORED_STATUSES ) ),
				Taxonomies::TYPE         => $term->slug,
				'fields'                 => 'ids',
				'posts_per_page'         => 1,
				'no_found_rows'          => true,
				'ignore_sticky_posts'    => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		return array() !== $query->posts;
	}

	/**
	 * The refusal's message.
	 */
	public static function message(): string {
		return __( 'This type cannot be deleted while resources have it. Give those resources another type first.', 'resource-hub' );
	}

	/**
	 * Denies deleting a type that is in use. Hooked to `map_meta_cap`.
	 *
	 * @param string[] $caps    Primitive capabilities core mapped the meta capability to.
	 * @param string   $cap     The capability checked.
	 * @param int      $user_id User ID.
	 * @param mixed[]  $args    Arguments of the check; for `delete_term`, the term ID first.
	 * @return string[]
	 */
	public function deny_delete( $caps, $cap, $user_id, $args ) {
		unset( $user_id );

		if ( 'delete_term' !== $cap || ! isset( $args[0] ) ) {
			return $caps;
		}

		$term = get_term( (int) $args[0] );

		if ( ! $term instanceof WP_Term || Taxonomies::TYPE !== $term->taxonomy || ! self::in_use( $term ) ) {
			return $caps;
		}

		$caps[] = 'do_not_allow';

		return $caps;
	}

	/**
	 * Replaces core's "not allowed" message on a REST delete of a used type with one that says
	 * why, for a user who could delete the type were it unused; anyone else keeps core's answer.
	 * Hooked to `rest_request_after_callbacks`, which also sees a failed permission check.
	 *
	 * @param WP_REST_Response|WP_HTTP_Response|WP_Error|mixed $response Result of the request.
	 * @param array<string, mixed>                             $handler  Route handler.
	 * @param WP_REST_Request                                  $request  The REST request.
	 * @return WP_REST_Response|WP_HTTP_Response|WP_Error|mixed
	 */
	public function rest_message( $response, $handler, WP_REST_Request $request ) {
		unset( $handler );

		if ( ! $response instanceof WP_Error || 'rest_cannot_delete' !== $response->get_error_code() || 'DELETE' !== $request->get_method() ) {
			return $response;
		}

		if ( ! preg_match( '#^/wp/v2/' . Taxonomies::TYPE . '/(\d+)$#', $request->get_route(), $matches ) ) {
			return $response;
		}

		$taxonomy = get_taxonomy( Taxonomies::TYPE );
		$term     = get_term( (int) $matches[1], Taxonomies::TYPE );

		if ( ! $taxonomy || ! $term instanceof WP_Term || ! current_user_can( $taxonomy->cap->delete_terms ) || ! self::in_use( $term ) ) {
			return $response;
		}

		return new WP_Error( self::ERROR_CODE, self::message(), $response->get_error_data() );
	}
}
