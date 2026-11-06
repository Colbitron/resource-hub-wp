<?php
/**
 * Where a revalidation result is kept and how the editor reads it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\ContentModel\PostType;
use ResourceHub\Pages\PagePath;
use WP_Post;
use WP_REST_Request;
use WP_Term;

/**
 * Writes `_rh_last_revalidation` on every resource, term and page in a batch and exposes it over REST
 * (see `docs/architecture/revalidation.md`).
 *
 * A batch gets one result, written to every object it carried, each copy noting how many other
 * changes travelled with it. The status moves from `pending`, written when the batch is scheduled,
 * to `sent` or `failed` when the cron job records the response. The final result of a batch that
 * wrote its own `pending` (sent through cron, or at once because core refused to schedule it) is not
 * written over another batch's `pending` ({@see ResultStore::is_pending_for_another_batch()}); every
 * other result is written whatever is stored. A force-deleted post or a deleted term has nowhere to
 * hold a result; those are recorded by {@see PostHog} alone.
 *
 * The REST field is read-only and in the `edit` context only, so it never appears in the public
 * responses the front end reads. Core already refuses `context=edit` to users who cannot edit the
 * object; the callback checks again so the rule is stated here too.
 */
final class ResultStore {
	/**
	 * Post and term meta key. The underscore makes it protected meta: hidden from the Custom Fields box.
	 */
	public const META_KEY = '_rh_last_revalidation';

	/**
	 * REST field name on `resource`, `page`, `resource_topic` and `resource_type` objects.
	 */
	public const REST_FIELD = 'rh_last_revalidation';

	/**
	 * The post types whose saves send an event and hold a record: the field is registered on each, and
	 * the block editor's notice ({@see \ResourceHub\Editor\RevalidationAssets}) and the list column
	 * ({@see \ResourceHub\Admin\ListColumn}) show the record on each.
	 *
	 * @var string[]
	 */
	public const POST_TYPES = array( PostType::NAME, PagePath::POST_TYPE );

	/**
	 * Status while the batch is scheduled and not yet sent.
	 */
	public const PENDING = 'pending';

	/**
	 * The error stored, with an empty body, when the full record could not be written.
	 */
	public const BODY_NOT_STORED = 'The response body could not be stored.';

	/**
	 * Writes a `pending` record to every object in a batch that is about to be scheduled.
	 *
	 * @param string                           $batch_id The batch.
	 * @param array<int, array<string, mixed>> $events   Its events.
	 */
	public function mark_pending( string $batch_id, array $events ): void {
		$pending = array(
			'status'      => self::PENDING,
			'outcome'     => self::PENDING,
			'code'        => null,
			'body'        => '',
			'truncated'   => false,
			'error'       => null,
			'duration_ms' => 0,
		);

		$this->write_all( $batch_id, $events, $pending, false );
	}

	/**
	 * Writes a batch's result to every object in it.
	 *
	 * @param string                           $batch_id          The batch.
	 * @param array<int, array<string, mixed>> $events            Its events.
	 * @param Result                           $result            What the front end answered.
	 * @param bool                             $wrote_own_pending True only for a batch that wrote its own `pending` before it was sent: one
	 *                                                            sent through cron, or at once because core refused to schedule it. Another
	 *                                                            batch's `pending` is then newer and is kept.
	 *                                                            False for every other result, which is written whatever is stored.
	 */
	public function record( string $batch_id, array $events, Result $result, bool $wrote_own_pending = false ): void {
		$this->write_all( $batch_id, $events, $result->to_array(), $wrote_own_pending );
	}

	/**
	 * A resource's last result, or null when none is stored.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string, mixed>|null
	 */
	public static function read_post( int $post_id ): ?array {
		$value = get_post_meta( $post_id, self::META_KEY, true );

		return is_array( $value ) && array() !== $value ? $value : null;
	}

	/**
	 * A term's last result, or null when none is stored.
	 *
	 * @param int $term_id Term ID.
	 * @return array<string, mixed>|null
	 */
	public static function read_term( int $term_id ): ?array {
		$value = get_term_meta( $term_id, self::META_KEY, true );

		return is_array( $value ) && array() !== $value ? $value : null;
	}

