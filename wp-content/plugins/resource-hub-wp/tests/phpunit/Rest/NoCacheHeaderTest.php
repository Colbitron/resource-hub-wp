<?php
/**
 * Anonymous REST reads carry a no-cache header (ADR 0023).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\NoCacheHeader;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * The `rest_post_dispatch` filter, run the way `WP_REST_Server::serve_request()` runs it.
 */
final class NoCacheHeaderTest extends WP_UnitTestCase {
	/**
	 * A published resource with a type and a topic.
	 *
	 * @var int
	 */
	private int $resource;

	/**
	 * Term IDs keyed by taxonomy.
	 *
	 * @var array<string, int>
	 */
	private array $terms;

	/**
	 * Builds a fresh REST server with a stand-in route in the plugin's namespace, because the
	 * related and resolve routes are not on this branch yet, and creates the content to read.
	 */
	public function set_up(): void {
		parent::set_up();

		// Core's own REST server global, reset as core's REST tests reset it.
		$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound

		add_action(
			'rest_api_init',
			static function (): void {
				register_rest_route(
					NoCacheHeader::NAMESPACE,
					'/stand-in/(?P<id>\d+)',
					array(
						'methods'             => 'GET',
						'permission_callback' => '__return_true',
						'callback'            => static function ( WP_REST_Request $request ) {
							if ( 1 !== (int) $request['id'] ) {
								return new WP_Error( 'rest_not_found', 'Not found.', array( 'status' => 404 ) );
							}

							return new WP_REST_Response( array( 'id' => 1 ) );
						},
					)
				);
			}
		);

		rest_get_server();

		$this->terms = array(
			Taxonomies::TOPIC => self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) ),
			Taxonomies::TYPE  => self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ),
			Taxonomies::FLAG  => ( new Taxonomies() )->ensure_featured_flag(),
		);

		$this->resource = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
			)
		);
		wp_set_object_terms( $this->resource, $this->terms[ Taxonomies::TYPE ], Taxonomies::TYPE );
		wp_set_object_terms( $this->resource, $this->terms[ Taxonomies::TOPIC ], Taxonomies::TOPIC );

		wp_set_current_user( 0 );
	}

	/**
	 * Drops the server built for this test, so the stand-in route does not leak into others.
	 */
	public function tear_down(): void {
		$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
		parent::tear_down();
	}

	/**
	 * Every covered route answers an anonymous read with 200 and the header.
	 */
	public function test_anonymous_reads_get_the_header(): void {
		$routes = array(
			'/wp/v2/resources',
			'/wp/v2/resources/' . $this->resource,
			'/' . NoCacheHeader::NAMESPACE . '/stand-in/1',
		);

		foreach ( $this->terms as $taxonomy => $term_id ) {
			$routes[] = '/wp/v2/' . $taxonomy;
			$routes[] = '/wp/v2/' . $taxonomy . '/' . $term_id;
		}

		foreach ( $routes as $route ) {
			$response = $this->get( $route );

			$this->assertSame( 200, $response->get_status(), $route );
			$this->assertSame( NoCacheHeader::VALUE, $this->cache_control( $response ), $route );
		}
	}

	/**
	 * The resources collection with the query the front end sends still matches.
	 */
	public function test_filtered_collection_gets_the_header(): void {
		$response = $this->get(
			'/wp/v2/resources',
			array(
				'_embed'          => '1',
				'per_page'        => 12,
				Taxonomies::TOPIC => $this->terms[ Taxonomies::TOPIC ],
				Taxonomies::TYPE  => $this->terms[ Taxonomies::TYPE ],
				'include'         => array( $this->resource ),
				'orderby'         => 'include',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 1, $response->get_data() );
		$this->assertSame( NoCacheHeader::VALUE, $this->cache_control( $response ) );
	}

	/**
	 * Logged-in reads are left to core, which sends its own no-cache headers.
	 */
	public function test_logged_in_reads_get_none(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		foreach ( array( 'view', 'edit' ) as $context ) {
			$response = $this->get( '/wp/v2/resources/' . $this->resource, array( 'context' => $context ) );

			$this->assertSame( 200, $response->get_status(), $context );
			$this->assertNull( $this->cache_control( $response ), $context );
		}
	}

	/**
	 * Routes outside the front end's reads are untouched.
	 */
	public function test_other_routes_get_none(): void {
		self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$response = $this->get( '/wp/v2/posts' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $this->cache_control( $response ) );
	}

	/**
	 * A route whose base only starts with a covered one is not covered.
	 */
	public function test_prefix_alone_does_not_match(): void {
		$this->assertNull( $this->cache_control( $this->get( '/wp/v2/resources-not' ) ) );
	}

	/**
	 * Errors on covered routes get the header too: publishing turns a 404 into a 200, and a
	 * cached 404 would outlive the revalidation that should replace it.
	 */
	public function test_not_found_on_a_covered_route_gets_the_header(): void {
		$routes = array(
			'/wp/v2/resources/' . ( $this->resource + 1000 ),
			'/wp/v2/' . Taxonomies::TOPIC . '/' . ( $this->terms[ Taxonomies::TOPIC ] + 1000 ),
			'/' . NoCacheHeader::NAMESPACE . '/stand-in/2',
		);

		foreach ( $routes as $route ) {
			$response = $this->get( $route );

			$this->assertSame( 404, $response->get_status(), $route );
			$this->assertSame( NoCacheHeader::VALUE, $this->cache_control( $response ), $route );
		}
	}

	/**
	 * A request that matched no route is left alone.
	 */
	public function test_unmatched_request_gets_none(): void {
		$unmatched = $this->get( '/wp/v2/resources/not-an-id' );

		$this->assertSame( 404, $unmatched->get_status() );
		$this->assertNull( $this->cache_control( $unmatched ) );
	}

	/**
	 * An anonymous `edit`-context request gets the header like any other: exempting on a request
	 * parameter would leave a future anonymous 200 uncovered.
	 */
	public function test_anonymous_edit_context_gets_the_header(): void {
		$edit = $this->get( '/wp/v2/resources/' . $this->resource, array( 'context' => 'edit' ) );

		$this->assertSame( 401, $edit->get_status() );
		$this->assertSame( NoCacheHeader::VALUE, $this->cache_control( $edit ) );
	}

	/**
	 * A stricter Cache-Control set by an earlier filter survives.
	 */
	public function test_stricter_existing_header_is_kept(): void {
		$stricter = static function ( $response ) {
			$response->header( 'Cache-Control', 'private, no-store' );

			return $response;
		};

		add_filter( 'rest_post_dispatch', $stricter, 5 );

		$response = $this->get( '/wp/v2/resources/' . $this->resource );

		remove_filter( 'rest_post_dispatch', $stricter, 5 );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'private, no-store', $this->cache_control( $response ) );
	}

	/**
	 * A weaker Cache-Control set earlier, under any case, is replaced by one header with ours.
	 */
	public function test_weaker_existing_header_is_replaced(): void {
		$weaker = static function ( $response ) {
			$response->header( 'cache-control', 'public, max-age=600' );

			return $response;
		};

		add_filter( 'rest_post_dispatch', $weaker, 5 );

		$response = $this->get( '/wp/v2/resources/' . $this->resource );

		remove_filter( 'rest_post_dispatch', $weaker, 5 );

		$this->assertSame( NoCacheHeader::VALUE, $this->cache_control( $response ) );
		$this->assertArrayNotHasKey( 'cache-control', $response->get_headers() );
	}

	/**
	 * Dispatches a GET and applies `rest_post_dispatch`, as `serve_request()` does.
	 *
	 * @param string               $route  Route.
	 * @param array<string, mixed> $params Query parameters.
	 */
	private function get( string $route, array $params = array() ): WP_REST_Response {
		$request = new WP_REST_Request( 'GET', $route );
		$request->set_query_params( $params );

		$server   = rest_get_server();
		$response = rest_ensure_response( $server->dispatch( $request ) );

		// Core's hook, applied here as serve_request() applies it; rest_do_request() does not.
		return apply_filters( 'rest_post_dispatch', $response, $server, $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound
	}

	/**
	 * The response's Cache-Control header, or null.
	 *
	 * @param WP_REST_Response $response Response.
	 */
	private function cache_control( WP_REST_Response $response ): ?string {
		return $response->get_headers()['Cache-Control'] ?? null;
	}
}
