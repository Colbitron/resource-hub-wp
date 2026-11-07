<?php
/**
 * A resource has a title, at least one topic and a summary once it is public.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use stdClass;
use WP_Error;
use WP_REST_Request;

/**
 * Refuses a save that would publish, or keep published, a resource without a title, a topic or
 * a summary.
 *
 * The front end renders such a resource, but badly: "Untitled resource" for a blank title, no
 * topic listing for a resource with no topic, a card and a page lead with nothing under the name
 * for a blank summary. OneType keeps the type whole because the URL needs it; this keeps the rest
 * of what a card needs whole, as the editor asked (2026-11-07). The rule, checked on the state
 * the save would leave, for the statuses in {@see OneType::PUBLIC_STATUSES}:
 * - a title that is not blank;
 * - at least one `resource_topic`;
 * - a `summary` meta value that is not blank.
 * Blank follows what the front end shows. The title is rendered HTML that `cardTitle()` in
 * `apps/web/lib/wp/cards.ts` reads as text, so a title is blank when nothing is left once tags
 * are stripped, entities decoded, and whitespace, no-break spaces and the zero-width characters
 * U+200B to U+200D and U+FEFF are removed (`is_blank()`). The summary is stored as plain text
 * and shown verbatim, so it is judged as it would be stored, after `MetaRules::sanitize_summary()`,
 * and is blank when nothing is left once whitespace and those characters are removed, with no
 * entity decoding: a typed `&nbsp;` is six visible characters (`is_blank_summary()`). A draft,
 * pending or private resource may lack all three, and a save that unpublishes a resource
 * (to draft, pending or private) is never refused, so an editor never loses work to the rule.
 *
 * The block editor saves through REST, so the check runs on `rest_pre_insert_resource`, after
 * OneType's: before WordPress writes the post, its terms or its meta. Each field is judged from
 * the request when the request carries it (`title`, `resource_topic`, `meta.summary`) and from
 * what is stored when it does not, which is how OneType judges the type. A refusal is a 400
 * whose message the editor shows in its "Publishing failed" or "Updating failed" notice; the
 * first missing field, in the order above, gives the code and the message, and the others ride
 * along as the response's `additional_errors`. The editor's own lock (`editor/required-fields/`)
 * keeps the editor from sending such a save: that is the convenience, this is the check.
 *
 * Autosaves are judged before the route's callback runs (`rest_dispatch_request`), not on
 * `rest_pre_insert_resource`, because core's autosaves controller ignores an error from that
 * filter and saves anyway. The route writes the resource itself, status included, for an
 * author's own draft (`WP_REST_Autosaves_Controller::create_item()` calls `wp_update_post()`),
 * so a crafted `POST /wp/v2/resources/{id}/autosaves` with `status: publish` could otherwise
 * publish a draft unchecked. An autosave passes when the stored status is public (the route then
 * writes an autosave revision, never the resource) or when the status it sends, or the stored
 * one if it sends none, is not public; otherwise it is judged like any other save, on what that
 * write would store: the title from the request or storage, and the topics and summary from
 * storage, since the route writes neither terms nor meta to the resource. The type is judged the
 * same way, for OneType, whose `rest_pre_insert_resource` check the route ignores too: from
 * storage, by `OneType::problem()` on the stored types, so a `resource_type` the autosave sends
 * does not count. It is judged first and alone, with OneType's code and message, as a REST save
 * reports OneType's error before this rule's. The check lives here rather than behind a second
 * `rest_dispatch_request` hook in OneType so the autosave route and its status test have one
 * definition. The editor's own periodic autosave never sends a public status, so it always passes.
 *
 * Quick Edit on the Resources list saves outside REST. It can blank the title, change the topics
 * (a flat taxonomy stays on in Quick Edit) and move the status, so while its handler runs a save
 * that would leave a resource `publish` or `future` without the three is refused, judged on what
 * core is about to write (`wp_insert_post_data`): the title from the row, the topics from the
 * `tax_input` names core assigns after the row when the request carries them and the stored
 * topics otherwise, and the summary as stored, since Quick Edit cannot edit it. For a resource
 * already published or scheduled the rule is OneType's "no worse": the save is refused only when
 * it would leave a field missing that is not missing now, so a resource an unguarded path left
 * incomplete can still be Quick Edited. The request ends with the message, which the list shows
 * in the row, before anything is written (core's `edit_post()` has already written
 * `_edit_last`), as OneType's Quick Edit refusal does.
 *
 * Guarded: REST saves, autosaves and Quick Edit. Not guarded, so each can leave a public resource
 * without one of the three:
 * - Bulk Edit, which can publish a draft that lacks a topic or a summary (it cannot blank a
 *   title);
 * - restoring a revision (`revision.php`, `wp_restore_post_revision()`), which writes the
 *   revision's title through `wp_update_post()` and so can blank the title of a published
 *   resource from a revision saved before it had one (the summary is not revisioned);
 * - deleting a topic (the Topics screen, `DELETE /wp/v2/resource_topic/{id}`,
 *   `wp term delete`), which removes it from every resource and can leave a published or
 *   scheduled one with none; a scheduled one then publishes through cron unchecked. Topics are
 *   open like tags, and keeping a used topic from being deleted, as UsedTypes does for types,
 *   is a product decision that has not been made;
 * - cron publishing a scheduled resource (`wp_publish_post()`), which checks nothing, so a
 *   resource scheduled complete and emptied since by one of these paths publishes as it is;
 * - the classic `post.php` form submission, WP-CLI, and PHP calls to `wp_insert_post()` and the
 *   like, the seeder among them (it gives every resource all three); XML-RPC is off (XmlRpc).
 * A resource made public through those without one of the three is served by the front end as
 * it is, and the editor keeps its Update button off until an editor fills the gap.
 * `missing_stored()` is for listing such resources from WP-CLI (README, "Running it").
 */
