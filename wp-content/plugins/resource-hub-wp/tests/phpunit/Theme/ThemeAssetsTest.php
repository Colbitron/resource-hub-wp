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
 * contract package's tokens, lockup stylesheet, Figtree, its licence and its fallback faces into the
 * theme, and `theme.json` and `functions.php` load the copies. `packages/ui/DESIGN.md` ("Consumers and
 * loading") promises that the copy of the font is byte for byte the package's, proved by a SHA-256
 * the theme records: that record is `figtree.sha256`, committed in the theme, so a new font file
 * fails here until the record is changed with it on purpose. Every other copy is compared with its
 * source directly, and `build/assets.php`, which `functions.php` takes the stylesheets' versions
 * from, must hold each copy's real hash.
 *
 * `pnpm build` runs before PHPUnit, locally and in CI, so a missing build fails here rather than
 * skipping. wp-env mounts `packages/ui` at the same path relative to the WordPress root
 * (`.wp-env.json`), as `BrandMarkTest` reads it.
 */
final class ThemeAssetsTest extends WP_UnitTestCase {
	/**
	 * Each copy's path under the theme's `build/`, and its source under `packages/ui/`.
	 */
	private const COPIES = array(
		'tokens.css'                            => 'tokens.css',
		'brand.css'                             => 'brand.css',
		'fonts/figtree-latin-wght-normal.woff2' => 'fonts/figtree-latin-wght-normal.woff2',
		'fonts/LICENSE-Figtree.txt'             => 'fonts/LICENSE-Figtree.txt',
		'fonts/figtree-fallback.css'            => 'fonts/figtree-fallback.css',
	);

	/**
	 * The font's path under `build/`, as `theme.json` names it and `figtree.sha256` records it.
	 */
	private const FONT = 'fonts/figtree-latin-wght-normal.woff2';

	/**
	 * Every copy is its source byte for byte.
	 */
	public function test_every_copy_is_the_package_file(): void {
		foreach ( self::COPIES as $copy => $source ) {
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
		$manifest = require WP_CONTENT_DIR . '/themes/resource-hub/build/assets.php';

		$this->assertIsArray( $manifest );
		$this->assertSame( array_keys( self::COPIES ), array_keys( $manifest ) );

		foreach ( $manifest as $copy => $hash ) {
			$this->assertSame( $this->sha256( $this->theme( 'build/' . $copy ) ), $hash, "build/assets.php has a stale hash for {$copy}." );
		}
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
