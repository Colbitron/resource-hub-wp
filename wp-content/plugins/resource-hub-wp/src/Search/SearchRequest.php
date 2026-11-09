<?php
/**
 * What a request to the CMS's search page asks for, read off the main query.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use ResourceHub\Rest\SearchRoute;
use WP_Query;

/**
 * The front end's `parseSearchRequest()` (`apps/web/lib/search-request.ts`) for the CMS theme's search
 * template: one kind per request, each rendered as one state by the plugin's search blocks.
 *
 * The front end's search page reads `q` and `page` from its query string and renders one of six states,
 * every one a 200. On the CMS the same page is core's search, `search.html`, over the main query: the
 * query is core's `s` and the page core's `paged`, which {@see SearchPath}'s rules and core's own set from
 * `/search/?s=…`, `/search/page/{n}/?s=…` and `/?s=…`. This reads them into the front end's kinds:
 *
 * - `none`: no `s`, or one that is only whitespace. The form alone.
 * - `invalid`: an `s` that still holds a control character once normalised (Unicode's `Cc`), or that is
 *   not valid UTF-8, which the front end's strings cannot be. A sentence beside the form; no search.
 * - `too-short`, `too-long`: an `s` under {@see SearchRoute::MIN_QUERY_LENGTH} or over
 *   {@see SearchRoute::MAX_QUERY_LENGTH} code points once normalised, which the search route refuses with
 *   a 400 and the front end refuses without a request. A sentence beside the form; no search.
 * - `search`: a query to search for and a page from 1 to {@see SearchRoute::MAX_PAGE}.
 * - `no-such-page`: a valid query with a `paged` past {@see SearchRoute::MAX_PAGE}, which the route would
 *   refuse: the "no results on this page" state with a link to the first page, and no search. Core's
 *   `paged` is already a whole number, so the front end's rules for `02` or `1.5` have nothing to read.
 *
 * `input` is `s` as the reader typed it, so the form shows their words again, whitespace and all (with
 * its control characters removed in the `invalid` state, so the field never holds one); `query` is the
 * normalised form, {@see SearchRoute::normalize_query()}, the one the count line quotes and the first
 * page's link carries. The normalisation and the bounds are the route's, so what the CMS's page searches
 * for is what the front end's page would send.
 *
 * `from()` is null for any request that is not a search page: a collection, a single resource, a feed,
 * the 404 the lockdown gives an anonymous visitor (`Gate::empty_404()` clears the query's flags), so a
 * search block in another template renders nothing. {@see MainSearchQuery} shapes the main query from the
 * same object, and the `search-head` and `search-empty` blocks render from it.
 */
final class SearchRequest {
	public const NONE         = 'none';
	public const INVALID      = 'invalid';
	public const TOO_SHORT    = 'too-short';
	public const TOO_LONG     = 'too-long';
	public const SEARCH       = 'search';
	public const NO_SUCH_PAGE = 'no-such-page';

	/**
	 * A control character: Unicode's `Cc`, U+0000 to U+001F and U+007F to U+009F, the front end's `CONTROL`.
	 */
	private const CONTROL = '/\p{Cc}/u';

	/**
	 * Constructor.
	 *
	 * @param string $kind  One of the class constants.
	 * @param string $input The query as typed (control characters removed when `invalid`).
	 * @param string $query The normalised query; `''` when there is none to search for.
	 * @param int    $page  The page asked for, 1 or more.
	 */
	public function __construct(
		public readonly string $kind,
		public readonly string $input,
		public readonly string $query,
		public readonly int $page,
	) {
	}

	/**
	 * The request the main query asks for, or null when it is not a search page.
	 */
	public static function current(): ?self {
		$query = $GLOBALS['wp_query'] ?? null;

		return $query instanceof WP_Query ? self::from( $query ) : null;
	}

	/**
	 * The request `$query` asks for, or null when it is not a search page.
	 *
	 * @param WP_Query $query A query whose flags are set (`parse_query()` has run).
	 */
	public static function from( WP_Query $query ): ?self {
		if ( ! self::is_search_page( $query ) ) {
			return null;
		}

		$input = $query->get( 's' );

		return self::classify( is_string( $input ) ? $input : '', (int) $query->get( 'paged' ) );
	}

	/**
	 * Whether `$query` is a search page: core's search, as a page, not a feed or an embed, and not a 404.
	 *
	 * @param WP_Query $query A query whose flags are set.
	 */
	public static function is_search_page( WP_Query $query ): bool {
		return $query->is_search() && ! $query->is_404() && ! $query->is_feed() && ! $query->is_embed();
	}

	/**
	 * The kind, the input, the query and the page for an `s` and a `paged`, by the rules in the class comment.
	 *
	 * @param string $input The raw `s`.
	 * @param int    $paged Core's `paged`; 0 and 1 are the first page.
	 */
	public static function classify( string $input, int $paged ): self {
		$page       = max( 1, $paged );
		$normalised = SearchRoute::normalize_query( $input );

		if ( null === $normalised ) {
			return new self( self::INVALID, '', '', $page );
		}

		if ( '' === $normalised ) {
			return new self( self::NONE, $input, '', $page );
		}

		if ( 1 === preg_match( self::CONTROL, $normalised ) ) {
			return new self( self::INVALID, (string) preg_replace( self::CONTROL, '', $input ), '', $page );
		}

		$length = mb_strlen( $normalised, 'UTF-8' );

		if ( $length < SearchRoute::MIN_QUERY_LENGTH ) {
			return new self( self::TOO_SHORT, $input, '', $page );
		}

		if ( $length > SearchRoute::MAX_QUERY_LENGTH ) {
			return new self( self::TOO_LONG, $input, '', $page );
		}

		return new self( $page > SearchRoute::MAX_PAGE ? self::NO_SUCH_PAGE : self::SEARCH, $input, $normalised, $page );
	}

	/**
	 * Whether the request runs a search: only the `search` kind does; every other kind renders a sentence instead.
	 */
	public function searches(): bool {
		return self::SEARCH === $this->kind;
	}

	/**
	 * Whether the page shows a sentence about the query, which the form's field is described by: every kind but `none`.
	 */
	public function describes(): bool {
		return self::NONE !== $this->kind;
	}

	/**
	 * Whether the query cannot be searched as it is, which marks the field `aria-invalid`: a control character, too short or too long.
	 */
	public function invalid(): bool {
		return in_array( $this->kind, array( self::INVALID, self::TOO_SHORT, self::TOO_LONG ), true );
	}

	/**
	 * The CMS's URL of the first page of results for the query: `/search/?s=…`, the front end's `searchPath()` with core's query var.
	 *
	 * The value is written as `URLSearchParams` writes it on the front end (`application/x-www-form-urlencoded`:
	 * a space as `+`, `*`, `-`, `.` and `_` as they are, everything else percent-encoded), from
	 * `rawurlencode()`, which differs from it in those three characters alone, so the two sites' links to
	 * one search differ in the parameter's name alone (`packages/ui/README.md`, "Markup fixtures").
	 */
	public function first_page_url(): string {
		$value = strtr(
			rawurlencode( $this->query ),
			array(
				'%20' => '+',
				'%2A' => '*',
				'~'   => '%7E',
			)
		);

		return home_url( '/' . SearchPath::BASE . '/?s=' . $value );
	}

	/**
	 * The query as the page quotes it, `“query”`, the front end's `quoted()`.
	 */
	public function quoted(): string {
		return '“' . $this->query . '”';
	}
}
