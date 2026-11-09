<?php
/**
 * The `resource-hub/search-head` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\SearchHeadBlock;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\Search\SearchRequest;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The markup against the contract's fixtures is `MarkupParityTest`'s; this holds the block's own rules: the
 * form's state per request, the count line, and where it renders nothing.
 */
final class SearchHeadBlockTest extends WP_UnitTestCase {
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
	 * The compiled block.json: the callback, no wrapper supports and the tokens alone.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( SearchHeadBlock::NAME );

		$this->assertNotNull( $type, 'The block is not registered: run `pnpm build` so build/search-head/block.json exists.' );
		$this->assertIsCallable( $type->render_callback );
		$this->assertFalse( $type->supports['className'] );
		$this->assertSame( array( SharedTokens::HANDLE ), $type->style_handles );
	}

	/**
	 * The heading, the form with the reader's words, and the count with the route's wording.
	 */
	public function test_heading_form_and_count(): void {
		$this->resource( 'Quokka guide', 'ebook', array( 'caching' ) );
		$this->resource( 'Quokka webinar', 'ebook', array( 'caching' ), '2026-11-02 09:30:00' );

		$this->go_to( home_url( '/search/?s=+Quokka+' ) );
		$html = $this->render_block( SearchHeadBlock::NAME );

		$this->assertStringStartsWith( '<header class="rh-listing__header"><h1>Search</h1></header><form class="rh-search" role="search" action="' . home_url( '/search/' ) . '" method="get">', $html );
		$this->assertStringContainsString( '<input class="rh-search__input" id="rh-search-q" type="search" enterkeyhint="search" aria-describedby="rh-search-message" name="s" value=" Quokka "/>', $html, 'The field shows the words as typed.' );
		$this->assertStringEndsWith( '<p class="rh-search__summary" id="rh-search-message">2 results for “Quokka”</p>', $html, 'The count quotes the normalised query.' );
		$this->assertStringNotContainsString( 'aria-invalid', $html );

		// One word that one title holds: Relevanssi's implicit operator is OR, so two words could match both.
		$this->go_to( home_url( '/search/?s=webinar' ) );
		$this->assertStringEndsWith( '1 result for “webinar”</p>', $this->render_block( SearchHeadBlock::NAME ) );
	}

	/**
	 * No query: the form alone, described by nothing. No results: described, no count line. A refused query:
	 * described and invalid.
	 */
	public function test_form_state_per_kind(): void {
		$this->go_to( home_url( '/search/' ) );
		$html = $this->render_block( SearchHeadBlock::NAME );
		$this->assertStringContainsString( 'enterkeyhint="search" name="s" value=""/>', $html );
		$this->assertStringNotContainsString( 'aria-describedby', $html );
		$this->assertStringNotContainsString( 'rh-search__summary', $html );

		$this->go_to( home_url( '/search/?s=zebra' ) );
		$html = $this->render_block( SearchHeadBlock::NAME );
		$this->assertStringContainsString( 'aria-describedby="rh-search-message" name="s" value="zebra"/>', $html );
		$this->assertStringNotContainsString( 'aria-invalid', $html );
		$this->assertStringNotContainsString( 'rh-search__summary', $html );

		$this->go_to( home_url( '/search/?s=a' ) );
		$this->assertStringContainsString( 'aria-describedby="rh-search-message" aria-invalid="true" name="s" value="a"/>', $this->render_block( SearchHeadBlock::NAME ) );

		$this->go_to( home_url( '/search/page/11/?s=zebra' ) );
		$html = $this->render_block( SearchHeadBlock::NAME );
		$this->assertStringContainsString( 'aria-describedby="rh-search-message" name="s" value="zebra"/>', $html );
		$this->assertStringNotContainsString( 'rh-search__summary', $html, 'A page the route would refuse has no count.' );
	}

	/**
	 * The count past the route's last page says only the first 120 are listed; every text is escaped as React escapes it.
	 */
	public function test_count_past_the_cap_and_escaping(): void {
		$request = SearchRequest::classify( 'cats & "dogs"', 1 );

		$this->assertStringEndsWith( '>121 results for “cats &amp; &quot;dogs&quot;”. The first 120 are listed; add words to narrow the search.</p>', SearchHeadBlock::head( $request, 121 ) );
		$this->assertStringEndsWith( '>120 results for “cats &amp; &quot;dogs&quot;”</p>', SearchHeadBlock::head( $request, 120 ) );
		$this->assertStringContainsString( 'value="cats &amp; &quot;dogs&quot;"', SearchHeadBlock::head( $request, 1 ) );
	}

	/**
	 * Nothing off a search page.
	 */
	public function test_renders_nothing_off_a_search_page(): void {
		$id = $this->resource( 'Quokka', 'ebook', array( 'caching' ) );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( '', $this->render_block( SearchHeadBlock::NAME ) );

		$this->go_to( get_permalink( $id ) );
		$this->assertSame( '', $this->render_block( SearchHeadBlock::NAME ) );

		wp_set_current_user( 0 );
		$this->go_to( home_url( '/search/?s=quokka' ) );
		$this->assertTrue( is_404() );
		$this->assertSame( '', $this->render_block( SearchHeadBlock::NAME ) );
	}
}
