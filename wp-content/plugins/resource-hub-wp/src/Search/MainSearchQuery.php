<?php
/**
 * The CMS's search page's main query, shaped as the search route's query.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use ResourceHub\Rest\SearchRoute;
use WP_Block;
use WP_Query;

/**
 * Makes core's main search query, which the CMS theme's `search.html` renders through `core/query` with
 * `inherit`, answer as the search route answers the front end (`SearchRoute`), so a logged-in preview of a
 * search lists what the site's search page lists.
 *
 * - **The route's scope.** On `pre_get_posts` the main search query takes {@see SearchRoute::scope()}:
 *   published resources and pages with no password, never the posts page, twelve to a page. Core's own
 *   search would also list posts, and private posts for a user who may read them, at Settings > Reading's
 *   count. Relevanssi answers the main query without being asked, as it answers the route's query with
 *   `'relevanssi' => true`, and reads the same vars.
 * - **No search for a request that is not one.** For every {@see SearchRequest} kind but `search` (no
 *   query, a control character, too short, too long, a page past the route's last), the front end makes
 *   no request and shows a sentence. Here `posts_pre_query` answers the main query with no posts before
 *   any SQL runs, and Relevanssi is told not to search either (`relevanssi_search_ok`), so the
 *   `query-no-results` block renders and the `search-empty` block writes the sentence. Without this an
 *   empty `s` lists every post, since `WP_Query` searches for nothing and finds everything.
 * - **The count and the pages on a later page.** The front end's summary says the true total on every
 *   page and its pagination lists at most {@see SearchRoute::MAX_PAGE} pages. Core leaves `found_posts`
 *   at 0 on a page past the last, so on `the_posts` an empty later page gets its count from the route's
 *   own one-row query ({@see SearchRoute::total()}), and every page's `max_num_pages` is capped at the
 *   route's, so the `search-head` block's count line and core's pagination say what the front end's do.
 *   Pages past the cap are the `no-such-page` kind above, not a 404, as on the front end.
 * - **Never a 404.** The front end's search page answers every state with a 200, a page past the last
 *   included. Core answers a paged query that found nothing with a 404 (`WP::handle_404()`), so the
 *   `pre_handle_404` filter keeps the main search query from it, after the lockdown has had its say
 *   (ADR 0031: an anonymous visitor's request is already the lockdown's 404 by then), and the
 *   `search-empty` block says there are no results on that page instead. The front end draws no
 *   pagination on such a page, whose number is in no list of pages, so the inheriting
 *   `core/query-pagination` block renders nothing there either (`render_block_core/query-pagination`);
 *   core alone would draw a Previous link and the numbers with no current page.
 *
 * Nothing here touches a query that is not the main one, the admin's, or a search inside a `core/query`
 * of its own, and the search route's query is untouched: it is never the main query.
 */
final class MainSearchQuery {
	/**
	 * Before Relevanssi's own `posts_pre_query` callback (priority 10), which does not read the posts handed to it.
	 */
	private const BEFORE_RELEVANSSI = 5;

	/**
	 * Hooks the effects.
	 */
	public function register(): void {
		add_action( 'pre_get_posts', array( $this, 'set_scope' ) );
		add_filter( 'posts_pre_query', array( $this, 'answer_without_a_search' ), self::BEFORE_RELEVANSSI, 2 );
		add_filter( 'relevanssi_search_ok', array( $this, 'relevanssi_search_ok' ), 10, 2 );
		add_filter( 'the_posts', array( $this, 'count_and_cap' ), 10, 2 );
		add_filter( 'pre_handle_404', array( $this, 'never_a_404' ), 1, 2 );
		add_filter( 'render_block_core/query-pagination', array( $this, 'no_pagination_past_the_last_page' ), 10, 3 );
	}

	/**
	 * The route's scope on the main search query. Hooked to `pre_get_posts`.
	 *
	 * @param WP_Query $query The query being set up.
	 */
	public function set_scope( WP_Query $query ): void {
		if ( is_admin() || ! $query->is_main_query() || ! SearchRequest::is_search_page( $query ) ) {
			return;
		}

		foreach ( SearchRoute::scope() as $var => $value ) {
			$query->set( $var, $value );
		}
	}