	/**
	 * Registers the read-only `edit`-context REST field on the post type, on pages and on both taxonomies.
	 * Hooked to `rest_api_init`. The block editor's notice polls it after a save of a resource or a page.
	 */
	public function register_rest_fields(): void {
		foreach ( self::POST_TYPES as $post_type ) {
			register_rest_field(
				$post_type,
				self::REST_FIELD,
				array(
					'get_callback' => array( $this, 'rest_post_value' ),
					'schema'       => self::rest_schema(),
				)
			);
		}

		foreach ( TermEvents::TAXONOMIES as $taxonomy ) {
			register_rest_field(
				$taxonomy,
				self::REST_FIELD,
				array(
					'get_callback' => array( $this, 'rest_term_value' ),
					'schema'       => self::rest_schema(),
				)
			);
		}
	}

	/**
	 * The field's value for a resource or a page: its stored result, for a user who may edit it, in the `edit` context.
	 *
	 * @param array<string, mixed> $prepared The prepared post response, with `id`.
	 * @param string               $field    Field name. Unused.
	 * @param WP_REST_Request      $request  The request, for its `context`.
	 * @return array<string, mixed>|null
	 */
	public function rest_post_value( array $prepared, string $field, WP_REST_Request $request ): ?array {
		$post_id = (int) ( $prepared['id'] ?? 0 );

		if ( 'edit' !== $request['context'] || ! current_user_can( 'edit_post', $post_id ) ) {
			return null;
		}

		return self::read_post( $post_id );
	}

	/**
	 * The field's value for a term: its stored result, for a user who may edit it, in the `edit` context.
	 *
	 * @param array<string, mixed> $prepared The prepared term response, with `id`.
	 * @param string               $field    Field name. Unused.
	 * @param WP_REST_Request      $request  The request, for its `context`.
	 * @return array<string, mixed>|null
	 */
	public function rest_term_value( array $prepared, string $field, WP_REST_Request $request ): ?array {
		$term_id = (int) ( $prepared['id'] ?? 0 );

		if ( 'edit' !== $request['context'] || ! current_user_can( 'edit_term', $term_id ) ) {
			return null;
		}

		return self::read_term( $term_id );
	}

	/**
	 * Writes one record per event, skipping objects that no longer exist, and, for a batch that wrote
	 * its own `pending`, skipping an object whose stored record is another batch's `pending`
	 * ({@see ResultStore::is_pending_for_another_batch()}). The free-text fields, `body` and `error`, are made valid UTF-8 first, since the database refuses
	 * a value that is not. Should a record still fail to write, it is written again without its body
	 * (and so with `truncated` false, since no body is kept to be cut), so the status never stays `pending`.
	 *
	 * @param string                           $batch_id          The batch.
	 * @param array<int, array<string, mixed>> $events            Its events.
	 * @param array<string, mixed>             $result            The result fields shared by every copy.
	 * @param bool                             $wrote_own_pending Whether this is the final result of a batch that wrote its own `pending` first.
	 */
	private function write_all( string $batch_id, array $events, array $result, bool $wrote_own_pending ): void {
		$others = count( $events ) - 1;
		$time   = gmdate( 'Y-m-d\TH:i:s\Z' );

		foreach ( $events as $event ) {
			$record = array(
				'status'      => $result['status'],
				'outcome'     => $result['outcome'],
				'code'        => $result['code'],
				'event'       => $event['event'],
				'time'        => $time,
				'batch_id'    => $batch_id,
				'others'      => $others,
				'body'        => self::scrub( $result['body'] ),
				'truncated'   => (bool) ( $result['truncated'] ?? false ),
				'error'       => null === $result['error'] ? null : self::scrub( $result['error'] ),
				'duration_ms' => $result['duration_ms'],
			);

			$object = self::target( $event );

			if ( null === $object ) {
				continue;
			}

			if ( $wrote_own_pending && self::is_pending_for_another_batch( $object[0], $object[1], $batch_id ) ) {
				continue;
			}

			if ( ! self::write( $object[0], $object[1], $record ) ) {
				$record['body']      = '';
				$record['truncated'] = false;
				$record['error']     = $record['error'] ?? self::BODY_NOT_STORED;

				self::write( $object[0], $object[1], $record );
			}
		}
	}

	/**
	 * A free-text value as valid UTF-8, each invalid byte sequence replaced with U+FFFD by core's
	 * `wp_scrub_utf8()`. A body or a transport error message that is not valid UTF-8 would make the
	 * meta write fail.
	 *
	 * @param string $text The text.
	 */
	private static function scrub( string $text ): string {
		return wp_scrub_utf8( $text );
	}

