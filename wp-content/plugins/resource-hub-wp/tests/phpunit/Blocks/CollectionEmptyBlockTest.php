<?php
/**
 * The `resource-hub/collection-empty` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\CollectionEmptyBlock;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The empty state's sentence per request, its link on a filtered page, and where it renders nothing.
 */
final class CollectionEmptyBlockTest extends WP_UnitTestCase {
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
		$type = WP_Block_Type_Registry::get_instance()->get_registered( CollectionEmptyBlock::NAME );

		$this->assertNotNull( $type, 'The block is not registered: run `pnpm build` so build/collection-empty/block.json exists.' );
		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'core/query-no-results' ), $type->ancestor );
		$this->assertFalse( $type->supports['className'] );
		$this->assertSame( array( SharedTokens::HANDLE ), $type->style_handles );
	}

	/**
	 * The sentence and the link per request, the front end's wording.
	 */
	public function test_sentence_and_link_per_request(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->term( Taxonomies::TYPE, 'webinar' );
		$this->term( Taxonomies::TOPIC, 'testing' );
		$library = '<p><a href="' . home_url( '/resources/' ) . '">Show all resources</a></p>';

		$this->go_to( home_url( '/resources/webinar/' ) );
		$this->assertSame( '<div class="rh-listing__empty"><p>No resources here yet.</p>' . $library . '</div>', $this->render_block( CollectionEmptyBlock::NAME ) );

		$this->go_to( home_url( '/resources/topic/testing/' ) );
		$this->assertSame( '<div class="rh-listing__empty"><p>No resources here yet.</p>' . $library . '</div>', $this->render_block( CollectionEmptyBlock::NAME ) );

		$this->go_to( home_url( '/resources/ebook/topic/testing/' ) );
		$this->assertSame( '<div class="rh-listing__empty"><p>No resources match this type and topic yet.</p>' . $library . '</div>', $this->render_block( CollectionEmptyBlock::NAME ) );
	}

	/**
	 * The library itself, with nothing published, says so without a link.
	 */
	public function test_empty_library_has_no_link(): void {
		$this->term( Taxonomies::TYPE, 'ebook' );

		$this->go_to( home_url( '/resources/' ) );

		$this->assertSame( '<div class="rh-listing__empty"><p>No resources here yet.</p></div>', $this->render_block( CollectionEmptyBlock::NAME ) );
	}

	/**
	 * Nothing off a collection, and nothing beside a lead.
	 */
	public function test_renders_nothing_off_a_collection_or_beside_a_lead(): void {
		$id = $this->resource( 'Only one', 'ebook', array( 'caching' ) );

		$this->go_to( get_permalink( $id ) );
		$this->assertSame( '', $this->render_block( CollectionEmptyBlock::NAME ) );

		$this->feature( $id );
		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( 0, $GLOBALS['wp_query']->post_count, 'The lead\'s row was taken out, so the list is empty.' );
		$this->assertSame( '', $this->render_block( CollectionEmptyBlock::NAME ), 'Never an empty state beside the lead.' );
	}
}
