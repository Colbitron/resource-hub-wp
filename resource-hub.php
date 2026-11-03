<?php
/**
 * Plugin Name:       Resource Hub
 * Description:       A filterable resources library for a headless WordPress front end.
 * Version:           0.1.0
 * Requires at least: 6.7
 * Requires PHP:      8.2
 * Author:            Colby Hill
 * License:           GPL-2.0-or-later
 * Text Domain:       resource-hub
 *
 * @package ResourceHub
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

$resource_hub_autoload = __DIR__ . '/vendor/autoload.php';

if ( ! is_readable( $resource_hub_autoload ) ) {
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

require_once $resource_hub_autoload;

( new ResourceHub\Plugin( __FILE__ ) )->boot();
