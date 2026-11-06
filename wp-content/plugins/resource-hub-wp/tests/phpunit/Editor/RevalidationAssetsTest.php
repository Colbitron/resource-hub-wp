<?php
/**
 * The block editor's revalidation feedback script: where it is enqueued and what it is handed (see `docs/architecture/revalidation.md`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Editor;

use ResourceHub\Admin\ResultText;
use ResourceHub\ContentModel\PostType;
use ResourceHub\Editor\RevalidationAssets;
use ResourceHub\Revalidation\ResultStore;
use WP_UnitTestCase;

/**
 * Tests for {@see RevalidationAssets}: the script loads on the resource and page editors and no other,
 * and hands the script each post type's REST route.
 */
final class RevalidationAssetsTest extends WP_UnitTestCase {
	/**
	 * Leaves the scripts and the screen as they were.
	 */
	public function tear_down(): void {
		wp_dequeue_script( RevalidationAssets::HANDLE );
		wp_deregister_script( RevalidationAssets::HANDLE );
		unset( $GLOBALS['current_screen'] );

		parent::tear_down();
	}

	/**
	 * Runs the enqueue on the block editor screen of a post type.
	 *
	 * @param string $post_type The post type being edited.
	 */
	private function enqueue_on( string $post_type ): void {
		set_current_screen( $post_type );
		$this->assertSame( $post_type, get_current_screen()->post_type );

		( new RevalidationAssets( dirname( __DIR__, 3 ) . '/resource-hub.php' ) )->enqueue();
	}

	/**
	 * The object the script is handed, decoded from the `var resourceHubRevalidation = {…};` line
	 * `wp_localize_script()` writes, so the assertions compare decoded values and not the JSON's slash
	 * escaping or layout.
	 *
	 * @param string $label Names the case in a failure message.
	 * @return array<string, mixed>
	 */
	private function localized_data( string $label ): array {
		$data = wp_scripts()->get_data( RevalidationAssets::HANDLE, 'data' );
		$this->assertIsString( $data, $label );

		$prefix = 'var ' . RevalidationAssets::OBJECT_NAME . ' = ';
		$this->assertSame( 1, preg_match( '/^' . preg_quote( $prefix, '/' ) . '(\{.*\});$/s', trim( $data ), $match ), $label );

		$decoded = json_decode( $match[1], true );
		$this->assertIsArray( $decoded, $label );

		return $decoded;
	}

	/**
	 * Skips a test that needs the built bundle, which `pnpm build` writes.
	 */
	private function require_bundle(): void {
		if ( ! is_readable( dirname( __DIR__, 3 ) . '/build/editor/revalidation-feedback.asset.php' ) ) {
			$this->markTestSkipped( 'The editor bundle is not built; run `pnpm build` first.' );
		}
	}

	/**
	 * The script is enqueued on the page editor as on the resource editor, with the sentences, the
	 * REST routes and the posts page's ID (none set here), and not on the post editor.
	 */
	public function test_enqueued_on_resource_and_page_editors_only(): void {
		$this->require_bundle();

		$this->assertSame( array( PostType::NAME, 'page' ), ResultStore::POST_TYPES );

		foreach ( ResultStore::POST_TYPES as $post_type ) {
			$this->enqueue_on( $post_type );
			$this->assertTrue( wp_script_is( RevalidationAssets::HANDLE, 'enqueued' ), $post_type );

			$data = $this->localized_data( $post_type );
			$this->assertEqualsCanonicalizing( array( 'sentences', 'restPaths', 'postsPageId' ), array_keys( $data ), $post_type );
			$this->assertSame( ResultText::sentences(), $data['sentences'], $post_type );
			$this->assertSame(
				array(
					PostType::NAME => '/wp/v2/resources',
					'page'         => '/wp/v2/pages',
				),
				$data['restPaths'],
				$post_type
			);
			// wp_localize_script() hands a top-level scalar over as a string; the script reads it with Number().
			$this->assertSame( '0', $data['postsPageId'], $post_type );

			wp_dequeue_script( RevalidationAssets::HANDLE );
			wp_deregister_script( RevalidationAssets::HANDLE );
		}

		$this->enqueue_on( 'post' );
		$this->assertFalse( wp_script_is( RevalidationAssets::HANDLE, 'enqueued' ) );
		$this->assertFalse( wp_script_is( RevalidationAssets::HANDLE, 'registered' ) );
	}

	/**
	 * The script is handed the posts page's ID while `show_on_front` is `page`, as core reads
	 * `page_for_posts`, so it can tell that saving the posts page sends nothing; with `show_on_front`
	 * on `posts` the option names an ordinary page, and the ID handed over is 0.
	 */
	public function test_hands_over_the_posts_page_id_as_core_reads_it(): void {
		$this->require_bundle();

		$posts_page = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);
		update_option( 'page_for_posts', $posts_page );

		update_option( 'show_on_front', 'page' );
		$this->enqueue_on( 'page' );
		$this->assertSame( (string) $posts_page, $this->localized_data( 'show_on_front=page' )['postsPageId'] );

		wp_dequeue_script( RevalidationAssets::HANDLE );
		wp_deregister_script( RevalidationAssets::HANDLE );

		update_option( 'show_on_front', 'posts' );
		$this->enqueue_on( 'page' );
		$this->assertSame( '0', $this->localized_data( 'show_on_front=posts' )['postsPageId'] );
	}

	/**
	 * The REST route of each post type comes from its registration: `resources` for the resource post
	 * type and core's `pages` for pages, under `wp/v2`, keyed by post type and in the order of the list.
	 */
	public function test_rest_paths_come_from_each_post_type(): void {
		$this->assertSame(
			array(
				PostType::NAME => '/wp/v2/resources',
				'page'         => '/wp/v2/pages',
			),
			RevalidationAssets::rest_paths()
		);
	}
}