final class RequiredFields {
	/**
	 * Error code when a public resource would have a blank title.
	 */
	public const TITLE_MISSING = 'resource_hub_title_missing';

	/**
	 * Error code when a public resource would have no topic.
	 */
	public const TOPIC_MISSING = 'resource_hub_topic_missing';

	/**
	 * Error code when a public resource would have a blank summary.
	 */
	public const SUMMARY_MISSING = 'resource_hub_summary_missing';

	/**
	 * The field keys `missing()` reports, in the order they are reported.
	 */
	public const FIELDS = array( 'title', 'topic', 'summary' );

	/**
	 * Whitespace, no-break spaces and the zero-width characters, for `is_blank_summary()`.
	 * `\p{Z}` is every Unicode separator, the no-break space among them; the ASCII controls `\s`
	 * would cover are listed so the class does not depend on PCRE's Unicode mode for `\s`.
	 */
	private const BLANK_CHARACTERS = '/[\p{Z}\t\n\x0B\f\r\x{200B}-\x{200D}\x{FEFF}]+/u';

	/**
	 * ID of the resource the running Quick Edit saves, or 0 for none.
	 *
	 * @var int
	 */
	private int $quick_edit_id = 0;

	/**
	 * Hooks the check onto REST saves and autosaves of `resource` and onto the Resources list's
	 * Quick Edit handler. Registered after OneType, so its REST check runs after OneType's at the
	 * same priority.
	 */
	public function register(): void {
		add_filter( 'rest_pre_insert_' . PostType::NAME, array( $this, 'check_rest_save' ), 10, 2 );
		add_filter( 'rest_dispatch_request', array( $this, 'check_autosave' ), 10, 2 );
		add_action( 'wp_ajax_inline-save', array( $this, 'guard_quick_edit' ), 0 );
	}

