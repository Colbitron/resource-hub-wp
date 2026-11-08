<?php
/**
 * The theme's header draws the brand mark as the shared package's canonical file does.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use WP_UnitTestCase;

/**
 * Compares the inline mark in `parts/header.html` with `packages/ui/brand/mark.svg`.
 *
 * The mark has one canonical drawing, in the shared package (`packages/ui/DESIGN.md`, "Brand").
 * The theme's header part draws it inline, because a block theme's part is static markup and an
 * inline SVG costs no request, so the copy can drift. This holds it to the canonical file, with the
 * same reduction the front end's `apps/web/test/brand-mark.test.tsx` applies to its two copies:
 * every shape inside the tilted group, reduced to its tag and its attributes with whitespace
 * collapsed, in order. wp-env mounts `packages/ui` into the containers at the same path relative to
 * the WordPress root (`.wp-env.json`), so the file is read where `SchemaValidator` reads the schemas.
 */
final class BrandMarkTest extends WP_UnitTestCase {
	/**
	 * The theme's header part has exactly one SVG, the same drawing as the canonical mark, decorative.
	 */
	public function test_header_mark_is_the_canonical_drawing(): void {
		$canonical = $this->read( dirname( __DIR__, 6 ) . '/packages/ui/brand/mark.svg' );
		$header    = $this->read( WP_CONTENT_DIR . '/themes/resource-hub/parts/header.html' );

		$this->assertSame( 1, preg_match_all( '/<svg\b[\s\S]*?<\/svg>/', $header, $svgs ), 'The header part should draw exactly one SVG.' );
		$inline = $svgs[0][0];

		$this->assertCount( 3, $this->shapes( $canonical ) );
		$this->assertSame( $this->shapes( $canonical ), $this->shapes( $inline ) );
		$this->assertStringContainsString( 'transform="rotate(-6 32 32)"', $inline );
		$this->assertStringContainsString( 'viewBox="0 0 64 64"', $inline );
		$this->assertStringContainsString( 'aria-hidden="true"', $inline );
		$this->assertStringContainsString( 'focusable="false"', $inline );
		$this->assertStringNotContainsString( '<title', $inline );
	}

	/**
	 * The shapes inside the tilted group, each as its tag and attributes, as the front end's test
	 * reduces them.
	 *
	 * @param string $svg An SVG document or element.
	 * @return string[]
	 */
	private function shapes( string $svg ): array {
		$this->assertSame( 1, preg_match( '/<g [^>]*>([\s\S]*?)<\/g>/', $svg, $group ), 'No tilted group in the SVG.' );

		preg_match_all( '/<([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/', $group[1], $elements, PREG_SET_ORDER );

		return array_map(
			static fn ( array $element ): string => $element[1] . rtrim( (string) preg_replace( '/\s+/', ' ', $element[2] ) ),
			$elements
		);
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
