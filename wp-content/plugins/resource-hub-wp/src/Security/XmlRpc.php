<?php
/**
 * XML-RPC is off on the headless CMS.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Security;

/**
 * Turns off XML-RPC and stops pointing pages and headers at it.
 *
 * The CMS is headless: the front end reads REST and editors use the block editor, so no client
 * uses XML-RPC. It is also a save path the one-type rule does not guard (ADR 0024), so closing
 * it leaves one fewer.
 *
 * `xmlrpc_enabled` alone only turns off the methods that log in; pingbacks and the other
 * anonymous methods still answer, so the method list is emptied too. Core's IXR server adds
 * `system.listMethods`, `system.getCapabilities` and `system.multicall` itself after the filter,
 * and those three only describe a server with nothing else on it. The `X-Pingback` header and
 * the RSD link in `wp_head` are removed, so core prints no link or header to `xmlrpc.php`. The
 * endpoint itself still answers `GET /xmlrpc.php?rsd` with an RSD document, which core prints
 * before the server is built, so the `xmlrpc_enabled` and `xmlrpc_methods` filters do not run
 * there.
 *
 * Trackbacks go through `wp-trackback.php`, not XML-RPC, so this switch does not stop them.
 * Resources do not declare `trackbacks` support, so core creates them with `ping_status` closed and
 * `wp-trackback.php` refuses them. That was checked by reading core, not tested over HTTP.
 *
 * Blocking `xmlrpc.php` at the host or at Cloudflare was rejected as the switch: the rule would live
 * outside the repository, where wp-env, CI and the tests cannot check it. It could still be added on
 * top as load shedding.
 */
final class XmlRpc {
	/**
	 * Hooks the filters and removes core's RSD link.
	 */
	public function register(): void {
		add_filter( 'xmlrpc_enabled', '__return_false' );
		add_filter( 'xmlrpc_methods', array( $this, 'remove_methods' ), PHP_INT_MAX );
		add_filter( 'wp_headers', array( $this, 'remove_pingback_header' ) );
		remove_action( 'wp_head', 'rsd_link' );
	}

	/**
	 * Drops every XML-RPC method, pingbacks included. Hooked to `xmlrpc_methods` last, so a
	 * method another plugin adds is dropped as well.
	 *
	 * @param mixed $methods Methods core and other plugins registered. Unused.
	 * @return array<string, mixed> No methods.
	 */
	public function remove_methods( $methods ): array {
		unset( $methods );

		return array();
	}

	/**
	 * Removes the `X-Pingback` header core sends on single posts that allow pings. Hooked to
	 * `wp_headers`.
	 *
	 * @param mixed $headers Headers about to be sent.
	 * @return mixed The headers without `X-Pingback`.
	 */
	public function remove_pingback_header( $headers ) {
		if ( is_array( $headers ) ) {
			unset( $headers['X-Pingback'] );
		}

		return $headers;
	}
}
