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
 * Refuses a save that would leave a resource with the wrong number of types.
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
 * publish and an edit of a resource already published.
 *
 * Quick Edit and Bulk Edit on the Resources list save outside REST. Neither can change the type:
 * the taxonomy is off in Quick Edit (`show_in_quick_edit`), core's Quick Edit handler drops terms
 * of such a taxonomy from the request, and the Bulk Edit request has its `resource_type` terms
 * removed here before core reads it. Both can change the status, so while either handler runs,
 * a move into `publish` or `future` is refused for a resource that does not have exactly one
 * stored type, judged on the status core is about to write (`wp_insert_post_data`):
 * - Quick Edit is ended before the post row and terms are written (core's `edit_post()` has
 *   already written `_edit_last` and any `meta[]` sent), and answers with the message, which the
 *   list shows in the row;
 * - Bulk Edit keeps that resource's status, date and slug as stored, saves the rest, and the list
 *   names the resources it did not publish.
 * A resource already published or scheduled keeps its status through either handler, with or
 * without a type: neither handler publishes it, unpublishes it or gives it a type, so an edit
 * there leaves it no worse. Such a resource can arise only through the unguarded paths below.
 * Guarded: REST saves, Quick Edit, Bulk Edit, and type deletion from the Types screen and REST
 * (UsedTypes). Not guarded: the classic `post.php` form submission, XML-RPC, WP-CLI, and PHP calls
 * to `wp_insert_post()` and the like, the seeder among them. The revalidation hook never sends an
 * event whose top-level `types` isn't exactly one element, so the front end never receives an
 * invalid state from any of the unguarded paths.
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
	 * Query argument that carries the IDs of the resources Bulk Edit did not publish to the notice.
	 */
	public const ADMIN_ARG = 'rh_not_published';

	/**
	 * The admin handler running in this request, `quick-edit` or `bulk-edit`, or empty for none.
	 *
	 * @var string
	 */
	private string $handler = '';

	/**
	 * IDs of the resources the running admin handler saves.
	 *
	 * @var int[]
	 */
	private array $guarded = array();

	/**
	 * IDs of the resources Bulk Edit was kept from publishing.
	 *
	 * @var int[]
	 */
	private array $refused = array();

	/**
	 * Hooks the check onto REST saves of `resource`, and onto the Resources list's Quick Edit and
	 * Bulk Edit handlers.
	 */
	public function register(): void {
		add_filter( 'rest_pre_insert_' . PostType::NAME, array( $this, 'check_rest_save' ), 10, 2 );
		add_action( 'wp_ajax_inline-save', array( $this, 'guard_quick_edit' ), 0 );
		add_action( 'load-edit.php', array( $this, 'guard_bulk_edit' ) );
		add_action( 'admin_notices', array( $this, 'bulk_edit_notice' ) );
		add_filter( 'removable_query_args', array( $this, 'removable_query_args' ) );
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
	 * Guards the status of the resource a Quick Edit saves. Hooked to `wp_ajax_inline-save` before
	 * core's handler: for a resource the user may edit, after the nonce core checks, it adds
	 * keep_status() to `wp_insert_post_data` for the rest of the request, which core ends once it
	 * has saved. Other post types, and a user who may not edit the resource, are left to core.
	 */
	public function guard_quick_edit(): void {
		if ( ! isset( $_POST['post_ID'] ) ) {
			return;
		}

		$post_id = absint( $_POST['post_ID'] );

		if ( PostType::NAME !== get_post_type( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		check_ajax_referer( 'inlineeditnonce', '_inline_edit' );

		$this->handler = 'quick-edit';
		$this->guarded = array( $post_id );
		add_filter( 'wp_insert_post_data', array( $this, 'keep_status' ), 99, 2 );
	}

	/**
	 * Guards a Bulk Edit from the posts list. Hooked to `load-edit.php`, which fires before core
	 * handles the request; a request without `bulk_edit` or without core's `bulk-posts` nonce is
	 * left to core. It removes the `resource_type` terms from the request, as core's Quick Edit
	 * handler does for a taxonomy that is off in Quick Edit, because core's Bulk Edit passes them on
	 * to `wp_update_post()` otherwise. It then adds keep_status() to `wp_insert_post_data` until
	 * core's `bulk_edit_posts` action, for the posts selected, whatever list they were selected on.
	 */
	public function guard_bulk_edit(): void {
		if ( ! isset( $_REQUEST['bulk_edit'], $_REQUEST['post'], $_REQUEST['_wpnonce'] ) ) {
			return;
		}

		if ( ! wp_verify_nonce( sanitize_key( wp_unslash( $_REQUEST['_wpnonce'] ) ), 'bulk-posts' ) ) {
			return;
		}

		if ( isset( $_REQUEST['tax_input'] ) && is_array( $_REQUEST['tax_input'] ) ) {
			unset( $_REQUEST['tax_input'][ Taxonomies::TYPE ] );
		}

		if ( isset( $_POST['tax_input'] ) && is_array( $_POST['tax_input'] ) ) {
			unset( $_POST['tax_input'][ Taxonomies::TYPE ] );
		}

		if ( isset( $_GET['tax_input'] ) && is_array( $_GET['tax_input'] ) ) {
			unset( $_GET['tax_input'][ Taxonomies::TYPE ] );
		}

		$this->handler = 'bulk-edit';
		$this->guarded = array_filter( array_map( 'absint', (array) wp_unslash( $_REQUEST['post'] ) ) );
		$this->refused = array();
		add_filter( 'wp_insert_post_data', array( $this, 'keep_status' ), 99, 2 );
		add_action( 'bulk_edit_posts', array( $this, 'end_bulk_edit' ) );
	}

	/**
	 * Rule: while Quick Edit or Bulk Edit saves a resource that is neither published nor
	 * scheduled, a save that would make it `publish` or `future` without exactly one stored type is
	 * refused. Quick Edit is ended with the message before anything is written; Bulk Edit keeps
	 * the resource's stored status, and the date and slug core derived from the new one, and saves
	 * the rest. Hooked to `wp_insert_post_data`, late, only while one of those handlers runs.
	 *
	 * @param array<string, mixed> $data    The post fields core is about to write, slashed.
	 * @param array<string, mixed> $postarr The post data passed to `wp_insert_post()`.
	 * @return array<string, mixed>
	 */
	public function keep_status( $data, $postarr ) {
		$post_id = isset( $postarr['ID'] ) ? (int) $postarr['ID'] : 0;

		if ( ! in_array( $post_id, $this->guarded, true ) || ! isset( $data['post_type'], $data['post_status'] ) || PostType::NAME !== $data['post_type'] ) {
			return $data;
		}

		$stored = get_post( $post_id );

		if ( ! $stored
			|| in_array( $stored->post_status, self::PUBLIC_STATUSES, true )
			|| ! in_array( $data['post_status'], self::PUBLIC_STATUSES, true )
			|| 1 === count( self::stored_type_ids( $post_id ) )
		) {
			return $data;
		}

		if ( 'quick-edit' === $this->handler ) {
			wp_die( esc_html( self::admin_message() ) );
		}

		$data['post_status']   = $stored->post_status;
		$data['post_date']     = $stored->post_date;
		$data['post_date_gmt'] = $stored->post_date_gmt;
		$data['post_name']     = $stored->post_name;
		$this->refused[]       = $post_id;

		return $data;
	}

	/**
	 * Ends the Bulk Edit guard and, if it kept any resource from being published, adds their IDs
	 * to core's redirect back to the list. Hooked to `bulk_edit_posts` by guard_bulk_edit().
	 */
	public function end_bulk_edit(): void {
		remove_filter( 'wp_insert_post_data', array( $this, 'keep_status' ), 99 );
		$this->handler = '';
		$this->guarded = array();

		if ( array() !== $this->refused ) {
			add_filter( 'wp_redirect', array( $this, 'bulk_edit_redirect' ) );
		}
	}

	/**
	 * Adds the IDs of the resources Bulk Edit did not publish to core's redirect back to the list.
	 * Hooked to `wp_redirect` by end_bulk_edit(), only when there are any.
	 *
	 * @param string $location Where core redirects.
	 */
	public function bulk_edit_redirect( $location ): string {
		return add_query_arg( self::ADMIN_ARG, implode( ',', array_unique( $this->refused ) ), (string) $location );
	}

	/**
	 * Prints the Bulk Edit refusal on the Resources list, naming the resources, escaped. The names
	 * come from the IDs in ADMIN_ARG, kept only while each is a resource the user may edit that is
	 * neither published nor scheduled and does not have exactly one type, so a hand-made link
	 * cannot name any other. Hooked to `admin_notices`.
	 */
	public function bulk_edit_notice(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		if ( ! $screen || 'edit-' . PostType::NAME !== $screen->id ) {
			return;
		}

		// Display only: the IDs name the notice's resources and change nothing, so no nonce applies.
		$ids    = isset( $_GET[ self::ADMIN_ARG ] ) ? wp_parse_id_list( sanitize_text_field( wp_unslash( $_GET[ self::ADMIN_ARG ] ) ) ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$titles = array();

		foreach ( $ids as $post_id ) {
			$resource = get_post( $post_id );

			if ( ! $resource
				|| PostType::NAME !== $resource->post_type
				|| ! current_user_can( 'edit_post', $post_id )
				|| in_array( $resource->post_status, self::PUBLIC_STATUSES, true )
				|| 1 === count( self::stored_type_ids( $post_id ) )
			) {
				continue;
			}

			$title    = trim( wp_strip_all_tags( $resource->post_title ) );
			$titles[] = '' === $title ? __( '(no title)', 'resource-hub' ) : $title;
		}

		if ( array() === $titles ) {
			return;
		}

		printf(
			'<div class="notice notice-error"><p>%s</p></div>',
			esc_html(
				sprintf(
					/* translators: %s: the titles of the resources, as a list. */
					_n(
						'Not published or scheduled: %s. A resource needs a type to be published or scheduled. Edit it to choose one.',
						'Not published or scheduled: %s. A resource needs a type to be published or scheduled. Edit each one to choose one.',
						count( $titles ),
						'resource-hub'
					),
					wp_sprintf_l( '%l', $titles )
				)
			)
		);
	}

	/**
	 * Lets core drop ADMIN_ARG from the address bar once the notice is shown, as it does its own
	 * bulk counts. Hooked to `removable_query_args`.
	 *
	 * @param string[] $args Query arguments core removes.
	 * @return string[]
	 */
	public function removable_query_args( $args ) {
		$args   = (array) $args;
		$args[] = self::ADMIN_ARG;

		return $args;
	}

	/**
	 * The Quick Edit refusal's message.
	 */
	public static function admin_message(): string {
		return __( 'A resource needs a type to be published or scheduled. Edit it to choose one.', 'resource-hub' );
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
