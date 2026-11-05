<?php
/**
 * Enqueues the "Resource details" sidebar panel, and the Types panel's radio buttons bundled
 * with it, in the block editor.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Editor;

use ResourceHub\ContentModel\PostType;

/**
 * Loads `build/editor/resource-details.js` on the block editor for `resource` posts only.
 */
final class SidebarAssets {
	/**
	 * Script handle.
	 */
	public const HANDLE = 'resource-hub-resource-details';

	/**
	 * Absolute path to the plugin's main file, for `plugins_url()`.
	 *
	 * @var string
	 */
	private string $plugin_file;

	/**
	 * Constructor.
	 *
	 * @param string $plugin_file Absolute path to the plugin's main file.
	 */
	public function __construct( string $plugin_file ) {
		$this->plugin_file = $plugin_file;
	}

	/**
	 * Enqueues the panel script. Hooked to `enqueue_block_editor_assets`.
	 *
	 * Dependencies and the cache-busting version come from the `.asset.php` file that
	 * `@wordpress/scripts` writes next to the bundle, so nothing is hand-maintained.
	 */
	public function enqueue(): void {
		$screen = get_current_screen();

		if ( ! $screen || PostType::NAME !== $screen->post_type ) {
			return;
		}

		if ( ! is_readable( dirname( __DIR__, 2 ) . '/build/editor/resource-details.asset.php' ) ) {
			return;
		}

		$asset = require dirname( __DIR__, 2 ) . '/build/editor/resource-details.asset.php';

		wp_enqueue_script(
			self::HANDLE,
			plugins_url( 'build/editor/resource-details.js', $this->plugin_file ),
			$asset['dependencies'] ?? array(),
			$asset['version'] ?? false,
			true
		);

		wp_set_script_translations( self::HANDLE, 'resource-hub' );
	}
}
