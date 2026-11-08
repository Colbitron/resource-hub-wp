<?php
/**
 * The library's lead: the newest featured resource.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Collections;

use ResourceHub\Blocks\ResourceCardMarkup;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Post;
use WP_Query;

/**
 * The resource the front end's `leadCard()` picks (`apps/web/lib/listing-data.ts`), for the CMS's library.
 *
 * The front end reads the first page of the `featured` flag's listing, newest first, and takes the
 * first resource on it that has a URL: exactly one type (`toCard()` is null otherwise). It shows that
 * lead on the first page of the unfiltered library only, and nowhere else: a filtered listing answers
 * the filter with its list, and a later page is not the front (`packages/ui/DESIGN.md`, "The lead").
 * So `for()` is null for every other collection without a query, and for the library's front page when
 * the CMS has no `featured` flag, nothing carries it, or none of the newest {@see self::CANDIDATES}
 * flagged resources has exactly one type.
 *
 * One query per request: the blocks and {@see CollectionQuery}'s filters all ask for the same lead, so
 * the answer is kept for the main query it was found for and read again while that query is the main
 * query. A blank title does not disqualify a lead, as it does not on the front end: the lead is shown
 * as "Untitled resource", as a row would be.
 */
final class Lead {
	/**
	 * How many of the newest featured resources are looked at: the front end's one page of the flag's listing.
	 */
	public const CANDIDATES = Collection::PER_PAGE;

	/**
	 * The main query the memo below was found for, and its lead.
	 *
	 * @var array{query: WP_Query, lead: WP_Post|null}|null
	 */
	private static ?array $memo = null;

	/**
	 * The lead for `$collection`, or null.
	 *
	 * @param Collection $collection The collection the main query asks for.
	 */
	public static function for( Collection $collection ): ?WP_Post {
		if ( ! $collection->is_library_front() ) {
			return null;
		}

		$query = $GLOBALS['wp_query'] ?? null;

		if ( $query instanceof WP_Query && null !== self::$memo && self::$memo['query'] === $query ) {
			return self::$memo['lead'];
		}

		$lead = self::newest_featured();

		if ( $query instanceof WP_Query ) {
			self::$memo = array(
				'query' => $query,
				'lead'  => $lead,
			);
		}

		return $lead;
	}

	/**
	 * The lead of the current request, or null when the main query is not the library's front page or it has none.
	 */
	public static function current(): ?WP_Post {
		$collection = Collection::current();

		return null === $collection ? null : self::for( $collection );
	}

	/**
	 * Forgets the kept answer, for a test that changes the featured resources under one request.
	 */
	public static function forget(): void {
		self::$memo = null;
	}

	/**
	 * The newest published resource carrying the `featured` flag that has exactly one type, or null.
	 */
	private static function newest_featured(): ?WP_Post {
		$flag = Taxonomies::featured_flag_id();

		if ( 0 === $flag ) {
			return null;
		}

		$query = new WP_Query(
			array(
				'post_type'           => PostType::NAME,
				'post_status'         => 'publish',
				'posts_per_page'      => self::CANDIDATES,
				'orderby'             => 'date',
				'order'               => 'DESC',
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
				'tax_query'           => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- The flag is a term by design (ADR 0007); one query per library page.
					array(
						'taxonomy' => Taxonomies::FLAG,
						'field'    => 'term_id',
						'terms'    => array( $flag ),
					),
				),
			)
		);

		foreach ( $query->posts as $post ) {
			if ( $post instanceof WP_Post && null !== ResourceCardMarkup::type( $post ) ) {
				return $post;
			}
		}

		return null;
	}
}
