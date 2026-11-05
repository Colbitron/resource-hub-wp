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
 * The Types screen's bulk delete checks only the taxonomy's `delete_terms`, not each term, so a
 * request that names a used type (a crafted one, or a page loaded before a resource took the
 * type) is refused before core handles it: the editor is sent back to the list with a notice
 * naming the types in use, and nothing is deleted.
 * Not covered: WP-CLI and PHP calls to `wp_delete_term()` check no capability, so they are out of
 * reach of `map_meta_cap` and of the screen.
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
	 * Message number of the bulk-delete refusal on the Types screen, past core's own 1 to 6 and
	 * ReservedTypeSlugs::ADMIN_MESSAGE.
	 */
	public const ADMIN_MESSAGE = 102;

	/**
	 * Query argument that carries the IDs of the types in use to the refusal's notice.
	 */
	public const ADMIN_ARG = 'rh_types_in_use';

	/**
	 * Hooks the capability check, the REST message and the Types screen's bulk-delete refusal.
	 */
	public function register(): void {
		add_filter( 'map_meta_cap', array( $this, 'deny_delete' ), 10, 4 );
		add_filter( 'rest_request_after_callbacks', array( $this, 'rest_message' ), 10, 3 );
		add_action( 'load-edit-tags.php', array( $this, 'refuse_bulk_delete' ) );
		add_filter( 'term_updated_messages', array( $this, 'admin_messages' ) );
		add_filter( 'removable_query_args', array( $this, 'removable_query_args' ) );
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

	/**
	 * Refuses the Types screen's bulk delete when any selected type is in use, by sending the
	 * editor back to the list with an error notice naming those types; nothing is deleted. Hooked
	 * to `load-edit-tags.php`, which fires before core handles the request. A user who may not
	 * delete types is left to core's own refusal; for the rest, the nonce checked is the one core
	 * checks. A bulk delete of unused types is left to core.
	 *
	 * The request is a bulk delete when core's list table reads it as `bulk-delete`, decided as
	 * WordPress 7.1's `WP_Terms_List_Table::current_action()` decides it: `action` is `delete` and
	 * `delete_tags` is present, whatever else is sent, a submitted `filter_action` included; or,
	 * failing that, `WP_List_Table::current_action()` gives `bulk-delete`, which it does when
	 * `action` is `bulk-delete` and no `filter_action` is submitted. Core reads only `action`; the
	 * bottom bulk selector is copied into it in the browser.
	 */
	public function refuse_bulk_delete(): void {
		if ( ! isset( $_REQUEST['taxonomy'], $_REQUEST['action'] ) || Taxonomies::TYPE !== $_REQUEST['taxonomy'] ) {
			return;
		}

		$is_bulk_delete = ( 'delete' === $_REQUEST['action'] && isset( $_REQUEST['delete_tags'] ) )
			|| ( 'bulk-delete' === $_REQUEST['action'] && empty( $_REQUEST['filter_action'] ) );

		if ( ! $is_bulk_delete ) {
			return;
		}

		$taxonomy = get_taxonomy( Taxonomies::TYPE );

		if ( ! $taxonomy || ! current_user_can( $taxonomy->cap->delete_terms ) ) {
			return;
		}

		check_admin_referer( 'bulk-tags' );

		$selected = isset( $_REQUEST['delete_tags'] ) ? array_map( 'absint', (array) wp_unslash( $_REQUEST['delete_tags'] ) ) : array();
		$in_use   = array();

		foreach ( array_unique( $selected ) as $term_id ) {
			$term = get_term( $term_id, Taxonomies::TYPE );

			if ( $term instanceof WP_Term && self::in_use( $term ) ) {
				$in_use[] = $term->term_id;
			}
		}

		if ( array() === $in_use ) {
			return;
		}

		$back = wp_get_referer();

		if ( ! $back ) {
			$back = admin_url( 'edit-tags.php?taxonomy=' . Taxonomies::TYPE . '&post_type=' . PostType::NAME );
		}

		wp_safe_redirect(
			add_query_arg(
				array(
					'error'         => 1,
					'message'       => self::ADMIN_MESSAGE,
					self::ADMIN_ARG => implode( ',', $in_use ),
				),
				remove_query_arg( array( '_wp_http_referer', '_wpnonce', 'error', 'message', self::ADMIN_ARG ), $back )
			)
		);
		exit;
	}

	/**
	 * Adds the bulk-delete refusal to the Types screen's messages, naming the types in use, escaped.
	 * The names come from the IDs in ADMIN_ARG, kept only while each is a type still in use, so a
	 * hand-made link cannot name a type that resources do not have. Hooked to
	 * `term_updated_messages`, which the Types screen applies when it prints its notice.
	 *
	 * @param array<string, array<int, string>> $messages Messages by taxonomy, `_item` the default.
	 * @return array<string, array<int, string>>
	 */
	public function admin_messages( $messages ) {
		$messages = (array) $messages;

		// Display only: the IDs name the notice's types and change nothing, so no nonce applies.
		$ids   = isset( $_GET[ self::ADMIN_ARG ] ) ? wp_parse_id_list( sanitize_text_field( wp_unslash( $_GET[ self::ADMIN_ARG ] ) ) ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$names = array();

		foreach ( $ids as $term_id ) {
			$term = get_term( $term_id, Taxonomies::TYPE );

			if ( $term instanceof WP_Term && self::in_use( $term ) ) {
				$names[] = $term->name;
			}
		}

		if ( array() === $names ) {
			return $messages;
		}

		$base = $messages[ Taxonomies::TYPE ] ?? $messages['_item'] ?? array();

		$messages[ Taxonomies::TYPE ] = $base + array(
			self::ADMIN_MESSAGE => esc_html(
				sprintf(
					/* translators: %s: the names of the types in use, as a list. */
					_n(
						'Types not deleted. Resources still have the type %s. Give those resources another type first.',
						'Types not deleted. Resources still have the types %s. Give those resources another type first.',
						count( $names ),
						'resource-hub'
					),
					wp_sprintf_l( '%l', $names )
				)
			),
		);

		return $messages;
	}

	/**
	 * Lets core drop ADMIN_ARG from the address bar once the notice is shown, as it does
	 * `message` and `error`. Hooked to `removable_query_args`.
	 *
	 * @param string[] $args Query arguments core removes.
	 * @return string[]
	 */
	public function removable_query_args( $args ) {
		$args   = (array) $args;
		$args[] = self::ADMIN_ARG;

		return $args;
	}
}
