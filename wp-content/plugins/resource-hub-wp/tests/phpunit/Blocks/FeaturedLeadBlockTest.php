<?php
/**
 * The `resource-hub/featured-lead` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\FeaturedLeadBlock;
use ResourceHub\Blocks\ResourceCardMarkup;
use ResourceHub\Blocks\SharedCard;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\Tests\Collections\MakesCollections;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The markup without an image is `MarkupParityTest`'s (against the contract's lead fixtures) and which resource
 * is the lead is `CollectionQueryTest`'s; this holds the block's own rules: the registration, where it renders,
 * the title's fallback, and the image box the fixtures cannot hold.
 */
final class FeaturedLeadBlockTest extends WP_UnitTestCase {
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
	 * The compiled block.json: the callback, no wrapper supports, the tokens and the shared row, and not the theme's lead handle.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( FeaturedLeadBlock::NAME );

		$this->assertNotNull( $type, 'The block is not registered: run `pnpm build` so build/featured-lead/block.json exists.' );
		$this->assertIsCallable( $type->render_callback );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );
		$this->assertSame( array( SharedTokens::HANDLE, SharedCard::HANDLE ), $type->style_handles );
	}

	/**
	 * The section on the library's first page, and nothing anywhere else or without a featured resource.
	 */
	public function test_renders_the_section_on_the_library_front_only(): void {
		$id = $this->resource( 'Featured one', 'ebook', array( 'caching' ) );

		$this->go_to( home_url( '/resources/' ) );
		$this->assertSame( '', $this->render_block( FeaturedLeadBlock::NAME ), 'Nothing is featured.' );

		$this->feature( $id );
		$this->go_to( home_url( '/resources/' ) );
		$html = $this->render_block( FeaturedLeadBlock::NAME );
		$this->assertStringStartsWith( '<div class="rh-listing__lead"><h2 class="rh-listing__section">Featured</h2><article class="rh-lead">', $html );
		$this->assertStringEndsWith( '</article></div>', $html );
		$this->assertStringContainsString( '<h3 class="rh-lead__title"><a class="rh-lead__link" href="' . get_permalink( $id ) . '">Featured one</a></h3>', $html );
		$this->assertStringNotContainsString( 'rh-lead__media', $html, 'No image, no box.' );

		foreach ( array( '/resources/ebook/', '/resources/topic/caching/', get_permalink( $id ), home_url( '/' ) ) as $url ) {
			$this->go_to( str_starts_with( $url, 'http' ) ? $url : home_url( $url ) );
			$this->assertSame( '', $this->render_block( FeaturedLeadBlock::NAME ), $url );
		}
	}

	/**
	 * An empty title shows "Untitled resource", as the front end's lead does.
	 */
	public function test_empty_title_is_untitled(): void {
		$this->feature( $this->resource( '&nbsp;', 'ebook', array( 'caching' ) ) );

		$this->go_to( home_url( '/resources/' ) );

		$this->assertStringContainsString( '>' . ResourceCardMarkup::UNTITLED . '</a></h3>', $this->render_block( FeaturedLeadBlock::NAME ) );
	}

	/**
	 * A measured featured image is the lead's box: the `large` size with its dimensions, the front end's `sizes`, eager and at high priority.
	 */
	public function test_image_box(): void {
		$id    = $this->resource( 'With an image', 'ebook', array( 'caching' ) );
		$image = self::factory()->attachment->create_object(
			array(
				'file'           => '2026/11/lead.jpg',
				'post_parent'    => $id,
				'post_mime_type' => 'image/jpeg',
				'post_title'     => 'Lead',
			)
		);
		update_post_meta( $image, '_wp_attached_file', '2026/11/lead.jpg' );
		update_post_meta( $image, '_wp_attachment_image_alt', 'A warm "paper" surface' );
		wp_update_attachment_metadata(
			$image,
			array(
				'width'  => 1600,
				'height' => 900,
				'file'   => '2026/11/lead.jpg',
				'sizes'  => array(
					'large' => array(
						'file'      => 'lead-1024x576.jpg',
						'width'     => 1024,
						'height'    => 576,
						'mime-type' => 'image/jpeg',
					),
				),
			)
		);
		set_post_thumbnail( $id, $image );
		$this->feature( $id );

		$this->go_to( home_url( '/resources/' ) );
		$html = $this->render_block( FeaturedLeadBlock::NAME );

		$this->assertMatchesRegularExpression(
			'#<article class="rh-lead"><div class="rh-lead__media"><img src="[^"]*/2026/11/lead-1024x576\.jpg" alt="A warm &quot;paper&quot; surface" width="1024" height="576" srcset="[^"]*lead-1024x576\.jpg 1024w, [^"]*lead\.jpg 1600w" sizes="' . preg_quote( ResourceCardMarkup::SIZES, '#' ) . '" loading="eager" fetchpriority="high" decoding="async"></div><div class="rh-lead__body">#',
			$html
		);
	}

	/**
	 * A featured image WordPress has not measured (an SVG) gets no box, as the front end gives it no image.
	 */
	public function test_unmeasured_image_has_no_box(): void {
		$id    = $this->resource( 'With an SVG', 'ebook', array( 'caching' ) );
		$image = self::factory()->attachment->create_object(
			array(
				'file'           => '2026/11/lead.svg',
				'post_parent'    => $id,
				'post_mime_type' => 'image/svg+xml',
			)
		);
		update_post_meta( $image, '_wp_attached_file', '2026/11/lead.svg' );
		set_post_thumbnail( $id, $image );
		$this->feature( $id );

		$this->go_to( home_url( '/resources/' ) );
		$html = $this->render_block( FeaturedLeadBlock::NAME );

		$this->assertStringContainsString( '<article class="rh-lead"><div class="rh-lead__body">', $html );
		$this->assertStringNotContainsString( 'rh-lead__media', $html );
	}
}
