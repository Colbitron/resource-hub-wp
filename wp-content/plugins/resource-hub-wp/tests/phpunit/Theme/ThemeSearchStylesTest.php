<?php
/**
 * The theme's search stylesheets load on the search page, and the header control's on every page but the 404.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use ResourceHub\Tests\Collections\MakesCollections;
use WP_Styles;
use WP_UnitTestCase;

/**
 * The theme's `functions.php` enqueues `listing.css` and `search.css` (`resource-hub-listing`,
 * `resource-hub-search`) on the search page, with the pagination's CSS inline, as the front end's search
 * page carries them, and `header-search.css` (`resource-hub-header-search`) on every page but the 404,
 * where the control's slot is hidden by a rule inline after `shell.css` instead; the bar's two
 * stylesheets are registered and never enqueued, since the theme's script adds them.
 *
 * Loaded and run as `ThemeRelatedStylesTest` does it: the theme's functions once, its hooks taken off, the
 * manifest's handles registered, and the enqueue run under requests set up with `go_to()`, as an editor.
 */
final class ThemeSearchStylesTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * Loads the theme's functions once, without the hooks the file adds.
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
		remove_action( 'wp_footer', 'resource_hub_theme_print_header_search_script' );
		remove_filter( 'render_block_core/html', 'resource_hub_theme_header_search_page_link' );
	}

	/**
	 * Pretty permalinks with the rules, an empty style queue with the manifest's handles, and an editor.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_pretty_permalinks();
		$GLOBALS['wp_styles'] = new WP_Styles(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- A fresh queue for each test, as a new request has.
		resource_hub_theme_register_styles();
		$this->assertTrue( wp_style_is( 'resource-hub-search', 'registered' ), 'The manifest is missing search.css: run `pnpm build`.' );
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
	 * The search page loads the listing's and the form's stylesheets, with the pagination's CSS inline, and no page's.
	 */
	public function test_search_page_loads_listing_and_search_css(): void {
		$this->go_to( home_url( '/search/?s=quokka' ) );
		$this->assertTrue( is_search() );
		resource_hub_theme_enqueue_page_styles();

		foreach ( array( 'resource-hub-base', 'resource-hub-shell', 'resource-hub-listing', 'resource-hub-search', 'resource-hub-header-search', 'resource-hub-theme-toggle' ) as $handle ) {
			$this->assertTrue( wp_style_is( $handle, 'enqueued' ), $handle );
		}
		foreach ( array( 'resource-hub-page', 'resource-hub-prose', 'resource-hub-lead', 'resource-hub-resource', 'resource-hub-not-found', 'resource-hub-header-search-bar' ) as $handle ) {
			$this->assertFalse( wp_style_is( $handle, 'enqueued' ), $handle );
		}
		$this->assertStringContainsString( '.rh-pagination', (string) wp_styles()->get_data( 'resource-hub-listing', 'after' )[0] );

		// The same for `/search/` with no query.
		$GLOBALS['wp_styles'] = new WP_Styles(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- A fresh queue, as a new request has.
		resource_hub_theme_register_styles();
		$this->go_to( home_url( '/search/' ) );
		resource_hub_theme_enqueue_page_styles();
		$this->assertTrue( wp_style_is( 'resource-hub-search', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'resource-hub-listing', 'enqueued' ) );
	}

	/**
	 * A page, a collection and a resource load the control's stylesheet and never the search page's.
	 */
	public function test_other_pages_load_the_control_and_not_the_search_css(): void {
		$resource = $this->resource( 'Quokka', 'ebook', array( 'caching' ) );

		foreach ( array( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ), home_url( '/resources/' ), get_permalink( $resource ), home_url( '/' ) ) as $url ) {
			$GLOBALS['wp_styles'] = new WP_Styles(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- A fresh queue, as a new request has.
			resource_hub_theme_register_styles();
			$this->go_to( $url );
			$this->assertFalse( is_search(), $url );
			resource_hub_theme_enqueue_page_styles();

			$this->assertTrue( wp_style_is( 'resource-hub-header-search', 'enqueued' ), $url );
			$this->assertFalse( wp_style_is( 'resource-hub-search', 'enqueued' ), $url );
			$this->assertFalse( wp_style_is( 'resource-hub-header-search-bar', 'enqueued' ), $url );
			$this->assertStringNotContainsString( RESOURCE_HUB_THEME_NO_HEADER_SEARCH, implode( '', (array) wp_styles()->get_data( 'resource-hub-shell', 'after' ) ), $url );
		}
	}

	/**
	 * The 404 loads no control stylesheet and hides the control's slot inline after the shell's.
	 */
	public function test_404_hides_the_control(): void {
		$this->go_to( '/?p=' . PHP_INT_MAX );
		$this->assertTrue( is_404() );
		resource_hub_theme_enqueue_page_styles();

		$this->assertFalse( wp_style_is( 'resource-hub-header-search', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'resource-hub-search', 'enqueued' ) );
		$this->assertStringContainsString( RESOURCE_HUB_THEME_NO_HEADER_SEARCH, implode( '', (array) wp_styles()->get_data( 'resource-hub-shell', 'after' ) ) );
	}

	/**
	 * The bar's two stylesheets are registered from the manifest in the order the script adds them.
	 */
	public function test_bar_styles_are_registered(): void {
		foreach ( RESOURCE_HUB_THEME_HEADER_SEARCH_BAR_STYLES as $handle ) {
			$this->assertTrue( wp_style_is( $handle, 'registered' ), $handle );
		}
		$this->assertSame( array( 'resource-hub-header-search-bar', 'resource-hub-search' ), RESOURCE_HUB_THEME_HEADER_SEARCH_BAR_STYLES );
		$this->assertCount( 2, resource_hub_theme_header_search_styles() );
	}
}
