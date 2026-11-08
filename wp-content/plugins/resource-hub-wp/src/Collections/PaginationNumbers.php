<?php
/**
 * Core's pagination numbers on a collection page, windowed as the front end windows them.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Collections;

use WP_Query;

/**
 * Makes the page-number list core's `query-pagination-numbers` block writes on a collection page the
 * front end's list, through {@see PageWindow}.
 *
 * The CMS theme's collection part renders core's `core/query-pagination` block, whose numbers come from
 * `paginate_links()`. Core's windowing is a fixed `end_size` and `mid_size` (the block's default is
 * core's, 1 and 2): it writes a gap wherever a page is skipped, a gap of one page included, and never
 * lists every page past `2 * end_size + 2 * mid_size + 1` of them. The front end's `pageWindow()` lists
 * every page up to seven and, past that, never writes a gap for a single page, so no choice of the two
 * sizes reproduces its list for every page count and current page (20 pages at page 4 is 1, 2, 3, 4, 5, a
 * gap, 20 on the front end; core's shapes are 1, gap, 3, 4, 5, gap, 20 or 1, 2, 3, 4, 5, 6, gap, 20).
 *
 * So this filters `paginate_links_output`, core's filter on the finished list, while the global
 * `$wp_query` is the main query and a collection ({@see Collection::is_collection()}), for the call the
 * numbers block makes (`type` plain, no previous and next links, not already every page): it calls
 * `paginate_links()` again with the same arguments and `show_all`, so core builds every page's link
 * itself, its URL from the request's base, format and query arguments, its `paginate_links` filter, its
 * escaping, its "Page" screen-reader prefix and its `aria-current`; splits them on the newline core
 * joins them with, one per page; and keeps the pages `PageWindow::items()` names, with core's own
 * dots span (`<span class="page-numbers dots">&hellip;</span>`) at each gap. The markup stays core's,
 * so the theme's `assets/pagination.css` draws it unchanged and core's DOM stays the one accepted
 * difference from the front end's `Pagination`; only which numbers show between Previous and Next
 * changes. If core's list does not split into one entry per page (another `type`, or a page prefix
 * with a newline in it), the output is left as core wrote it. On a collection the numbers block's
 * `midSize` attribute is inert, because the front end's window decides which pages are listed.
 *
 * Both tests are needed: `is_collection()` alone is true of any query for resources, and for a Query
 * Loop that does not inherit the main query core's numbers block swaps the global `$wp_query` for the
 * block's own query while it calls `paginate_links()`. So off a collection (a page with a resource
 * Query Loop of its own, say) the list is core's, and so is a non-inheriting Query Loop's on a
 * collection page. In the editor and the REST API nothing paginates through this filter.
 */
final class PaginationNumbers {
	/**
	 * Core's gap, as `paginate_links()` writes it; the front end writes the same character, "…".
	 */
	private const DOTS = '<span class="page-numbers dots">&hellip;</span>';

	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'paginate_links_output', array( $this, 'window_the_numbers' ), 10, 2 );
	}

	/**
	 * Replaces core's windowing with the front end's on a collection page. Hooked to `paginate_links_output`.
	 *
	 * @param string|mixed $output Core's list of links, joined by newlines.
	 * @param array|mixed  $args   The arguments `paginate_links()` ran with, defaults filled in.
	 * @return string|mixed The windowed list, or `$output` as it came.
	 */
	public function window_the_numbers( $output, $args ) {
		if ( ! is_string( $output ) || ! is_array( $args ) || is_admin() ) {
			return $output;
		}

		if ( 'plain' !== ( $args['type'] ?? 'plain' ) || ! empty( $args['prev_next'] ) || ! empty( $args['show_all'] ) ) {
			return $output;
		}

		$query = $GLOBALS['wp_query'] ?? null;

		if ( ! $query instanceof WP_Query || ! $query->is_main_query() || ! Collection::is_collection( $query ) ) {
			return $output;
		}

		$total   = (int) ( $args['total'] ?? 0 );
		$current = (int) ( $args['current'] ?? 0 );

		if ( $total < 2 || $current < 1 || $current > $total ) {
			return $output;
		}

		// This call runs this filter again; the `show_all` guard above returns its output as it came, so there is no recursion.
		$all = paginate_links( array_merge( $args, array( 'show_all' => true ) ) );

		$links = is_string( $all ) ? explode( "\n", $all ) : array();

		if ( count( $links ) !== $total ) {
			return $output;
		}

		$items = array();

		foreach ( PageWindow::items( $current, $total ) as $item ) {
			$items[] = null === $item ? self::DOTS : $links[ $item - 1 ];
		}

		return implode( "\n", $items );
	}
}
