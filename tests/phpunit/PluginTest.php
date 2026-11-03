<?php
/**
 * Smoke test: proves the test bootstrap loads WordPress and the plugin.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\Plugin;
use WP_UnitTestCase;

/**
 * Plugin bootstrap tests.
 */
final class PluginTest extends WP_UnitTestCase {
	/**
	 * The plugin class autoloads and WordPress has finished loading.
	 */
	public function test_plugin_is_loaded(): void {
		$this->assertTrue( class_exists( Plugin::class ) );
		$this->assertGreaterThan( 0, did_action( 'plugins_loaded' ) );
	}

	/**
	 * Version constant mirrors the plugin header.
	 */
	public function test_version_matches_header(): void {
		$header = get_file_data( dirname( __DIR__, 2 ) . '/resource-hub.php', array( 'Version' => 'Version' ) );

		$this->assertSame( $header['Version'], Plugin::VERSION );
	}
}
