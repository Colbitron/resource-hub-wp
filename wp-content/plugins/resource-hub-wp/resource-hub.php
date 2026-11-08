<?php
/**
 * Plugin Name:       Resource Hub
 * Description:       A filterable resources library for a headless WordPress front end.
 * Version:           0.1.0
 * Requires at least: 6.9
 * Requires PHP:      8.4
 * Author:            Colby Hill
 * License:           GPL-2.0-or-later
 * Text Domain:       resource-hub
 *
 * @package ResourceHub
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

if ( ! is_readable( __DIR__ . '/vendor/autoload.php' ) ) {
	add_action(
		'admin_notices',
		static function (): void {
			echo '<div class="notice notice-error"><p>';
			esc_html_e( 'Resource Hub: run "composer install" in the plugin directory before activating.', 'resource-hub' );
			echo '</p></div>';
		}
	);
	return;
}

require_once __DIR__ . '/vendor/autoload.php';

// Activation clears the stored rewrite rules so /resources/ URLs work at once; see Plugin::activate().
register_activation_hook( __FILE__, array( ResourceHub\Plugin::class, 'activate' ) );

( new ResourceHub\Plugin( __FILE__ ) )->boot();
