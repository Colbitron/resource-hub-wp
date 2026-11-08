<?php
/**
 * The theme's built assets are the shared package's files, byte for byte.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use WP_UnitTestCase;

/**
 * Holds `wp-content/themes/resource-hub/build/` to `packages/ui/`.
 *
 * The host never sees the pnpm workspace, so the theme's build (`scripts/build.mjs`) copies the
 * contract package's tokens, lockup stylesheet, Figtree, its licence, its fallback faces, the base
 * and shell styles and the component stylesheets its templates render into the theme, and
 * `theme.json` and `functions.php` load the copies. `packages/ui/DESIGN.md` ("Consumers and
 * loading") promises that the copy of the font is byte for byte the package's, proved by a SHA-256
 * the theme records: that record is `figtree.sha256`, committed in the theme, so a new font file
 * fails here until the record is changed with it on purpose. Every other copy is compared with its
 * source directly.
 *
 * The theme's one list of what it copies, and of the stylesheets it registers with their handles
 * and order, is `ASSETS` in `scripts/build.mjs`, which the build writes into `build/assets.php`:
 * `copies` (each copy's path under `build/`, the same as its path in the package, and its SHA-256)
 * and `styles` (each handle's file and the handles it loads after). `functions.php` registers every
 * stylesheet from that manifest. So these tests read the manifest rather than keep a list of their
 * own: every copy must be the package's file with its real hash, every registered stylesheet a
 * copied one and every copied stylesheet registered, and every handle `functions.php` enqueues one
 * the manifest registers, so a stylesheet dropped from the build, or a handle renamed on one side,
 * fails here.
 *
 * `pnpm build` runs before PHPUnit, locally and in CI, so a missing build fails here rather than
 * skipping. wp-env mounts `packages/ui` at the same path relative to the WordPress root
 * (`.wp-env.json`), as `BrandMarkTest` reads it.
 */
final class ThemeAssetsTest extends WP_UnitTestCase {
	/**
	 * The font's path under `build/`, as `theme.json` names it and `figtree.sha256` records it.
	 */
	private const FONT = 'fonts/figtree-latin-wght-normal.woff2';

	/**
	 * Every copy is its source byte for byte.
	 */
	public function test_every_copy_is_the_package_file(): void {
		$copies = $this->manifest()['copies'];
		// The manifest is not passing on an empty list: the tokens, the font and its licence are in it.
		foreach ( array( 'tokens.css', self::FONT, 'fonts/LICENSE-Figtree.txt' ) as $required ) {
			$this->assertArrayHasKey( $required, $copies );
		}

		foreach ( array_keys( $copies ) as $copy ) {
			$source = $copy;
			$this->assertFileExists( $this->theme( 'build/' . $copy ), "Run `pnpm build`: the theme's build has no {$copy}." );
			$this->assertSame(
				$this->sha256( $this->package( $source ) ),
				$this->sha256( $this->theme( 'build/' . $copy ) ),
				"The theme's build/{$copy} is not packages/ui/{$source} byte for byte."
			);
		}
	}

	/**
	 * The font's SHA-256 committed in the theme is the package's file and the theme's copy.
	 */
	public function test_font_is_the_file_the_theme_records(): void {
		$record = trim( $this->read( $this->theme( 'figtree.sha256' ) ) );

		$this->assertSame( 1, preg_match( '/^([0-9a-f]{64})  (\S+)$/', $record, $matches ), 'figtree.sha256 should be one line in `shasum -a 256` form.' );
		$this->assertSame( 'build/' . self::FONT, $matches[2], 'figtree.sha256 should name the copy theme.json loads.' );
		$this->assertSame( $matches[1], $this->sha256( $this->package( self::FONT ) ), 'packages/ui has a different Figtree file from the one the theme records; change figtree.sha256 with it.' );
		$this->assertSame( $matches[1], $this->sha256( $this->theme( 'build/' . self::FONT ) ), "The theme's copy of Figtree is not the file it records." );
	}

