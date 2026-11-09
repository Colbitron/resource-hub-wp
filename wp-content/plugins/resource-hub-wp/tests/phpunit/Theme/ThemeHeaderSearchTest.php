<?php
/**
 * Tests `wp-content/themes/resource-hub/inc/header-search.php` and the header part's control.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use ResourceHub\Tests\Collections\MakesCollections;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_Styles;
use WP_UnitTestCase;

/**
 * The CMS's header search control: the header part renders the front end's link, and the theme prints its
 * script inline in the footer of every page but the 404, with the form's action and the bar's stylesheets.
 *
 * The markup is the plugin's half of the contract's `header-search.html` fixture (`packages/ui/README.md`,
 * "Markup fixtures"): the header part's second Custom HTML block, rendered through `do_blocks()` as a
 * template part is, must be the fixture byte for byte once the fixture's indentation is removed. The front
 * end's `markup-parity.test.tsx` renders `HeaderSearch` as the server does and compares it with the same
 * file. What the script builds in the browser is held to the front end's by
 * `apps/web/test/header-search-cms-parity.test.tsx`, and what it does by `theme-header-search.spec.js`.
 *
 * The PHPUnit bootstrap leaves the tests site on core's test theme, so the theme's `functions.php` is not
 * loaded: this test loads the one file that defines the functions, which hooks nothing by itself, and
 * calls them under requests set up with `go_to()`, as an editor.
 */
