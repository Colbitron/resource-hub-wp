<?php
/**
 * The `resource-hub/resource-source` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\ResourceSourceBlock;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Block;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The line's link follows the front end's `sourceLink()` (`apps/web/lib/source-link.ts`), case by case:
 * an external host with and without a port, an internationalised host in punycode, an upload on the CMS, a
 * front-end path on the CMS, paths read with their dot segments resolved, a CMS URL the front end will not
 * link (another port included), and the URLs that are not links at all.
 */
final class ResourceSourceBlockTest extends WP_UnitTestCase {
	/**
	 * A type term's ID.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * One type.
	 */
	public function set_up(): void {
		parent::set_up();
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$this->assertTrue(
			WP_Block_Type_Registry::get_instance()->is_registered( ResourceSourceBlock::NAME ),
			'The block is not registered: run `pnpm build` so build/resource-source/block.json exists.'
		);

		$this->type = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
	}

	/**
	 * The compiled block.json: the callback, the context, no attributes, no wrapper supports and no stylesheet.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( ResourceSourceBlock::NAME );

		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'postId', 'postType' ), $type->uses_context );
		$this->assertArrayNotHasKey( 'attributes', wp_json_file_decode( dirname( __DIR__, 3 ) . '/build/resource-source/block.json', array( 'associative' => true ) ) );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );
		$this->assertSame( array(), $type->style_handles, 'The line is styled by the theme\'s resource.css.' );
	}

	/**
	 * An external URL links as stored, shown by its host, lower-cased with trailing dots removed and with a
	 * port that is not the scheme's default, with `rel="noopener noreferrer"`.
	 */
	public function test_external_source_is_shown_by_its_host(): void {
		$this->assertSame(
			'<footer class="rh-resource__source"><p>Source: <a href="https://Example.COM./downloads/guide.pdf?v=2" rel="noopener noreferrer">example.com</a></p></footer>',
			$this->render( $this->resource( 'https://Example.COM./downloads/guide.pdf?v=2' ) )
		);
		$this->assertStringContainsString( '>example.com:8443</a>', $this->render( $this->resource( 'https://example.com:8443/x' ) ) );
		$this->assertStringContainsString( '>example.com</a>', $this->render( $this->resource( 'http://example.com:80/x' ) ), 'The scheme\'s default port is not shown.' );
	}

	/**
	 * An upload on the CMS links the file itself and is shown by its file name, decoded, with no `rel`.
	 */
	public function test_upload_is_shown_by_its_file_name(): void {
		$url = wp_get_upload_dir()['baseurl'] . '/2026/11/field%20guide.pdf';

		$this->assertSame(
			'<footer class="rh-resource__source"><p>Source: <a href="' . esc_url( $url ) . '">field guide.pdf</a></p></footer>',
			$this->render( $this->resource( $url ) )
		);
	}

	/**
	 * A CMS URL under `/resources` links the front end's path on the CMS's origin, with the trailing slash
	 * every public URL has, its query and fragment kept, and is shown as that path; any other CMS URL is no link.
	 */
	public function test_cms_url_is_a_front_end_path_or_nothing(): void {
		$this->assertSame(
			'<footer class="rh-resource__source"><p>Source: <a href="' . esc_url( home_url( '/resources/webinar/?a=1#top' ) ) . '">/resources/webinar/?a=1#top</a></p></footer>',
			$this->render( $this->resource( home_url( '/resources/webinar?a=1#top' ) ) )
		);
		$this->assertStringContainsString( '>/resources/</a>', $this->render( $this->resource( home_url( '/resources' ) ) ) );

		foreach ( array( home_url( '/wp-admin/' ), home_url( '/about/' ), home_url( '/resourcesx/' ), home_url( '/' ) ) as $url ) {
			$this->assertSame( '', $this->render( $this->resource( $url ) ), $url );
		}
	}

