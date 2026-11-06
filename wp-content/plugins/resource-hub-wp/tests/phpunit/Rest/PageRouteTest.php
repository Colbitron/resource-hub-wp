<?php
/**
 * `GET /resource-hub/v1/page?path=…` (ADR 0052).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Rest;

use ResourceHub\Pages\PagePath;
use ResourceHub\Rest\PageRoute;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Every 200 is checked against `page-response` and every 400 against `wp-error` in `packages/ui/schemas/`.
 */
final class PageRouteTest extends WP_UnitTestCase {
	/**
	 * Starts every test with no front page and no posts page.
	 */
	public function set_up(): void {
		parent::set_up();

		update_option( 'show_on_front', 'posts' );
		update_option( 'page_on_front', 0 );
		update_option( 'page_for_posts', 0 );
	}

	/**
	 * The route is public.
	 */
	public function test_route_is_public(): void {
		wp_set_current_user( 0 );

		$response = $this->lookup( '/about/' );

		$this->assertSame( 200, $response->get_status() );
		$this->assert_page( null, $response );
	}

	/**
	 * With no front page set, the root is no page.
	 */
	public function test_root_without_a_front_page_is_null(): void {
		$this->page( 'home' );

		foreach ( array( '/', '', null ) as $path ) {
			$this->assert_page( null, $this->lookup( $path ) );
		}
	}

	/**
	 * With a published front page set, the root is that page at `/`, and the page's own slug answers `/` too.
	 */
	public function test_root_is_the_front_page_and_its_own_slug_points_there(): void {
		$home = $this->page( 'home' );
		$this->set_front_page( $home );

		$this->assert_page(
			array(
				'id'   => $home,
				'path' => '/',
			),
			$this->lookup( '/' )
		);
		$this->assert_page(
			array(
				'id'   => $home,
				'path' => '/',
			),
			$this->lookup( '/home/' )
		);
		$this->assert_page(
			array(
				'id'   => $home,
				'path' => '/',
			),
			$this->lookup( 'home' )
		);
	}

	/**
	 * A front page that is a draft, or `page_on_front` pointing at nothing, is no front page.
	 */
	public function test_an_unpublished_front_page_is_null(): void {
		$home = $this->page( 'home', 'draft' );
		$this->set_front_page( $home );

		$this->assert_page( null, $this->lookup( '/' ) );
		$this->assert_page( null, $this->lookup( '/home/' ) );

		update_option( 'page_on_front', 999999 );
		$this->assert_page( null, $this->lookup( '/' ) );
	}

	/**
	 * `show_on_front` must be `page`: a `page_on_front` left over after switching to posts counts for nothing.
	 */
	public function test_show_on_front_posts_ignores_page_on_front(): void {
		$home = $this->page( 'home' );
		update_option( 'page_on_front', $home );

		$this->assert_page( null, $this->lookup( '/' ) );
		$this->assert_page(
			array(
				'id'   => $home,
				'path' => '/home/',
			),
			$this->lookup( '/home/' )
		);
	}

	/**
	 * A nested page is found by its whole parent chain, with its path answered back, slashes optional.
	 */
	public function test_nested_page_by_full_path(): void {
		$about = $this->page( 'about' );
		$team  = $this->page( 'team', 'publish', $about );

		foreach ( array( '/about/team/', 'about/team', '/about/team', 'about/team/' ) as $path ) {
			$this->assert_page(
				array(
					'id'   => $team,
					'path' => '/about/team/',
				),
				$this->lookup( $path )
			);
		}
		$this->assert_page(
			array(
				'id'   => $about,
				'path' => '/about/',
			),
			$this->lookup( '/about/' )
		);
	}

	/**
	 * Two pages may share a slug under different parents; each is found by its own chain only.
	 */
	public function test_same_slug_under_two_parents(): void {
		$about        = $this->page( 'about' );
		$company      = $this->page( 'company' );
		$about_team   = $this->page( 'team', 'publish', $about );
		$company_team = $this->page( 'team', 'publish', $company );

		$this->assert_page(
			array(
				'id'   => $about_team,
				'path' => '/about/team/',
			),
			$this->lookup( '/about/team/' )
		);
		$this->assert_page(
			array(
				'id'   => $company_team,
				'path' => '/company/team/',
			),
			$this->lookup( '/company/team/' )
		);
		// Two pages have the slug, so a wrong parent is ambiguous and nothing is guessed.
		$this->assert_page( null, $this->lookup( '/team/' ) );
		$this->assert_page( null, $this->lookup( '/elsewhere/team/' ) );
	}

