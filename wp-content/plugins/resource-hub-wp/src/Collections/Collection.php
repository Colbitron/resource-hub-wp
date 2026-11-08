<?php
/**
 * The collection a request asks for: the library, a type, a topic or a type within a topic, at a page.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Collections;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Query;
use WP_Term;

/**
 * What the front end's `validListing()` and `loadListing()` know about a listing request, read off the CMS's main query.
 *
 * The front end answers eight listing routes with one component, `ListingPage`, from the request's
 * filter (a type, a topic, both or neither) and page (`apps/web/components/ListingPage.tsx`). On the CMS
 * the same requests are the resource archive (`/resources/`), the `resource_type` archive and the
 * `resource_topic` archive, with both taxonomies' query vars set for a type within a topic
 * ({@see Routes}), so this reads the main query's flags and vars into the same four facts, for the
 * collection blocks and {@see CollectionQuery} to share:
 *
 * - `type` and `topic`: the terms the request is filtered by, from the `resource_type` and
 *   `resource_topic` query vars, which the taxonomies' rewrite rules and {@see Routes} set from the path.
 *   A var that names no term is read as no filter; such a request finds no posts and core answers 404
 *   before any block renders, as the front end does for a term that does not exist.
 * - `page`: core's `paged`, 1 on the first page.
 * - `total`: `found_posts`, the resources across every page as the CMS counts them, the front end's
 *   `listing.total`.
 *
 * `from()` is null for any other request (a single resource, a page, the welcome, a feed), so a
 * collection block in another template renders nothing. The 404 the lockdown gives an anonymous visitor
 * clears the query's flags (`Gate::empty_404()`), so for them nothing is a collection either.
 */
final class Collection {
	/**
	 * Resources per page, the front end's `RESOURCES_PER_PAGE` (`apps/web/lib/wp/resources.ts`).
	 */
	public const PER_PAGE = 12;

	/**
	 * Constructor.
	 *
	 * @param WP_Term|null $type  The type the request is filtered by, or null.
	 * @param WP_Term|null $topic The topic the request is filtered by, or null.
	 * @param int          $page  The page, 1 or more.
	 * @param int          $total Resources across every page.
	 */
	public function __construct(
		public readonly ?WP_Term $type,
		public readonly ?WP_Term $topic,
		public readonly int $page,
		public readonly int $total,
	) {
	}

	/**
	 * The collection the main query asks for, or null when it asks for something else.
	 */
	public static function current(): ?self {
		$query = $GLOBALS['wp_query'] ?? null;

		return $query instanceof WP_Query ? self::from( $query ) : null;
	}

	/**
	 * The collection `$query` asks for, or null.
	 *
	 * @param WP_Query $query A query whose flags are set (`parse_query()` has run).
	 */
	public static function from( WP_Query $query ): ?self {
		if ( ! self::is_collection( $query ) ) {
			return null;
		}

		return new self(
			self::term( $query, Taxonomies::TYPE ),
			self::term( $query, Taxonomies::TOPIC ),
			max( 1, (int) $query->get( 'paged' ) ),
			max( 0, (int) $query->found_posts )
		);
	}

	/**
	 * Whether `$query` is a collection: the resource archive or a type or topic archive, as a page, not a feed or an embed, and not a 404.
	 *
	 * @param WP_Query $query A query whose flags are set.
	 */
	public static function is_collection( WP_Query $query ): bool {
		if ( $query->is_404() || $query->is_feed() || $query->is_embed() || $query->is_search() ) {
			return false;
		}

		return $query->is_post_type_archive( PostType::NAME ) || $query->is_tax( Taxonomies::TYPE ) || $query->is_tax( Taxonomies::TOPIC );
	}

	/**
	 * True on the page that shows the lead: the first page of the unfiltered library.
	 */
	public function is_library_front(): bool {
		return null === $this->type && null === $this->topic && 1 === $this->page;
	}

	/**
	 * The term a taxonomy's query var names, or null.
	 *
	 * @param WP_Query $query    The query.
	 * @param string   $taxonomy `resource_type` or `resource_topic`.
	 */
	private static function term( WP_Query $query, string $taxonomy ): ?WP_Term {
		$slug = $query->get( $taxonomy );

		if ( ! is_string( $slug ) || '' === $slug ) {
			return null;
		}

		$term = get_term_by( 'slug', $slug, $taxonomy );

		return $term instanceof WP_Term ? $term : null;
	}
}
