<?php
/**
 * Enqueues the required-fields editor plugin in the block editor.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Editor;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\RequiredFields;

/**
 * Loads `build/editor/required-fields.js`, and the stylesheet beside it, on the block editor for
 * `resource` posts only. The script shows which of the title, the type, the topic and the summary
 * a resource still lacks, and locks publishing while one is missing; the rule it applies is the
 * server's ({@see RequiredFields} and OneType), and the server's check stands whether or not the
 * script loads. It is a bundle of its own, apart from `resource-details.js`, so the panels' own
 * controls and this plugin's notices change independently.
 */
final class RequiredFieldsAssets {
	/**
	 * Script and style handle.
	 */
	public const HANDLE = 'resource-hub-required-fields';

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
	 * Enqueues the script and its stylesheet. Hooked to `enqueue_block_editor_assets`.
	 *
	 * Dependencies and the cache-busting version come from the `.asset.php` file that
	 * `@wordpress/scripts` writes next to the bundle, so nothing is hand-maintained.
	 */
	public function enqueue(): void {
		$screen = get_current_screen();

		if ( ! $screen || PostType::NAME !== $screen->post_type ) {
			return;
		}

		if ( ! is_readable( dirname( __DIR__, 2 ) . '/build/editor/required-fields.asset.php' ) ) {
			return;
		}

		$asset = require dirname( __DIR__, 2 ) . '/build/editor/required-fields.asset.php';

		wp_enqueue_script(
			self::HANDLE,
			plugins_url( 'build/editor/required-fields.js', $this->plugin_file ),
			$asset['dependencies'] ?? array(),
			$asset['version'] ?? false,
			true
		);

		if ( is_readable( dirname( __DIR__, 2 ) . '/build/editor/required-fields.css' ) ) {
			wp_enqueue_style(
				self::HANDLE,
				plugins_url( 'build/editor/required-fields.css', $this->plugin_file ),
				array(),
				$asset['version'] ?? false
			);
		}

		wp_set_script_translations( self::HANDLE, 'resource-hub' );
	}
}
