<?php
/**
 * The request body: a versioned batch of events.
 *
 * This file is a critical path: it is read line by line before merge.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\ContentModel\ReservedTypeSlugs;
use ResourceHub\ContentModel\SlugEscapes;

/**
 * Wraps a batch of events as `{ "version": 1, "events": [ … ] }`, the body of
 * `POST {FRONTEND_URL}/api/revalidate/` (`revalidate-request.schema.json`), and makes sure no slug
 * in an event carries an escape the front end's router decodes (ADR 0024).
 */
final class Payload {
	/**
	 * The contract version. Fixed by the schema's `const`; a breaking change to an event shape bumps it (ADR 0014).
	 */
	public const VERSION = 1;

	/**
	 * Builds the body for one batch of at most {@see Queue::BATCH_SIZE} events, each already passed
	 * through {@see Payload::decode_slugs()} by the dispatcher.
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

	/**
	 * One event with every slug field in the form a save would store it now: a resource event's
	 * `slug`, `types`, `topics`, `previous.slug`, `previous.types` and `previous.topics`, and a term
	 * event's `slug` and `previous.slug`, each through {@see SlugEscapes::decode_stored()}.
	 *
	 * Events read stored slugs, and a slug stored before the save-time rule can still carry an escape
	 * such as `%2d`: `previous` on the save that decodes it (`$post_before`, the term snapshot), a
	 * removal of a resource never saved since, a resource listing a topic never saved since, or a
	 * cron publish, which writes the status without the save hooks. The front end refuses such a
	 * slug and answers the whole batch with a 400, so every event in it would be lost. Decoding here
	 * names the path the front end would serve the slug at; the escaped path itself was never servable.
	 *
	 * A slug that decodes to nothing has no servable path at all, so nothing is cached under it:
	 * - `previous.slug` falls back to the event's own slug, so the update still revalidates the
	 *   listings in `previous`, at the cost of naming the current path twice;
	 * - the top-level `slug` falls back to the object's ID as a string, as core names a post whose
	 *   title sanitizes to nothing; the listings the event names are what matter;
	 * - a type or topic is dropped from its list, and lists are deduplicated, since two stored slugs
	 *   can decode to one. A resource left with no top-level type is then held back by the
	 *   dispatcher's one-type check, and one left with no previous type gets the current type there.
	 * A type slug that decodes to a reserved word ({@see ReservedTypeSlugs::SLUGS}), such as a
	 * `%74opic` written by direct SQL past the refusal on save, is dropped the same way: `topic` and
	 * `page` name listing paths, never a type, and the schema rejects them as one.
	 * Call this before {@see ResourceState::has_one_type()}, so that check sees the lists as sent.
	 * Every other slug is returned exactly as stored.
	 *
	 * @param array<string, mixed> $event A resource or term event.
	 * @return array<string, mixed>
	 */
	public static function decode_slugs( array $event ): array {
		$is_resource   = 'resource' === $event['type'];
		$event['slug'] = self::decoded_slug( (string) $event['slug'], (string) $event['id'] );

		if ( $is_resource ) {
			$event['types']  = self::decoded_types( $event['types'] );
			$event['topics'] = self::decoded_list( $event['topics'] );
		}

		if ( ! is_array( $event['previous'] ?? null ) ) {
			return $event;
		}

		$event['previous']['slug'] = self::decoded_slug( (string) $event['previous']['slug'], $event['slug'] );

		if ( $is_resource ) {
			$event['previous']['types']  = self::decoded_types( $event['previous']['types'] );
			$event['previous']['topics'] = self::decoded_list( $event['previous']['topics'] );
		}

		return $event;
	}

	/**
	 * A stored slug decoded, or the fallback when it decodes to nothing.
	 *
	 * @param string $slug     A stored slug.
	 * @param string $fallback What to send instead of an empty slug.
	 */
	private static function decoded_slug( string $slug, string $fallback ): string {
		$decoded = SlugEscapes::decode_stored( $slug );

		return '' === $decoded ? $fallback : $decoded;
	}

	/**
	 * A list of stored term slugs decoded, without empty or repeated slugs.
	 *
	 * @param array<int, mixed> $slugs Stored slugs.
	 * @return string[]
	 */
	private static function decoded_list( array $slugs ): array {
		$decoded = array_map( static fn( $slug ): string => SlugEscapes::decode_stored( (string) $slug ), $slugs );

		return array_values( array_unique( array_filter( $decoded, static fn( string $slug ): bool => '' !== $slug ) ) );
	}

	/**
	 * A list of stored type slugs decoded, without empty, repeated or reserved slugs.
	 *
	 * @param array<int, mixed> $slugs Stored slugs.
	 * @return string[]
	 */
	private static function decoded_types( array $slugs ): array {
		return array_values( array_diff( self::decoded_list( $slugs ), ReservedTypeSlugs::SLUGS ) );
	}
}
