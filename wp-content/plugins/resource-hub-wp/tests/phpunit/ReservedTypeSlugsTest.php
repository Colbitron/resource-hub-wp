<?php
/**
 * `topic` and `page` are never a type slug (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\ReservedTypeSlugs;
use ResourceHub\ContentModel\Taxonomies;
use RuntimeException;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_Term;
use WP_UnitTestCase;

/**
 * Creating and editing types with reserved slugs, through PHP, REST and the Types screen's form.
 * Quick Edit is in ReservedTypeSlugsAjaxTest.
 */
final class ReservedTypeSlugsTest extends WP_UnitTestCase {
	/**
	 * Logs in an editor, who can manage types.
	 */
	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
	}

	/**
	 * Clears the form globals the admin test sets.
	 */
	public function tear_down(): void {
		$_POST    = array();
		$_REQUEST = array();
		parent::tear_down();
	}

	/**
	 * Creating a type: a reserved slug is refused whether it is typed or generated from the name.
	 *
	 * @dataProvider create_cases
	 *
	 * @param string $name     Name.
	 * @param string $slug     Slug, '' for none.
	 * @param string $reserved The reserved slug expected in the refusal, or '' if it is allowed.
	 */
	public function test_create( string $name, string $slug, string $reserved ): void {
		$args   = '' === $slug ? array() : array( 'slug' => $slug );
		$result = wp_insert_term( $name, Taxonomies::TYPE, $args );

		if ( '' === $reserved ) {
			$this->assertIsArray( $result );
			return;
		}

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $result->get_error_code() );
		$this->assertSame( ReservedTypeSlugs::message( $reserved ), $result->get_error_message() );
		$this->assertFalse( get_term_by( 'slug', $reserved, Taxonomies::TYPE ) );
	}

	/**
	 * Cases for test_create().
	 *
	 * @return array<string, array{0: string, 1: string, 2: string}>
	 */
	public function create_cases(): array {
		return array(
			'slug topic'                  => array( 'Topical', 'topic', 'topic' ),
			'slug page'                   => array( 'Pages', 'page', 'page' ),
			'slug sanitized to topic'     => array( 'Topical', ' Topic ', 'topic' ),
			'name Topic, no slug'         => array( 'Topic', '', 'topic' ),
			'name Page, no slug'          => array( 'Page', '', 'page' ),
			'name Topic, slug elsewhere'  => array( 'Topic', 'topic-guide', '' ),
			'ordinary type'               => array( 'Article', '', '' ),
			'slug that only contains one' => array( 'Topics', 'topics', '' ),
			'slug percent-encoded topic'  => array( 'Topical', '%74opic', 'topic' ),
			'slug page, encoded space'    => array( 'Pages', 'page%20', 'page' ),
		);
	}

	/**
	 * Other taxonomies are untouched: a topic may be called Page.
	 */
	public function test_other_taxonomies_may_use_the_slugs(): void {
		$this->assertIsArray( wp_insert_term( 'Page', Taxonomies::TOPIC ) );
	}

	/**
	 * Creating a type over REST, as the editor's Types panel and the API do, is a 400 with the message.
	 */
	public function test_rest_create_is_refused(): void {
		$response = $this->send( 'POST', '/wp/v2/' . Taxonomies::TYPE, array( 'name' => 'Topic' ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $response->get_data()['code'] );
		$this->assertSame( ReservedTypeSlugs::message( 'topic' ), $response->get_data()['message'] );
	}

	/**
	 * Editing a type over REST: a reserved slug, typed or generated from the name, is a 400 and
	 * changes nothing; a new name with no slug keeps the current slug and is allowed.
	 *
	 * @dataProvider rest_update_cases
	 *
	 * @param array<string, string> $params Body parameters.
	 * @param int                   $status Expected HTTP status.
	 * @param string                $slug   Slug expected afterwards.
	 */
	public function test_rest_update( array $params, int $status, string $slug ): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		$response = $this->send( 'POST', '/wp/v2/' . Taxonomies::TYPE . '/' . $term_id, $params );

		$this->assertSame( $status, $response->get_status() );
		$this->assertSame( $slug, get_term( $term_id )->slug );

		if ( 400 === $status ) {
			$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $response->get_data()['code'] );
			$this->assertSame( 'Webinar', get_term( $term_id )->name );
		}
	}

	/**
	 * Cases for test_rest_update().
	 *
	 * @return array<string, array{0: array<string, string>, 1: int, 2: string}>
	 */
	public function rest_update_cases(): array {
		return array(
			'slug page'                 => array( array( 'slug' => 'page' ), 400, 'webinar' ),
			'slug topic with a name'    => array(
				array(
					'name' => 'Topics',
					'slug' => 'topic',
				),
				400,
				'webinar',
			),
			'empty slug, name Topic'    => array(
				array(
					'name' => 'Topic',
					'slug' => '',
				),
				400,
				'webinar',
			),
			'name Topic, slug not sent' => array( array( 'name' => 'Topic' ), 200, 'webinar' ),
			'ordinary slug'             => array( array( 'slug' => 'webinars' ), 200, 'webinars' ),
		);
	}

	/**
	 * Someone who may not edit types gets the permission error, not the slug check: the refusal
	 * runs after the route's permission check.
	 */
	public function test_rest_update_checks_permission_first(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		$response = $this->send( 'POST', '/wp/v2/' . Taxonomies::TYPE . '/' . $term_id, array( 'slug' => 'page' ) );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * The REST refusal holds whatever case the route is requested in. Core matches routes without
	 * regard to case, so every spelling reaches the terms controller's update handler, and the
	 * refusal keys on the route core matched, not the URL: each is a 400 that changes nothing,
	 * through `rest_do_request()`.
	 *
	 * @dataProvider route_spellings
	 *
	 * @param string $route The route, with `%d` for the type's ID.
	 */
	public function test_rest_update_is_refused_in_any_case( string $route ): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		$request = new WP_REST_Request( 'POST', sprintf( $route, $term_id ) );
		$request->set_body_params( array( 'slug' => 'page' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $response->get_data()['code'] );
		$this->assertSame( ReservedTypeSlugs::message( 'page' ), $response->get_data()['message'] );
		$this->assertSame( 'webinar', get_term( $term_id )->slug );
	}

	/**
	 * Cases for test_rest_update_is_refused_in_any_case().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function route_spellings(): array {
		return array(
			'lowercase'  => array( '/wp/v2/' . Taxonomies::TYPE . '/%d' ),
			'mixed case' => array( '/WP/v2/Resource_Type/%d' ),
			'uppercase'  => array( '/WP/V2/RESOURCE_TYPE/%d' ),
		);
	}

	/**
	 * The refusal judges the term the controller edits, `$request['id']`, which core reads from a
	 * JSON body, a form body or the query string before the path: `POST /resource_type/{a}` with an
	 * `id` of b is refused for b, and neither type changes. Each case is one where judging a would
	 * let the edit through: a names no type, or b's own name is what an empty slug is generated from.
	 *
	 * @dataProvider body_id_cases
	 *
	 * @param string $where     Where the `id` and the slug are sent: `body`, `query` or `json`.
	 * @param string $url_type  What the URL's ID names: `none` (a deleted type) or `ordinary`.
	 * @param string $body_name Name of the type the `id` names.
	 * @param string $body_slug Its slug.
	 * @param string $slug      Slug sent.
	 * @param string $reserved  The reserved slug expected in the refusal.
	 */
	public function test_rest_update_judges_the_body_id_over_the_url_id( string $where, string $url_type, string $body_name, string $body_slug, string $slug, string $reserved ): void {
		$url_id = $this->type( 'Webinar', 'webinar' );

		if ( 'none' === $url_type ) {
			wp_delete_term( $url_id, Taxonomies::TYPE );
		}

		$body_id = $this->type( $body_name, $body_slug );
		$params  = array(
			'id'   => $body_id,
			'slug' => $slug,
		);
		$request = new WP_REST_Request( 'POST', '/wp/v2/' . Taxonomies::TYPE . '/' . $url_id );

		if ( 'query' === $where ) {
			$request->set_query_params( $params );
		} elseif ( 'json' === $where ) {
			$request->set_header( 'Content-Type', 'application/json' );
			$request->set_body( (string) wp_json_encode( $params ) );
		} else {
			$request->set_body_params( $params );
		}

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $response->get_data()['code'] );
		$this->assertSame( ReservedTypeSlugs::message( $reserved ), $response->get_data()['message'] );
		$this->assertSame( $body_slug, get_term( $body_id )->slug );

		if ( 'ordinary' === $url_type ) {
			$this->assertSame( 'webinar', get_term( $url_id )->slug );
		}
	}

	/**
	 * Cases for test_rest_update_judges_the_body_id_over_the_url_id().
	 *
	 * @return array<string, array{0: string, 1: string, 2: string, 3: string, 4: string, 5: string}>
	 */
	public function body_id_cases(): array {
		return array(
			'slug page, URL names no type'               => array( 'body', 'none', 'Guide', 'guide', 'page', 'page' ),
			'empty slug, body type named Topic'          => array( 'body', 'ordinary', 'Topic', 'topic-guide', '', 'topic' ),
			'query-string id, slug page, URL names no type' => array( 'query', 'none', 'Guide', 'guide', 'page', 'page' ),
			'JSON-body id, empty slug, type named Topic' => array( 'json', 'ordinary', 'Topic', 'topic-guide', '', 'topic' ),
		);
	}

	/**
	 * A body `id` equal to the URL's changes nothing: a reserved slug is refused and an ordinary one
	 * saves, as without it.
	 *
	 * @dataProvider same_id_cases
	 *
	 * @param string $slug   Slug sent.
	 * @param int    $status Expected HTTP status.
	 * @param string $stored Slug expected afterwards.
	 */
	public function test_rest_update_with_the_same_body_id( string $slug, int $status, string $stored ): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		$response = $this->send(
			'POST',
			'/wp/v2/' . Taxonomies::TYPE . '/' . $term_id,
			array(
				'id'   => $term_id,
				'slug' => $slug,
			)
		);

		$this->assertSame( $status, $response->get_status() );
		$this->assertSame( $stored, get_term( $term_id )->slug );
	}

	/**
	 * Cases for test_rest_update_with_the_same_body_id().
	 *
	 * @return array<string, array{0: string, 1: int, 2: string}>
	 */
	public function same_id_cases(): array {
		return array(
			'reserved slug' => array( 'page', 400, 'webinar' ),
			'ordinary slug' => array( 'webinars', 200, 'webinars' ),
		);
	}

	/**
	 * The same refusal through `serve_request()`, which is how core serves a `?rest_route=` request
	 * (`rest_api_loaded()` passes the query variable as the path): `?rest_route=/WP/v2/Resource_Type/
	 * {id}` with `slug: page` is a 400 and the slug is unchanged.
	 */
	public function test_rest_update_served_from_a_mixed_case_rest_route_is_refused(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );
		$server  = rest_get_server();

		// `serve_request()` reads the method and the body from the superglobals. Both go back to
		// the test library's values: `GET` (`tests_reset__SERVER()`) and an empty `$_POST`.
		$_SERVER['REQUEST_METHOD'] = 'POST';
		$_POST                     = array( 'slug' => 'page' );

		try {
			$server->serve_request( '/WP/v2/Resource_Type/' . $term_id );
		} finally {
			$_SERVER['REQUEST_METHOD'] = 'GET';
			$_POST                     = array();
		}

		$body = json_decode( $server->sent_body, true );

		$this->assertSame( 400, $server->status );
		$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $body['code'] );
		$this->assertSame( 'webinar', get_term( $term_id )->slug );
	}

	/**
	 * The same refusal inside a batch request, whose items core matches to their routes the same
	 * way: an item at `/WP/v2/Resource_Type/{id}` with `slug: page` is answered with the 400.
	 */
	public function test_rest_update_in_a_mixed_case_batch_item_is_refused(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		$request = new WP_REST_Request( 'POST', '/batch/v1' );
		$request->set_body_params(
			array(
				'requests' => array(
					array(
						'method' => 'POST',
						'path'   => '/WP/v2/Resource_Type/' . $term_id,
						'body'   => array( 'slug' => 'page' ),
					),
				),
			)
		);
		$item = rest_do_request( $request )->get_data()['responses'][0];

		$this->assertSame( 400, $item['status'] );
		$this->assertSame( ReservedTypeSlugs::ERROR_CODE, $item['body']['code'] );
		$this->assertSame( 'webinar', get_term( $term_id )->slug );
	}

	/**
	 * Any other edit, here a PHP call, keeps the current slug instead of storing a reserved one.
	 */
	public function test_other_edits_keep_the_current_slug(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		wp_update_term(
			$term_id,
			Taxonomies::TYPE,
			array(
				'name' => 'Topic',
				'slug' => 'topic',
			)
		);

		$this->assertSame( 'webinar', get_term( $term_id )->slug );
		$this->assertSame( 'Topic', get_term( $term_id )->name );
	}

	/**
	 * The Types screen's edit form sends the editor back with the error notice and changes nothing.
	 */
	public function test_admin_form_is_refused(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );
		$back    = admin_url( 'term.php?taxonomy=' . Taxonomies::TYPE . '&tag_ID=' . $term_id . '&post_type=resource' );

		$this->post_form( $term_id, 'Topic', '', $back );

		$location = $this->redirect_of( array( new ReservedTypeSlugs(), 'refuse_admin_update' ) );

		$expected = add_query_arg(
			array(
				'error'   => 1,
				'message' => ReservedTypeSlugs::ADMIN_MESSAGE,
			),
			$back
		);
		$this->assertSame( $expected, $location );
		$this->assertSame( 'webinar', get_term( $term_id )->slug );
	}

	/**
	 * Someone who may not edit types is left to core's own refusal: the form handler neither
	 * checks the nonce nor redirects.
	 */
	public function test_admin_form_checks_permission_first(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		$this->post_form( $term_id, 'Topic', '', admin_url( 'term.php' ) );

		$this->assertNull( $this->redirect_of( array( new ReservedTypeSlugs(), 'refuse_admin_update' ) ) );
	}

	/**
	 * Any other edit keeps the current slug when the new one only decodes to a reserved slug.
	 */
	public function test_other_edits_keep_the_current_slug_when_encoded(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		wp_update_term( $term_id, Taxonomies::TYPE, array( 'slug' => '%74opic' ) );

		$this->assertSame( 'webinar', get_term( $term_id )->slug );
	}

	/**
	 * The edit form with an allowed slug is left to core.
	 */
	public function test_admin_form_with_allowed_slug_is_left_alone(): void {
		$term_id = $this->type( 'Webinar', 'webinar' );

		$this->post_form( $term_id, 'Webinars', 'webinars', admin_url( 'term.php' ) );

		$this->assertNull( $this->redirect_of( array( new ReservedTypeSlugs(), 'refuse_admin_update' ) ) );
	}

	/**
	 * The notice the form shows names the reserved slugs, and core's messages stay in place.
	 */
	public function test_admin_messages(): void {
		$messages = ( new ReservedTypeSlugs() )->admin_messages(
			array(
				'_item' => array( 3 => 'Item updated.' ),
			)
		);

		$this->assertSame( 'Item updated.', $messages[ Taxonomies::TYPE ][3] );
		$this->assertStringContainsString( 'reserved', $messages[ Taxonomies::TYPE ][ ReservedTypeSlugs::ADMIN_MESSAGE ] );
	}

	/**
	 * Creates a type and returns its ID.
	 *
	 * @param string $name Name.
	 * @param string $slug Slug.
	 */
	private function type( string $name, string $slug ): int {
		$created = wp_insert_term( $name, Taxonomies::TYPE, array( 'slug' => $slug ) );
		$this->assertIsArray( $created );

		return (int) $created['term_id'];
	}

	/**
	 * Fills the globals the Types screen's edit form posts.
	 *
	 * @param int    $term_id Term ID.
	 * @param string $name    Name field.
	 * @param string $slug    Slug field.
	 * @param string $back    The page the form was on.
	 */
	private function post_form( int $term_id, string $name, string $slug, string $back ): void {
		$form = array(
			'action'           => 'editedtag',
			'taxonomy'         => Taxonomies::TYPE,
			'tag_ID'           => (string) $term_id,
			'name'             => $name,
			'slug'             => $slug,
			'_wpnonce'         => wp_create_nonce( 'update-tag_' . $term_id ),
			'_wp_http_referer' => $back,
		);

		$_POST    = $form;
		$_REQUEST = $form;
	}

	/**
	 * Runs a handler and returns where it redirected, or null if it returned without redirecting.
	 * The redirect is caught at the `wp_redirect` filter, before any header or exit.
	 *
	 * @param callable $handler The handler.
	 */
	private function redirect_of( callable $handler ): ?string {
		$location = null;
		$catch    = static function ( string $to ) use ( &$location ): string {
			$location = $to;
			throw new RuntimeException( 'Redirected.' );
		};
		add_filter( 'wp_redirect', $catch );

		try {
			$handler();
		} catch ( RuntimeException $redirect ) {
			unset( $redirect );
		} finally {
			remove_filter( 'wp_redirect', $catch );
		}

		return $location;
	}

	/**
	 * Dispatches a REST request with body parameters as the current user.
	 *
	 * @param string               $method HTTP method.
	 * @param string               $route  Route.
	 * @param array<string, mixed> $params Body parameters.
	 */
	private function send( string $method, string $route, array $params ): WP_REST_Response {
		$request = new WP_REST_Request( $method, $route );
		$request->set_body_params( $params );

		return rest_get_server()->dispatch( $request );
	}
}
