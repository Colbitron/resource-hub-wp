<?php
/**
 * XML-RPC is off and not advertised (ADR 0044).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Security;

use wp_xmlrpc_server;
use WP_UnitTestCase;

/**
 * Each part of the XML-RPC switch-off, checked by its effect.
 */
final class XmlRpcTest extends WP_UnitTestCase {
	/**
	 * Loads core's XML-RPC server classes, which WordPress only loads from `xmlrpc.php`.
	 */
	public static function set_up_before_class(): void {
		parent::set_up_before_class();

		require_once ABSPATH . WPINC . '/class-IXR.php';
		require_once ABSPATH . WPINC . '/class-wp-xmlrpc-server.php';
	}

	/**
	 * With `xmlrpc_enabled` false, the server refuses to log anyone in, with core's 405.
	 */
	public function test_login_is_refused(): void {
		$password = 'a-password';
		$user     = self::factory()->user->create(
			array(
				'role'      => 'administrator',
				'user_pass' => $password,
			)
		);

		$server = new wp_xmlrpc_server();

		$this->assertFalse( $server->login( get_userdata( $user )->user_login, $password ) );
		$this->assertSame( 405, $server->error->code );
	}

	/**
	 * The server registers no methods at all, so pingbacks and every `wp.*` method are gone.
	 */
	public function test_server_has_no_methods(): void {
		$server = new wp_xmlrpc_server();

		$this->assertSame( array(), $server->methods );
	}

	/**
	 * Core adds `X-Pingback` on a single post that allows pings; the plugin takes it out again.
	 */
	public function test_pingback_header_is_removed(): void {
		$post = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'ping_status' => 'open',
			)
		);

		$before = array();
		$after  = array();

		add_filter(
			'wp_headers',
			static function ( $headers ) use ( &$before ) {
				$before = $headers;
				return $headers;
			},
			9
		);
		add_filter(
			'wp_headers',
			static function ( $headers ) use ( &$after ) {
				$after = $headers;
				return $headers;
			},
			PHP_INT_MAX
		);

		$this->go_to( get_permalink( $post ) );

		$this->assertArrayHasKey( 'X-Pingback', $before, 'Core should have added the header, or this test checks nothing.' );
		$this->assertArrayNotHasKey( 'X-Pingback', $after );
	}

	/**
	 * The page head no longer links to the RSD document that points clients at `xmlrpc.php`.
	 */
	public function test_rsd_link_is_removed(): void {
		$this->assertFalse( has_action( 'wp_head', 'rsd_link' ) );
		$this->assertStringNotContainsString( 'EditURI', get_echo( 'wp_head' ) );
	}
}
