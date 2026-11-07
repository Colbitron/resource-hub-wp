<?php
/**
 * Which registered REST route and handler a request reached.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

/**
 * Identifies a REST request by the route pattern and handler it reached, never by how its URL is
 * spelled.
 *
 * Core matches a request's path against each registered pattern without regard to case
 * (`'@^' . $route . '$@i'` in `WP_REST_Server::match_request_to_handler()`), so
 * `/wp-json/WP/v2/Resource_Type/7`, `?rest_route=/WP/v2/…` and a batch item with such a path all
 * reach the handler that `/wp/v2/resource_type/7` reaches. A guard that tests the path with a
 * case-sensitive expression of its own misses them.
 *
 * A hook that is given the pattern core matched (`rest_dispatch_request`) compares it with is().
 * A hook that is given only the handler and the request (`rest_request_before_callbacks`,
 * `rest_request_after_callbacks`) checks both: the handler's callback with is_handler(), and the
 * request's path with params(), which runs core's match (same pattern, same flags) on it. The path
 * alone is not enough, because another handler registered on a pattern that also matches the path
 * may be the one core picked; the callback alone is not enough, because one controller instance
 * serves several routes.
 */
final class RouteMatch {
	/**
	 * The single-term route pattern a taxonomy's terms controller registers,
	 * `/{rest_namespace}/{rest_base}/(?P<id>[\d]+)`, built from core's own route for the taxonomy.
	 *
	 * @param string $taxonomy Taxonomy name.
	 * @return string The pattern, or '' when the taxonomy has no REST route.
	 */
	public static function term_item( string $taxonomy ): string {
		$items = rest_get_route_for_taxonomy_items( $taxonomy );

		return '' === $items ? '' : $items . '/(?P<id>[\d]+)';
	}

	/**
	 * Whether the pattern core matched for a request is the given registered pattern. Core passes
	 * `rest_dispatch_request` the registered route key itself, so the two are compared exactly.
	 *
	 * @param string $route   The route pattern core matched.
	 * @param string $pattern A registered route pattern; '' never matches.
	 */
	public static function is( string $route, string $pattern ): bool {
		return '' !== $pattern && $pattern === $route;
	}

	/**
	 * Whether a route handler's callback is the given method of an instance of the given class.
	 *
	 * @param mixed  $handler    The route handler core matched, as REST hooks are given it.
	 * @param string $controller The controller class, or a parent of it.
	 * @param string $method     The callback's method name.
	 */
	public static function is_handler( $handler, string $controller, string $method ): bool {
		$callback = is_array( $handler ) ? ( $handler['callback'] ?? null ) : null;

		return is_array( $callback )
			&& 2 === count( $callback )
			&& isset( $callback[0], $callback[1] )
			&& $callback[0] instanceof $controller
			&& $method === $callback[1];
	}

	/**
	 * The URL parameters a requested path gives a registered pattern, matched as core matches it.
	 *
	 * @param string $pattern A registered route pattern; '' never matches.
	 * @param string $path    The requested route, `WP_REST_Request::get_route()`.
	 * @return array<string, string>|null The named parameters, or null if the path does not match.
	 */
	public static function params( string $pattern, string $path ): ?array {
		if ( '' === $pattern || 1 !== preg_match( '@^' . $pattern . '$@i', $path, $matches ) ) {
			return null;
		}

		return array_filter( $matches, 'is_string', ARRAY_FILTER_USE_KEY );
	}
}
