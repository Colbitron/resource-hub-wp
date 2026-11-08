<?php
/**
 * PHPUnit bootstrap: loads the WordPress test library from the wp-env tests container
 * and registers this plugin as a must-use plugin for the duration of the run.
 *
 * Relevanssi, which `site-plugins/` installs beside this plugin, is loaded the same way and its
 * tables created once the test library has reinstalled the database, because that reinstall drops
 * them and deactivates every plugin. Set `RESOURCE_HUB_TESTS_WITHOUT_RELEVANSSI=1` to run the
 * suite without it, which is how the plugin is shown to work when Relevanssi is absent; the
 * search tests then skip. Without the variable a missing Relevanssi fails them instead.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

$resource_hub_plugin_dir = dirname( __DIR__, 2 );
$resource_hub_tests_dir  = getenv( 'WP_TESTS_DIR' );

if ( ! $resource_hub_tests_dir ) {
	$resource_hub_tests_dir = '/wordpress-phpunit';
}

if ( ! file_exists( $resource_hub_tests_dir . '/includes/functions.php' ) ) {
	echo "WordPress test library not found at {$resource_hub_tests_dir}. Run the suite inside wp-env: pnpm test:php" . PHP_EOL; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	exit( 1 );
}

require_once $resource_hub_plugin_dir . '/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php';
require_once $resource_hub_tests_dir . '/includes/functions.php';

$resource_hub_relevanssi = getenv( 'RESOURCE_HUB_TESTS_WITHOUT_RELEVANSSI' ) ? '' : dirname( $resource_hub_plugin_dir ) . '/relevanssi/relevanssi.php';

tests_add_filter(
	'muplugins_loaded',
	static function () use ( $resource_hub_plugin_dir, $resource_hub_relevanssi ): void {
		require $resource_hub_plugin_dir . '/resource-hub.php';

		if ( '' !== $resource_hub_relevanssi && is_readable( $resource_hub_relevanssi ) ) {
			require $resource_hub_relevanssi;
		}
	}
);

require $resource_hub_tests_dir . '/includes/bootstrap.php';

// Outside any test's transaction, so the tables are real and survive every rollback.
if ( function_exists( 'relevanssi_install' ) ) {
	relevanssi_install();
}