	/**
	 * The licence ships beside the font, as the SIL Open Font License requires of a copy.
	 */
	public function test_licence_is_beside_the_font(): void {
		$this->assertStringContainsString( 'SIL OPEN FONT LICENSE', $this->read( $this->theme( 'build/' . dirname( self::FONT ) . '/LICENSE-Figtree.txt' ) ) );
	}

	/**
	 * `build/assets.php` lists exactly the copies, each with its real SHA-256.
	 */
	public function test_assets_manifest_holds_each_copys_hash(): void {
		foreach ( $this->manifest()['copies'] as $copy => $hash ) {
			$this->assertSame( $this->sha256( $this->theme( 'build/' . $copy ) ), $hash, "build/assets.php has a stale hash for {$copy}." );
		}
	}

	/**
	 * Every registered stylesheet is a copied `.css` file, every copied stylesheet is registered, and
	 * every handle a stylesheet loads after is registered by the theme or, for none yet, core.
	 */
	public function test_every_copied_stylesheet_is_registered(): void {
		$manifest = $this->manifest();
		$files    = array_column( $manifest['styles'], 0 );

		$this->assertContains( 'resource-hub-tokens', array_keys( $manifest['styles'] ) );
		foreach ( $manifest['styles'] as $handle => list( $file, $deps ) ) {
			$this->assertStringStartsWith( 'resource-hub-', $handle );
			$this->assertArrayHasKey( $file, $manifest['copies'], "{$handle} names {$file}, which the build does not copy." );
			foreach ( $deps as $dep ) {
				$this->assertArrayHasKey( $dep, $manifest['styles'], "{$handle} loads after {$dep}, which the theme does not register." );
			}
		}
		foreach ( array_keys( $manifest['copies'] ) as $copy ) {
			if ( str_ends_with( $copy, '.css' ) ) {
				$this->assertContains( $copy, $files, "The build copies {$copy} but registers no handle for it." );
			}
		}
	}

	/**
	 * Every handle `functions.php` enqueues is one the manifest registers.
	 */
	public function test_every_enqueued_handle_is_registered(): void {
		$styles = $this->manifest()['styles'];

		$this->assertGreaterThan( 5, preg_match_all( "/wp_enqueue_style\\(\\s*'([^']+)'/", $this->read( $this->theme( 'functions.php' ) ), $matches ) );
		foreach ( array_unique( $matches[1] ) as $handle ) {
			$this->assertArrayHasKey( $handle, $styles, "functions.php enqueues {$handle}, which build/assets.php does not register." );
		}
	}

	/**
	 * The manifest `scripts/build.mjs` writes.
	 *
	 * @return array{copies: array<string, string>, styles: array<string, array{0: string, 1: string[]}>}
	 */
	private function manifest(): array {
		$this->assertFileExists( WP_CONTENT_DIR . '/themes/resource-hub/build/assets.php', 'Run `pnpm build`: the theme has no build/assets.php.' );
		$manifest = require WP_CONTENT_DIR . '/themes/resource-hub/build/assets.php';

		$this->assertIsArray( $manifest );
		$this->assertSame( array( 'copies', 'styles' ), array_keys( $manifest ) );

		return $manifest;
	}

	/**
	 * A path inside the theme.
	 *
	 * @param string $relative Path relative to the theme's directory.
	 */
	private function theme( string $relative ): string {
		return WP_CONTENT_DIR . '/themes/resource-hub/' . $relative;
	}

	/**
	 * A path inside the shared package.
	 *
	 * @param string $relative Path relative to `packages/ui/`.
	 */
	private function package( string $relative ): string {
		return dirname( __DIR__, 6 ) . '/packages/ui/' . $relative;
	}

	/**
	 * A file's SHA-256.
	 *
	 * @param string $path Absolute path in the container.
	 */
	private function sha256( string $path ): string {
		$this->assertFileExists( $path );
		$hash = hash_file( 'sha256', $path );
		$this->assertIsString( $hash, $path );

		return $hash;
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
