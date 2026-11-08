<?php
/**
 * The posts page under a static front page is a 404 on the CMS, as on the front end.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Pages;

use WP_Query;

/**
 * Answers the posts page with a 404 while Settings > Reading names a static front page.
 *
 * The front end serves no posts listing: its page route answers the page `page_for_posts` names with
 * `null` while `show_on_front` is `page` ({@see PagePath::is_served()}, `packages/ui/README.md`, "A
 * page lookup is answered for the current state"), so that page's path is a 404 there. Core, given the
 * same request, reads it as the posts index (`is_home()`, `is_posts_page`) and the CMS theme rendered
 * `home.html`, the welcome page, for a logged-in user. Full parity means the CMS answers what the front
 * end answers, so the request is made the 404 core would send for a path that matched nothing, the
 * way {@see \ResourceHub\Collections\CollectionQuery::missing_term_is_404()} does for a type or topic
 * that names no term: on `pre_handle_404` at priority 1, after the lockdown's gate at 0 (ADR 0031)
 * has answered an anonymous visitor, so this only ever decides for a logged-in user, and standing
 * down when an earlier callback has already handled the request.
 *
 * The test is core's own flag, `is_posts_page`, which `WP_Query::parse_query()` sets only when
 * `show_on_front` is `page` and the request names the page `page_for_posts` names, by its path or by
 * `page_id`, so its later pages (`/page/2/`) and its feed are 404s too, and nothing else is touched:
 * `/` while the front page shows posts, or while a static front page is set with no page chosen, stays
 * the welcome on both sites, and the same page named by `page_for_posts` while `show_on_front` is
 * `posts` is an ordinary page on both.
 */
final class PostsPage {
	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'pre_handle_404', array( $this, 'is_404' ), 1, 2 );
	}

	/**
	 * The posts page under a static front page is a 404. Hooked to `pre_handle_404` at priority 1.
	 *
	 * @param mixed    $preempt Whether an earlier callback already handled the request.
	 * @param WP_Query $query   The main query.
	 * @return mixed True once the request is a 404; `$preempt` unchanged otherwise.
	 */
	public function is_404( $preempt, $query ) {
		if ( false !== $preempt || ! $query instanceof WP_Query || $query->is_404() || ! $query->is_posts_page ) {
			return $preempt;
		}

		// What core's `handle_404()` does for a path that matched nothing.
		$query->set_404();
		status_header( 404 );
		nocache_headers();

		return true;
	}
}
