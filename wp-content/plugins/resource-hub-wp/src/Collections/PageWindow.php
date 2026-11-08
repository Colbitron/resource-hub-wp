<?php
/**
 * Which page numbers a collection's pagination lists: the front end's `pageWindow()`, in PHP.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Collections;

use RangeException;

/**
 * The front end's `pageWindow()` (`apps/web/lib/pagination.ts`), written again, so a CMS collection page
 * lists the same page numbers as the front end's `Pagination` for every page count and current page.
 *
 * Every page is listed up to `MAX_LISTED` pages. Past that, the first page, the last page and a window
 * of `AROUND` pages either side of the current one are listed, with a gap (`null`) wherever pages are
 * skipped, so the list has a fixed maximum length and a reader always has a way to the ends and to the
 * neighbours. A gap never stands for a single page: that page is listed instead, since it takes the
 * same room. So for 20 pages at page 4 the list is 1, 2, 3, 4, 5, a gap, 20, where core's
 * `paginate_links()` would write 1, a gap, 3, 4, 5, a gap, 20 (or list 2 and 6 too, at its default
 * `mid_size`), and up to 7 pages every page is listed where core would already write gaps.
 *
 * The contract package holds both sides to one table: `packages/ui/fixtures/pagination/page-window.json`
 * lists the items for every page count from 1 to 20 and every current page, the front end's
 * `pagination.test.ts` checks `pageWindow()` against it and `PaginationNumbersTest` checks this, so a
 * change to either side's windowing fails one of the two until the fixture, and the other side, follow.
 * {@see PaginationNumbers} applies it to core's pagination block on the collection pages.
 */
final class PageWindow {
	/**
	 * Up to this many pages, every page is listed: the front end's `MAX_LISTED`.
	 */
	public const MAX_LISTED = 7;

	/**
	 * Pages shown either side of the current one in a windowed list: the front end's `AROUND`.
	 */
	public const AROUND = 1;

	/**
	 * The page numbers to list for page `$current` of `$total`, in order, with `null` for each gap.
	 *
	 * @param int $current The current page, 1 or more.
	 * @param int $total   The page count, 1 or more.
	 * @return array<int, int|null>
	 * @throws RangeException When `$total` is less than 1 or `$current` is not within `1..$total`: a listing with no pages shows no pagination and never asks.
	 */
	public static function items( int $current, int $total ): array {
		if ( $total < 1 ) {
			throw new RangeException( esc_html( "Not a page count: {$total}" ) );
		}

		if ( $current < 1 || $current > $total ) {
			throw new RangeException( esc_html( "Page {$current} is not within 1..{$total}" ) );
		}

		if ( $total <= self::MAX_LISTED ) {
			return range( 1, $total );
		}

		$items = array( 1 );
		$start = max( 2, $current - self::AROUND );
		$end   = min( $total - 1, $current + self::AROUND );

		if ( $start > 2 ) {
			// A gap of one page is that page, not an ellipsis.
			$items[] = 3 === $start ? 2 : null;
		}

		for ( $page = $start; $page <= $end; $page++ ) {
			$items[] = $page;
		}

		if ( $end < $total - 1 ) {
			$items[] = $end === $total - 2 ? $total - 1 : null;
		}

		$items[] = $total;

		return $items;
	}
}
