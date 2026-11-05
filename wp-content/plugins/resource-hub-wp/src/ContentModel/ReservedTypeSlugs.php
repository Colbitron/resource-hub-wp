<?php
/**
 * `topic` and `page` are never a `resource_type` slug (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use WP_Error;
use WP_REST_Request;
use WP_Term;

/**
 * Refuses a reserved slug for a type, whether typed as the slug or generated from the name.
 *
 * `/resources/topic/{topic}/` and `…/page/{n}/` are listing URLs, so a type with either slug
 * would collide with them. Core has a filter that can refuse a new term, `pre_insert_term`, but
 * none that can refuse an edit, so edits are refused where an editor makes them, each with a
 * plain message:
 * - creating, anywhere (Types screen, REST, WP-CLI, PHP): `pre_insert_term` returns an error;
 * - editing over REST: a 400 from `rest_dispatch_request`, after the route's permission check;
 * - the Types screen's edit form: a redirect back to the form with an error notice;
 * - Quick Edit on the Types screen: the error message in place of the updated row.
 * Every other edit (WP-CLI, PHP calls to `wp_update_term()`) keeps the term's current slug, so a
 * reserved slug is never stored.
 */
final class ReservedTypeSlugs {
	/**
	 * The slugs a type may not have.
	 */
	public const SLUGS = array( 'topic', 'page' );

	/**
	 * Error code of the refusal.
	 */
	public const ERROR_CODE = 'resource_hub_reserved_type_slug';

	/**
	 * Message number of the refusal on the Types screen, past core's own 1 to 6.
	 */
	public const ADMIN_MESSAGE = 101;

	/**
	 * Hooks the refusals.
	 */
	public function register(): void {
		add_filter( 'pre_insert_term', array( $this, 'refuse_insert' ), 10, 3 );
		add_filter( 'rest_dispatch_request', array( $this, 'refuse_rest_update' ), 10, 2 );
		add_action( 'load-edit-tags.php', array( $this, 'refuse_admin_update' ) );
		add_action( 'wp_ajax_inline-save-tax', array( $this, 'refuse_quick_edit' ), 0 );
		add_filter( 'term_updated_messages', array( $this, 'admin_messages' ) );
		add_filter( 'wp_update_term_data', array( $this, 'keep_current_slug' ), 10, 3 );
	}

	/**
	 * Rule: the slug a term gets is the sanitized slug if that is not empty, else the sanitized
	 * name; it is refused when it is one of SLUGS. This mirrors `wp_insert_term()` and
	 * `wp_update_term()`, which sanitize both with `sanitize_title()`.
	 *
	 * @param string $slug Slug as given, possibly empty.
	 * @param string $name Name as given.
	 * @return string The reserved slug the term would get, or '' if it would get none.
	 */
	public static function reserved( string $slug, string $name ): string {
		$candidate = sanitize_title( $slug );

		if ( '' === $candidate ) {
			$candidate = sanitize_title( $name );
		}

		return in_array( $candidate, self::SLUGS, true ) ? $candidate : '';
	}

	/**
	 * The reserved slug an edit of a type would give it, or ''.
	 *
	 * An edit that sends no slug keeps the current one. An edit that sends an empty slug gets one
	 * generated from the name: the new name if the edit sends one, else the current name.
	 *
	 * @param int         $term_id Type term ID.
	 * @param string|null $slug    Slug the edit sends, or null if it sends none.
	 * @param string|null $name    Name the edit sends, or null if it sends none.
	 */
	public static function reserved_after_update( int $term_id, ?string $slug, ?string $name ): string {
		$term = get_term( $term_id, Taxonomies::TYPE );

		if ( ! $term instanceof WP_Term || null === $slug ) {
			return '';
		}

		return self::reserved( $slug, $name ?? $term->name );
	}

	/**
	 * The refusal, as an error with HTTP status 400 for REST.
	 *
	 * @param string $slug The reserved slug.
	 */
	public static function error( string $slug ): WP_Error {
		return new WP_Error( self::ERROR_CODE, self::message( $slug ), array( 'status' => 400 ) );
	}

	/**
	 * The refusal's message.
	 *
	 * @param string $slug The reserved slug.
	 */
	public static function message( string $slug ): string {
		return sprintf(
			/* translators: %s: the reserved slug, "topic" or "page". */
			__( 'The slug "%1$s" is reserved, because /resources/%1$s/ is a listing URL. Choose another name or slug for this type.', 'resource-hub' ),
			$slug
		);
	}

	/**
	 * Refuses a new type with a reserved slug. Hooked to `pre_insert_term`.
	 *
	 * @param string|WP_Error $term     The term name, or an earlier error.
	 * @param string          $taxonomy Taxonomy slug.
	 * @param array|string    $args     Arguments passed to `wp_insert_term()`.
	 * @return string|WP_Error The name unchanged, or the refusal.
	 */
	public function refuse_insert( $term, $taxonomy, $args = array() ) {
		if ( Taxonomies::TYPE !== $taxonomy || ! is_string( $term ) ) {
			return $term;
		}

		$args     = wp_parse_args( $args );
		$slug     = isset( $args['slug'] ) && is_string( $args['slug'] ) ? wp_unslash( $args['slug'] ) : '';
		$reserved = self::reserved( $slug, wp_unslash( $term ) );

		return '' === $reserved ? $term : self::error( $reserved );
	}