final class ThemeHeaderSearchTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * Loads the theme's header search functions.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();
		require_once WP_CONTENT_DIR . '/themes/resource-hub/inc/header-search.php';
	}

	/**
	 * Pretty permalinks with the rules, an empty style queue, and an editor.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_pretty_permalinks();
		$GLOBALS['wp_styles'] = new WP_Styles(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- A fresh queue for each test, as a new request has.
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
	 * The header part renders the control exactly as the fixture says, after the lockup.
	 */
	public function test_header_part_renders_the_control_as_the_fixture(): void {
		$header = do_blocks( $this->read( self::theme_dir() . '/parts/header.html' ) );

		$this->assertSame( 1, preg_match( '/<div class="rh-header-search">.*?<\/a>\s*<\/div>/s', $header, $matches ), 'The header part renders no control.' );
		$this->assertSame( self::normalise( $this->read( SchemaValidator::fixtures_dir() . '/markup/header-search.html' ) ), self::normalise( $matches[0] ) );
		$this->assertLessThan( strpos( $header, 'rh-header-search' ), strpos( $header, 'class="rh-brand"' ), 'The control comes after the lockup, at the end of the row.' );
		$this->assertDoesNotMatchRegularExpression( '/\son[a-z]+=/i', $header, 'The control has an inline event handler.' );
		$this->assertStringNotContainsString( '<button', $header, 'The button exists only once the script runs.' );
	}

	/**
	 * Every template but the 404 has the control.
	 */
	public function test_every_template_but_the_404_has_the_control(): void {
		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );
		$this->assertTrue( resource_hub_theme_has_header_search() );

		$this->go_to( home_url( '/search/?s=quokka' ) );
		$this->assertTrue( resource_hub_theme_has_header_search() );

		$this->go_to( '/?p=' . PHP_INT_MAX );
		$this->assertTrue( is_404() );
		$this->assertFalse( resource_hub_theme_has_header_search() );
	}

	/**
	 * On a page, the script is printed inline, whole, in a tag with its id, the CMS's `/search/` as its
	 * action, and the two registered bar stylesheets as versioned URLs, in order.
	 */
	public function test_prints_the_script_inline_with_its_data(): void {
		wp_register_style( 'resource-hub-header-search-bar', 'http://example.org/build/header-search-bar.css', array(), 'abc' );
		wp_register_style( 'resource-hub-search', 'http://example.org/build/search.css', array(), 'def' );
		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );

		$printed = get_echo( 'resource_hub_theme_print_header_search_script' );
		$script  = $this->read( self::theme_dir() . '/js/header-search.js' );

		$this->assertSame( 1, preg_match( '/<script([^>]*)\sid="resource-hub-header-search-js"[^>]*>(.*?)<\/script>/s', $printed, $matches ), $printed );
		$this->assertSame( trim( $script ), trim( $matches[2] ) );
		$this->assertSame( 1, substr_count( $printed, '<script' ) );
		$this->assertDoesNotMatchRegularExpression( '/<script[^>]*\ssrc=/', $printed, 'The script is inline.' );
		$this->assertStringContainsString( 'data-action="' . esc_attr( home_url( '/search/' ) ) . '"', $printed );

		$this->assertSame( 1, preg_match( '/data-styles="([^"]*)"/', $printed, $styles ) );
		$this->assertSame(
			array(
				'resource-hub-header-search-bar' => 'http://example.org/build/header-search-bar.css?ver=abc',
				'resource-hub-search'            => 'http://example.org/build/search.css?ver=def',
			),
			json_decode( html_entity_decode( $styles[1], ENT_QUOTES ), true )
		);
	}

	/**
	 * A bar stylesheet the manifest does not register (no build) is left out, and the script still prints.
	 */
	public function test_unregistered_styles_are_left_out(): void {
		wp_register_style( 'resource-hub-search', 'http://example.org/build/search.css', array(), 'def' );
		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );

		$this->assertSame( array( 'resource-hub-search' => 'http://example.org/build/search.css?ver=def' ), resource_hub_theme_header_search_styles() );
		$this->assertStringContainsString( 'id="resource-hub-header-search-js"', get_echo( 'resource_hub_theme_print_header_search_script' ) );
	}

	/**
	 * On the 404 nothing is printed: no script for anonymous visitors.
	 */
	public function test_prints_nothing_on_the_404(): void {
		$this->go_to( '/?p=' . PHP_INT_MAX );
		$this->assertTrue( is_404() );

		$this->assertSame( '', get_echo( 'resource_hub_theme_print_header_search_script' ) );
	}

	/**
	 * A script file that is missing, or is a directory, reads as an empty string, quietly.
	 */
	public function test_missing_script_reads_as_empty_without_a_warning(): void {
		$this->assertSame( '', resource_hub_theme_header_search_script( self::theme_dir() . '/js/no-such-file.js' ) );
		$this->assertSame( '', resource_hub_theme_header_search_script( self::theme_dir() . '/js' ) );
		$this->assertSame( $this->read( self::theme_dir() . '/js/header-search.js' ), resource_hub_theme_header_search_script() );
	}

	/**
	 * On the search page the control's link goes to the page's own field; elsewhere, and for any other
	 * HTML block, the block renders as written.
	 */
	public function test_link_targets_the_field_on_the_search_page(): void {
		$control = '<div class="rh-header-search"><a class="rh-header-search__toggle" href="/search/" aria-label="Search"></a></div>';
		$other   = '<p><a href="/search/">Search</a></p>';

		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );
		$this->assertSame( $control, resource_hub_theme_header_search_page_link( $control ) );

		$this->go_to( home_url( '/search/?s=quokka' ) );
		$this->assertTrue( is_search() );
		$this->assertSame( str_replace( 'href="/search/"', 'href="#rh-search-q"', $control ), resource_hub_theme_header_search_page_link( $control ) );
		$this->assertSame( $other, resource_hub_theme_header_search_page_link( $other ), 'Another HTML block is left alone.' );
		$this->assertSame( array( 'x' ), resource_hub_theme_header_search_page_link( array( 'x' ) ) );

		// The header part itself, rendered on the search page through the filter.
		add_filter( 'render_block_core/html', 'resource_hub_theme_header_search_page_link' );
		$header = do_blocks( $this->read( self::theme_dir() . '/parts/header.html' ) );
		remove_filter( 'render_block_core/html', 'resource_hub_theme_header_search_page_link' );
		$this->assertStringContainsString( '<a class="rh-header-search__toggle" href="#rh-search-q" aria-label="Search">', $header );
		$this->assertStringContainsString( '<a class="rh-brand" href="/resources/">', $header, 'The lockup keeps its link.' );
	}

	/**
	 * The file printed inline can be: it closes no `<script>` early and holds no PHP tag, and it names the
	 * front end's ids and the search page's field.
	 */
	public function test_script_file_is_safe_to_print_inline(): void {
		$script = $this->read( self::theme_dir() . '/js/header-search.js' );

		$this->assertStringNotContainsStringIgnoringCase( '</script', $script );
		$this->assertStringNotContainsString( '<?', $script );
		$this->assertStringContainsString( "'rh-header-search-panel'", $script );
		$this->assertStringContainsString( "'rh-search-q'", $script );
		$this->assertStringContainsString( "'resource-hub-header-search-js'", $script );
	}

	/**
	 * The hide rule removes the control from the header's row, for the 404.
	 */
	public function test_no_control_rule(): void {
		$this->assertSame( '.rh-header-search{display:none}', RESOURCE_HUB_THEME_NO_HEADER_SEARCH );
	}

	/**
	 * The markup with the fixture's indentation removed: whitespace holding a line break between two tags.
	 *
	 * @param string $html A render or a fixture.
	 */
	private static function normalise( string $html ): string {
		return trim( (string) preg_replace( '/>\s*\n\s*</', '><', $html ) );
	}

	/**
	 * The theme's directory in the container.
	 */
	private static function theme_dir(): string {
		return WP_CONTENT_DIR . '/themes/resource-hub';
	}

	/**
	 * A file's contents.
	 *
	 * @param string $path Absolute path.
	 */
	private function read( string $path ): string {
		$contents = file_get_contents( $path ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local theme or fixture file read by a test, never a remote URL.
		$this->assertIsString( $contents, $path );

		return $contents;
	}
}
