<?php
/**
 * Tests for `ResourceHub\Search\SearchPath`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\Search\SearchPath;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_UnitTestCase;

/**
 * `/search/` and `/search/page/{n}/` reach core's main search query, with `s` from the query string, and
 * anonymous visitors get the lockdown's 404 there as everywhere.
 */
final class SearchPathTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * Pretty permalinks with the rules, and a subscriber, since the lockdown answers anonymous requests with a 404.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_pretty_permalinks();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
	}

	/**
	 * Back to plain permalinks.
	 */
	public function tear_down(): void {
		$this->use_plain_permalinks();
		parent::tear_down();
	}

	/**
	 * The two rules are in the regenerated rules, above core's own search rule.
	 */
	public function test_rules_are_added_at_the_top(): void {
		global $wp_rewrite;

		$rules = $wp_rewrite->wp_rewrite_rules();
		$keys  = array_keys( $rules );
		$core  = array_search( 'search/(.+)/?$', $keys, true );
		$this->assertNotFalse( $core, "Core's own search rule is there." );

		foreach ( SearchPath::rules() as $pattern => $query ) {
			$this->assertArrayHasKey( $pattern, $rules );
			$this->assertSame( $query, $rules[ $pattern ] );
			$this->assertLessThan( $core, array_search( $pattern, $keys, true ), "{$pattern} sits above core's search rule." );
		}

		$this->assertSame( 'index.php?s=', $rules['search/?$'] );
		$this->assertSame( 'index.php?s=&paged=$matches[1]', $rules['search/page/([0-9]{1,})/?$'] );
	}

	/**
	 * `/search/?s=…` is core's search for the query, as `/?s=…` is.
	 */
	public function test_search_path_with_a_query(): void {
		$this->resource( 'Caching basics', 'ebook', array( 'caching' ) );

		$this->go_to( home_url( '/search/?s=caching' ) );

		$this->assertFalse( is_404() );
		$this->assertTrue( is_search() );
		$this->assertSame( 'caching', get_query_var( 's' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count );

		$this->go_to( home_url( '/?s=caching' ) );
		$this->assertTrue( is_search() );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count );
	}

	/**
	 * `/search/` alone is a search for nothing: the template renders, with its form alone, as the front end's `/search/`.
	 */
	public function test_search_path_without_a_query_is_a_search(): void {
		self::factory()->post->create( array( 'post_type' => 'page' ) );

		$this->go_to( home_url( '/search/' ) );

		$this->assertFalse( is_404() );
		$this->assertTrue( is_search() );
		$this->assertSame( '', get_query_var( 's' ) );
	}

	/**
	 * `/search/page/{n}/?s=…` is page n of the search, the form core's pagination links take.
	 */
	public function test_search_path_later_page(): void {
		for ( $i = 1; $i <= 13; $i++ ) {
			$this->resource( "Caching {$i}", 'ebook', array( 'caching' ), gmdate( 'Y-m-d H:i:s', 1_700_000_000 + $i ) );
		}

		$this->go_to( home_url( '/search/page/2/?s=caching' ) );

		$this->assertFalse( is_404() );
		$this->assertTrue( is_search() );
		$this->assertTrue( is_paged() );
		$this->assertSame( 2, (int) get_query_var( 'paged' ) );
		$this->assertSame( 'caching', get_query_var( 's' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count, 'Twelve to a page: the thirteenth is alone on page two.' );
		$this->assertSame( get_pagenum_link( 2 ), home_url( '/search/page/2/?s=caching' ), "Core's own pagination link is the path the rule answers." );
	}

	/**
	 * An anonymous visitor gets the lockdown's 404 at every search URL.
	 */
	public function test_anonymous_visitor_gets_the_404(): void {
		wp_set_current_user( 0 );

		foreach ( array( '/search/', '/search/?s=caching', '/search/page/2/?s=caching', '/?s=caching' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertTrue( is_404(), $path );
			$this->assertFalse( is_search(), $path );
		}
	}
}
