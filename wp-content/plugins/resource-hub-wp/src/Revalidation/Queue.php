<?php
/**
 * The events raised during one PHP request.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * Collects the events raised during a request and deduplicates them (see `packages/ui/README.md`).
 * {@see Dispatcher} splits them into batches of at most {@see Queue::BATCH_SIZE} after checking
 * each one.
 *
 * Deduplication is per resource ID for resource events, per (taxonomy, term ID) for term events and
 * per page ID for page events (ADR 0052), so a post and a term that share a numeric ID never merge. A group becomes one event that carries
 * the earliest `previous` and the latest current state: the event is a change from the state before
 * the first save to the state after the last one. A group that ends in a removal reports the state
 * from before the first save at the top level, when there was one. Events keep the position of their
 * first observation.
 */
final class Queue {
	/**
	 * Most events in one request body; the schema's `maxItems`.
	 */
	public const BATCH_SIZE = 25;

	/**
	 * Queued events by deduplication key, in order of first observation. `before` is the public state
	 * before the earliest event in the group, or null when the item was not public (or did not exist) then.
	 *
	 * @var array<string, array{event: array<string, mixed>, before: array<string, mixed>|null}>
	 */
	private array $entries = array();

	/**
	 * Adds an event, merging it into an earlier event for the same resource or term.
	 *
	 * @param array<string, mixed> $event A resource or term event as the payload carries it.
	 */
	public function add( array $event ): void {
		$key = self::key( $event );

		if ( ! isset( $this->entries[ $key ] ) ) {
			$this->entries[ $key ] = array(
				'event'  => $event,
				'before' => self::before_state( $event ),
			);

			return;
		}

		$this->entries[ $key ]['event'] = self::merge( $this->entries[ $key ]['before'], $event );
	}

	/**
	 * The deduplicated events, in order of first observation.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function events(): array {
		return array_values( array_column( $this->entries, 'event' ) );
	}

	/**
	 * Whether nothing is queued.
	 */
	public function is_empty(): bool {
		return array() === $this->entries;
	}

	/**
	 * Forgets everything queued.
	 */
	public function clear(): void {
		$this->entries = array();
	}

	/**
	 * The deduplication key: `resource:{id}`, `term:{taxonomy}:{id}` or `page:{id}`.
	 *
	 * @param array<string, mixed> $event The event.
	 */
	private static function key( array $event ): string {
		if ( 'term' === $event['type'] ) {
			return 'term:' . $event['taxonomy'] . ':' . $event['id'];
		}

		return $event['type'] . ':' . $event['id'];
	}

	/**
	 * The public state an event says the item had before it: null for `publish` and `create` (it had
	 * none), `previous` for `update`, and the top-level state for the removals, which describe the
	 * last public state at the top level.
	 *
	 * @param array<string, mixed> $event The event.
	 * @return array<string, mixed>|null
	 */
	private static function before_state( array $event ): ?array {
		switch ( $event['event'] ) {
			case 'publish':
			case 'create':
				return null;
			case 'update':
				return $event['previous'];
			default:
				return self::top_level_state( $event );
		}
	}

	/**
	 * The merged event for a group: the latest event's fields, with the event name and `previous`
	 * chosen from the state before the earliest event and the state after the latest.
	 *
	 * - The item is public after the latest event (`publish`/`update`, `create`/`update`): it was not
	 *   public before the earliest, so the whole change is a `publish` (or `create`) with no `previous`;
	 *   or it was, so the whole change is an `update` whose `previous` is that earliest state.
	 * - The item is not public after the latest event: the latest removal event stands, with `previous`
	 *   null as the schema requires. If the item was public before the earliest event, the top-level
	 *   state is that earliest state, the one the front end can have cached, not a state that only
	 *   existed during this request: an update that renames a resource and a trash in the same request
	 *   send `trash` under the original slug. A `publish` followed by a `trash` in one request still
	 *   sends the `trash`, with the latest state; the front end's refetch finds nothing, which costs
	 *   one revalidation and is never wrong.
	 * - A resource's earliest state can have no type or two, when the update in the group is the save
	 *   that fixed its type. The removal then takes `types` from the latest event when that is exactly
	 *   one type, as {@see ResourceState::with_valid_previous_types()} does for an `update`, so it is
	 *   sent; otherwise the dispatcher holds it back.
	 * - A page's state is its path alone, so the same rules give a page trashed in the request that
	 *   also unset it as the front page a `trash` under `/`, the path readers used.
	 *
	 * @param array<string, mixed>|null $before The state before the earliest event in the group.
	 * @param array<string, mixed>      $latest The latest event.
	 * @return array<string, mixed>
	 */
	private static function merge( ?array $before, array $latest ): array {
		$merged      = $latest;
		$is_term     = 'term' === $latest['type'];
		$is_resource = 'resource' === $latest['type'];
		$exists      = in_array( $latest['event'], array( 'publish', 'create', 'update' ), true );

		if ( ! $exists ) {
			if ( null !== $before ) {
				$merged = array_merge( $merged, $before );

				if ( $is_resource && 1 !== count( $before['types'] ) && 1 === count( $latest['types'] ) ) {
					$merged['types'] = $latest['types'];
				}
			}

			$merged['previous'] = null;

			return $merged;
		}

		if ( null === $before ) {
			$merged['event']    = $is_term ? 'create' : 'publish';
			$merged['previous'] = null;

			return $merged;
		}

		$merged['event']    = 'update';
		$merged['previous'] = $before;

		return $merged;
	}

	/**
	 * The top-level state fields of an event, in the shape `previous` uses.
	 *
	 * @param array<string, mixed> $event The event.
	 * @return array<string, mixed>
	 */
	private static function top_level_state( array $event ): array {
		if ( 'term' === $event['type'] ) {
			return array(
				'slug' => $event['slug'],
				'name' => $event['name'],
			);
		}

		if ( 'page' === $event['type'] ) {
			return array( 'path' => $event['path'] );
		}

		return array(
			'slug'   => $event['slug'],
			'types'  => $event['types'],
			'topics' => $event['topics'],
		);
	}
}
