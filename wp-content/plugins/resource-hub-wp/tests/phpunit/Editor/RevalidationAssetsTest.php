<?php
/**
 * The block editor's revalidation feedback script: where it is enqueued and what it is handed (ADR 0018).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Editor;

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
	 * The script is enqueued on the page editor as on the resource editor, with the sentences and the
	 * REST routes, and not on the post editor. Needs the built bundle, which `pnpm build` writes.
	 */
	public function test_enqueued_on_resource_and_page_editors_only(): void {
		if ( ! is_readable( dirname( __DIR__, 3 ) . '/build/editor/revalidation-feedback.asset.php' ) ) {
			$this->markTestSkipped( 'The editor bundle is not built; run `pnpm build` first.' );
		}

		$this->assertSame( array( PostType::NAME, 'page' ), ResultStore::POST_TYPES );

		foreach ( ResultStore::POST_TYPES as $post_type ) {
			$this->enqueue_on( $post_type );
			$this->assertTrue( wp_script_is( RevalidationAssets::HANDLE, 'enqueued' ), $post_type );

			$data = wp_scripts()->get_data( RevalidationAssets::HANDLE, 'data' );
			$this->assertIsString( $data, $post_type );
			$this->assertStringContainsString( 'var ' . RevalidationAssets::OBJECT_NAME . ' = ', $data, $post_type );
			$this->assertStringContainsString( '"sentences":{', $data, $post_type );
			$this->assertStringContainsString( '"restPaths":{"resource":"/wp/v2/resources","page":"/wp/v2/pages"}', $data, $post_type );

			wp_dequeue_script( RevalidationAssets::HANDLE );
			wp_deregister_script( RevalidationAssets::HANDLE );
		}

		$this->enqueue_on( 'post' );
		$this->assertFalse( wp_script_is( RevalidationAssets::HANDLE, 'enqueued' ) );
		$this->assertFalse( wp_script_is( RevalidationAssets::HANDLE, 'registered' ) );
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