	/**
	 * A wrong parent is answered with the page's current path when exactly one published page has the slug.
	 */
	public function test_unique_slug_under_a_wrong_parent_answers_the_current_path(): void {
		$about   = $this->page( 'about' );
		$contact = $this->page( 'contact', 'publish', $about );
		$this->page( 'contact', 'draft' );

		$this->assert_page(
			array(
				'id'   => $contact,
				'path' => '/about/contact/',
			),
			$this->lookup( '/contact/' )
		);
		$this->assert_page(
			array(
				'id'   => $contact,
				'path' => '/about/contact/',
			),
			$this->lookup( '/company/contact/' )
		);
	}

	/**
	 * A parent move changes a child's path: the old path answers the new one.
	 */
	public function test_parent_move_answers_the_new_path(): void {
		$about   = $this->page( 'about' );
		$company = $this->page( 'company' );
		$contact = $this->page( 'contact', 'publish', $about );

		wp_update_post(
			array(
				'ID'          => $contact,
				'post_parent' => $company,
			)
		);

		$this->assert_page(
			array(
				'id'   => $contact,
				'path' => '/company/contact/',
			),
			$this->lookup( '/about/contact/' )
		);
		$this->assert_page(
			array(
				'id'   => $contact,
				'path' => '/company/contact/',
			),
			$this->lookup( '/company/contact/' )
		);
	}

	/**
	 * Core keeps no old slugs for pages, so a renamed page's old path is a miss; its children's old paths
	 * are still found by the guess when their slugs are unique.
	 */
	public function test_renamed_page_old_path_is_null_and_children_are_guessed(): void {
		$about = $this->page( 'about' );
		$team  = $this->page( 'team', 'publish', $about );

		wp_update_post(
			array(
				'ID'        => $about,
				'post_name' => 'about-us',
			)
		);

		$this->assertSame( '', get_post_meta( $about, '_wp_old_slug', true ), 'Core now records old slugs for pages; the route could use them.' );
		$this->assert_page( null, $this->lookup( '/about/' ) );
		$this->assert_page(
			array(
				'id'   => $team,
				'path' => '/about-us/team/',
			),
			$this->lookup( '/about-us/team/' )
		);
		$this->assert_page(
			array(
				'id'   => $team,
				'path' => '/about-us/team/',
			),
			$this->lookup( '/about/team/' )
		);
	}

