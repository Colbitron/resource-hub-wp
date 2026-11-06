<?php
/**
 * Enqueues the revalidation feedback script in the block editor.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Editor;

use ResourceHub\Admin\ResultText;
use ResourceHub\Revalidation\ResultStore;

/**
 * Loads `build/editor/revalidation-feedback.js` on the block editor for the post types in
 * {@see ResultStore::POST_TYPES}, `resource` and `page`, and no other (ADR 0018). The script polls
 * the post's `rh_last_revalidation` field after a save and puts the outcome in a `core/notices`
 * notice, in the sentences {@see ResultText::sentences()} hands it. The REST route it polls comes
 * from each post type's own `rest_base` ({@see RevalidationAssets::rest_paths()}), so the list of
 * post types is kept in one place.
 */
final class RevalidationAssets {
	/**
	 * Script handle.
	 */
	public const HANDLE = 'resource-hub-revalidation-feedback';

	/**
	 * The global the script reads its sentences from.
	 */
	public const OBJECT_NAME = 'resourceHubRevalidation';

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
	 * Enqueues the script. Hooked to `enqueue_block_editor_assets`.
	 *
	 * Dependencies and the cache-busting version come from the `.asset.php` file that
	 * `@wordpress/scripts` writes next to the bundle, so nothing is hand-maintained.
	 */
	public function enqueue(): void {
		$screen = get_current_screen();

		if ( ! $screen || ! in_array( $screen->post_type, ResultStore::POST_TYPES, true ) ) {
			return;
		}

		if ( ! is_readable( dirname( __DIR__, 2 ) . '/build/editor/revalidation-feedback.asset.php' ) ) {
			return;
		}

		$asset = require dirname( __DIR__, 2 ) . '/build/editor/revalidation-feedback.asset.php';

		wp_enqueue_script(
			self::HANDLE,
			plugins_url( 'build/editor/revalidation-feedback.js', $this->plugin_file ),
			$asset['dependencies'] ?? array(),
			$asset['version'] ?? false,
			true
		);

		wp_localize_script(
			self::HANDLE,
			self::OBJECT_NAME,
			array(
				'sentences' => ResultText::sentences(),
				'restPaths' => self::rest_paths(),
			)
		);
		wp_set_script_translations( self::HANDLE, 'resource-hub' );
	}

	/**
	 * The REST route of one object of each post type the script runs on, keyed by post type and
	 * without the ID: `resource` to `/wp/v2/resources`, `page` to `/wp/v2/pages`. Read from each post
	 * type's registration, so a post type that is not registered or not in REST is left out, and the
	 * script does nothing for it.
	 *
	 * @return array<string, string>
	 */
	public static function rest_paths(): array {
		$paths = array();

		foreach ( ResultStore::POST_TYPES as $post_type ) {
			$object = get_post_type_object( $post_type );

			if ( ! $object || ! $object->show_in_rest ) {
				continue;
			}

			$base      = is_string( $object->rest_base ) && '' !== $object->rest_base ? $object->rest_base : $post_type;
			$namespace = is_string( $object->rest_namespace ) && '' !== $object->rest_namespace ? $object->rest_namespace : 'wp/v2';

			$paths[ $post_type ] = '/' . trim( $namespace, '/' ) . '/' . $base;
		}

		return $paths;
	}
}
