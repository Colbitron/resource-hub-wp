<?php
/**
 * PHPUnit bootstrap: loads the WordPress test library from the wp-env tests container
 * and registers this plugin as a must-use plugin for the duration of the run.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

$resource_hub_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $resource_hub_tests_dir ) {
	$resource_hub_tests_dir = '/wordpress-phpunit';
}

if ( ! file_exists( $resource_hub_tests_dir . '/includes/functions.php' ) ) {
	echo "WordPress test library not found at {$resource_hub_tests_dir}. Run the suite inside wp-env: pnpm test:php" . PHP_EOL; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	exit( 1 );
}

define( 'RESOURCE_HUB_TESTS_DIR', $resource_hub_tests_dir );

require_once dirname( __DIR__, 2 ) . '/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php';
require_once RESOURCE_HUB_TESTS_DIR . '/includes/functions.php';

tests_add_filter(
	'muplugins_loaded',
	static function (): void {
		require dirname( __DIR__, 2 ) . '/resource-hub.php';
	}
);

require RESOURCE_HUB_TESTS_DIR . '/includes/bootstrap.php';
