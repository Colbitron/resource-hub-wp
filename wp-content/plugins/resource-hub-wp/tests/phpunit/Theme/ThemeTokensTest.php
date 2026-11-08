<?php
/**
 * The theme's `theme.json` presets are the shared package's tokens.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use WP_UnitTestCase;

/**
 * Compares `wp-content/themes/resource-hub/theme.json` with `packages/ui/tokens.css`.
 *
 * `packages/ui/DESIGN.md` ("Consumers and loading") says the theme's palette, scale and spacing are
 * the tokens and that a parity test compares the two. Each preset references its token
 * (`var(--rh-…)`) rather than copying its value, so a value can only change in `tokens.css`; this
 * holds the lists themselves, in both directions and in the tokens' order:
 *
 * - the palette is every `--rh-color-*` token, and no `--rh-mark-*` one: the five accents are for small
 *   marks only, never text or a text background, so they are not offered to editors as colours;
 * - the font sizes are every `--rh-text-*` token, and the spacing sizes every `--rh-space-*` one;
 * - the layout's content and wide sizes are `--rh-measure` and `--rh-measure-wide`;
 * - the one font family registers Figtree under the plain name `--rh-font-sans` falls back to, from
 *   the theme's copy of the package's file, with the front end's `swap`.
 *
 * Each preset's slug is the token's suffix as WordPress spells it in a custom property
 * (`_wp_to_kebab_case()`: `2xl` is `2-xl`), so a `var:preset|…` reference finds the property core
 * prints. Adding, renaming or removing a token in one of these groups fails here until `theme.json`
 * follows; so does a raw colour or length written into `theme.json`, or a reference to a token that
 * does not exist.
 */
final class ThemeTokensTest extends WP_UnitTestCase {
	/**
	 * Every preset group and the token prefix it mirrors: the `settings` path, the preset's value key,
	 * and the prefix.
	 */
	private const GROUPS = array(
		'palette'    => array( array( 'color', 'palette' ), 'color', '--rh-color-' ),
		'font sizes' => array( array( 'typography', 'fontSizes' ), 'size', '--rh-text-' ),
		'spacing'    => array( array( 'spacing', 'spacingSizes' ), 'size', '--rh-space-' ),
	);

	/**
	 * Each preset group lists its tokens, in order, each by reference.
	 */
	public function test_presets_are_the_tokens(): void {
		$settings = $this->theme_json()['settings'];

		foreach ( self::GROUPS as $group => list( $path, $key, $prefix ) ) {
			$presets = $settings[ $path[0] ][ $path[1] ] ?? null;
			$this->assertIsArray( $presets, "theme.json has no {$group}." );

			$expected = array_map(
				static fn ( string $token ): array => array( _wp_to_kebab_case( substr( $token, strlen( $prefix ) ) ), "var({$token})" ),
				$this->tokens( $prefix )
			);
			$actual   = array_map(
				static fn ( array $preset ): array => array( $preset['slug'] ?? null, $preset[ $key ] ?? null ),
				$presets
			);

			$this->assertNotEmpty( $expected, "tokens.css has no {$prefix}* tokens." );
			$this->assertSame( $expected, $actual, "theme.json's {$group} should be the {$prefix}* tokens, in order, each as var()." );
		}
	}

	/**
	 * The palette offers no mark accent.
	 */
	public function test_palette_offers_no_mark(): void {
		$palette = wp_json_encode( $this->theme_json()['settings']['color']['palette'] );

		$this->assertIsString( $palette );
		$this->assertStringNotContainsString( '--rh-mark-', $palette );
	}

	/**
	 * The layout's widths are the two measures.
	 */
	public function test_layout_widths_are_the_measures(): void {
		$layout = $this->theme_json()['settings']['layout'];

		$this->assertContains( '--rh-measure', $this->tokens( '--rh-measure' ) );
		$this->assertContains( '--rh-measure-wide', $this->tokens( '--rh-measure' ) );
		$this->assertSame( 'var(--rh-measure)', $layout['contentSize'] ?? null );
		$this->assertSame( 'var(--rh-measure-wide)', $layout['wideSize'] ?? null );
	}

