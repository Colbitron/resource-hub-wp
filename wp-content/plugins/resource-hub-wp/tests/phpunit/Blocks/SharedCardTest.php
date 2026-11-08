<?php
/**
 * The `resource-hub-card` handle the card-row blocks share.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\SharedCard;
use ResourceHub\Blocks\SharedTokens;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * Covers {@see SharedCard}: the registration, the copies in `build/shared/`, and the blocks' side of the
 * handle. Playwright's `resource-card-block.spec.js` counts the row's rules on a rendered page with both
 * blocks.
 */
final class SharedCardTest extends WP_UnitTestCase {
	/**
	 * Clears the handle, so each test registers it from scratch.
	 */
	public function set_up(): void {
		parent::set_up();
		wp_deregister_style( SharedCard::HANDLE );
	}

	/**
	 * Puts the plugin's registration back for the tests that follow.
	 */
	public function tear_down(): void {
		wp_deregister_style( SharedCard::HANDLE );
		( new SharedCard( $this->plugin_file() ) )->register_style();
		parent::tear_down();
	}

	/**
	 * The two blocks that write rows list the tokens and then this handle; the meta line does not.
	 */
	public function test_row_blocks_share_the_handle(): void {
		$registry = WP_Block_Type_Registry::get_instance();

		foreach ( array( 'resource-hub/related-resources', 'resource-hub/resource-card' ) as $name ) {
			$this->assertSame( array( SharedTokens::HANDLE, SharedCard::HANDLE ), $registry->get_registered( $name )->style_handles, $name );
		}

		$this->assertNotContains( SharedCard::HANDLE, $registry->get_registered( 'resource-hub/resource-meta' )->style_handles );
	}

	/**
	 * With nothing registering the handle, the plugin registers its copy at the tokens' priority, versioned by both files.
	 */
	public function test_plugin_registers_its_copy_when_nothing_has(): void {
		$this->assertTrue( $this->hooked_at_priority(), 'SharedCard should be hooked to init at SharedTokens::PRIORITY.' );

		( new SharedCard( $this->plugin_file() ) )->register_style();

		$style = wp_styles()->query( SharedCard::HANDLE );
		$this->assertNotFalse( $style );
		$this->assertStringEndsWith( '/resource-hub-wp/build/shared/card.css', $style->src );
		$this->assertSame( array(), $style->deps );
		$this->assertArrayNotHasKey( 'path', $style->extra, 'No path, so core never inlines it and the relative @import resolves against the file.' );

		$build = dirname( __DIR__, 3 ) . '/build/shared/';
		$hash  = hash_init( 'sha256' );
		hash_update_file( $hash, $build . 'card.css' );
		hash_update_file( $hash, $build . 'card-labels.css' );
		$this->assertSame( substr( hash_final( $hash ), 0, 20 ), $style->ver, 'The version is the hash of card.css and the card-labels.css it imports.' );
	}

	/**
	 * A handle registered before the plugin's, as a theme's would be, is left alone.
	 */
	public function test_plugin_leaves_an_earlier_registration_alone(): void {
		wp_register_style( SharedCard::HANDLE, 'https://example.org/theme/card.css', array(), '1' );

		( new SharedCard( $this->plugin_file() ) )->register_style();

		$this->assertSame( 'https://example.org/theme/card.css', wp_styles()->query( SharedCard::HANDLE )->src );
	}

	/**
	 * The copies are the package's files byte for byte, never minified, and `card.css` imports its neighbour.
	 *
	 * @dataProvider copies
	 *
	 * @param string $file The file's name in `packages/ui/` and in `build/shared/`.
	 */
	public function test_copy_is_the_package_file( string $file ): void {
		$copy = dirname( __DIR__, 3 ) . '/build/shared/' . $file;

		$this->assertFileExists( $copy, 'Run `pnpm build`.' );
		$this->assertSame( hash_file( 'sha256', dirname( __DIR__, 6 ) . '/packages/ui/' . $file ), hash_file( 'sha256', $copy ), $file . ' differs from the package\'s: run `pnpm build`.' );
	}

	/**
	 * Cases for test_copy_is_the_package_file().
	 *
	 * @return array<string, array{string}>
	 */
	public static function copies(): array {
		return array(
			'card.css'        => array( 'card.css' ),
			'card-labels.css' => array( 'card-labels.css' ),
		);
	}

	/**
	 * The one import in `card.css` is its neighbour, which is why the build ships the two side by side.
	 */
	public function test_card_imports_only_its_neighbour(): void {
		$css = (string) file_get_contents( dirname( __DIR__, 3 ) . '/build/shared/card.css' ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local file from the plugin's own build, read by a test, never a remote URL.

		preg_match_all( '/@import\s+[^;]+;/', $css, $imports );
		$this->assertSame( array( '@import "./card-labels.css";' ), $imports[0] );
	}

	/**
	 * Whether the plugin hooked a `SharedCard` registration to `init` at the tokens' priority.
	 */
	private function hooked_at_priority(): bool {
		global $wp_filter;

		foreach ( $wp_filter['init']->callbacks[ SharedTokens::PRIORITY ] ?? array() as $hooked ) {
			if ( is_array( $hooked['function'] ) && $hooked['function'][0] instanceof SharedCard ) {
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
}