	/**
	 * No posts, and no SQL, for a request that is not a search. Hooked to `posts_pre_query`.
	 *
	 * @param array|null $posts Posts another filter supplied, or null.
	 * @param WP_Query   $query The query.
	 * @return array|null An empty list for a request that is not a search; `$posts` otherwise.
	 */
	public function answer_without_a_search( $posts, WP_Query $query ) {
		return self::answers_without_a_search( $query ) ? array() : $posts;
	}

	/**
	 * Keeps Relevanssi from searching for a request that is not a search. Hooked to `relevanssi_search_ok`.
	 *
	 * @param mixed $ok    Whether Relevanssi may search.
	 * @param mixed $query The query.
	 * @return mixed False for such a request; `$ok` otherwise.
	 */
	public function relevanssi_search_ok( $ok, $query ) {
		return $query instanceof WP_Query && self::answers_without_a_search( $query ) ? false : $ok;
	}

	/**
	 * The true count on an empty later page, and the pages capped at the route's. Hooked to `the_posts`.
	 *
	 * @param mixed    $posts The page's posts.
	 * @param WP_Query $query The query that found them.
	 * @return mixed The posts, unchanged.
	 */
	public function count_and_cap( $posts, WP_Query $query ) {
		if ( ! self::applies( $query ) ) {
			return $posts;
		}

		$request = SearchRequest::from( $query );

		if ( null === $request || ! $request->searches() ) {
			return $posts;
		}

		if ( is_array( $posts ) && array() === $posts && $request->page > 1 ) {
			$query->found_posts = SearchRoute::total( $query, self::args( $request ) );
		}

		$query->max_num_pages = min( (int) ceil( (int) $query->found_posts / SearchRoute::PER_PAGE ), SearchRoute::MAX_PAGE );

		return $posts;
	}

	/**
	 * A search page is never a 404, as on the front end: a paged search that found nothing stays a 200 with
	 * the `search-empty` block's sentence. Hooked to `pre_handle_404` at priority 1, after the lockdown.
	 *
	 * @param mixed    $preempt Whether an earlier callback already handled the request.
	 * @param WP_Query $query   The main query.
	 * @return mixed True to keep core from its 404 on a search page; `$preempt` unchanged otherwise.
	 */
	public function never_a_404( $preempt, $query ) {
		if ( false !== $preempt || ! $query instanceof WP_Query || ! self::applies( $query ) ) {
			return $preempt;
		}

		return true;
	}

	/**
	 * No pagination on a search page past the last, as the front end draws none there. Hooked to
	 * `render_block_core/query-pagination`, for a block that inherits the main query.
	 *
	 * @param string|mixed         $content  The block's rendered markup.
	 * @param array<string, mixed> $block    The parsed block.
	 * @param mixed                $instance The block instance, whose context says whether its query inherits the main one.
	 * @return string|mixed Nothing past the last page; `$content` otherwise.
	 */
	public function no_pagination_past_the_last_page( $content, array $block, $instance = null ) {
		$query = $GLOBALS['wp_query'] ?? null;

		if ( ! $query instanceof WP_Query || ! self::applies( $query ) || ! $instance instanceof WP_Block || empty( $instance->context['query']['inherit'] ) ) {
			return $content;
		}

		$request = SearchRequest::from( $query );

		return null !== $request && $request->page > (int) $query->max_num_pages ? '' : $content;
	}

	/**
	 * Whether `$query` is the main search query on the CMS's own pages.
	 *
	 * @param WP_Query $query A query whose flags are set.
	 */
	private static function applies( WP_Query $query ): bool {
		return ! is_admin() && $query->is_main_query() && SearchRequest::is_search_page( $query );
	}

	/**
	 * Whether `$query` is the main search query for a request that runs no search.
	 *
	 * @param WP_Query $query A query whose flags are set.
	 */
	private static function answers_without_a_search( WP_Query $query ): bool {
		if ( ! self::applies( $query ) ) {
			return false;
		}

		$request = SearchRequest::from( $query );

		return null !== $request && ! $request->searches();
	}

	/**
	 * The route's arguments for a request, as `SearchRoute::total()` reads them.
	 *
	 * @param SearchRequest $request A request of the `search` kind.
	 * @return array<string, mixed>
	 */
	private static function args( SearchRequest $request ): array {
		return array_merge(
			SearchRoute::scope(),
			array(
				's'                      => $request->query,
				'paged'                  => $request->page,
				'update_post_term_cache' => false,
				'update_post_meta_cache' => false,
				'ignore_sticky_posts'    => true,
				'relevanssi'             => true,
			)
		);
	}
}