	/**
	 * Figtree is registered under the name the token's stack falls back to, from the theme's copy.
	 */
	public function test_font_family_registers_figtree_for_the_token(): void {
		$families = $this->theme_json()['settings']['typography']['fontFamilies'];

		$this->assertCount( 1, $families, 'Figtree is the only typeface.' );
		$this->assertSame( '"Figtree", var(--rh-font-sans)', $families[0]['fontFamily'] );

		// The front end's loader sets --rh-font-figtree; the theme leaves it unset, so the stack falls back to "Figtree".
		$this->assertMatchesRegularExpression( '/--rh-font-sans:\s*var\(--rh-font-figtree,\s*"Figtree"\)/', $this->tokens_css() );

		$this->assertCount( 1, $families[0]['fontFace'] );
		$face = $families[0]['fontFace'][0];
		$this->assertSame( 'Figtree', $face['fontFamily'] );
		$this->assertSame( 'normal', $face['fontStyle'] );
		$this->assertSame( '300 900', $face['fontWeight'], "The variable file's weight axis, as apps/web/app/fonts.ts declares it." );
		$this->assertSame( 'swap', $face['fontDisplay'], 'DESIGN.md, "Font display: swap".' );
		$this->assertSame( array( 'file:./build/fonts/figtree-latin-wght-normal.woff2' ), $face['src'] );
		$this->assertFileExists( dirname( __DIR__, 6 ) . '/packages/ui/fonts/figtree-latin-wght-normal.woff2' );
	}

	/**
	 * `theme.json` writes no raw colour or length, and every token it names exists.
	 */
	public function test_theme_json_writes_no_raw_values(): void {
		$json = $this->read( WP_CONTENT_DIR . '/themes/resource-hub/theme.json' );

		$this->assertDoesNotMatchRegularExpression( '/#[0-9a-f]{3,8}\b/i', $json, 'A colour belongs in tokens.css.' );
		$this->assertDoesNotMatchRegularExpression( '/\b(?:rgba?|hsla?|oklch|lab|lch|light-dark)\(/i', $json, 'A colour belongs in tokens.css.' );
		$this->assertDoesNotMatchRegularExpression( '/\d(?:px|rem|em|ch|vw|vh|%)\b/', $json, 'A length belongs in tokens.css.' );

		preg_match_all( '/var\((--rh-[a-z0-9-]+)\)/', $json, $references );
		$this->assertNotEmpty( $references[1] );
		$this->assertSame( array(), array_values( array_diff( array_unique( $references[1] ), $this->tokens( '--rh-' ) ) ), 'theme.json names a token tokens.css does not declare.' );
	}

	/**
	 * The tokens `tokens.css` declares with a prefix, in order.
	 *
	 * @param string $prefix Token prefix, such as `--rh-color-`.
	 * @return string[]
	 */
	private function tokens( string $prefix ): array {
		preg_match_all( '/(--rh-[a-z0-9-]+)\s*:/', $this->tokens_css(), $matches );

		return array_values( array_filter( $matches[1], static fn ( string $token ): bool => str_starts_with( $token, $prefix ) ) );
	}

	/**
	 * `packages/ui/tokens.css` without its comments.
	 */
	private function tokens_css(): string {
		return (string) preg_replace( '#/\*.*?\*/#s', '', $this->read( dirname( __DIR__, 6 ) . '/packages/ui/tokens.css' ) );
	}

	/**
	 * The theme's `theme.json`, decoded.
	 *
	 * @return array<string, mixed>
	 */
	private function theme_json(): array {
		$decoded = json_decode( $this->read( WP_CONTENT_DIR . '/themes/resource-hub/theme.json' ), true );
		$this->assertIsArray( $decoded );

		return $decoded;
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