	/**
	 * Rule: the post as the save would leave it has no missing field for its status, or the save
	 * is refused. An earlier error passes through, and so does an autosave, which check_autosave()
	 * has judged before the route ran.
	 *
	 * @param stdClass|WP_Error $prepared_post The post core is about to save, or an earlier error.
	 * @param WP_REST_Request   $request       The REST request.
	 * @return stdClass|WP_Error The post unchanged, or the refusal.
	 */
	public function check_rest_save( $prepared_post, WP_REST_Request $request ) {
		if ( ! $prepared_post instanceof stdClass || self::is_autosave( $request ) ) {
			return $prepared_post;
		}

		$existing = isset( $prepared_post->ID ) ? get_post( (int) $prepared_post->ID ) : null;

		if ( ! empty( $prepared_post->post_status ) ) {
			$status = (string) $prepared_post->post_status;
		} else {
			$status = $existing ? $existing->post_status : 'draft';
		}

		if ( isset( $prepared_post->post_title ) ) {
			$title = (string) $prepared_post->post_title;
		} else {
			$title = $existing ? $existing->post_title : '';
		}

		if ( isset( $request[ Taxonomies::TOPIC ] ) ) {
			$topics = count( self::existing_term_ids( Taxonomies::TOPIC, (array) $request[ Taxonomies::TOPIC ] ) );
		} else {
			$topics = $existing ? self::stored_topic_count( $existing->ID ) : 0;
		}

		$meta = $request['meta'] ?? null;

		if ( is_array( $meta ) && array_key_exists( Meta::SUMMARY, $meta ) ) {
			$summary = MetaRules::sanitize_summary( $meta[ Meta::SUMMARY ] );
		} else {
			$summary = $existing ? self::stored_summary( $existing->ID ) : '';
		}

		return self::problem( $status, self::missing( $title, $topics, $summary ) ) ?? $prepared_post;
	}

	/**
	 * Rule: an autosave that would write a public status onto a resource that is not public is
	 * refused while the resource, as that write would leave it, does not have exactly one stored
	 * type (OneType's rule and error, judged first) or lacks a field. Hooked to
	 * `rest_dispatch_request`, which runs after the route's permission check and before its
	 * callback, so a refusal is the response and nothing is written. Any other request, and an
	 * autosave that passes, is left to the route.
	 *
	 * @param mixed           $result  Null, or a response an earlier filter chose.
	 * @param WP_REST_Request $request The REST request.
	 * @return mixed The result unchanged, or the refusal.
	 */
	public function check_autosave( $result, WP_REST_Request $request ) {
		if ( null !== $result || 'POST' !== $request->get_method() || ! self::is_autosave( $request ) ) {
			return $result;
		}

		$existing = get_post( (int) $request['id'] );

		if ( ! $existing || PostType::NAME !== $existing->post_type || in_array( $existing->post_status, OneType::PUBLIC_STATUSES, true ) ) {
			return $result;
		}

		$status = is_string( $request['status'] ) && '' !== $request['status'] ? $request['status'] : $existing->post_status;

		if ( ! in_array( $status, OneType::PUBLIC_STATUSES, true ) ) {
			return $result;
		}

		// The type first and alone, as on a REST save, where OneType's error comes before this one.
		$type_problem = OneType::problem( $status, count( OneType::stored_type_ids( $existing->ID ) ) );

		if ( null !== $type_problem ) {
			return $type_problem;
		}

		// The title as core's `prepare_item_for_database()` reads it: a string, or a non-empty `raw`.
		$title = $request['title'];

		if ( is_array( $title ) ) {
			$title = empty( $title['raw'] ) ? null : $title['raw'];
		}

		$title   = is_string( $title ) ? $title : $existing->post_title;
		$missing = self::missing( $title, self::stored_topic_count( $existing->ID ), self::stored_summary( $existing->ID ) );

		return self::problem( $status, $missing ) ?? $result;
	}

