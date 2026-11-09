<?php
/**
 * Tests for `ResourceHub\Search\SearchRequest`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\Rest\SearchRoute;
use ResourceHub\Search\SearchRequest;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_Query;
use WP_UnitTestCase;

/**
 * Each `s` and `paged` classifies as the front end's `parseSearchRequest()` classifies the same `q` and
 * `page` (`apps/web/test/search-request.test.ts`), and only a search page has a request at all.
 */
final class SearchRequestTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * Pretty permalinks with the rules, and an editor, since the lockdown answers anonymous requests with a 404.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_pretty_permalinks();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
	}

	/**
	 * Back to plain permalinks.
	 */
	public function tear_down(): void {
		$this->use_plain_permalinks();
		parent::tear_down();
	}

	/**
	 * The kinds, with the front end's cases.
	 *
	 * @return array<string, array{string, int, string, string, string, int}>
	 */
	public static function requests(): array {
		$long = str_repeat( 'a', SearchRoute::MAX_QUERY_LENGTH + 1 );

		return array(
			'no query'                  => array( '', 1, SearchRequest::NONE, '', '', 1 ),
			'only whitespace'           => array( "  \t ", 1, SearchRequest::NONE, "  \t ", '', 1 ),
			'one character'             => array( 'a', 1, SearchRequest::TOO_SHORT, 'a', '', 1 ),
			'one character padded'      => array( ' a ', 1, SearchRequest::TOO_SHORT, ' a ', '', 1 ),
			'two characters'            => array( 'ab', 1, SearchRequest::SEARCH, 'ab', 'ab', 1 ),
			'at the cap'                => array( str_repeat( 'a', SearchRoute::MAX_QUERY_LENGTH ), 1, SearchRequest::SEARCH, str_repeat( 'a', SearchRoute::MAX_QUERY_LENGTH ), str_repeat( 'a', SearchRoute::MAX_QUERY_LENGTH ), 1 ),
			'past the cap'              => array( $long, 1, SearchRequest::TOO_LONG, $long, '', 1 ),
			'a control character'       => array( "co\u{0}re", 1, SearchRequest::INVALID, 'core', '', 1 ),
			'a C1 control character'    => array( "co\u{9F}re", 1, SearchRequest::INVALID, 'core', '', 1 ),
			'NEL is whitespace to both' => array( "co\u{85}re", 1, SearchRequest::SEARCH, "co\u{85}re", 'co re', 1 ),
			'a line break collapses'    => array( "core\nvitals", 1, SearchRequest::SEARCH, "core\nvitals", 'core vitals', 1 ),
			'whitespace is collapsed'   => array( '  core   vitals ', 2, SearchRequest::SEARCH, '  core   vitals ', 'core vitals', 2 ),
			'page zero is the first'    => array( 'core', 0, SearchRequest::SEARCH, 'core', 'core', 1 ),
			'the last page'             => array( 'core', SearchRoute::MAX_PAGE, SearchRequest::SEARCH, 'core', 'core', SearchRoute::MAX_PAGE ),
			'past the last page'        => array( 'core', SearchRoute::MAX_PAGE + 1, SearchRequest::NO_SUCH_PAGE, 'core', 'core', SearchRoute::MAX_PAGE + 1 ),
			'a short query on a page'   => array( 'a', 3, SearchRequest::TOO_SHORT, 'a', '', 3 ),
			'code points, not bytes'    => array( 'ñ', 1, SearchRequest::TOO_SHORT, 'ñ', '', 1 ),
			'two code points'           => array( 'ñá', 1, SearchRequest::SEARCH, 'ñá', 'ñá', 1 ),
			'invalid UTF-8 is invalid'  => array( "\xff\xfe", 1, SearchRequest::INVALID, '', '', 1 ),
		);
	}

	/**
	 * `classify()` gives the front end's kind, input, query and page.
	 *
	 * @dataProvider requests
	 *
	 * @param string $s     The raw `s`.
	 * @param int    $paged Core's `paged`.
	 * @param string $kind  The expected kind.
	 * @param string $input The expected input.
	 * @param string $query The expected normalised query.
	 * @param int    $page  The expected page.
	 */
	public function test_classify( string $s, int $paged, string $kind, string $input, string $query, int $page ): void {
		$request = SearchRequest::classify( $s, $paged );

		$this->assertSame( $kind, $request->kind );
		$this->assertSame( $input, $request->input );
		$this->assertSame( $query, $request->query );
		$this->assertSame( $page, $request->page );
		$this->assertSame( SearchRequest::SEARCH === $kind, $request->searches() );
		$this->assertSame( SearchRequest::NONE !== $kind, $request->describes() );
		$this->assertSame( in_array( $kind, array( SearchRequest::INVALID, SearchRequest::TOO_SHORT, SearchRequest::TOO_LONG ), true ), $request->invalid() );
	}

	/**
	 * The search page's requests read off the main query: `/search/`, `/search/?s=`, a later page, and core's `/?s=`.
	 */
	public function test_from_the_main_query(): void {
		$this->go_to( home_url( '/search/' ) );
		$request = SearchRequest::current();
		$this->assertNotNull( $request );
		$this->assertSame( SearchRequest::NONE, $request->kind );

		$this->go_to( home_url( '/search/?s=core+vitals' ) );
		$request = SearchRequest::current();
		$this->assertSame( SearchRequest::SEARCH, $request->kind );
		$this->assertSame( 'core vitals', $request->query );
		$this->assertSame( 1, $request->page );

		$this->go_to( home_url( '/search/page/3/?s=core' ) );
		$request = SearchRequest::current();
		$this->assertSame( SearchRequest::SEARCH, $request->kind );
		$this->assertSame( 3, $request->page );

		$this->go_to( home_url( '/?s=a' ) );
		$this->assertSame( SearchRequest::TOO_SHORT, SearchRequest::current()->kind );
	}

	/**
	 * Nothing off a search page: a collection, a page, a feed, the anonymous 404.
	 */
	public function test_null_off_a_search_page(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertNull( SearchRequest::current() );

		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );
		$this->assertNull( SearchRequest::current() );

		$this->go_to( home_url( '/?s=core&feed=rss2' ) );
		$this->assertTrue( is_feed() );
		$this->assertNull( SearchRequest::current() );

		wp_set_current_user( 0 );
		$this->go_to( home_url( '/search/?s=core' ) );
		$this->assertTrue( is_404(), 'The lockdown answers an anonymous visitor with its 404.' );
		$this->assertNull( SearchRequest::current() );

		$this->assertNull( SearchRequest::from( new WP_Query( array( 'post_type' => 'page' ) ) ) );
	}

	/**
	 * The first page's URL is the CMS's `/search/?s=…`, encoded as the front end encodes `q`.
	 */
	public function test_first_page_url_and_quoted(): void {
		$request = SearchRequest::classify( ' core  vitals & more ', 2 );

		$this->assertSame( home_url( '/search/?s=core+vitals+%26+more' ), $request->first_page_url() );
		$this->assertSame( '“core vitals & more”', $request->quoted() );

		// Encoded as the browser writes a query-string value: the star, the hyphen, the dot and the underscore
		// kept, the tilde and everything else escaped.
		$this->assertSame( home_url( '/search/?s=a*b-c.d_e+%7E+%C3%B1+%2B%2F%3F%23' ), SearchRequest::classify( 'a*b-c.d_e ~ ñ +/?#', 1 )->first_page_url() );
	}
}
