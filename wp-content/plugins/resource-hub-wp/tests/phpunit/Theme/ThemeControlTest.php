<?php
/**
 * Tests `wp-content/themes/resource-hub/inc/theme-control.php` and the footer part's control.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_UnitTestCase;

/**
 * The CMS's System / Light / Dark control: the footer part renders the front end's markup, and the
 * theme prints its script inline in the head of every page but the 404.
 *
 * The markup is the plugin's half of the contract's `theme-control.html` fixture
 * (`packages/ui/README.md`, "Markup fixtures"): the footer part's Custom HTML block, rendered through
 * `do_blocks()` as a template part is, must be the fixture byte for byte once the fixture's
 * indentation is removed, the one thing the HTML parser ignores that the two differ in. The front
 * end's `markup-parity.test.tsx` renders `ThemeFieldset` and compares it with the same file, with its
 * React-generated ids written as the CMS's, so a change to either side's control fails one of the two
 * until the fixture, and the other side, follow.
 *
 * The PHPUnit bootstrap leaves the tests site on core's test theme, so the theme's `functions.php`
 * is not loaded: this test loads the one file that defines the functions, which hooks nothing by
 * itself, and calls them under requests set up with `go_to()`, as an editor, since the plugin's
 * lockdown answers an anonymous request for a theme page with its 404. Which stylesheet each template loads
 * is `functions.php`'s and is checked on the rendered pages by `theme-control.spec.js`.
 */
final class ThemeControlTest extends WP_UnitTestCase {
	/**
	 * Loads the theme's control functions.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();
		require_once WP_CONTENT_DIR . '/themes/resource-hub/inc/theme-control.php';
	}

	/**
	 * An editor, since the plugin's lockdown answers an anonymous request for a theme page with its 404.
	 */
	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
	}

	/**
	 * The footer part renders the control exactly as the fixture says, after the footer's text.
	 */
	public function test_footer_part_renders_the_control_as_the_fixture(): void {
		$footer = do_blocks( $this->read( self::theme_dir() . '/parts/footer.html' ) );

		$this->assertSame( 1, preg_match( '/<fieldset class="rh-theme[^"]*">.*?<\/fieldset>/s', $footer, $matches ), 'The footer part renders no control.' );
		$this->assertSame( self::normalise( $this->read( SchemaValidator::fixtures_dir() . '/markup/theme-control.html' ) ), self::normalise( $matches[0] ) );

		// In the control's slot, after the text, as the front end's Shell lays the footer out.
		$this->assertStringContainsString( 'rh-footer__theme', $footer );
		$this->assertLessThan( strpos( $footer, 'rh-footer__theme' ), strpos( $footer, 'rh-footer__text' ) );
		$this->assertLessThan( strpos( $footer, '<fieldset' ), strpos( $footer, 'rh-footer__theme' ) );
	}

	/**
	 * Nothing is checked and the group is pending until the script has read the stored choice, as the
	 * front end's server render; the script, not the markup, decides.
	 */
	public function test_control_starts_pending_with_nothing_checked(): void {
		$footer = do_blocks( $this->read( self::theme_dir() . '/parts/footer.html' ) );

		$this->assertStringContainsString( 'rh-theme--pending', $footer );
		$this->assertDoesNotMatchRegularExpression( '/\schecked\b/', $footer );
		$this->assertSame( 3, substr_count( $footer, 'type="radio"' ) );
		$this->assertDoesNotMatchRegularExpression( '/\son[a-z]+=/i', $footer, 'The control has an inline event handler.' );
	}

	/**
	 * Every template but the 404 has the control.
	 */
	public function test_every_template_but_the_404_has_the_control(): void {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );

		$this->go_to( get_permalink( $page ) );
		$this->assertTrue( resource_hub_theme_has_control() );

		$this->go_to( '/' );
		$this->assertTrue( resource_hub_theme_has_control() );

		$this->go_to( '/?p=' . PHP_INT_MAX );
		$this->assertTrue( is_404() );
		$this->assertFalse( resource_hub_theme_has_control() );
	}

	/**
	 * On a page, the script is printed inline, whole, in a tag with its id, with the `<noscript>` rule
	 * after it.
	 */
	public function test_prints_the_script_inline_with_the_noscript_rule(): void {
		$this->go_to( get_permalink( self::factory()->post->create( array( 'post_type' => 'page' ) ) ) );

		$printed = get_echo( 'resource_hub_theme_print_control_script' );
		$script  = $this->read( self::theme_dir() . '/js/theme-control.js' );

		$this->assertSame( 1, preg_match( '/<script[^>]*\sid="resource-hub-theme-control-js"[^>]*>(.*?)<\/script>/s', $printed, $matches ), $printed );
		$this->assertSame( trim( $script ), trim( $matches[1] ) );
		$this->assertDoesNotMatchRegularExpression( '/<script[^>]*\ssrc=/', $printed, 'The script is inline, never an external file to wait for.' );
		$this->assertSame( 1, substr_count( $printed, '<script' ) );

		$this->assertStringContainsString( '<noscript><style>' . RESOURCE_HUB_THEME_NO_CONTROL . '</style></noscript>', $printed );
		$this->assertLessThan( strpos( $printed, '<noscript>' ), strpos( $printed, '</script>' ) );
	}

	/**
	 * On the 404 nothing is printed: no script for anonymous visitors, and no `<noscript>` rule,
	 * since `functions.php` adds the rule as a style on that page.
	 */
	public function test_prints_nothing_on_the_404(): void {
		$this->go_to( '/?p=' . PHP_INT_MAX );
		$this->assertTrue( is_404() );

		$this->assertSame( '', get_echo( 'resource_hub_theme_print_control_script' ) );
	}

	/**
	 * A script file that is missing, or is a directory, reads as an empty string, quietly: no
	 * warning that `display_errors` would print into `<head>`. PHPUnit turns a warning into a
	 * failure here, so a read without the check fails this test.
	 */
	public function test_missing_script_reads_as_empty_without_a_warning(): void {
		$this->assertSame( '', resource_hub_theme_control_script( self::theme_dir() . '/js/no-such-file.js' ) );
		$this->assertSame( '', resource_hub_theme_control_script( self::theme_dir() . '/js' ) );

		// The default is the theme's own file.
		$this->assertSame( $this->read( self::theme_dir() . '/js/theme-control.js' ), resource_hub_theme_control_script() );
	}

	/**
	 * The file printed inline can be: it closes no `<script>` early and holds no PHP tag, and its
	 * first statement applies the stored choice, before anything waits for the DOM.
	 */
	public function test_script_file_is_safe_to_print_inline(): void {
		$script = $this->read( self::theme_dir() . '/js/theme-control.js' );

		$this->assertStringNotContainsStringIgnoringCase( '</script', $script );
		$this->assertStringNotContainsString( '<?', $script );
		$this->assertStringContainsString( "'rh-theme'", $script );
		$this->assertStringContainsString( "'data-theme'", $script );
		$this->assertLessThan( strpos( $script, 'DOMContentLoaded' ), strpos( $script, 'apply( stored() )' ) );
	}

	/**
	 * The hide rule is the front end's `<noscript>` rule, so a footer without script, or the 404, is
	 * laid out as the front end's is without script.
	 */
	public function test_no_control_rule_removes_the_slot(): void {
		$this->assertSame( '.rh-footer__theme{display:none}', RESOURCE_HUB_THEME_NO_CONTROL );
	}

	/**
	 * The markup with the fixture's indentation removed: whitespace holding a line break between two
	 * tags, which the HTML parser ignores. Nothing else: the control is fixed markup on both sides.
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
