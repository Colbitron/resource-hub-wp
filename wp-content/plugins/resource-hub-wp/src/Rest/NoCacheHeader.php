<?php
/**
 * Keeps anonymous REST reads out of every HTTP cache but the front end's (ADR 0023).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Pages\PagePath;
use WP_HTTP_Response;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Adds `Cache-Control: no-cache, must-revalidate, max-age=0` to anonymous responses from the
 * routes the front end reads: `/wp/v2/resources`, `/wp/v2/pages` (ADR 0052), the three taxonomy
 * endpoints, and everything under `/resource-hub/v1/`.
 *
 * Varnish and Cloudflare sit between the front end and WordPress. A copy cached there would
 * survive a revalidation, because Next.js would refetch and get the stale copy, so the front
 * end's data cache, which the revalidation request clears, is the only one allowed.
 *
 * Error responses on those routes get the header too. A 404 is as cacheable as a 200 (Varnish's
 * built-in rules store it), and publishing is exactly what turns one into the other: a cached
 * 404 from `/wp/v2/resources/{id}` or the resolve route would outlive the publish event that
 * should have replaced it.
 *
 * Logged-in responses are left alone: core already sends its own no-cache headers for them
 * (`rest_send_nocache_headers`). Every anonymous response on a covered route gets the header,
 * whatever its method or context, so no future anonymous 200 can slip past on a request
 * parameter; on writes, `OPTIONS` and anonymous `edit`-context 401s it is harmless.
 *
 * A `Cache-Control` already on the response that is stricter than ours, one containing
 * `no-store` or `private`, is kept, so an earlier filter's choice is never weakened.
 */
final class NoCacheHeader {
	/**
	 * The header value: any cache must check with WordPress before reusing a copy.
	 */
	public const VALUE = 'no-cache, must-revalidate, max-age=0';

	/**
	 * The plugin's own REST namespace.
	 */
	public const NAMESPACE = 'resource-hub/v1';

	/**
	 * Directives that make an existing `Cache-Control` stricter than ours, so it is kept.
	 */
	private const STRICTER = array( 'no-store', 'private' );

	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'rest_post_dispatch', array( $this, 'add_header' ), 10, 3 );
	}

	/**
	 * Sets the header on an anonymous response from one of the covered routes. Hooked to
	 * `rest_post_dispatch`.
	 *
	 * @param WP_HTTP_Response|mixed $response The response about to be served.
	 * @param mixed                  $server   The REST server. Unused.
	 * @param WP_REST_Request|mixed  $request  The request.
	 * @return WP_HTTP_Response|mixed The same response.
	 */
	public function add_header( $response, $server, $request ) {
		unset( $server );

		if ( ! $response instanceof WP_REST_Response || ! $request instanceof WP_REST_Request ) {
			return $response;
		}

		if ( is_user_logged_in() ) {
			return $response;
		}

		if ( ! $this->is_covered( $response->get_matched_route() ) ) {
			return $response;
		}

		$headers = $response->get_headers();

		foreach ( $headers as $name => $value ) {
			if ( 'cache-control' !== strtolower( (string) $name ) ) {
				continue;
			}

			if ( $this->is_stricter( (string) $value ) ) {
				return $response;
			}

			// Dropped so a differently cased name cannot leave two Cache-Control headers.
			unset( $headers[ $name ] );
		}

		$headers['Cache-Control'] = self::VALUE;
		$response->set_headers( $headers );

		return $response;
	}

	/**
	 * Whether an existing `Cache-Control` value is stricter than ours and must be kept.
	 *
	 * @param string $value The existing header value.
	 */
	private function is_stricter( string $value ): bool {
		$directives = array_map( 'trim', explode( ',', strtolower( $value ) ) );

		return array() !== array_intersect( self::STRICTER, $directives );
	}

	/**
	 * Whether a matched route pattern belongs to one of the covered endpoints.
	 *
	 * The matched route is the registered pattern (such as `/wp/v2/resources/(?P<id>[\d]+)`), not
	 * the requested path, so case and trailing slashes in the URL do not matter. A request that
	 * matched no route has an empty one and is never covered.
	 *
	 * @param string $route The matched route pattern.
	 */
	private function is_covered( string $route ): bool {
		if ( '' === $route ) {
			return false;
		}

		foreach ( $this->bases() as $base ) {
			if ( $route === $base || str_starts_with( $route, $base . '/' ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * The covered route bases, read from the registered post type and taxonomies so a changed
	 * `rest_base` or `rest_namespace` moves the header with it.
	 *
	 * @return string[]
	 */
	private function bases(): array {
		$bases = array( '/' . self::NAMESPACE );

		foreach ( array( PostType::NAME, PagePath::POST_TYPE ) as $post_type ) {
			$items = rest_get_route_for_post_type_items( $post_type );

			if ( '' !== $items ) {
				$bases[] = $items;
			}
		}

		foreach ( array( Taxonomies::TOPIC, Taxonomies::TYPE, Taxonomies::FLAG ) as $taxonomy ) {
			$terms = rest_get_route_for_taxonomy_items( $taxonomy );

			if ( '' !== $terms ) {
				$bases[] = $terms;
			}
		}

		return $bases;
	}
}
