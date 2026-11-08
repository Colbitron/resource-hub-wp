<?php
/**
 * A collection page's page numbers are the front end's, for every page count and current page.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Collections;

use RangeException;
use ResourceHub\Collections\PageWindow;
use WP_UnitTestCase;

/**
 * `PageWindow` is the front end's `pageWindow()`, held to the contract's table
 * (`packages/ui/fixtures/pagination/page-window.json`, which the front end's `pagination.test.ts` reads
 * too), and `PaginationNumbers` applies it to core's `query-pagination-numbers` block on a collection page,
 * so the numbers between Previous and Next are the ones the front end's `Pagination` lists, in core's own
 * markup, and nothing else core paginates changes.
 */
final class PaginationNumbersTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * The theme's pagination block over the main query, as `parts/collection.html` renders it.
	 */
	private const BLOCK = '<!-- wp:query {"queryId":0,"query":{"inherit":true}} --><div class="wp-block-query"><!-- wp:query-pagination {"className":"rh-pagination"} --><!-- wp:query-pagination-numbers /--><!-- /wp:query-pagination --></div><!-- /wp:query -->';

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
	 * `PageWindow::items()` is the fixture, case by case: every page count from 1 to 12 and every current page,
	 * with the front end's two constants.
	 */
	public function test_page_window_is_the_fixture(): void {
		$fixture = $this->fixture();

		$this->assertSame( PageWindow::MAX_LISTED, $fixture['maxListed'] );
		$this->assertSame( PageWindow::AROUND, $fixture['around'] );
		$this->assertCount( 78, $fixture['cases'], 'One case per (pages, current) pair for 1 to 12 pages.' );

		$seen = array();
		foreach ( $fixture['cases'] as $case ) {
			$this->assertSame( $case['items'], PageWindow::items( $case['current'], $case['pages'] ), "{$case['current']} of {$case['pages']}" );
			$seen[] = "{$case['pages']}:{$case['current']}";
		}

		for ( $pages = 1; $pages <= 12; $pages++ ) {
			for ( $current = 1; $current <= $pages; $current++ ) {
				$this->assertContains( "{$pages}:{$current}", $seen, "{$current} of {$pages} is in the fixture." );
			}
		}
	}

	/**
	 * Past the fixture, the front end's shape: a bounded length, strictly increasing numbers, the ends and the
	 * current page always listed, and a gap always standing for two pages or more.
	 */
	public function test_page_window_keeps_the_front_ends_shape(): void {
		for ( $total = 1; $total <= 40; $total++ ) {
			for ( $current = 1; $current <= $total; $current++ ) {
				$items = PageWindow::items( $current, $total );
				$label = "{$current} of {$total}";

				$this->assertLessThanOrEqual( 2 * PageWindow::AROUND + 5, count( $items ), $label );
				$this->assertContains( $current, $items, $label );
				$this->assertSame( 1, $items[0], $label );
				$this->assertSame( $total, $items[ count( $items ) - 1 ], $label );

				$numbers = array_values( array_filter( $items, 'is_int' ) );
				$listed  = count( $numbers );
				for ( $i = 1; $i < $listed; $i++ ) {
					$this->assertGreaterThan( $numbers[ $i - 1 ], $numbers[ $i ], $label );
				}

				foreach ( $items as $i => $item ) {
					if ( null === $item ) {
						$this->assertGreaterThan( 2, $items[ $i + 1 ] - $items[ $i - 1 ], "{$label}: a gap stands for at least two pages." );
					}
				}
			}
		}
	}

	/**
	 * A page outside the count, or no pages, is refused, as the front end's `RangeError`.
	 */
	public function test_page_window_refuses_a_page_outside_the_count(): void {
		foreach ( array( array( 0, 5 ), array( 6, 5 ), array( 1, 0 ), array( -1, 3 ) ) as list( $current, $total ) ) {
			try {
				PageWindow::items( $current, $total );
				$this->fail( "{$current} of {$total} was not refused." );
			} catch ( RangeException $e ) {
				$this->assertStringContainsString( (string) $total, $e->getMessage() );
			}
		}
	}

	/**
	 * On a collection page, core's numbers block lists the fixture's pages for every page count and current
	 * page, in core's markup: each page a `page-numbers` link to its path (the first page's the collection's
	 * own), the current one core's `aria-current` span, and each gap core's dots span.
	 */
	public function test_collection_numbers_are_the_front_ends(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->go_to( home_url( '/resources/' ) );
		$this->assertTrue( is_post_type_archive( 'resource' ) );

		foreach ( $this->fixture()['cases'] as $case ) {
			if ( $case['pages'] < 2 ) {
				continue;
			}

			$html  = $this->render_numbers( $case['pages'], $case['current'] );
			$label = "{$case['current']} of {$case['pages']}";

			$this->assertSame( $case['items'], $this->numbers_in( $html ), $label );
			$this->assertSame( 1, substr_count( $html, '<span aria-current="page" class="page-numbers current">' ), $label );
			$this->assertSame( count( array_filter( $case['items'], 'is_null' ) ), substr_count( $html, '<span class="page-numbers dots">&hellip;</span>' ), $label );

			foreach ( $case['items'] as $item ) {
				if ( null === $item || $item === $case['current'] ) {
					continue;
				}
				$href = 1 === $item ? home_url( '/resources/' ) : home_url( "/resources/page/{$item}/" );
				$this->assertStringContainsString( '<a class="page-numbers" href="' . esc_url( $href ) . '">', $html, "{$label}: page {$item}'s link" );
			}
		}

		// One page: core prints no numbers, as the front end's `Pagination` renders nothing for a single page.
		$this->assertStringNotContainsString( 'page-numbers', $this->render_numbers( 1, 1 ) );
	}

	/**
	 * The windowing applies on a type, a topic and a type within a topic too, with each page's link on
	 * the collection's own path.
	 */
	public function test_filtered_collections_are_windowed_too(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );

		foreach ( array( '/resources/ebook/', '/resources/topic/caching/', '/resources/ebook/topic/caching/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertFalse( is_404(), $path );

			$html = $this->render_numbers( 20, 4 );

			$this->assertSame( array( 1, 2, 3, 4, 5, null, 20 ), $this->numbers_in( $html ), $path );
			$this->assertStringContainsString( '<a class="page-numbers" href="' . esc_url( home_url( $path . 'page/20/' ) ) . '">', $html, $path );
			$this->assertStringContainsString( '<a class="page-numbers" href="' . esc_url( home_url( $path ) ) . '">', $html, "{$path}: page 1 is the collection's own path" );
		}
	}

	/**
	 * Off a collection the list is core's own: a page's request, with `paginate_links()`' default sizes,
	 * lists 2 and 6 around page 4 of 20 and a gap before 20, where a collection lists 1 to 5.
	 */
	public function test_off_a_collection_the_list_is_cores(): void {
		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );
		$this->assertTrue( is_page() );

		$html = $this->render_numbers( 20, 4 );

		$this->assertSame( array( 1, 2, 3, 4, 5, 6, null, 20 ), $this->numbers_in( $html ) );
	}

	/**
	 * A Query Loop of resources that does not inherit the main query keeps core's list, on a page and on a
	 * collection page alike: core's numbers block swaps the global `$wp_query` for the block's own query,
	 * which reads as a resource archive but is not the main query.
	 */
	public function test_a_resource_query_loop_of_its_own_keeps_cores_list(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		self::factory()->post->create_many( 19, array( 'post_type' => 'resource' ) );

		$block = '<!-- wp:query {"queryId":7,"query":{"inherit":false,"postType":"resource","perPage":1,"pages":0}} --><div class="wp-block-query"><!-- wp:query-pagination --><!-- wp:query-pagination-numbers /--><!-- /wp:query-pagination --></div><!-- /wp:query -->';
		$page  = get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) );

		foreach ( array( $page, home_url( '/resources/' ) ) as $url ) {
			$this->go_to( $url );
			$_GET['query-7-page'] = '4';

			$this->assertSame( array( 1, 2, 3, 4, 5, 6, null, 20 ), $this->numbers_in( do_blocks( $block ) ), $url );

			unset( $_GET['query-7-page'] );
		}
	}

	/**
	 * Only the numbers block's call is windowed: a `paginate_links()` with previous and next links, a list,
	 * or every page already shown, is left as core wrote it, even on a collection.
	 */
	public function test_other_paginate_links_calls_are_untouched(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->go_to( home_url( '/resources/' ) );

		$args = array(
			'total'   => 20,
			'current' => 4,
		);

		$numbers_block = array( 'prev_next' => false );
		$as_a_list     = array(
			'prev_next' => false,
			'type'      => 'list',
		);
		$every_page    = array(
			'prev_next' => false,
			'show_all'  => true,
		);

		$this->assertSame( array( 1, 2, 3, 4, 5, null, 20 ), $this->numbers_in( (string) paginate_links( $args + $numbers_block ) ), 'The numbers block\'s shape is windowed.' );
		$this->assertSame( array( 1, 2, 3, 4, 5, 6, null, 20 ), $this->numbers_in( (string) paginate_links( $args + array( 'prev_next' => true ) ) ), 'With previous and next, core\'s.' );
		$this->assertSame( array( 1, 2, 3, 4, 5, 6, null, 20 ), $this->numbers_in( (string) paginate_links( $args + $as_a_list ) ), 'A list, core\'s.' );
		$this->assertSame( range( 1, 20 ), $this->numbers_in( (string) paginate_links( $args + $every_page ) ), 'Every page, core\'s.' );
	}

	/**
	 * The contract's page-window table.
	 *
	 * @return array{maxListed: int, around: int, cases: array<int, array{pages: int, current: int, items: array<int, int|null>}>}
	 */
	private function fixture(): array {
		$file = dirname( __DIR__, 6 ) . '/packages/ui/fixtures/pagination/page-window.json';
		$this->assertFileIsReadable( $file, 'packages/ui is not mounted: run `pnpm env:start` after a change to .wp-env.json.' );

		$fixture = json_decode( (string) file_get_contents( $file ), true ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- The contract's fixture, read by a test.
		$this->assertIsArray( $fixture );

		return $fixture;
	}

	/**
	 * The theme's pagination block rendered over the current request with this many pages at this page.
	 *
	 * @param int $pages   The page count the main query reports.
	 * @param int $current The current page.
	 */
	private function render_numbers( int $pages, int $current ): string {
		$GLOBALS['wp_query']->max_num_pages = $pages;
		set_query_var( 'paged', $current );

		return do_blocks( self::BLOCK );
	}

	/**
	 * The page numbers in a `paginate_links()` output, in order, `null` for each dots span.
	 *
	 * @param string $html The rendered links.
	 * @return array<int, int|null>
	 */
	private function numbers_in( string $html ): array {
		preg_match_all( '/<(a|span)\b[^>]*class="page-numbers( current| dots)?"[^>]*>(.*?)<\/\1>/s', $html, $matches, PREG_SET_ORDER );

		return array_map(
			static fn ( array $link ): ?int => ' dots' === $link[2] ? null : (int) trim( wp_strip_all_tags( $link[3] ) ),
			$matches
		);
	}
}
