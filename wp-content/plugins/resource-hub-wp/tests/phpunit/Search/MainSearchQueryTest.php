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
	 * The theme's pagination block over the main query, as `search.html` renders it.
	 */
	private const PAGINATION = '<!-- wp:query {"queryId":0,"query":{"inherit":true}} --><div class="wp-block-query"><!-- wp:query-pagination {"className":"rh-pagination"} --><!-- wp:query-pagination-previous /--><!-- wp:query-pagination-numbers /--><!-- wp:query-pagination-next /--><!-- /wp:query-pagination --></div><!-- /wp:query -->';

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
			$this->assertSame( array(), $this->content_queries( $path ), "{$path} runs no content query." );

			$this->assertTrue( is_search(), $path );
			$this->assertFalse( is_404(), $path );
			$this->assertSame( array(), $GLOBALS['wp_query']->posts, $path );
			$this->assertSame( 0, (int) $GLOBALS['wp_query']->found_posts, $path );
			$this->assertSame( 0, (int) $GLOBALS['wp_query']->max_num_pages, $path );
		}
	}

	/**
	 * An anonymous visitor's search runs no content query at all, and still gets the lockdown's 404, the
	 * same 404 as at any other theme page: no posts, no count, no pages, the request marked `error` 404.
	 * The same search for a logged-in user runs one, so the recorder would see it.
	 */
	public function test_an_anonymous_search_runs_no_content_query(): void {
		$this->resource( self::WORD . ' guide', 'ebook', array( 'caching' ) );
		$this->post( 'page' );
		$this->assertNotSame( array(), $this->content_queries( '/search/?s=' . self::WORD ), 'Logged in, the search runs.' );

		wp_set_current_user( 0 );

		foreach ( array( '/search/?s=revalidation', '/search/?s=' . self::WORD, '/search/page/2/?s=' . self::WORD, '/?s=' . self::WORD ) as $path ) {
			$this->assertSame( array(), $this->content_queries( $path ), "{$path} runs no content query." );

			$query = $GLOBALS['wp_query'];
			$this->assertTrue( is_404(), $path );
			$this->assertFalse( is_search(), $path );
			$this->assertSame( array(), $query->posts, $path );
			$this->assertSame( 0, $query->post_count, $path );
			$this->assertSame( 0, (int) $query->found_posts, $path );
			$this->assertSame( 0, (int) $query->max_num_pages, $path );
			$this->assertSame( '404', $GLOBALS['wp']->query_vars['error'] ?? null, $path );
		}
	}

	/**
	 * A page past the last, within the cap, is a 200 with no posts and the true count, as the route answers
	 * it, and the theme's pagination block renders nothing there, as the front end's does not.
	 */
	public function test_an_empty_later_page_keeps_the_count_and_the_pages(): void {
		$this->resource( self::WORD . ' guide', 'ebook', array( 'caching' ) );
		$this->post( 'page' );

		$this->go_to( home_url( '/search/page/3/?s=' . self::WORD ) );

		$this->assertFalse( is_404() );
		$this->assertSame( array(), $GLOBALS['wp_query']->posts );
		$this->assertSame( 2, (int) $GLOBALS['wp_query']->found_posts );
		$this->assertSame( 1, (int) $GLOBALS['wp_query']->max_num_pages );
		$this->assertStringNotContainsString( 'wp-block-query-pagination', do_blocks( self::PAGINATION ), 'No pagination past the last page.' );

		// On a page that is listed, the block renders; a block over a query of its own is untouched.
		for ( $i = 1; $i <= SearchRoute::PER_PAGE; $i++ ) {
			$this->post( 'page', 'publish', '', (string) $i );
		}
		$this->go_to( home_url( '/search/page/2/?s=' . self::WORD ) );
		$this->assertStringContainsString( 'page-numbers', do_blocks( self::PAGINATION ) );
		$this->go_to( home_url( '/search/page/3/?s=' . self::WORD ) );
		$this->assertStringNotContainsString( 'wp-block-query-pagination', do_blocks( self::PAGINATION ) );
		$this->assertStringContainsString( 'page-numbers', do_blocks( str_replace( '"inherit":true', '"inherit":false,"postType":"page","perPage":2', self::PAGINATION ) ) );
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
	 * A search feed is not the search page: it keeps core's own scope, which lists a post.
	 */
	public function test_a_search_feed_keeps_cores_scope(): void {
		$post = $this->post( 'post' );

		$this->go_to( home_url( '/?s=' . self::WORD . '&feed=rss2' ) );

		$this->assertTrue( is_feed() );
		$this->assertNotSame( SearchRoute::TYPES, $GLOBALS['wp_query']->get( 'post_type' ) );
		$this->assertContains( $post, wp_list_pluck( $GLOBALS['wp_query']->posts, 'ID' ) );
	}

	/**
	 * The admin's main search query, as the posts list runs it, keeps its own scope: a draft and a
	 * private page are listed for an editor.
	 */
	public function test_an_admin_search_keeps_its_own_scope(): void {
		$draft   = $this->post( 'page', 'draft' );
		$private = $this->post( 'page', 'private' );
		set_current_screen( 'edit-page' );

		$query                   = new \WP_Query();
		$GLOBALS['wp_the_query'] = $query; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The test stands in for `wp_edit_posts_query()`, whose query is the main one.

		try {
			$query->query(
				array(
					's'           => self::WORD,
					'post_type'   => 'page',
					'post_status' => array( 'draft', 'private' ),
				)
			);

			$this->assertTrue( $query->is_main_query() && $query->is_search() );
			$this->assertSame( 'page', $query->get( 'post_type' ) );
			$this->assertEqualsCanonicalizing( array( $draft, $private ), wp_list_pluck( $query->posts, 'ID' ) );
		} finally {
			$GLOBALS['wp_the_query']   = $GLOBALS['wp_query']; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restores the main query.
			$GLOBALS['current_screen'] = null; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Leaves the admin.
		}
	}

	/**
	 * The SQL that reads content, posts or Relevanssi's index, while `$path` is asked for.
	 *
	 * @param string $path A path under the home URL.
	 * @return string[] The statements.
	 */
	private function content_queries( string $path ): array {
		global $wpdb;

		$seen    = array();
		$pattern = '/\b(?:' . preg_quote( $wpdb->posts, '/' ) . '\b|' . preg_quote( $wpdb->prefix . 'relevanssi', '/' ) . ')/';
		$record  = static function ( $sql ) use ( &$seen, $pattern ) {
			if ( is_string( $sql ) && preg_match( $pattern, $sql ) ) {
				$seen[] = $sql;
			}
			return $sql;
		};

		add_filter( 'query', $record );
		$this->go_to( home_url( $path ) );
		remove_filter( 'query', $record );

		return $seen;
	}

	/**
	 * A post whose title holds the word.
	 *
	 * @param string $type     Post type.
	 * @param string $status   Post status.
	 * @param string $password The post password, or '' for none.
	 * @param string $suffix   Something to make the title its own.
	 */
	private function post( string $type, string $status = 'publish', string $password = '', string $suffix = '' ): int {
		return self::factory()->post->create(
			array(
				'post_type'     => $type,
				'post_status'   => $status,
				'post_title'    => self::WORD . ' ' . $type . ' ' . $status . $suffix,
				'post_content'  => 'Body text.',
				'post_password' => $password,
			)
		);
	}
}
