<?php
/**
 * `related.css` loads where a related-resources block renders in a body, and nowhere else but the resource page.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use WP_Styles;
use WP_UnitTestCase;

/**
 * The theme's `functions.php` enqueues `related.css` (`resource-hub-related`) on every single resource and,
 * through `resource_hub_theme_has_related_block()`, on a page, a post or an archive whose main query holds a
 * post with a `resource-hub/related-resources` block in its body: the front end's `PageArticle` carries
 * `related.css` with every `RelatedList`, so the block's heading draws the same on both sites. The welcome,
 * the 404 and the collections never load it, whatever their query holds, because none of them renders a
 * post's content.
 *
 * The PHPUnit bootstrap leaves the tests site on core's test theme, so the theme's `functions.php` is not
 * loaded: this test loads it once, takes its hooks off again (it is called directly here), registers the
 * manifest's handles and runs the page enqueue under requests set up with `go_to()`, as an editor, since the
 * plugin's lockdown answers an anonymous request for a theme page with its 404. The rendered pages are
 * checked by `theme-parity.spec.js`, which holds a page with the block to `related.css`'s heading rule.
 */
final class ThemeRelatedStylesTest extends WP_UnitTestCase {
	/**
	 * The block's delimiter, as the editor stores it.
	 */
	private const BLOCK = '<!-- wp:resource-hub/related-resources {"topic":1} /-->';

	/**
	 * Loads the theme's functions once, without the hooks the file adds: each test calls the enqueue itself.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();
		require_once WP_CONTENT_DIR . '/themes/resource-hub/functions.php';
		remove_action( 'init', 'resource_hub_theme_register_styles' );
		remove_action( 'enqueue_block_assets', 'resource_hub_theme_enqueue_styles' );
		remove_action( 'wp_enqueue_scripts', 'resource_hub_theme_enqueue_page_styles', 20 );
		remove_action( 'template_redirect', 'resource_hub_theme_add_table_regions' );
		remove_action( 'template_redirect', 'resource_hub_theme_add_lightbox_off' );
		remove_action( 'wp_head', 'resource_hub_theme_print_control_script', 1 );
	}

	/**
	 * An empty style queue with the manifest's handles registered, and an editor.
	 */
	public function set_up(): void {
		parent::set_up();
		$GLOBALS['wp_styles'] = new WP_Styles(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- A fresh queue for each test, as a new request has.
		resource_hub_theme_register_styles();
		$this->assertTrue( wp_style_is( 'resource-hub-related', 'registered' ), 'The manifest is missing: run `pnpm build`.' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		update_option( 'show_on_front', 'posts' );
	}

	/**
	 * A page with the block in its body loads `related.css` beside the page's stylesheets, and not the resource's.
	 */
	public function test_page_with_the_block_loads_related_css(): void {
		$page = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_content' => '<!-- wp:paragraph --><p>Before.</p><!-- /wp:paragraph -->' . self::BLOCK,
			)
		);

		$this->enqueue_for( get_permalink( $page ) );

		$this->assertTrue( resource_hub_theme_has_related_block() );
		$this->assertTrue( wp_style_is( 'resource-hub-related', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'resource-hub-page', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'resource-hub-prose', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'resource-hub-resource', 'enqueued' ) );
	}

	/**
	 * A page without the block does not, nor does a page that only mentions the block's name as text.
	 */
	public function test_page_without_the_block_does_not(): void {
		foreach ( array( '<!-- wp:paragraph --><p>A page.</p><!-- /wp:paragraph -->', '<!-- wp:paragraph --><p>resource-hub/related-resources</p><!-- /wp:paragraph -->' ) as $content ) {
			$this->set_up_styles();
			$page = self::factory()->post->create(
				array(
					'post_type'    => 'page',
					'post_content' => $content,
				)
			);

			$this->enqueue_for( get_permalink( $page ) );

			$this->assertFalse( resource_hub_theme_has_related_block(), $content );
			$this->assertFalse( wp_style_is( 'resource-hub-related', 'enqueued' ), $content );
			$this->assertTrue( wp_style_is( 'resource-hub-page', 'enqueued' ), $content );
		}
	}

