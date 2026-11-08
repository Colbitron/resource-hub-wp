<?php
/**
 * The theme renders image blocks without their lightbox on its own pages.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use WP_UnitTestCase;

/**
 * Tests `wp-content/themes/resource-hub/inc/image-lightbox.php`.
 *
 * The theme's pages leave core's image block stylesheet out, which is what hides a lightbox's
 * overlay, and the front end never shows a lightbox, so the theme turns it off on the pages it
 * renders. The PHPUnit bootstrap leaves the tests site on core's test theme, so this test loads the
 * one file that defines the filter, which hooks nothing by itself.
 */
final class ImageLightboxTest extends WP_UnitTestCase {
	/**
	 * An image block set to expand on click.
	 */
	private const BLOCK = '<!-- wp:image {"lightbox":{"enabled":true},"sizeSlug":"large","linkDestination":"none"} --><figure class="wp-block-image size-large"><img src="https://example.org/a.png" alt="An image"/></figure><!-- /wp:image -->';

	/**
	 * Loads the theme's lightbox functions.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();
		require_once WP_CONTENT_DIR . '/themes/resource-hub/inc/image-lightbox.php';
	}

	/**
	 * An image block's lightbox is off, whatever it was; another block is left as it came.
	 */
	public function test_turns_an_image_blocks_lightbox_off(): void {
		$image = parse_blocks( self::BLOCK )[0];
		$this->assertTrue( $image['attrs']['lightbox']['enabled'] );

		$this->assertSame( array( 'enabled' => false ), resource_hub_theme_lightbox_off( $image )['attrs']['lightbox'] );

		$paragraph = array(
			'blockName' => 'core/paragraph',
			'attrs'     => array(),
		);
		$this->assertSame( $paragraph, resource_hub_theme_lightbox_off( $paragraph ) );
	}

	/**
	 * Rendered with the filter on, an image set to expand on click is the image alone, inside a group too.
	 */
	public function test_rendered_image_has_no_lightbox(): void {
		$grouped = '<!-- wp:group --><div class="wp-block-group">' . self::BLOCK . '</div><!-- /wp:group -->';

		$this->assertStringContainsString( 'data-wp-interactive', do_blocks( self::BLOCK ), 'The block renders a lightbox without the filter, so this test proves something.' );

		add_filter( 'render_block_data', 'resource_hub_theme_lightbox_off' );
		foreach ( array( self::BLOCK, $grouped ) as $content ) {
			$html = do_blocks( $content );
			$this->assertStringContainsString( '<img', $html );
			$this->assertStringNotContainsString( 'data-wp-interactive', $html );
			$this->assertStringNotContainsString( '<button', $html );
		}
	}

	/**
	 * Loading the file hooks nothing; the theme adds the filter on `template_redirect`, for a page
	 * core renders, and not for a feed or an embed. Logged in, as the lockdown answers an anonymous
	 * feed with its 404.
	 */
	public function test_filter_is_added_only_for_a_rendered_page(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		remove_all_filters( 'render_block_data' );
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );

		foreach ( array( get_feed_link(), get_post_embed_url( $page ) ) as $url ) {
			$this->go_to( $url );
			$this->assertTrue( is_feed() || is_embed(), $url );
			resource_hub_theme_add_lightbox_off();
			$this->assertFalse( has_filter( 'render_block_data', 'resource_hub_theme_lightbox_off' ), $url );
		}

		$this->go_to( get_permalink( $page ) );
		resource_hub_theme_add_lightbox_off();
		$this->assertSame( 10, has_filter( 'render_block_data', 'resource_hub_theme_lightbox_off' ) );
	}
}
