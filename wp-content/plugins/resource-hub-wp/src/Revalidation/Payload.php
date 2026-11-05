<?php
/**
 * The request body: a versioned batch of events.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * Wraps a batch of events as `{ "version": 1, "events": [ … ] }`, the body of
 * `POST {FRONTEND_URL}/api/revalidate` (`revalidate-request.schema.json`).
 */
final class Payload {
	/**
	 * The contract version. Fixed by the schema's `const`; a breaking change to an event shape bumps it (ADR 0014).
	 */
	public const VERSION = 1;

	/**
	 * Builds the body for one batch of at most {@see Queue::BATCH_SIZE} events.
	 *
	 * @param array<int, array<string, mixed>> $events The events, already deduplicated by {@see Queue}.
	 * @return array{version: int, events: array<int, array<string, mixed>>}
	 */
	public static function build( array $events ): array {
		return array(
			'version' => self::VERSION,
			'events'  => array_values( $events ),
		);
	}
}
