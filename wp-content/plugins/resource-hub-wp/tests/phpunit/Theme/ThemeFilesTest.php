<?php
/**
 * The `resource-hub` theme keeps the two rules issue #89 sets for it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;
use WP_UnitTestCase;

/**
 * Reads the theme's files from `wp-content/themes/resource-hub/`, where `.wp-env.json` mounts them.
 *
 * The lockdown's 404 ({@see \ResourceHub\Lockdown\Gate}) is rendered with this theme's 404
 * template, so whatever that template and the parts it includes print, every anonymous visitor
 * sees. Issue #89 sets two rules for it:
 *
 * - **No block that lists pages.** A navigation block with no menu falls back to a list of every
 *   published page, which would show anonymous visitors what exists. The 404 template and the
 *   parts it includes may use only the blocks in {@see self::ALLOWED_404_BLOCKS}, which print fixed
 *   content. An allow list, not a deny list, so a block added later that lists posts, pages or
 *   terms fails here until someone decides it is safe; `core/pattern` is left out because it pulls
 *   in markup this test cannot follow. {@see self::LISTING_BLOCKS} names the known offenders so a
 *   failure says which rule broke. An allowed block with block bindings (`metadata.bindings`) is
 *   rejected as well: a binding fills a heading or a paragraph from a source such as post meta at
 *   render time, so it would no longer print fixed content.
 * - **No pingback link.** A classic or compat `header.php` prints `<link rel="pingback">` itself,
 *   which the plugin's switch-off of XML-RPC cannot remove. A block theme has no `header.php`, and
 *   no file the theme renders from ({@see self::RENDERED_EXTENSIONS}) may mention pingbacks at all.
 *   The theme's `README.md` explains this rule, so documentation is not read.
 *
 * These read the files, not the rendered page: an editor can still change the header or the
 * footer in the Site Editor, which stores its own copy of a part in the database. The Playwright
 * spec `theme-404.spec.js` checks the page an anonymous visitor actually gets.
 */
final class ThemeFilesTest extends WP_UnitTestCase {
	/**
	 * The theme's directory name, which is its stylesheet slug.
	 */
	private const SLUG = 'resource-hub';

	/**
	 * Extensions of the files WordPress builds the theme's pages from or a browser is served: templates
	 * and parts, PHP in its several spellings, `theme.json`, and the stylesheets, scripts, images and
	 * XML a later slice may add.
	 */
	private const RENDERED_EXTENSIONS = array( 'html', 'htm', 'php', 'phtml', 'inc', 'json', 'css', 'js', 'svg', 'xml' );

	/**
	 * Blocks the 404 template and its parts may use: containers and fixed content only.
	 */
	private const ALLOWED_404_BLOCKS = array(
		'core/template-part',
		'core/group',
		'core/heading',
		'core/paragraph',
		'core/html',
		'core/separator',
		'core/spacer',
	);

	/**
	 * Blocks known to list pages, posts or terms; none may appear in the 404 template or its parts.
	 */
	private const LISTING_BLOCKS = array(
		'core/navigation',
		'core/navigation-link',
		'core/navigation-submenu',
		'core/page-list',
		'core/page-list-item',
		'core/query',
		'core/latest-posts',
		'core/archives',
		'core/categories',
		'core/tag-cloud',
		'core/calendar',
		'core/latest-comments',
		'core/rss',
	);

	/**
	 * WordPress finds the theme where wp-env mounts it, as a block theme with no errors.
	 */
	public function test_theme_is_a_valid_block_theme(): void {
		$theme = wp_get_theme( self::SLUG, WP_CONTENT_DIR . '/themes' );

		$this->assertTrue( $theme->exists(), 'The theme is not mounted at wp-content/themes/' . self::SLUG );
		$this->assertFalse( $theme->errors() );
		$this->assertTrue( $theme->is_block_theme() );
	}

	/**
	 * No `header.php`, the file that prints the pingback link in a classic or compat theme.
	 */
	public function test_theme_has_no_header_php(): void {
		$this->assertFileDoesNotExist( $this->theme_dir() . '/header.php' );
	}

