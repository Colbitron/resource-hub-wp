<?php
/**
 * The `resource-hub-tokens` handle the block and the theme share.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\SharedTokens;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * Covers {@see SharedTokens} and the block's side of the handle.
 *
 * The tests site runs on core's test theme, `default`, which has no `functions.php`, so these are the
 * "any other theme" case: the plugin registers its own copy. The theme's own registration, which runs
 * first when the `resource-hub` theme is active, is loaded here from its `functions.php` to prove the
 * plugin then leaves the handle alone. Playwright's `theme-assets.spec.js` counts the tokens on a
 * rendered page with the block.
 */
final class SharedTokensTest extends WP_UnitTestCase {
	/**
	 * Clears the handle, so each test registers it from scratch.
	 */
	public function set_up(): void {
		parent::set_up();
		wp_deregister_style( SharedTokens::HANDLE );
	}

	/**
	 * Puts the plugin's registration back for the tests that follow.
	 */
	public function tear_down(): void {
		wp_deregister_style( SharedTokens::HANDLE );
		( new SharedTokens( $this->plugin_file() ) )->register_style();
		parent::tear_down();
	}

	/**
	 * The block's styles are the shared handle first, then its own file, which no longer carries the tokens.
	 */
	public function test_block_lists_the_shared_handle_before_its_own_style(): void {
		$block = WP_Block_Type_Registry::get_instance()->get_registered( 'resource-hub/related-resources' );

		$this->assertNotNull( $block, 'Run `pnpm build`: the block is registered from build/.' );
		$this->assertCount( 2, $block->style_handles );
		$this->assertSame( SharedTokens::HANDLE, $block->style_handles[0], 'The tokens load before the row that builds on them.' );

		$own = $this->read( dirname( __DIR__, 3 ) . '/build/related-resources/style-index.css' );
		$this->assertStringContainsString( '.rh-card', $own );
		$this->assertStringNotContainsString( '--rh-color-text:', $own, 'The block stylesheet should not inline tokens.css; it names the shared handle.' );
	}

	/**
	 * With no theme registering the handle, the plugin registers its own copy, at a later `init` priority.
	 */
	public function test_plugin_registers_its_copy_when_no_theme_has(): void {
		$this->assertTrue( $this->hooked_at_priority(), 'SharedTokens should be hooked to init at its PRIORITY.' );
		$this->assertGreaterThan( 10, SharedTokens::PRIORITY, "The theme registers at init's default priority, and must go first." );

		( new SharedTokens( $this->plugin_file() ) )->register_style();

		$style = wp_styles()->query( SharedTokens::HANDLE );
		$this->assertNotFalse( $style );
		$this->assertStringEndsWith( '/resource-hub-wp/build/shared/tokens.css', $style->src );
		$this->assertMatchesRegularExpression( '/^[0-9a-f]{20}$/', (string) $style->ver );
		$this->assertSame( substr( (string) hash_file( 'sha256', dirname( __DIR__, 3 ) . '/build/shared/tokens.css' ), 0, 20 ), $style->ver );
	}

	/**
	 * When the theme has registered the handle, the plugin leaves it alone.
	 */
	public function test_plugin_leaves_the_themes_registration_alone(): void {
		require_once WP_CONTENT_DIR . '/themes/resource-hub/functions.php';

		resource_hub_theme_register_styles();
		( new SharedTokens( $this->plugin_file() ) )->register_style();

		$style = wp_styles()->query( SharedTokens::HANDLE );
		$this->assertNotFalse( $style );
		// The active theme's URL (core's test theme here), not the plugin's copy.
		$this->assertSame( get_theme_file_uri( 'build/tokens.css' ), $style->src );
		$this->assertStringNotContainsString( '/plugins/', $style->src );

		wp_deregister_style( 'resource-hub-figtree-fallback' );
		wp_deregister_style( 'resource-hub-brand' );
	}

	/**
	 * The plugin's copy is the package's `tokens.css` byte for byte, never minified.
	 */
	public function test_plugin_copy_is_the_package_file(): void {
		$copy = dirname( __DIR__, 3 ) . '/build/shared/tokens.css';

		$this->assertFileExists( $copy, 'Run `pnpm build`.' );
		$this->assertSame( hash_file( 'sha256', dirname( __DIR__, 6 ) . '/packages/ui/tokens.css' ), hash_file( 'sha256', $copy ) );
	}

	/**
	 * Whether the plugin hooked a `SharedTokens` registration to `init` at {@see SharedTokens::PRIORITY}.
	 */
	private function hooked_at_priority(): bool {
		global $wp_filter;

		foreach ( $wp_filter['init']->callbacks[ SharedTokens::PRIORITY ] ?? array() as $hooked ) {
			if ( is_array( $hooked['function'] ) && $hooked['function'][0] instanceof SharedTokens ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * The plugin's main file.
	 */
	private function plugin_file(): string {
		return dirname( __DIR__, 3 ) . '/resource-hub.php';
	}

	/**
	 * A file's contents.
	 *
	 * @param string $path Absolute path in the container.
	 */
	private function read( string $path ): string {
		$this->assertFileExists( $path );
		$contents = file_get_contents( $path ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local file from the repository, read by a test, never a remote URL.
		$this->assertIsString( $contents, $path );

		return $contents;
	}
}