	/**
	 * An internationalised host is shown in punycode, the front end's anti-spoofing rule, so a look-alike
	 * cannot pass for a Latin name; the link itself is the URL as stored.
	 */
	public function test_internationalised_host_is_shown_in_punycode(): void {
		// A Cyrillic "а" (U+0430) in place of the Latin "a": the front end's `sourceLink()` test.
		$this->assertSame(
			"<footer class=\"rh-resource__source\"><p>Source: <a href=\"https://\u{430}pple.example/\" rel=\"noopener noreferrer\">xn--pple-43d.example</a></p></footer>",
			$this->render( $this->resource( "https://\u{430}pple.example/" ) )
		);
		$this->assertStringContainsString( '>xn--mnchen-3ya.example</a>', $this->render( $this->resource( 'https://MÜNCHEN.example./report' ) ), 'Lower-cased first, trailing dot removed.' );
		$this->assertStringContainsString( '>xn--pple-43d.example</a>', $this->render( $this->resource( 'https://%D0%B0pple.example/' ) ), 'A percent-encoded host is decoded first.' );
		$this->assertSame( '', $this->render( $this->resource( 'https://ev%20il.example/' ) ), 'A host the URL parser refuses is no line.' );
	}

	/**
	 * A path is read with its dot segments resolved, as the front end's URL parser and a browser read it, so
	 * a URL that climbs out of the uploads directory or `/resources` is judged by where it lands.
	 */
	public function test_dot_segments_are_resolved_before_the_rules(): void {
		$uploads = wp_get_upload_dir()['baseurl'];

		foreach ( array( $uploads . '/../../wp-admin/export.php', $uploads . '/%2e%2e/%2E%2e/wp-admin/export.php', home_url( '/resources/../wp-admin/' ), home_url( '/resources\\x\\..\\..\\wp-admin/' ) ) as $url ) {
			$this->assertSame( '', $this->render( $this->resource( $url ) ), $url );
		}

		$this->assertStringContainsString( '<a href="' . esc_url( home_url( '/resources/y/' ) ) . '">/resources/y/</a>', $this->render( $this->resource( home_url( '/resources/x/../y/' ) ) ) );
		$this->assertStringContainsString( '>/resources/?q#h</a>', $this->render( $this->resource( home_url( '/resources/x/.%2E?q#h' ) ) ), 'A last `..` leaves the trailing slash.' );
		$this->assertStringContainsString( '>/resources/</a>', $this->render( $this->resource( home_url( '/wp-admin/../resources/' ) ) ) );
		$this->assertStringContainsString( '>/resources/.../</a>', $this->render( $this->resource( home_url( '/resources/.../' ) ) ), 'Three dots are a name, not a dot segment.' );
		$this->assertSame(
			'<footer class="rh-resource__source"><p>Source: <a href="' . esc_url( $uploads . '/2026/a.pdf' ) . '">a.pdf</a></p></footer>',
			$this->render( $this->resource( $uploads . '/2026/./x/../a.pdf' ) )
		);
	}

	/**
	 * An upload path the front end's `uploadsPath()` refuses is no line: nothing after the directory, a
	 * second slash, or an escape a server could decode into a new segment.
	 */
	public function test_upload_paths_the_front_end_refuses(): void {
		$uploads = wp_get_upload_dir()['baseurl'];

		foreach ( array( $uploads . '/', $uploads . '//a.pdf', $uploads . '/a%2fb.pdf', $uploads . '/a%5Cb.pdf', $uploads . '/a%252fb.pdf' ) as $url ) {
			$this->assertSame( '', $this->render( $this->resource( $url ) ), $url );
		}
	}

	/**
	 * A URL on the CMS's host but another port is no line: the front end's last check compares host names,
	 * not ports, so it is never shown as an external link to the CMS.
	 */
	public function test_cms_host_on_another_port_is_no_line(): void {
		$home = wp_parse_url( home_url( '/' ) );
		$host = $home['host'];

		foreach ( array( 'http://' . $host . ':9999/report.pdf', 'https://' . strtoupper( $host ) . '.:9999/resources/', 'https://' . $host . '/report.pdf' ) as $url ) {
			$this->assertSame( '', $this->render( $this->resource( $url ) ), $url );
		}

	}