	/**
	 * The meta type and ID an event's record goes to, or null when the object no longer exists or is
	 * not a resource (for a resource event) or a page (for a page event).
	 *
	 * @param array<string, mixed> $event The event.
	 * @return array{0: string, 1: int}|null
	 */
	private static function target( array $event ): ?array {
		if ( 'term' === $event['type'] ) {
			$term = get_term( (int) $event['id'], (string) $event['taxonomy'] );

			return $term instanceof WP_Term ? array( 'term', $term->term_id ) : null;
		}

		$post      = get_post( (int) $event['id'] );
		$post_type = 'page' === $event['type'] ? PagePath::POST_TYPE : PostType::NAME;

		return $post instanceof WP_Post && $post_type === $post->post_type ? array( 'post', $post->ID ) : null;
	}

	/**
	 * Whether the object's stored record is a `pending` from a batch other than this one.
	 *
	 * Asked only for the final result of a batch that wrote its own `pending` before it was sent: a
	 * cron batch, or one sent at once because core refused to schedule it. A stored `pending` from
	 * another batch was then written after it, by a later save the editor may be polling for. Writing
	 * the older result over it would make that save's poll read the wrong batch, and the later batch's
	 * own result replaces its pending anyway. A final with no pending of its own (a held-back event, a
	 * send under WP-CLI or on an unconfigured site, the status page's test) is never checked: the
	 * `pending` it finds may be older than it, or left by a send that never ran, and skipping would
	 * lose a real result.
	 *
	 * The cost: if the later send never completes, the guarded result is lost, and the record stays
	 * `pending` until the stale-pending display covers it (see `docs/architecture/revalidation.md`).
	 * The read here and the write after it are not atomic, so a `pending` written between them is
	 * still overwritten. Only a `pending` is protected: an older guarded result still replaces a
	 * later final, such as a held-back save's failure.
	 *
	 * @param string $meta_type `post` or `term`.
	 * @param int    $object_id Post or term ID.
	 * @param string $batch_id  The batch whose final result is about to be written.
	 */
	private static function is_pending_for_another_batch( string $meta_type, int $object_id, string $batch_id ): bool {
		$stored = 'term' === $meta_type ? self::read_term( $object_id ) : self::read_post( $object_id );

		return null !== $stored
			&& self::PENDING === ( $stored['status'] ?? null )
			&& ( $stored['batch_id'] ?? null ) !== $batch_id;
	}

	/**
	 * Writes one record and reports whether it is now stored.
	 *
	 * Core unslashes meta values before storing them, so the record is slashed first and a body with
	 * backslashes or quotes is kept exactly. `update_*_meta()` also returns false when the stored value
	 * is already identical, so a false is checked against what is stored before it counts as a failure.
	 *
	 * @param string               $meta_type `post` or `term`.
	 * @param int                  $object_id Post or term ID.
	 * @param array<string, mixed> $record    The record.
	 */
	private static function write( string $meta_type, int $object_id, array $record ): bool {
		$written = 'term' === $meta_type
			? update_term_meta( $object_id, self::META_KEY, wp_slash( $record ) )
			: update_post_meta( $object_id, self::META_KEY, wp_slash( $record ) );

		if ( false !== $written && ! is_wp_error( $written ) ) {
			return true;
		}

		$stored = 'term' === $meta_type ? self::read_term( $object_id ) : self::read_post( $object_id );

		return $stored === $record;
	}

	/**
	 * The REST schema of the field. `context` is `edit` only, so core strips the field from `view` and `embed` responses.
	 *
	 * @return array<string, mixed>
	 */
	private static function rest_schema(): array {
		return array(
			'description' => __( 'The outcome of the last front-end revalidation this object was part of.', 'resource-hub' ),
			'type'        => array( 'object', 'null' ),
			'context'     => array( 'edit' ),
			'readonly'    => true,
			'properties'  => array(
				'status'      => array(
					'type' => 'string',
					'enum' => array( self::PENDING, Result::SENT, Result::FAILED ),
				),
				'outcome'     => array(
					'type' => 'string',
					'enum' => array_merge( array( self::PENDING ), Result::OUTCOMES ),
				),
				'code'        => array( 'type' => array( 'integer', 'null' ) ),
				'event'       => array( 'type' => 'string' ),
				'time'        => array( 'type' => 'string' ),
				'batch_id'    => array( 'type' => 'string' ),
				'others'      => array( 'type' => 'integer' ),
				'body'        => array( 'type' => 'string' ),
				'truncated'   => array( 'type' => 'boolean' ),
				'error'       => array( 'type' => array( 'string', 'null' ) ),
				'duration_ms' => array( 'type' => 'integer' ),
			),
		);
	}
}
