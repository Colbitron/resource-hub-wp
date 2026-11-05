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

	/**
	 * Activation deletes the stored rewrite rules, and the rules core regenerates on the next read
	 * include the resource archive and the single URL, /resources/{type}/{slug}/ (ADR 0024).
	 */
	public function test_activation_regenerates_rewrite_rules(): void {
		global $wp_rewrite;

		$this->set_permalink_structure( '/%postname%/' );

		try {
			update_option( 'rewrite_rules', array( 'stale/?$' => 'index.php?stale=1' ) );

			Plugin::activate();

			$this->assertFalse( get_option( 'rewrite_rules' ) );

			$rules = $wp_rewrite->wp_rewrite_rules();

			$this->assertArrayNotHasKey( 'stale/?$', $rules );
			$this->assertArrayHasKey( 'resources/?$', $rules );
			$this->assertArrayHasKey( 'resources/([^/]+)/([^/]+)(?:/([0-9]+))?/?$', $rules );
			$this->assertSame( 'index.php?resource_type=$matches[1]&resource=$matches[2]&page=$matches[3]', $rules['resources/([^/]+)/([^/]+)(?:/([0-9]+))?/?$'] );
			$this->assertArrayNotHasKey( 'resources/([^/]+)(?:/([0-9]+))?/?$', $rules );
		} finally {
			$this->set_permalink_structure( '' );
		}
	}

	/**
	 * The entry file registers Plugin::activate() as the activation hook.
	 */
	public function test_activation_hook_is_registered(): void {
		$file = plugin_basename( dirname( __DIR__, 2 ) . '/resource-hub.php' );

		$this->assertSame( 10, has_action( 'activate_' . $file, array( Plugin::class, 'activate' ) ) );
	}
}
