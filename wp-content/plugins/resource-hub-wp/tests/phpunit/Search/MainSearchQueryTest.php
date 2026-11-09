<?php
/**
 * Tests for `ResourceHub\Search\MainSearchQuery`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\Rest\SearchRoute;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_UnitTestCase;

/**
 * The main search query lists what the search route lists, and lists nothing for a request that is
 * not a search; its count and its pages are the front end's on every page. Membership and counts are
 * asserted, never order, so the tests pass with Relevanssi answering the main query or core's search.
 */
final class MainSearchQueryTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * The word every searched post carries.
	 */
	private const WORD = 'quokka';

	/**
	 * Pretty permalinks with the rules, and an editor, who may read private posts, so the scope is what keeps them out.
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
	 * Published resources and pages with no password match, and nothing else, as on the route.
	 */
	public function test_main_search_query_has_the_routes_scope(): void {
		$resource = $this->resource( self::WORD . ' guide', 'ebook', array( 'caching' ) );
		$page     = $this->post( 'page' );
		$this->post( 'page', 'draft' );
		$this->post( 'page', 'private' );
		$this->post( 'page', 'publish', 'secret' );
		$this->post( 'post' );
		$posts_page = $this->post( 'page' );
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', self::factory()->post->create( array( 'post_type' => 'page' ) ) );
		update_option( 'page_for_posts', $posts_page );

		$this->go_to( home_url( '/search/?s=' . self::WORD ) );

		$query = $GLOBALS['wp_query'];
		$this->assertTrue( is_search() );
		$this->assertSame( SearchRoute::PER_PAGE, (int) $query->get( 'posts_per_page' ) );
		$this->assertSame( 'publish', $query->get( 'post_status' ) );
		$this->assertSame( SearchRoute::TYPES, $query->get( 'post_type' ) );
		$this->assertEqualsCanonicalizing( array( $resource, $page ), wp_list_pluck( $query->posts, 'ID' ) );
		$this->assertSame( 2, (int) $query->found_posts );
	}

	/**
	 * A request that is not a search finds nothing, and is not a 404: no query, one character, a control
	 * character, too long, a page past the route's last.
	 */
	public function test_requests_that_are_not_searches_find_nothing(): void {
		$this->resource( self::WORD . ' guide', 'ebook', array( 'caching' ) );
		$this->post( 'page' );

		foreach ( array( '/search/', '/search/?s=a', '/search/?s=' . rawurlencode( "qu\u{1}okka" ), '/search/?s=' . str_repeat( 'a', 101 ), '/search/page/11/?s=' . self::WORD ) as $path ) {
			$this->go_to( home_url( $path ) );

			$this->assertTrue( is_search(), $path );
			$this->assertFalse( is_404(), $path );
			$this->assertSame( array(), $GLOBALS['wp_query']->posts, $path );
			$this->assertSame( 0, (int) $GLOBALS['wp_query']->found_posts, $path );
			$this->assertSame( 0, (int) $GLOBALS['wp_query']->max_num_pages, $path );
		}
	}

	/**
	 * A page past the last, within the cap, is a 200 with no posts and the true count, as the route answers it.
	 */
	public function test_an_empty_later_page_keeps_the_count_and_the_pages(): void {
		$this->resource( self::WORD . ' guide', 'ebook', array( 'caching' ) );
		$this->post( 'page' );

		$this->go_to( home_url( '/search/page/3/?s=' . self::WORD ) );

		$this->assertFalse( is_404() );
		$this->assertSame( array(), $GLOBALS['wp_query']->posts );
		$this->assertSame( 2, (int) $GLOBALS['wp_query']->found_posts );
		$this->assertSame( 1, (int) $GLOBALS['wp_query']->max_num_pages );
	}

	/**
	 * The pages are capped at the route's ten, while the count says everything.
	 */
	public function test_pages_are_capped_at_the_routes_most(): void {
		$query = $GLOBALS['wp_query'];
		$query->init();
		$query->is_search = true;
		$query->is_main_query();
		$GLOBALS['wp_the_query'] = $query; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The test stands in for `WP::main()`, which sets the main query.
		$query->set( 's', self::WORD );
		$query->set( 'paged', 1 );
		$query->found_posts   = 130;
		$query->max_num_pages = 11;

		( new \ResourceHub\Search\MainSearchQuery() )->count_and_cap( array( get_post( $this->post( 'page' ) ) ), $query );

		$this->assertSame( 130, (int) $query->found_posts );
		$this->assertSame( SearchRoute::MAX_PAGE, (int) $query->max_num_pages );
	}

	/**
	 * A collection's main query and a query of its own are untouched.
	 */
	public function test_other_queries_are_untouched(): void {
		$this->resource( self::WORD . ' guide', 'ebook', array( 'caching' ) );
		$private = $this->post( 'page', 'private' );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count );

		$own = new \WP_Query(
			array(
				's'         => self::WORD,
				'post_type' => 'page',
			)
		);
		$this->assertContains( $private, wp_list_pluck( $own->posts, 'ID' ), 'A query of its own keeps its reader\'s private posts.' );
	}

	/**
	 * A post whose title holds the word.
	 *
	 * @param string $type     Post type.
	 * @param string $status   Post status.
	 * @param string $password The post password, or '' for none.
	 */
	private function post( string $type, string $status = 'publish', string $password = '' ): int {
		return self::factory()->post->create(
			array(
				'post_type'     => $type,
				'post_status'   => $status,
				'post_title'    => self::WORD . ' ' . $type . ' ' . $status,
				'post_content'  => 'Body text.',
				'post_password' => $password,
			)
		);
	}
}
