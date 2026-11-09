<?php
/**
 * The `resource-hub/search-empty` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\Rest\SearchRoute;
use ResourceHub\Search\SearchRequest;
use WP_Query;

/**
 * The search page's sentence when it lists no rows, as the front end's `SearchPage` renders it, for a
 * `core/query-no-results` in the CMS theme's `search.html`.
 *
 * The front end shows one of its sentences in `rh-listing__empty` (`listing.css`) whenever the page
 * lists nothing, each from the request's kind ({@see SearchRequest}; `apps/web/components/SearchPage.tsx`):
 *
 * - `none`: nothing at all; the form stands alone.
 * - `invalid`: "Your search has a character that can’t be searched for. Try typing it again."
 * - `too-short`, `too-long`: "Enter at least 2 characters to search." or "Enter at most 100 characters
 *   to search.", the route's bounds.
 * - `no-such-page`: "There are no results on this page." and a link to the first page of results.
 * - `search` with nothing found: "No results for “q”." and "Try other words, or browse all resources.",
 *   the last a link to the library.
 * - `search` on a page past the last: "There are no results on page {n}." and, on a page after the
 *   first, the link to the first page. Here the count line above carries the message's `id`, so the
 *   sentence does not.
 *
 * In every kind but the last, the first sentence carries `id="rh-search-message"`, which the form's field
 * is described by (`SearchHeadBlock`). Core's no-results block renders its inner blocks whenever the main
 * query found nothing, which {@see \ResourceHub\Search\MainSearchQuery} arranges for every kind that runs
 * no search, so this block decides the sentence, or none; off a search page it renders nothing.
 *
 * The front end's sentences for a CMS without the route and for rows its reader refused have no
 * counterpart here. The links are the CMS's own: the library at `/resources/` and the first page at
 * `/search/?s=…`, the front end's paths on the CMS's origin with core's query var.
 *
 * - **No wrapper.** The output is the `<div class="rh-listing__empty">` alone, with no block wrapper
 *   attributes, so it is the front end's markup exactly.
 * - **Styles.** `block.json` lists the shared `resource-hub-tokens` handle alone; the empty state's rules
 *   are the package's `listing.css`, which the CMS theme enqueues on its search template (see
 *   {@see CollectionHeadBlock} for why the block names no theme handle).
 *
 * Registered from `build/search-empty/`, so without a build the block is not registered.
 */
final class SearchEmptyBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/search-empty';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/search-empty/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/search-empty';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the current search page's empty state, or nothing.
	 */
	public function render(): string {
		$request = SearchRequest::current();

		if ( null === $request ) {
			return '';
		}

		$query = $GLOBALS['wp_query'] ?? null;

		// Beside rows, nothing: the no-results block renders this only when the query found none, and a
		// render outside it (the editor's preview, a test) must not say the page is empty when it is not.
		if ( $query instanceof WP_Query && $query->post_count > 0 ) {
			return '';
		}

		return self::empty_state( $request, $query instanceof WP_Query ? max( 0, (int) $query->found_posts ) : 0 );
	}

	/**
	 * The empty state for `$request`, or nothing for the `none` kind.
	 *
	 * @param SearchRequest $request The request.
	 * @param int           $total   Matches across every page, when the request searches.
	 */
	public static function empty_state( SearchRequest $request, int $total ): string {
		$id = ' id="' . SearchHeadBlock::MESSAGE_ID . '"';

		switch ( $request->kind ) {
			case SearchRequest::NONE:
				return '';
			case SearchRequest::INVALID:
				return self::wrap( '<p' . $id . '>Your search has a character that can’t be searched for. Try typing it again.</p>' );
			case SearchRequest::TOO_SHORT:
				return self::wrap( '<p' . $id . '>Enter at least ' . SearchRoute::MIN_QUERY_LENGTH . ' characters to search.</p>' );
			case SearchRequest::TOO_LONG:
				return self::wrap( '<p' . $id . '>Enter at most ' . SearchRoute::MAX_QUERY_LENGTH . ' characters to search.</p>' );
			case SearchRequest::NO_SUCH_PAGE:
				return self::wrap( '<p' . $id . '>There are no results on this page.</p>' . self::first_page( $request ) );
		}

		if ( 0 === $total ) {
			return self::wrap(
				'<p' . $id . '>' . ResourceCardMarkup::text_html( 'No results for ' . $request->quoted() . '.' ) . '</p>'
				. '<p>Try other words, or <a href="' . esc_url( ResourceCardMarkup::listing_url( null, null ) ) . '">browse all resources</a>.</p>'
			);
		}

		return self::wrap( '<p>There are no results on page ' . $request->page . '.</p>' . ( $request->page > 1 ? self::first_page( $request ) : '' ) );
	}

	/**
	 * The link to the first page of results for the request's query.
	 *
	 * @param SearchRequest $request The request.
	 */
	private static function first_page( SearchRequest $request ): string {
		return '<p><a href="' . esc_url( $request->first_page_url() ) . '">Go to the first page of results</a></p>';
	}

	/**
	 * The sentences in the empty state's box.
	 *
	 * @param string $html The sentences.
	 */
	private static function wrap( string $html ): string {
		return '<div class="rh-listing__empty">' . $html . '</div>';
	}
}