	/**
	 * Drafts, private pages, trashed pages and posts are never answered.
	 */
	public function test_unpublished_pages_and_posts_are_null(): void {
		$this->page( 'draft-page', 'draft' );
		$this->page( 'private-page', 'private' );
		$trashed = $this->page( 'trashed-page' );
		wp_trash_post( $trashed );
		self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_name'   => 'a-post',
			)
		);

		foreach ( array( '/draft-page/', '/private-page/', '/trashed-page/', '/a-post/' ) as $path ) {
			$this->assert_page( null, $this->lookup( $path ) );
		}
	}

	/**
	 * A child of a draft parent is served at its chain, as WordPress itself serves it.
	 */
	public function test_child_of_a_draft_parent_is_served(): void {
		$parent = $this->page( 'draft-parent', 'draft' );
		$child  = $this->page( 'child', 'publish', $parent );

		$this->assert_page(
			array(
				'id'   => $child,
				'path' => '/draft-parent/child/',
			),
			$this->lookup( '/draft-parent/child/' )
		);
		$this->assert_page( null, $this->lookup( '/draft-parent/' ) );
	}

	/**
	 * The posts page is never answered: not by its path, not as the front page, not by a guess.
	 */
	public function test_posts_page_is_null(): void {
		$news = $this->page( 'news' );
		update_option( 'show_on_front', 'page' );
		update_option( 'page_for_posts', $news );

		$this->assert_page( null, $this->lookup( '/news/' ) );
		$this->assert_page( null, $this->lookup( '/somewhere/news/' ) );

		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $news );
		$this->assert_page( null, $this->lookup( '/' ) );
	}

	/**
	 * The path is sanitized as a slug is: case and spaces do not matter.
	 */
	public function test_path_is_sanitized(): void {
		$about = $this->page( 'about' );
		$team  = $this->page( 'team', 'publish', $about );

		$this->assert_page(
			array(
				'id'   => $team,
				'path' => '/about/team/',
			),
			$this->lookup( '/About/Team/' )
		);
	}

	/**
	 * A segment that sanitizes to nothing names no page and is a miss, never an error, so a visitor's URL
	 * can never make the front end fail; a path too long and a non-string are 400s in core's error shape.
	 */
	public function test_unsanitizable_segments_are_misses_and_malformed_paths_are_400(): void {
		$this->page( 'about' );

		foreach ( array( '/about//team/', '/about/%/', '/-/', '/~/', "/'/", '/(/', '/!!!/', '/&/', '//' ) as $path ) {
			$this->assert_page( null, $this->lookup( $path ) );
		}

		$this->assert_error( $this->lookup( str_repeat( 'a', PageRoute::MAX_PATH_LENGTH + 1 ) ), 'too long' );
		$this->assert_error( $this->lookup( array( 'about' ) ), 'an array' );
	}

	/**
	 * A password-protected page is never answered: not at its path, not as the front page, not by a guess.
	 */
	public function test_protected_pages_are_null(): void {
		$about  = $this->page( 'about' );
		$secret = self::factory()->post->create(
			array(
				'post_type'     => PagePath::POST_TYPE,
				'post_status'   => 'publish',
				'post_name'     => 'secret',
				'post_password' => 'hunter2',
				'post_parent'   => $about,
			)
		);
		$this->assert_page( null, $this->lookup( '/about/secret/' ) );
		$this->assert_page( null, $this->lookup( '/secret/' ) );

		$this->set_front_page( $secret );
		$this->assert_page( null, $this->lookup( '/' ) );
		$this->assertSame( 0, PagePath::front_page_id() );
	}

	/**
	 * `page_for_posts` means something only while `show_on_front` is `page`, as core reads it.
	 */
	public function test_posts_page_counts_only_with_show_on_front_page(): void {
		$news = $this->page( 'news' );
		update_option( 'page_for_posts', $news );

		$this->assert_page(
			array(
				'id'   => $news,
				'path' => '/news/',
			),
			$this->lookup( '/news/' )
		);

		update_option( 'show_on_front', 'page' );
		$this->assert_page( null, $this->lookup( '/news/' ) );
	}

	/**
	 * The plugin sends the same `no-cache` header on this route as on the others (ADR 0043).
	 */
	public function test_anonymous_responses_carry_the_no_cache_header(): void {
		wp_set_current_user( 0 );

		// `dispatch()` stops before `rest_post_dispatch`, where the plugin's filter runs; apply it as `serve_request()` would.
		$request  = $this->request( '/' );
		$response = apply_filters( 'rest_post_dispatch', rest_get_server()->dispatch( $request ), rest_get_server(), $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound

		$this->assertSame( 'no-cache, must-revalidate, max-age=0', $response->get_headers()['Cache-Control'] ?? '' );
	}

	/**
	 * Creates a page.
	 *
	 * @param string $slug   Slug.
	 * @param string $status Status.
	 * @param int    $parent_id Parent page ID.
	 * @return int Post ID.
	 */
	private function page( string $slug, string $status = 'publish', int $parent_id = 0 ): int {
		return self::factory()->post->create(
			array(
				'post_type'   => PagePath::POST_TYPE,
				'post_status' => $status,
				'post_name'   => $slug,
				'post_title'  => ucfirst( str_replace( '-', ' ', $slug ) ),
				'post_parent' => $parent_id,
			)
		);
	}

	/**
	 * Makes a page the static front page.
	 *
	 * @param int $page_id The page.
	 */
	private function set_front_page( int $page_id ): void {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $page_id );
	}

	/**
	 * A page request, with `path` unless it is null.
	 *
	 * @param mixed $path The parameter, or null to leave it out.
	 */
	private function request( mixed $path ): WP_REST_Request {
		$request = new WP_REST_Request( 'GET', '/' . PageRoute::NAMESPACE . PageRoute::ROUTE );

		if ( null !== $path ) {
			$request->set_query_params( array( 'path' => $path ) );
		}

		return $request;
	}

	/**
	 * Dispatches a page request through the REST server.
	 *
	 * @param mixed $path The parameter, or null to leave it out.
	 */
	private function lookup( mixed $path ): WP_REST_Response {
		return rest_get_server()->dispatch( $this->request( $path ) );
	}

	/**
	 * Asserts a 200 whose body validates and names the expected page.
	 *
	 * @param array{id: int, path: string}|null $expected The page expected, or null.
	 * @param WP_REST_Response                  $response The response.
	 */
	private function assert_page( ?array $expected, WP_REST_Response $response ): void {
		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assertNull( SchemaValidator::errors( 'page-response', $response->get_data() ) );
		$this->assertSame( array( 'page' => $expected ), $response->get_data() );
	}

	/**
	 * Asserts a 400 `rest_invalid_param` in core's error shape.
	 *
	 * @param WP_REST_Response $response The response.
	 * @param string           $message  What was sent, for the failure message.
	 */
	private function assert_error( WP_REST_Response $response, string $message ): void {
		$this->assertSame( 400, $response->get_status(), $message );
		$this->assertNull( SchemaValidator::errors( 'wp-error', $response->get_data() ), $message );
		$this->assertSame( 'rest_invalid_param', $response->get_data()['code'], $message );
	}
}