	/**
	 * Guards the resource a Quick Edit saves. Hooked to `wp_ajax_inline-save` before core's
	 * handler: for a resource the user may edit, after the nonce core checks, it adds
	 * check_quick_edit() to `wp_insert_post_data` for the rest of the request, which core ends once
	 * it has saved. Other post types, and a user who may not edit the resource, are left to core.
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

		$this->quick_edit_id = $post_id;
		add_filter( 'wp_insert_post_data', array( $this, 'check_quick_edit' ), 99, 2 );
	}

	/**
	 * Rule: while Quick Edit saves a resource, a save that would leave it `publish` or `future`
	 * without a title, a topic or a summary ends with the message before anything is written;
	 * for a resource already published or scheduled, only when the save would leave a field
	 * missing that is not missing in storage. Hooked to `wp_insert_post_data`, late, only while that handler runs. OneType's own Quick Edit
	 * guard runs at the same priority and may end the request first; either message fits.
	 *
	 * @param array<string, mixed> $data    The post fields core is about to write, slashed.
	 * @param array<string, mixed> $postarr The post data passed to `wp_insert_post()`.
	 * @return array<string, mixed>
	 */
	public function check_quick_edit( $data, $postarr ) {
		$post_id = isset( $postarr['ID'] ) ? (int) $postarr['ID'] : 0;

		if ( 0 === $post_id || $post_id !== $this->quick_edit_id || ! isset( $data['post_type'], $data['post_status'] ) || PostType::NAME !== $data['post_type'] ) {
			return $data;
		}

		if ( ! in_array( $data['post_status'], OneType::PUBLIC_STATUSES, true ) ) {
			return $data;
		}

		$title = isset( $data['post_title'] ) ? (string) wp_unslash( $data['post_title'] ) : '';

		if ( isset( $postarr['tax_input'][ Taxonomies::TOPIC ] ) && is_array( $postarr['tax_input'][ Taxonomies::TOPIC ] ) ) {
			$topics = count( array_filter( $postarr['tax_input'][ Taxonomies::TOPIC ], static fn( $term ): bool => '' !== trim( (string) $term ) ) );
		} else {
			$topics = self::stored_topic_count( $post_id );
		}

		$missing = self::missing( $title, $topics, self::stored_summary( $post_id ) );
		$stored  = get_post( $post_id );

		// No worse: a resource already public is refused only for a gap this save would open.
		if ( $stored && in_array( $stored->post_status, OneType::PUBLIC_STATUSES, true ) ) {
			$opened = array_diff( $missing, self::missing_stored( $post_id ) );
		} else {
			$opened = $missing;
		}

		if ( array() !== $opened ) {
			wp_die( esc_html( self::admin_message( $missing ) ) );
		}

		return $data;
	}

	/**
	 * Rule: a public status with a missing field is refused; any other status is not.
	 *
	 * @param string   $status  Post status after the save.
	 * @param string[] $missing The missing fields after the save, from `missing()`.
	 * @return WP_Error|null The refusal, with HTTP status 400 and one error per missing field, or
	 *                       null when the save may go ahead.
	 */
	public static function problem( string $status, array $missing ): ?WP_Error {
		if ( array() === $missing || ! in_array( $status, OneType::PUBLIC_STATUSES, true ) ) {
			return null;
		}

		$error = null;

		foreach ( $missing as $field ) {
			if ( null === $error ) {
				$error = new WP_Error( self::code( $field ), self::message( $field ), array( 'status' => 400 ) );
			} else {
				$error->add( self::code( $field ), self::message( $field ) );
			}
		}

		return $error;
	}

	/**
	 * The fields a resource in the given state lacks: `title`, `topic` and `summary`, in that
	 * order, each only when missing.
	 *
	 * @param string $title   The title after the save.
	 * @param int    $topics  Number of topics after the save.
	 * @param string $summary The summary meta after the save, as stored (sanitized).
	 * @return string[]
	 */
	public static function missing( string $title, int $topics, string $summary ): array {
		$missing = array();

		if ( self::is_blank( $title ) ) {
			$missing[] = 'title';
		}

		if ( $topics < 1 ) {
			$missing[] = 'topic';
		}

		if ( self::is_blank_summary( $summary ) ) {
			$missing[] = 'summary';
		}

		return $missing;
	}

	/**
	 * The fields a stored resource lacks, judged from the database alone, for listing resources
	 * the unguarded paths made public without them.
	 *
	 * @param int $post_id Post ID.
	 * @return string[]
	 */
	public static function missing_stored( int $post_id ): array {
		$post = get_post( $post_id );

		if ( ! $post ) {
			return self::FIELDS;
		}

		return self::missing( $post->post_title, self::stored_topic_count( $post_id ), self::stored_summary( $post_id ) );
	}

