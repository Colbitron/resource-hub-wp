<?php
/**
 * Sends a REST request each way core serves one, and stands another handler in front of core's.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use WP_REST_Request;

/**
 * Helpers for the guards that key on the route and handler core matched rather than on the URL.
 */
trait RestTransports {
	/**
	 * Sends a request one of the ways core serves it, with the parameters in the body, and returns
	 * the status and the body of its answer:
	 * - `dispatch`: `rest_do_request()`, as a `/wp-json/` request reaches the server;
	 * - `batch`: as the one item of a `/batch/v1` request, which core matches to its route itself;
	 * - `serve_request`: through `WP_REST_Server::serve_request()`, as core serves `?rest_route=`
	 *   (`rest_api_loaded()` passes the query variable as the path), with the method and the body
	 *   read from the superglobals and put back to the test library's values afterwards.
	 *
	 * @param string               $transport `dispatch`, `batch` or `serve_request`.
	 * @param string               $method    HTTP method.
	 * @param string               $path      The requested route.
	 * @param array<string, mixed> $params    Body parameters.
	 * @return array{status: int, body: array<string, mixed>}
	 */
	protected function send_via( string $transport, string $method, string $path, array $params ): array {
		if ( 'batch' === $transport ) {
			$request = new WP_REST_Request( 'POST', '/batch/v1' );
			$request->set_body_params(
				array(
					'requests' => array(
						array(
							'method' => $method,
							'path'   => $path,
							'body'   => $params,
						),
					),
				)
			);
			$item = rest_do_request( $request )->get_data()['responses'][0];

			return array(
				'status' => (int) $item['status'],
				'body'   => (array) $item['body'],
			);
		}

		if ( 'serve_request' === $transport ) {
			$server = rest_get_server();

			$_SERVER['REQUEST_METHOD'] = $method;
			$_POST                     = $params;

			try {
				$server->serve_request( $path );
			} finally {
				$_SERVER['REQUEST_METHOD'] = 'GET';
				$_POST                     = array();
			}

			return array(
				'status' => (int) $server->status,
				'body'   => (array) json_decode( $server->sent_body, true ),
			);
		}

		$request = new WP_REST_Request( $method, $path );
		$request->set_body_params( $params );
		$response = rest_do_request( $request );

		return array(
			'status' => $response->get_status(),
			'body'   => (array) $response->get_data(),
		);
	}

	/**
	 * Runs a test with another handler registered on a route pattern ahead of core's handlers for
	 * it, so core matches a request on that path to the other handler first. The server is rebuilt
	 * with the handler registered at `rest_api_init` priority 0, before core's routes at 99, and
	 * rebuilt without it afterwards.
	 *
	 * @param string   $route_namespace Namespace of the route, e.g. `wp/v2`.
	 * @param string   $route           The route pattern within the namespace, as core registers it.
	 * @param string   $method          HTTP method the handler answers.
	 * @param callable $callback        The handler's callback.
	 * @param callable $run             The test, run while the handler is registered.
	 */
	protected function with_handler_ahead_of_core( string $route_namespace, string $route, string $method, callable $callback, callable $run ): void {
		$register = static function () use ( $route_namespace, $route, $method, $callback ): void {
			register_rest_route(
				$route_namespace,
				$route,
				array(
					'methods'             => $method,
					'callback'            => $callback,
					'permission_callback' => '__return_true',
				)
			);
		};

		$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
		add_action( 'rest_api_init', $register, 0 );

		try {
			rest_get_server();
			$run();
		} finally {
			remove_action( 'rest_api_init', $register, 0 );
			$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
		}
	}
}
