<?php
/**
 * Anonymous visitors get a 404 from every theme page, never a redirect (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Lockdown;

use WP;
use WP_Query;

/**
 * Turns an anonymous request for anything the theme would render into a 404.
 *
 * Hooked to `pre_handle_404` at priority 0. That filter runs inside `wp()`, right after the main
 * query and before `send_headers()`, the `wp` action and `template_redirect`, and it is where
 * WordPress decides a request's status: a callback that returns true owns the decision and core's
 * own `handle_404()` stands down. Deciding there means every conditional (`is_singular()`,
 * `is_feed()`, `is_robots()`) is already set, the headers have not gone out yet, `is_404()` is
 * true for everything that runs afterwards, and the canonical and old-slug redirects on
 * `template_redirect` meet a 404 that {@see NoRedirects} tells them to leave alone. Priority 0
 * puts the decision ahead of any plugin at the default priority.
 *
 * Only two things pass: a logged-in user, so editors keep their pages and previews, and a request
 * for `robots.txt` and nothing else, which has to stay reachable to say "disallow everything" (see
 * {@see self::is_robots_txt()}). A preview nonce is
 * bound to the user it was made for and verifies only in that user's session, so an authorised
 * preview is a logged-in request; `?preview=true` on its own exempts nothing. Everything else
 * that reaches this filter is a theme page: single posts and pages, archives, the front page,
 * feeds, core sitemaps, author, search and date pages, embeds, `?p=` and `?page_id=` queries,
 * and the favicon redirect. Requests that never reach it are untouched by construction: the REST
 * API answers from `parse_request` before this runs, and wp-admin, wp-login.php, wp-cron.php,
 * admin-ajax.php, admin-post.php and files the web server serves itself, uploads included, never
 * call `wp()` at all.
 *
 * The 404 is the one core sends for a path no rewrite rule matches. The main query is made a 404
 * that has found nothing, and the request is marked `error` 404 on the `WP` object, exactly as
 * `parse_request()` marks an unmatched path; `send_headers()` then sends the 404 status, the
 * no-cache headers and the HTML content type, and skips a feed's `Last-Modified`, `ETag` and
 * conditional 304, so the gate sends no header of its own. The template loader picks the theme's
 * 404 template.
 */
final class Gate {
	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'pre_handle_404', array( $this, 'lock' ), 0, 2 );
	}

	/**
	 * Makes the request a 404 for an anonymous visitor. Hooked to `pre_handle_404`.
	 *
	 * The first argument, whether an earlier callback already handled the request, is ignored on
	 * purpose: an anonymous visitor's theme page is a 404 whatever else is installed.
	 *
	 * @param mixed    $preempt Whether an earlier callback short-circuited the handling.
	 * @param WP_Query $query   The main query.
	 * @return mixed True once the request is a 404; `$preempt` unchanged when it passes.
	 */
	public function lock( $preempt, $query ) {
		if ( ! $query instanceof WP_Query || is_user_logged_in() ) {
			return $preempt;
		}

		// Registered before the robots.txt exemption too, so no anonymous request can be redirected.
		( new NoRedirects() )->register();

		if ( $this->is_robots_txt( $query ) ) {
			return $preempt;
		}

		$this->empty_404( $query );

		if ( isset( $GLOBALS['wp'] ) && $GLOBALS['wp'] instanceof WP ) {
			$GLOBALS['wp']->query_vars['error'] = '404';
		}

		$this->drop_head_links();

		return true;
	}

	/**
	 * Removes the head links that would advertise the feeds and the XML-RPC endpoint from the 404.
	 *
	 * Core prints the site and comment feed links, the extra feed links and the RSD link on every
	 * theme page, the 404 included, and the feeds they point to are themselves 404s here. Only this
	 * request loses them; a logged-in user's pages keep them.
	 */
	private function drop_head_links(): void {
		remove_action( 'wp_head', 'feed_links', 2 );
		remove_action( 'wp_head', 'feed_links_extra', 3 );
		remove_action( 'wp_head', 'rsd_link' );
	}

	/**
	 * Whether the request asks for `robots.txt` and nothing else.
	 *
	 * `is_robots()` alone is not enough: `robots` is a public query var, so anyone can add
	 * `?robots=1` to a feed, sitemap or attachment URL, and the flag would then exempt that request.
	 * The test is on the main query's own arguments rather than the request path, because they are
	 * what WordPress acts on. Under pretty permalinks, core's rewrite rule turns `/robots.txt` into
	 * `robots=1` alone. Under plain permalinks, WordPress writes no rewrite rules for the web server,
	 * so `/robots.txt` never reaches WordPress and the web server answers it with its own 404; only
	 * `/?robots=1` reaches the query, again as `robots=1` alone. An unknown parameter such as
	 * `?utm_source=` never becomes a query var, while any public query var added to the request
	 * (`feed`, `sitemap`, `attachment_id`) does, and makes it a theme request like any other.
	 *
	 * @param WP_Query $query The main query.
	 */
	private function is_robots_txt( WP_Query $query ): bool {
		return $query->is_robots() && array( 'robots' ) === array_keys( (array) $query->query );
	}

	/**
	 * Makes the query a 404 that has found nothing.
	 *
	 * `set_404()` resets the query flags but keeps `is_feed`, never touches `is_embed`, and leaves
	 * the found posts, the current post and the queried object where they were, as `WP_Query::init()`
	 * would clear them. A feed or embed flag would pick that template over the theme's 404 page,
	 * and a template that loops would print what was found, so all of it is cleared.
	 *
	 * @param WP_Query $query The main query.
	 */
	private function empty_404( WP_Query $query ): void {
		$query->set_404();
		$query->is_feed  = false;
		$query->is_embed = false;

		$query->posts         = array();
		$query->post          = null;
		$query->post_count    = 0;
		$query->current_post  = -1;
		$query->found_posts   = 0;
		$query->max_num_pages = 0;
		unset( $query->queried_object, $query->queried_object_id );
	}
}