	/**
	 * Rule: a title is blank when nothing is left once tags are stripped, entities decoded, and
	 * whitespace, no-break spaces and the zero-width characters are removed. Text that is not
	 * valid UTF-8 is not blank: it has bytes a reader would see something for.
	 *
	 * @param string $text The title as stored or as sent.
	 */
	public static function is_blank( string $text ): bool {
		$decoded = html_entity_decode( wp_strip_all_tags( $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );

		return self::is_blank_summary( $decoded );
	}

	/**
	 * Rule: a summary, as stored, is blank when nothing is left once whitespace, no-break spaces
	 * and the zero-width characters are removed. It is plain text the front end shows verbatim,
	 * so nothing is stripped or decoded: `&nbsp;` typed as text is not blank. A value sent over
	 * REST is judged after `MetaRules::sanitize_summary()`, so a value that sanitizes to empty
	 * (invalid UTF-8, markup alone) is blank.
	 *
	 * @param string $text The summary as stored.
	 */
	public static function is_blank_summary( string $text ): bool {
		return '' === preg_replace( self::BLANK_CHARACTERS, '', $text );
	}

	/**
	 * The Quick Edit refusal's message, naming the missing fields.
	 *
	 * @param string[] $missing The missing fields, from `missing()`.
	 */
	public static function admin_message( array $missing ): string {
		$nouns = array(
			'title'   => __( 'a title', 'resource-hub' ),
			'topic'   => __( 'at least one topic', 'resource-hub' ),
			'summary' => __( 'a summary', 'resource-hub' ),
		);
		$named = array_values( array_intersect_key( $nouns, array_flip( $missing ) ) );

		return sprintf(
			/* translators: %s: what the resource lacks, as a list such as "a title and a summary". */
			__( 'A resource needs %s to be published or scheduled. Edit it to add what is missing.', 'resource-hub' ),
			wp_sprintf_l( '%l', $named )
		);
	}

	/**
	 * The error code of a missing field.
	 *
	 * @param string $field `title`, `topic` or `summary`.
	 */
	private static function code( string $field ): string {
		switch ( $field ) {
			case 'title':
				return self::TITLE_MISSING;
			case 'topic':
				return self::TOPIC_MISSING;
			default:
				return self::SUMMARY_MISSING;
		}
	}

	/**
	 * The REST refusal's message for a missing field: plain, quoting no value, and worded for a
	 * first publish and an edit of a resource already published alike, since the editor prefixes
	 * it with "Publishing failed." or "Updating failed.".
	 *
	 * @param string $field `title`, `topic` or `summary`.
	 */
	private static function message( string $field ): string {
		switch ( $field ) {
			case 'title':
				return __( 'A resource needs a title to be published or scheduled. Add one at the top of the editor.', 'resource-hub' );
			case 'topic':
				return __( 'A resource needs at least one topic to be published or scheduled. Add one in the Topics panel.', 'resource-hub' );
			default:
				return __( 'A resource needs a summary to be published or scheduled. Write one in the Resource details panel.', 'resource-hub' );
		}
	}

	/**
	 * Whether the request is to a resource's autosaves route.
	 *
	 * @param WP_REST_Request $request The REST request.
	 */
	private static function is_autosave( WP_REST_Request $request ): bool {
		return 1 === preg_match( '#^/wp/v2/' . PostType::REST_BASE . '/\d+/autosaves/?$#', $request->get_route() );
	}

	/**
	 * The distinct IDs in the list that name an existing term of the taxonomy; core skips the
	 * others when it assigns them.
	 *
	 * @param string       $taxonomy Taxonomy name.
	 * @param array<mixed> $ids      Term IDs from the request.
	 * @return int[]
	 */
	private static function existing_term_ids( string $taxonomy, array $ids ): array {
		$ids = array_values( array_unique( array_filter( array_map( 'absint', $ids ) ) ) );

		if ( array() === $ids ) {
			return array();
		}

		$found = get_terms(
			array(
				'taxonomy'               => $taxonomy,
				'include'                => $ids,
				'hide_empty'             => false,
				'fields'                 => 'ids',
				'update_term_meta_cache' => false,
			)
		);

		return is_array( $found ) ? array_map( 'intval', $found ) : array();
	}

	/**
	 * How many topics are stored on a post.
	 *
	 * @param int $post_id Post ID.
	 */
	private static function stored_topic_count( int $post_id ): int {
		$terms = get_the_terms( $post_id, Taxonomies::TOPIC );

		return is_array( $terms ) ? count( $terms ) : 0;
	}

	/**
	 * The summary stored on a post, or an empty string.
	 *
	 * @param int $post_id Post ID.
	 */
	private static function stored_summary( int $post_id ): string {
		$value = get_post_meta( $post_id, Meta::SUMMARY, true );

		return is_scalar( $value ) ? (string) $value : '';
	}
}
