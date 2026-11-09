<?php
/**
 * The `resource-hub/search-empty` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\SearchEmptyBlock;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The sentence per request, the front end's wording, and where it renders nothing.
 */
final class SearchEmptyBlockTest extends WP_UnitTestCase {
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
	 * The compiled block.json: the callback, the no-results ancestor, no wrapper supports and the tokens alone.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( SearchEmptyBlock::NAME );

		$this->assertNotNull( $type, 'The block is not registered: run `pnpm build` so build/search-empty/block.json exists.' );
		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'core/query-no-results' ), $type->ancestor );
		$this->assertFalse( $type->supports['className'] );
		$this->assertSame( array( SharedTokens::HANDLE ), $type->style_handles );
	}

	/**
	 * The sentence per kind.
	 */
	public function test_sentence_per_kind(): void {
		$this->resource( 'Quokka guide', 'ebook', array( 'caching' ) );
		$first = '<p><a href="' . home_url( '/search/?s=quokka' ) . '">Go to the first page of results</a></p>';

		$this->go_to( home_url( '/search/' ) );
		$this->assertSame( '', $this->render_block( SearchEmptyBlock::NAME ), 'No query: the form stands alone.' );

		$this->go_to( home_url( '/search/?s=a' ) );
		$this->assertSame( '<div class="rh-listing__empty"><p id="rh-search-message">Enter at least 2 characters to search.</p></div>', $this->render_block( SearchEmptyBlock::NAME ) );

		$this->go_to( home_url( '/search/?s=' . str_repeat( 'a', 101 ) ) );
		$this->assertSame( '<div class="rh-listing__empty"><p id="rh-search-message">Enter at most 100 characters to search.</p></div>', $this->render_block( SearchEmptyBlock::NAME ) );

		$this->go_to( home_url( '/search/?s=' . rawurlencode( "qu\u{1}okka" ) ) );
		$this->assertSame( '<div class="rh-listing__empty"><p id="rh-search-message">Your search has a character that can’t be searched for. Try typing it again.</p></div>', $this->render_block( SearchEmptyBlock::NAME ) );

		$this->go_to( home_url( '/search/?s=zebra+%26+%22more%22' ) );
		$this->assertSame(
			'<div class="rh-listing__empty"><p id="rh-search-message">No results for “zebra &amp; &quot;more&quot;”.</p><p>Try other words, or <a href="' . home_url( '/resources/' ) . '">browse all resources</a>.</p></div>',
			$this->render_block( SearchEmptyBlock::NAME )
		);

		$this->go_to( home_url( '/search/page/3/?s=quokka' ) );
		$this->assertSame( '<div class="rh-listing__empty"><p>There are no results on page 3.</p>' . $first . '</div>', $this->render_block( SearchEmptyBlock::NAME ), 'The count line above carries the message id on a later page.' );

		$this->go_to( home_url( '/search/page/11/?s=quokka' ) );
		$this->assertSame( '<div class="rh-listing__empty"><p id="rh-search-message">There are no results on this page.</p>' . $first . '</div>', $this->render_block( SearchEmptyBlock::NAME ) );
	}

	/**
	 * Nothing off a search page: a collection's empty state is the collection-empty block's.
	 */
	public function test_renders_nothing_off_a_search_page(): void {
		$this->term( \ResourceHub\ContentModel\Taxonomies::TYPE, 'webinar' );

		$this->go_to( home_url( '/resources/webinar/' ) );
		$this->assertSame( '', $this->render_block( SearchEmptyBlock::NAME ) );

		wp_set_current_user( 0 );
		$this->go_to( home_url( '/search/?s=zebra' ) );
		$this->assertTrue( is_404() );
		$this->assertSame( '', $this->render_block( SearchEmptyBlock::NAME ) );
	}
}
