<?php
/**
 * The `resource-hub/collection-head` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\CollectionHeadBlock;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The markup is `MarkupParityTest`'s (against the contract's collection fixtures); this holds the block's own
 * rules: the registration, where it renders, the heading's wording, the count and which terms are offered.
 */
final class CollectionHeadBlockTest extends WP_UnitTestCase {
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
	 * The compiled block.json: the callback, no context, no wrapper supports, the tokens and the theme's listing handle.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( CollectionHeadBlock::NAME );

		$this->assertNotNull( $type, 'The block is not registered: run `pnpm build` so build/collection-head/block.json exists.' );
		$this->assertIsCallable( $type->render_callback );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );
		$this->assertFalse( $type->supports['multiple'] );
		$this->assertSame( array( SharedTokens::HANDLE, 'resource-hub-listing' ), $type->style_handles );
	}

	/**
	 * Nothing on a request that is not a collection.
	 */
	public function test_renders_nothing_off_a_collection(): void {
		$id = $this->resource( 'A', 'ebook', array( 'caching' ) );

		$this->go_to( get_permalink( $id ) );
		$this->assertSame( '', $this->render_block( CollectionHeadBlock::NAME ), 'A single resource.' );

		$this->go_to( home_url( '/' ) );
		$this->assertSame( '', $this->render_block( CollectionHeadBlock::NAME ), 'The front page.' );

		$this->go_to( home_url( '/no-such-page/' ) );
		$this->assertSame( '', $this->render_block( CollectionHeadBlock::NAME ), 'A 404.' );
	}

	/**
	 * The heading names the collection as the front end does, with the terms' names as written.
	 */
	public function test_heading_wording(): void {
		$this->term( Taxonomies::TYPE, 'case-study', 'Case study' );
		$this->term( Taxonomies::TOPIC, 'caching', 'Caching &amp; CDNs' );
		$this->resource( 'A', 'case-study', array( 'caching' ) );

		$cases = array(
			'/resources/'                          => 'Resources',
			'/resources/case-study/'               => 'Case study resources',
			'/resources/topic/caching/'            => 'Resources on Caching &amp; CDNs',
			'/resources/case-study/topic/caching/' => 'Case study resources on Caching &amp; CDNs',
		);

		foreach ( $cases as $path => $heading ) {
			$this->go_to( home_url( $path ) );
			$this->assertStringContainsString( '<h1 id="rh-listing-heading" tabindex="-1">' . $heading . '</h1>', $this->render_block( CollectionHeadBlock::NAME ), $path );
		}
	}

	/**
	 * The count is singular for one, plural otherwise, and left out for none.
	 */
	public function test_count_line(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->resource( 'B', 'ebook', array( 'testing' ) );
		$this->term( Taxonomies::TYPE, 'webinar' );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertStringContainsString( '<p class="rh-listing__count">2 resources</p>', $this->render_block( CollectionHeadBlock::NAME ) );

		$this->go_to( home_url( '/resources/topic/testing/' ) );
		$this->assertStringContainsString( '<p class="rh-listing__count">1 resource</p>', $this->render_block( CollectionHeadBlock::NAME ) );

		$this->go_to( home_url( '/resources/webinar/' ) );
		$this->assertStringNotContainsString( 'rh-listing__count', $this->render_block( CollectionHeadBlock::NAME ) );
	}

	/**
	 * A term with no published resource is not offered unless it is the current one; a draft does not count.
	 */
	public function test_offers_terms_with_published_resources_and_the_current_one(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->term( Taxonomies::TYPE, 'webinar' );
		$draft = $this->resource( 'Draft', 'podcast', array( 'drafts' ) );
		wp_update_post(
			array(
				'ID'          => $draft,
				'post_status' => 'draft',
			)
		);

		$this->go_to( home_url( '/resources/' ) );
		$html = $this->render_block( CollectionHeadBlock::NAME );
		$this->assertStringContainsString( 'href="' . home_url( '/resources/ebook/' ) . '">ebook</a>', $html );
		$this->assertStringNotContainsString( '/resources/webinar/', $html );
		$this->assertStringNotContainsString( '/resources/podcast/', $html );
		$this->assertStringNotContainsString( '/resources/topic/drafts/', $html );
		$this->assertSame( 2, substr_count( $html, 'aria-current="true"' ), 'Both "All" links are current.' );

		$this->go_to( home_url( '/resources/webinar/' ) );
		$html = $this->render_block( CollectionHeadBlock::NAME );
		$this->assertStringContainsString( '<a class="rh-filters__link" aria-current="true" href="' . home_url( '/resources/webinar/' ) . '">webinar</a>', $html, 'The current type is offered even with nothing in it.' );
		$this->assertStringContainsString( '<a class="rh-filters__link" aria-current="true" href="' . home_url( '/resources/webinar/' ) . '">All topics</a>', $html, 'All topics keeps the type.' );
		$this->assertStringContainsString( 'href="' . home_url( '/resources/webinar/topic/caching/' ) . '">caching</a>', $html, 'A topic link keeps the type.' );
	}
}
