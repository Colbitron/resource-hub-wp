<?php
/**
 * Turns changes to topics and types into term events.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\ContentModel\Taxonomies;
use WP_Term;

/**
 * Derives `create`, `update` and `delete` for `resource_topic` and `resource_type` terms (see
 * `packages/ui/README.md`).
 *
 * `edit_terms` fires inside `wp_update_term()` before the row changes and captures the old slug and
 * name; `created_{taxonomy}`, `edited_{taxonomy}` and `delete_{taxonomy}` queue the events.
 * `resource_flag` is managed in code and sends nothing. Assigning terms to a resource is not a term
 * event; it is an `update` of that resource.
 */
final class TermEvents {
	/**
	 * The taxonomies that send events.
	 */
	public const TAXONOMIES = array( Taxonomies::TOPIC, Taxonomies::TYPE );

	/**
	 * The queue events go to.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Slug and name by term ID, taken at `edit_terms` and consumed at `edited_{taxonomy}`.
	 *
	 * @var array<int, array{slug: string, name: string}>
	 */
	private array $snapshots = array();

	/**
	 * Constructor.
	 *
	 * @param Queue $queue The per-request queue.
	 */
	public function __construct( Queue $queue ) {
		$this->queue = $queue;
	}

	/**
	 * Hooks `edit_terms` once and the three per-taxonomy actions for each taxonomy.
	 */
	public function register(): void {
		add_action( 'edit_terms', array( $this, 'snapshot' ), 10, 2 );

		foreach ( self::TAXONOMIES as $taxonomy ) {
			add_action( "created_{$taxonomy}", array( $this, 'on_created' ), 10, 1 );
			add_action( "edited_{$taxonomy}", array( $this, 'on_edited' ), 10, 1 );
			add_action( "delete_{$taxonomy}", array( $this, 'on_deleted' ), 10, 3 );
		}
	}

	/**
	 * `edit_terms`: remembers a term's slug and name before `wp_update_term()` changes them.
	 *
	 * @param int    $term_id  Term being updated.
	 * @param string $taxonomy Its taxonomy.
	 */
	public function snapshot( int $term_id, string $taxonomy ): void {
		if ( ! in_array( $taxonomy, self::TAXONOMIES, true ) ) {
			return;
		}

		$term = get_term( $term_id, $taxonomy );

		if ( $term instanceof WP_Term ) {
			$this->snapshots[ $term_id ] = self::state( $term );
		}
	}

	/**
	 * `created_{taxonomy}`: a new term is a `create` event.
	 *
	 * @param int $term_id The new term.
	 */
	public function on_created( int $term_id ): void {
		$term = get_term( $term_id );

		if ( $term instanceof WP_Term ) {
			$this->queue->add( self::event( 'create', $term, null ) );
		}
	}

	/**
	 * `edited_{taxonomy}`: a changed slug or name is an `update` event with the snapshot as `previous`.
	 *
	 * An edit that changes neither (a description, a parent) touches nothing the front end shows and
	 * sends nothing. Without a snapshot, which core's write path always provides, `previous` repeats
	 * the current state so the listing is still refreshed.
	 *
	 * @param int $term_id The edited term.
	 */
	public function on_edited( int $term_id ): void {
		$before = $this->snapshots[ $term_id ] ?? null;
		unset( $this->snapshots[ $term_id ] );

		$term = get_term( $term_id );

		if ( ! $term instanceof WP_Term ) {
			return;
		}

		if ( null !== $before && self::state( $term ) === $before ) {
			return;
		}

		$this->queue->add( self::event( 'update', $term, $before ?? self::state( $term ) ) );
	}

	/**
	 * `delete_{taxonomy}`: the deleted term, which core passes because it no longer exists, is a `delete` event.
	 *
	 * @param int     $term_id      Term ID.
	 * @param int     $tt_id        Term taxonomy ID. Unused; core passes it before the term object.
	 * @param WP_Term $deleted_term The term as it was.
	 */
	public function on_deleted( int $term_id, int $tt_id, WP_Term $deleted_term ): void {
		$this->queue->add( self::event( 'delete', $deleted_term, null ) );
	}

	/**
	 * A term's slug and name (`termState` in the request schema).
	 *
	 * @param WP_Term $term The term.
	 * @return array{slug: string, name: string}
	 */
	public static function state( WP_Term $term ): array {
		return array(
			'slug' => $term->slug,
			'name' => $term->name,
		);
	}

	/**
	 * A term event as the payload carries it (`termEvent` in the request schema).
	 *
	 * @param string                                 $event    `create`, `update` or `delete`.
	 * @param WP_Term                                $term     The term in the state the event concerns.
	 * @param array{slug: string, name: string}|null $previous The state before an `update`, else null.
	 * @return array<string, mixed>
	 */
	public static function event( string $event, WP_Term $term, ?array $previous ): array {
		return array(
			'type'     => 'term',
			'taxonomy' => $term->taxonomy,
			'event'    => $event,
			'id'       => $term->term_id,
			'slug'     => $term->slug,
			'name'     => $term->name,
			'previous' => $previous,
		);
	}
}
