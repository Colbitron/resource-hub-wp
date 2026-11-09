<?php
/**
 * The front end's search URL on the CMS: `/search/`, and its pages.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

/**
 * Rewrite rules that put core's search at the front end's path, `/search/` (`packages/ui/README.md`,
 * "Public URL shape"), for the CMS theme's search template and its header's search form.
 *
 * Core's search is `/?s=…`, and that keeps working. The front end's is `/search/?q=…`, and the owner
 * chose full parity for logged-in previews, so the CMS answers the same path: `/search/`, with core's
 * query var, `s`, in the query string, and `/search/page/{n}/` for a later page, the form core's own
 * `get_pagenum_link()` gives a search under pretty permalinks. Two rules, at the top of the rules, each
 * mapping to `s` with no value: `WP::parse_request()` reads a query var from the request's query string
 * before the matched rule's, so `/search/?s=foo` searches for `foo`, and `/search/` alone sets an empty
 * `s`, which `WP_Query` still reads as a search (`isset( $this->query['s'] )`), so the search template
 * renders with its form alone, the front end's state for `/search/` with no `q`
 * ({@see SearchRequest::NONE}; {@see MainSearchQuery} keeps that query from listing every post). The
 * rules sit above core's own `search/(.+)/?$`, which would read `page/2` as the query.
 *
 * What differs from the front end, for editors only (anonymous visitors get the lockdown's 404 here as
 * everywhere, ADR 0031): the query var is `s`, not `q`, because every part of core's search (the query,
 * `get_search_query()`, Relevanssi's main-query hook) reads `s`, and a second name for it would be a
 * mapping to maintain; a later page is `/search/page/{n}/?s=…`, core's form, where the front end's is
 * `?q=…&page=n`; and core's own `/search/{words}/` still answers, as it does on every WordPress site.
 * None of this changes the contract's URL rules: `/search/` stays the front end's path and `search` a
 * reserved page slug. Under plain permalinks there are no rules, and `/?s=…` is the search's URL, as on
 * the tests site.
 *
 * No flush here, as for {@see \ResourceHub\Collections\Routes}: `Plugin::activate()` deletes the stored
 * rules, and the deploy runs `wp rewrite flush`.
 */
final class SearchPath {
	/**
	 * The path segment, the front end's `SEARCH_PATH` without its slashes and core's `$wp_rewrite->search_base`.
	 */
	public const BASE = 'search';

	/**
	 * Hooks the rules onto `init`, after core's own have registered.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'add_rules' ), 20 );
	}

	/**
	 * Adds the two rules at the top of the rewrite rules.
	 */
	public function add_rules(): void {
		foreach ( self::rules() as $pattern => $query ) {
			add_rewrite_rule( $pattern, $query, 'top' );
		}
	}

	/**
	 * The rules: each pattern with the query it rewrites to.
	 *
	 * @return array<string, string>
	 */
	public static function rules(): array {
		return array(
			self::BASE . '/?$'                  => 'index.php?s=',
			self::BASE . '/page/([0-9]{1,})/?$' => 'index.php?s=&paged=$matches[1]',
		);
	}
}
