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
use ResourceHub\ContentModel\Taxonomies;

/**
 * Wraps a batch of events as `{ "version": 1, "events": [ … ] }`, the body of
 * `POST {FRONTEND_URL}/api/revalidate/` (`revalidate-request.schema.json`), and makes sure no slug
 * in an event carries an escape the front end's router decodes (ADR 0024).
 */
final class Payload {
	/**
	 * The contract version. Fixed by the schema's `const`; a breaking change to an event shape bumps it (ADR 0010).
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
	 * `slug`, `types`, `topics`, `previous.slug`, `previous.types` and `previous.topics`, a term
	 * event's `slug` and `previous.slug`, and each segment of a page event's `path` and
	 * `previous.path`, each through {@see SlugEscapes::decode_stored()}.
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
	 * `%74opic` written by direct SQL past the refusal on save, has no servable path either: `topic`
	 * and `page` name listing paths, never a type, and the schema rejects them as one.
	 * - In a resource event's `types` or `previous.types` it is dropped, as an empty one is.
	 * - As a `resource_type` term event's `previous.slug` it falls back to the event's own slug, by
	 *   the same rule as an empty one, so the type's rename still goes out.
	 * - As a `resource_type` term event's top-level slug it is kept, and the dispatcher holds the
	 *   event back ({@see Payload::is_reserved_type_term()}): there is no slug to stand in for it.
	 * Call this before {@see ResourceState::has_one_type()} and {@see Payload::is_reserved_type_term()},
	 * so those checks see the event as sent. Every other slug is returned exactly as stored.
	 *
	 * A page path's segment that decodes to nothing is kept as stored: the schema's `pagePath` asks
	 * only for a non-empty segment with no slash or whitespace, as does the front end's reader, so the
	 * event goes out and the front end revalidates the path as written. The lookup for that path is
	 * what the front end refuses, so such a page is a 404 there either way.
	 *
	 * @param array<string, mixed> $event A resource, term or page event.
	 * @return array<string, mixed>
	 */
	public static function decode_slugs( array $event ): array {
		if ( 'page' === $event['type'] ) {
			$event['path'] = self::decoded_path( (string) $event['path'] );

			if ( is_array( $event['previous'] ?? null ) ) {
				$event['previous']['path'] = self::decoded_path( (string) $event['previous']['path'] );
			}

			return $event;
		}

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

		if ( self::is_type_term( $event ) && self::is_reserved_type_slug( $event['previous']['slug'] ) ) {
			$event['previous']['slug'] = $event['slug'];
		}

		if ( $is_resource ) {
			$event['previous']['types']  = self::decoded_types( $event['previous']['types'] );
			$event['previous']['topics'] = self::decoded_list( $event['previous']['topics'] );
		}

		return $event;
	}

	/**
	 * Whether an event, already passed through {@see Payload::decode_slugs()}, is a `resource_type`
	 * term event whose slug is `topic` or `page`. Such an event cannot be sent: the schema requires a
	 * type slug there, so it would fail the whole batch with a 400. Only a row written straight into
	 * the database can carry one, since every save path refuses or keeps the slug.
	 *
	 * @param array<string, mixed> $event A resource or term event.
	 */
	public static function is_reserved_type_term( array $event ): bool {
		return self::is_type_term( $event ) && self::is_reserved_type_slug( (string) $event['slug'] );
	}

	/**
	 * Whether an event is a term event in the `resource_type` taxonomy.
	 *
	 * @param array<string, mixed> $event A resource or term event.
	 */
	private static function is_type_term( array $event ): bool {
		return 'term' === $event['type'] && Taxonomies::TYPE === ( $event['taxonomy'] ?? null );
	}

	/**
	 * Whether a decoded slug is one a type may not have.
	 *
	 * @param string $slug A decoded slug.
	 */
	private static function is_reserved_type_slug( string $slug ): bool {
		return in_array( $slug, ReservedTypeSlugs::SLUGS, true );
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
	 * A page path with each segment decoded as a stored slug; a segment that decodes to nothing is kept.
	 *
	 * @param string $path A page path, `/` or `/a/b/`.
	 */
	private static function decoded_path( string $path ): string {
		$segments = array_filter( explode( '/', $path ), static fn( string $segment ): bool => '' !== $segment );

		if ( array() === $segments ) {
			return '/';
		}

		$decoded = array_map( static fn( string $segment ): string => self::decoded_slug( $segment, $segment ), $segments );

		return '/' . implode( '/', $decoded ) . '/';
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