	/**
	 * Leading slashes on a CMS path collapse to one, as the front end's `singleLeadingSlash()` makes them.
	 */
	public function test_cms_path_leading_slashes_collapse(): void {
		$this->assertStringContainsString( '>/resources/</a>', $this->render( $this->resource( rtrim( home_url( '/' ), '/' ) . '//resources/' ) ) );
	}

	/**
	 * No source, or a value that is not an absolute http(s) URL with a host and no user name, is no line.
	 */
	public function test_renders_nothing_for_a_source_that_is_not_a_link(): void {
		foreach ( array( '', '   ', 'example.com', '//example.com/x', 'mailto:a@example.com', 'javascript:alert(1)', 'https://user@example.com/', 'https://user:pass@example.com/', 'ftp://example.com/x' ) as $url ) {
			$this->assertSame( '', $this->render( $this->resource( $url ) ), $url );
		}
	}

	/**
	 * Anything but a published resource with exactly one type renders nothing, as the meta block.
	 */
	public function test_renders_nothing_without_a_published_typed_resource(): void {
		$this->assertSame( '', $this->render( null ), 'No context.' );
		$this->assertSame( '', $this->render( self::factory()->post->create() ), 'A post.' );
		$this->assertSame( '', $this->render( $this->resource( 'https://example.com/', array( 'post_status' => 'draft' ) ) ), 'A draft.' );

		$untyped = $this->resource( 'https://example.com/' );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$this->assertSame( '', $this->render( $untyped ), 'No type.' );

		$this->assertSame( '', $this->render( $this->resource( 'https://example.com/' ), 'post' ), 'A postType context that is not resource.' );
	}

	/**
	 * In a single template, `do_blocks()` gives the block the global post as its context.
	 */
	public function test_renders_the_global_post(): void {
		$GLOBALS['post'] = get_post( $this->resource( 'https://example.com/guide' ) ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The loop's global post, which a single template sets.
		$html            = do_blocks( '<!-- wp:resource-hub/resource-source /-->' );
		unset( $GLOBALS['post'] );

		$this->assertStringStartsWith( '<footer class="rh-resource__source">', $html );
	}

	/**
	 * A published resource of the type with this stored `source_url`, written as a row so the cases a
	 * sanitizer would refuse are tested too.
	 *
	 * @param string               $url  The stored `source_url`.
	 * @param array<string, mixed> $args More `wp_insert_post()` arguments.
	 */
	private function resource( string $url, array $args = array() ): int {
		$id = self::factory()->post->create(
			array_merge(
				array(
					'post_type'   => PostType::NAME,
					'post_status' => 'publish',
				),
				$args
			)
		);
		wp_set_object_terms( $id, array( $this->type ), Taxonomies::TYPE );
		remove_all_filters( 'sanitize_post_meta_' . Meta::SOURCE_URL );
		remove_all_filters( 'sanitize_post_meta_' . Meta::SOURCE_URL . '_for_' . PostType::NAME );
		update_post_meta( $id, Meta::SOURCE_URL, wp_slash( $url ) );
		$this->assertSame( $url, get_post_meta( $id, Meta::SOURCE_URL, true ) );

		return $id;
	}

	/**
	 * The block rendered through `WP_Block` with the post as its context.
	 *
	 * @param int|null    $post      The context's post, or none.
	 * @param string|null $post_type The context's post type; the post's own when null.
	 */
	private function render( ?int $post, ?string $post_type = null ): string {
		$parsed = array(
			'blockName'    => ResourceSourceBlock::NAME,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);

		return ( new WP_Block(
			$parsed,
			null === $post ? array() : array(
				'postId'   => $post,
				'postType' => $post_type ?? get_post_type( $post ),
			)
		) )->render();
	}
}