	/**
	 * No file the theme renders from mentions pingbacks: no `rel="pingback"`, no `pingback_url`.
	 */
	public function test_no_theme_file_mentions_pingbacks(): void {
		$files = array_filter(
			$this->theme_files(),
			static fn ( string $path ): bool => in_array( strtolower( pathinfo( $path, PATHINFO_EXTENSION ) ), self::RENDERED_EXTENSIONS, true )
		);

		$this->assertNotEmpty( $files );
		foreach ( $files as $path ) {
			$this->assertStringNotContainsStringIgnoringCase( 'pingback', $this->read( $path ), $path );
		}
	}

	/**
	 * The 404 template and every part it includes use only fixed-content blocks.
	 */
	public function test_404_template_and_its_parts_list_nothing(): void {
		$parts  = array();
		$blocks = $this->blocks_of( 'templates/404.html', $parts );

		// The walk reached the header and the footer, so the test is not passing on an empty tree.
		$this->assertSame( array( 'header', 'footer' ), $parts );

		foreach ( $blocks as $block ) {
			$this->assertNotContains( $block['name'], self::LISTING_BLOCKS, $block['name'] . ' lists content, in ' . $block['file'] );
			$this->assertContains( $block['name'], self::ALLOWED_404_BLOCKS, $block['name'] . ' is not on the 404 allow list, in ' . $block['file'] );

			$this->assertArrayNotHasKey( 'bindings', $block['metadata'], $block['name'] . ' is bound to dynamic content, in ' . $block['file'] );

			// Raw HTML is fixed content, but must not smuggle in a navigation landmark.
			$this->assertDoesNotMatchRegularExpression( '/<nav\b/i', $block['html'], $block['file'] );
		}
	}

	/**
	 * Every block in a template file, with the template parts it includes followed into
	 * `parts/`, flattened.
	 *
	 * @param string   $file  Path relative to the theme directory.
	 * @param string[] $parts The part slugs followed so far, in order; filled in.
	 * @return array<int, array{name: string, file: string, html: string, metadata: array<string, mixed>}>
	 */
	private function blocks_of( string $file, array &$parts ): array {
		$path = $this->theme_dir() . '/' . $file;
		$this->assertFileExists( $path );

		$found = array();
		$queue = parse_blocks( $this->read( $path ) );

		while ( $queue ) {
			$block = array_shift( $queue );
			$queue = array_merge( $block['innerBlocks'], $queue );

			// Whitespace between blocks parses as a block with no name.
			if ( null === $block['blockName'] ) {
				continue;
			}

			$found[] = array(
				'name'     => $block['blockName'],
				'file'     => $file,
				'html'     => (string) $block['innerHTML'],
				'metadata' => is_array( $block['attrs']['metadata'] ?? null ) ? $block['attrs']['metadata'] : array(),
			);

			if ( 'core/template-part' !== $block['blockName'] ) {
				continue;
			}

			$attrs = $block['attrs'];
			$this->assertArrayHasKey( 'slug', $attrs, 'A template part without a slug, in ' . $file );
			if ( isset( $attrs['theme'] ) ) {
				$this->assertSame( self::SLUG, $attrs['theme'], 'A part from another theme, in ' . $file );
			}
			$this->assertNotContains( $attrs['slug'], $parts, 'A part included twice: ' . $attrs['slug'] );

			$parts[] = $attrs['slug'];
			$found   = array_merge( $found, $this->blocks_of( 'parts/' . $attrs['slug'] . '.html', $parts ) );
		}

		return $found;
	}

	/**
	 * The theme's directory in the container.
	 */
	private function theme_dir(): string {
		return WP_CONTENT_DIR . '/themes/' . self::SLUG;
	}

	/**
	 * Every file under the theme's directory, as absolute paths.
	 *
	 * @return string[]
	 */
	private function theme_files(): array {
		$files    = array();
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $this->theme_dir(), FilesystemIterator::SKIP_DOTS )
		);

		foreach ( $iterator as $file ) {
			if ( $file instanceof SplFileInfo && $file->isFile() ) {
				$files[] = $file->getPathname();
			}
		}

		sort( $files );

		return $files;
	}

	/**
	 * A file's contents.
	 *
	 * @param string $path Absolute path to a theme file.
	 */
	private function read( string $path ): string {
		$contents = file_get_contents( $path ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local theme file read by a test, never a remote URL.
		$this->assertIsString( $contents, $path );

		return $contents;
	}
}
