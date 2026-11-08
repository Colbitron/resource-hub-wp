<?php
/**
 * The collection pages' main query, the lead, and the lead's effect on the list.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Collections;

use ResourceHub\Collections\Collection;
use ResourceHub\Collections\Lead;
use ResourceHub\ContentModel\Taxonomies;
use WP_UnitTestCase;

/**
 * `Collection` reads the request, `Lead` picks the front end's lead, and `CollectionQuery` paginates and lists as
 * the front end's `ListingPage` does, through the theme's collection part.
 */
final class CollectionQueryTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * Pretty permalinks with the rules, and an editor.
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
	 * The collection each request is read as: its terms, its page and its count; null for anything else.
	 */
	public function test_collection_reads_the_request(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->resource( 'B', 'webinar', array( 'caching' ) );

		$this->go_to( home_url( '/resources/' ) );
		$library = Collection::current();
		$this->assertNotNull( $library );
		$this->assertNull( $library->type );
		$this->assertNull( $library->topic );
		$this->assertSame( 1, $library->page );
		$this->assertSame( 2, $library->total );
		$this->assertTrue( $library->is_library_front() );

		$this->go_to( home_url( '/resources/ebook/topic/caching/' ) );
		$both = Collection::current();
		$this->assertSame( 'ebook', $both->type->slug );
		$this->assertSame( 'caching', $both->topic->slug );
		$this->assertSame( 1, $both->total );
		$this->assertFalse( $both->is_library_front() );

		$this->go_to( get_permalink( $this->resource( 'Single', 'ebook', array( 'caching' ) ) ) );
		$this->assertNull( Collection::current(), 'A single resource is not a collection.' );

		$this->go_to( home_url( '/' ) );
		$this->assertNull( Collection::current(), 'The front page is not a collection.' );

		$this->go_to( home_url( '/resources/feed/' ) );
		$this->assertNull( Collection::current(), 'A feed is not a collection.' );

		wp_set_current_user( 0 );
		$this->go_to( home_url( '/resources/' ) );
		$this->assertNull( Collection::current(), "An anonymous visitor's 404 is not a collection." );
	}

	/**
	 * Twelve to a page on the library, a type and a topic; Settings > Reading's count elsewhere.
	 */
	public function test_twelve_to_a_page(): void {
		update_option( 'posts_per_page', 5 );
		for ( $i = 1; $i <= 13; $i++ ) {
			$this->resource( "Resource {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}

		foreach ( array( '/resources/', '/resources/ebook/', '/resources/topic/caching/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertSame( 12, $GLOBALS['wp_query']->post_count, $path );
			$this->assertSame( 2, $GLOBALS['wp_query']->max_num_pages, $path );
		}

		self::factory()->post->create_many( 7 );
		$this->go_to( home_url( '/?s=' ) );
		$this->assertSame( 5, $GLOBALS['wp_query']->post_count, 'Another archive keeps the option.' );
	}

	/**
	 * An editor's collection lists published resources only, as the front end does: a private one is not counted, not given a row, and does not keep the empty state away.
	 */
	public function test_private_resources_are_left_out_for_an_editor(): void {
		$this->resource( 'Published', 'ebook', array( 'caching' ) );
		$private = $this->resource( 'Private ebook', 'ebook', array( 'caching' ), '2026-11-02 09:30:00' );
		$alone   = $this->resource( 'Private webinar', 'webinar', array( 'testing' ) );
		foreach ( array( $private, $alone ) as $id ) {
			wp_update_post(
				array(
					'ID'          => $id,
					'post_status' => 'private',
				)
			);
		}
		$this->assertTrue( current_user_can( 'read_private_posts' ), 'An editor may read private posts, so core would list them.' );

		$this->go_to( home_url( '/resources/ebook/' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->found_posts );
		$html = $this->render_collection_part();
		$this->assertStringContainsString( '<p class="rh-listing__count">1 resource</p>', $html );
		$this->assertSame( 1, substr_count( $html, '<li class="wp-block-post' ), 'One row, the published resource\'s.' );
		$this->assertStringNotContainsString( 'status-private', $html );
		$this->assertStringNotContainsString( 'Private ebook', $html );

		foreach ( array( '/resources/webinar/', '/resources/topic/testing/', '/resources/webinar/topic/testing/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertFalse( is_404(), $path );
			$this->assertSame( 0, $GLOBALS['wp_query']->found_posts, $path );
			$html = $this->render_collection_part();
			$this->assertStringNotContainsString( 'rh-listing__count', $html, "{$path} has no count." );
			$this->assertStringNotContainsString( '<li class="wp-block-post', $html, "{$path} has no rows." );
			$this->assertStringContainsString( '<div class="rh-listing__empty">', $html, "{$path} shows the empty state." );
		}
	}

	/**
	 * The lead is the newest featured resource with exactly one type, on the library's first page only.
	 */
	public function test_lead_is_the_newest_featured_resource_with_one_type(): void {
		$older  = $this->resource( 'Older featured', 'ebook', array( 'caching' ), '2026-10-01 09:00:00' );
		$newest = $this->resource( 'Newest featured', 'ebook', array( 'caching' ), '2026-10-03 09:00:00' );
		$this->resource( 'Newest of all, not featured', 'ebook', array( 'caching' ), '2026-10-04 09:00:00' );
		$two = $this->resource( 'Two types, featured, newer', 'ebook', array( 'caching' ), '2026-10-05 09:00:00' );
		wp_set_object_terms( $two, array( $this->term( Taxonomies::TYPE, 'ebook' )->term_id, $this->term( Taxonomies::TYPE, 'webinar' )->term_id ), Taxonomies::TYPE );
		$this->feature( $older );
		$this->feature( $newest );
		$this->feature( $two );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( $newest, Lead::current()?->ID );

		foreach ( array( '/resources/ebook/', '/resources/topic/caching/', '/resources/ebook/topic/caching/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertNull( Lead::current(), "{$path} has no lead: a filtered listing answers the filter." );
		}
	}

	/**
	 * A later page of the library has no lead, and no lead means nothing: no flag, or nothing flagged.
	 */
	public function test_no_lead_without_a_featured_resource_or_on_a_later_page(): void {
		$ids = array();
		for ( $i = 1; $i <= 13; $i++ ) {
			$ids[ $i ] = $this->resource( "Resource {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}

		$this->go_to( home_url( '/resources/' ) );
		$this->assertNull( Lead::current(), 'Nothing is featured.' );
		$this->assertSame( 12, $GLOBALS['wp_query']->post_count );

		$html = $this->render_collection_part();
		$this->assertStringNotContainsString( 'rh-listing__lead', $html );
		$this->assertStringNotContainsString( 'rh-listing__latest', $html );
		$this->assertStringNotContainsString( '>Latest<', $html );
		$this->assertSame( 12, substr_count( $html, '<h2 class="rh-card__title">' ), 'Without a lead the rows sit under the h1 as h2s.' );

		$this->feature( $ids[13] );
		$this->go_to( home_url( '/resources/page/2/' ) );
		$this->assertNull( Lead::current(), 'A later page is not the front.' );
	}

	/**
	 * On the library's first page the lead's row is dropped, the count and the pages stay, the list is headed "Latest" and its rows are h3s.
	 */
	public function test_lead_leaves_the_rows_under_it(): void {
		$ids = array();
		for ( $i = 1; $i <= 13; $i++ ) {
			$ids[ $i ] = $this->resource( "Resource {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}
		$this->feature( $ids[13] );

		$this->go_to( home_url( '/resources/' ) );
		$query = $GLOBALS['wp_query'];
		$this->assertSame( $ids[13], Lead::current()?->ID );
		$this->assertSame( 13, $query->found_posts, 'The count stays the CMS\'s.' );
		$this->assertSame( 2, $query->max_num_pages, 'The pages stay the CMS\'s.' );
		$this->assertSame( 11, $query->post_count, 'Eleven rows under the lead.' );
		$this->assertNotContains( $ids[13], wp_list_pluck( $query->posts, 'ID' ) );

		$html = $this->render_collection_part();
		$this->assertSame( 1, substr_count( $html, '<div class="rh-listing__lead">' ) );
		$this->assertSame( 1, substr_count( $html, '<h3 class="rh-lead__title"><a class="rh-lead__link" href="' . get_permalink( $ids[13] ) . '">Resource 13</a></h3>' ) );
		$this->assertMatchesRegularExpression( '/<div class="wp-block-query[^"]*rh-listing__latest[^"]*"><h2 class="rh-listing__section">Latest<\/h2>/', $html, 'The query block takes the list\'s class and the heading as its first child.' );
		$this->assertSame( 11, substr_count( $html, '<h3 class="rh-card__title">' ), 'Each row one level down.' );
		$this->assertSame( 0, substr_count( $html, '<h2 class="rh-card__title">' ) );
		$this->assertSame( 1, substr_count( $html, 'href="' . get_permalink( $ids[13] ) . '"' ), 'The lead is linked once on the page.' );
		$this->assertStringContainsString( 'rh-pagination', $html );
		$this->assertStringNotContainsString( 'rh-listing__empty', $html );
	}

	/**
	 * A lead whose own place is on a later page appears there as a row, and that page keeps twelve.
	 */
	public function test_a_lead_from_a_later_page_stays_a_row_there(): void {
		$ids = array();
		for ( $i = 1; $i <= 13; $i++ ) {
			$ids[ $i ] = $this->resource( "Resource {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}
		$this->feature( $ids[1] );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( $ids[1], Lead::current()?->ID );
		$this->assertSame( 12, $GLOBALS['wp_query']->post_count, 'Nothing on page 1 is the lead, so twelve rows.' );

		$this->go_to( home_url( '/resources/page/2/' ) );
		$this->assertContains( $ids[1], wp_list_pluck( $GLOBALS['wp_query']->posts, 'ID' ) );
		$html = $this->render_collection_part();
		$this->assertStringNotContainsString( 'rh-lead', $html );
		$this->assertSame( 1, substr_count( $html, '<h2 class="rh-card__title">' ) );
	}

	/**
	 * When the lead is the library's only resource there is no list, no "Latest" and no empty state beside it.
	 */
	public function test_a_lead_alone_has_no_list_and_no_empty_state(): void {
		$this->feature( $this->resource( 'Only one', 'ebook', array( 'caching' ) ) );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( 0, $GLOBALS['wp_query']->post_count );
		$this->assertFalse( is_404(), 'Core found a post; the filter only hid its row.' );

		$html = $this->render_collection_part();
		$this->assertSame( 1, substr_count( $html, '<div class="rh-listing__lead">' ) );
		$this->assertStringNotContainsString( '>Latest<', $html );
		$this->assertStringNotContainsString( 'rh-listing__latest', $html );
		$this->assertStringNotContainsString( 'rh-listing__empty', $html );
	}

	/**
	 * A query block of its own, not inheriting the main query, is left alone on a page with a lead.
	 */
	public function test_a_custom_query_is_untouched(): void {
		$this->feature( $this->resource( 'Featured', 'ebook', array( 'caching' ) ) );
		$this->resource( 'Other', 'ebook', array( 'caching' ), '2026-09-01 09:00:00' );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertNotNull( Lead::current() );

		$html = do_blocks(
			'<!-- wp:query {"queryId":1,"query":{"postType":"resource","perPage":10,"inherit":false}} -->'
			. '<div class="wp-block-query"><!-- wp:post-template {"className":"rh-card-grid"} -->'
			. '<!-- wp:resource-hub/resource-card /-->'
			. '<!-- /wp:post-template --></div><!-- /wp:query -->'
		);

		$this->assertStringNotContainsString( 'rh-listing__latest', $html );
		$this->assertStringNotContainsString( '>Latest<', $html );
		$this->assertSame( 2, substr_count( $html, '<article class="rh-card">' ), 'Its own query lists the lead too.' );
		// The level is the page's: every row on the page that shows a lead is one level down.
		$this->assertSame( 2, substr_count( $html, '<h3 class="rh-card__title">' ) );
	}
}