	/**
	 * Refuses a REST edit of a type that would give it a reserved slug. Hooked to
	 * `rest_dispatch_request`, which runs after the route's permission check and before its
	 * callback; returning an error answers the request with it.
	 *
	 * @param mixed           $result  Null, or an earlier filter's result.
	 * @param WP_REST_Request $request The REST request.
	 * @return mixed The result unchanged, or the refusal.
	 */
	public function refuse_rest_update( $result, WP_REST_Request $request ) {
		if ( null !== $result || ! in_array( $request->get_method(), array( 'POST', 'PUT', 'PATCH' ), true ) ) {
			return $result;
		}

		if ( ! preg_match( '#^/wp/v2/' . Taxonomies::TYPE . '/(\d+)$#', $request->get_route(), $matches ) ) {
			return $result;
		}

		$reserved = self::reserved_after_update(
			(int) $matches[1],
			isset( $request['slug'] ) ? (string) $request['slug'] : null,
			isset( $request['name'] ) ? (string) $request['name'] : null
		);

		return '' === $reserved ? $result : self::error( $reserved );
	}

	/**
	 * Refuses the Types screen's edit form when it would give the type a reserved slug, by sending
	 * the editor back to the form with an error notice. Hooked to `load-edit-tags.php`, which
	 * fires before core handles the form; the nonce checked is the one core checks.
	 */
	public function refuse_admin_update(): void {
		if ( ! isset( $_POST['action'], $_POST['taxonomy'], $_POST['tag_ID'] ) || 'editedtag' !== $_POST['action'] || Taxonomies::TYPE !== $_POST['taxonomy'] ) {
			return;
		}

		$term_id = absint( $_POST['tag_ID'] );
		check_admin_referer( 'update-tag_' . $term_id );

		$reserved = self::reserved_after_update(
			$term_id,
			isset( $_POST['slug'] ) ? sanitize_text_field( wp_unslash( $_POST['slug'] ) ) : null,
			isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : null
		);

		if ( '' === $reserved ) {
			return;
		}

		$back = wp_get_referer();

		if ( ! $back ) {
			$back = (string) get_edit_term_link( $term_id, Taxonomies::TYPE, PostType::NAME );
		}

		wp_safe_redirect(
			add_query_arg(
				array(
					'error'   => 1,
					'message' => self::ADMIN_MESSAGE,
				),
				$back
			)
		);
		exit;
	}

	/**
	 * Refuses a Quick Edit of a type that would give it a reserved slug; the Types screen shows
	 * the message in the row. Hooked to `wp_ajax_inline-save-tax` before core's handler.
	 */
	public function refuse_quick_edit(): void {
		check_ajax_referer( 'taxinlineeditnonce', '_inline_edit' );

		if ( ! isset( $_POST['taxonomy'], $_POST['tax_ID'] ) || Taxonomies::TYPE !== $_POST['taxonomy'] ) {
			return;
		}

		$reserved = self::reserved_after_update(
			absint( $_POST['tax_ID'] ),
			isset( $_POST['slug'] ) ? sanitize_text_field( wp_unslash( $_POST['slug'] ) ) : null,
			isset( $_POST['name'] ) ? sanitize_text_field( wp_unslash( $_POST['name'] ) ) : null
		);

		if ( '' !== $reserved ) {
			wp_die( esc_html( self::message( $reserved ) ) );
		}
	}

	/**
	 * Adds the refusal to the Types screen's messages. Hooked to `term_updated_messages`.
	 *
	 * @param array<string, array<int, string>> $messages Messages by taxonomy, `_item` the default.
	 * @return array<string, array<int, string>>
	 */
	public function admin_messages( $messages ) {
		$messages = (array) $messages;
		$base     = $messages[ Taxonomies::TYPE ] ?? $messages['_item'] ?? array();

		$messages[ Taxonomies::TYPE ] = $base + array(
			self::ADMIN_MESSAGE => esc_html__( 'Type not updated. The slugs "topic" and "page" are reserved, because /resources/topic/ and /resources/page/ are listing URLs. Choose another name or slug.', 'resource-hub' ),
		);

		return $messages;
	}

	/**
	 * Keeps a type's current slug when an edit that none of the refusals above saw would give it a
	 * reserved one. Hooked to `wp_update_term_data`, the last point before core writes the term.
	 *
	 * @param array<string, mixed> $data     Name, slug and term group about to be written.
	 * @param int                  $term_id  Term ID.
	 * @param string               $taxonomy Taxonomy slug.
	 * @return array<string, mixed>
	 */
	public function keep_current_slug( $data, $term_id, $taxonomy ) {
		if ( Taxonomies::TYPE !== $taxonomy || ! isset( $data['slug'] ) || ! in_array( $data['slug'], self::SLUGS, true ) ) {
			return $data;
		}

		$current = get_term( (int) $term_id, Taxonomies::TYPE );

		if ( $current instanceof WP_Term ) {
			$data['slug'] = $current->slug;
		}

		return $data;
	}
}