	/**
	 * A post (`singular.html`) and an archive of posts (`index.html`) render each post's content, so one post
	 * with the block is enough.
	 */
	public function test_post_and_archive_with_the_block_load_related_css(): void {
		$category = self::factory()->category->create();
		self::factory()->post->create( array( 'post_category' => array( $category ) ) );
		$post = self::factory()->post->create(
			array(
				'post_category' => array( $category ),
				'post_content'  => self::BLOCK,
			)
		);

		$this->enqueue_for( get_permalink( $post ) );
		$this->assertTrue( wp_style_is( 'resource-hub-related', 'enqueued' ), 'The post.' );

		$this->set_up_styles();
		$this->enqueue_for( get_category_link( $category ) );
		$this->assertTrue( is_archive() );
		$this->assertTrue( wp_style_is( 'resource-hub-related', 'enqueued' ), 'The archive.' );
	}

	/**
	 * The welcome, the 404 and a collection render no post's content, so they never load it, whatever
	 * their main query found: `/` lists the posts, the block in one of them included.
	 */
	public function test_the_welcome_the_404_and_a_collection_never_load_it(): void {
		self::factory()->post->create( array( 'post_content' => self::BLOCK ) );
		$type     = self::factory()->term->create( array( 'taxonomy' => 'resource_type' ) );
		$resource = self::factory()->post->create(
			array(
				'post_type'    => 'resource',
				'post_content' => self::BLOCK,
			)
		);
		wp_set_object_terms( $resource, array( $type ), 'resource_type' );

		$this->enqueue_for( home_url( '/' ) );
		$this->assertTrue( is_home() );
		$this->assertTrue( resource_hub_theme_has_related_block(), 'The welcome\'s query lists the post with the block.' );
		$this->assertFalse( wp_style_is( 'resource-hub-related', 'enqueued' ), 'The welcome.' );
		$this->assertTrue( wp_style_is( 'resource-hub-welcome', 'enqueued' ) );

		$this->set_up_styles();
		$this->enqueue_for( home_url( '/?p=' . PHP_INT_MAX ) );
		$this->assertTrue( is_404() );
		$this->assertFalse( wp_style_is( 'resource-hub-related', 'enqueued' ), 'The 404.' );

		$this->set_up_styles();
		$this->enqueue_for( home_url( '/?post_type=resource' ) );
		$this->assertTrue( is_post_type_archive( 'resource' ) );
		$this->assertTrue( resource_hub_theme_has_related_block(), 'The library\'s query lists the resource with the block.' );
		$this->assertFalse( wp_style_is( 'resource-hub-related', 'enqueued' ), 'The library.' );
		$this->assertTrue( wp_style_is( 'resource-hub-listing', 'enqueued' ) );
	}

	/**
	 * A single resource loads it whether or not its body has the block, as before.
	 */
	public function test_a_resource_loads_it_regardless(): void {
		$resource = self::factory()->post->create( array( 'post_type' => 'resource' ) );

		$this->enqueue_for( get_permalink( $resource ) );

		$this->assertTrue( is_singular( 'resource' ) );
		$this->assertFalse( resource_hub_theme_has_related_block() );
		$this->assertTrue( wp_style_is( 'resource-hub-related', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'resource-hub-page', 'enqueued' ) );
	}

	/**
	 * Sets the request up and runs the theme's page enqueue, as `wp_enqueue_scripts` would.
	 *
	 * @param string $url The request.
	 */
	private function enqueue_for( string $url ): void {
		$this->go_to( $url );
		resource_hub_theme_enqueue_page_styles();
	}

	/**
	 * A fresh, registered queue, for a test that sets up more than one request.
	 */
	private function set_up_styles(): void {
		$GLOBALS['wp_styles'] = new WP_Styles(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- A fresh queue, as a new request has.
		resource_hub_theme_register_styles();
	}
}
