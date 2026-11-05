<?php
/**
 * `GET /resource-hub/v1/resolve?slug=…` (ADR 0029).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\ResolveRoute;
use ResourceHub\Tests\LegacySlugRows;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Every response is checked against `resolve-response` (200) or `wp-error` (400, 404) in `packages/ui/schemas/`.
 */
final class ResolveRouteTest extends WP_UnitTestCase {
	use LegacySlugRows;

	/**
	 * A type term: ID and slug.
	 *
	 * @var array{id: int, slug: string}
	 */
	private array $type;

	/**
	 * Creates one type.
	 */
	public function set_up(): void {
		parent::set_up();

		$id         = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'slug'     => 'webinar',
			)
		);
		$this->type = array(
			'id'   => $id,
			'slug' => 'webinar',
		);
	}

	/**
	 * A published resource resolves by its current slug.
	 */
	public function test_current_slug_resolves(): void {
		$id = $this->resource( 'current-slug' );

		$this->assert_resolves( 'current-slug', $id, 'current-slug' );
	}

	/**
	 * The slug is sanitized the way WordPress sanitizes a post slug, so a differently cased slug resolves.
	 */
	public function test_slug_is_sanitized(): void {
		$id = $this->resource( 'current-slug' );

		$this->assert_resolves( 'Current-Slug', $id, 'current-slug' );
	}

	/**
	 * After a rename, the old slug resolves to the current one.
	 */
	public function test_old_slug_resolves_after_rename(): void {
		$id = $this->resource( 'first' );
		$this->rename( $id, 'second' );

		$this->assert_resolves( 'first', $id, 'second' );
		$this->assert_resolves( 'second', $id, 'second' );
	}

	/**
	 * After two renames, both old slugs resolve to the current one, in a single hop.
	 */
	public function test_both_old_slugs_resolve_after_two_renames(): void {
		$id = $this->resource( 'first' );
		$this->rename( $id, 'second' );
		$this->rename( $id, 'third' );

		$this->assert_resolves( 'first', $id, 'third' );
		$this->assert_resolves( 'second', $id, 'third' );
		$this->assert_resolves( 'third', $id, 'third' );
	}

	/**
	 * A slug that is one resource's current slug and another's old slug resolves to the current one.
	 */
	public function test_current_slug_wins_over_another_resources_old_slug(): void {
		$renamed = $this->resource( 'shared' );
		$this->rename( $renamed, 'moved-on' );
		$current = $this->resource( 'shared' );

		$this->assert_resolves( 'shared', $current, 'shared' );
	}

	/**
	 * A resource that is no longer published resolves by neither its current nor its old slug.
	 *
	 * @dataProvider unpublished_statuses
	 *
	 * @param string $status The status it moves to.
	 */
	public function test_unpublished_resource_is_not_found( string $status ): void {
		$id = $this->resource( 'original' );
		$this->rename( $id, 'renamed' );

		if ( 'trash' === $status ) {
			wp_trash_post( $id );
		} elseif ( 'future' === $status ) {
			$date = time() + DAY_IN_SECONDS;
			wp_update_post(
				array(
					'ID'            => $id,
					'post_status'   => 'future',
					'post_date'     => gmdate( 'Y-m-d H:i:s', $date ),
					'post_date_gmt' => gmdate( 'Y-m-d H:i:s', $date ),
				)
			);
		} else {
			wp_update_post(
				array(
					'ID'          => $id,
					'post_status' => $status,
				)
			);
		}

		$this->assertSame( $status, get_post_status( $id ) );
		$this->assert_not_found( 'renamed' );
		$this->assert_not_found( 'original' );
	}

	/**
	 * Cases for test_unpublished_resource_is_not_found().
	 *
	 * @return array<string, array{string}>
	 */
	public static function unpublished_statuses(): array {
		return array(
			'draft'   => array( 'draft' ),
			'pending' => array( 'pending' ),
			'private' => array( 'private' ),
			'future'  => array( 'future' ),
			'trash'   => array( 'trash' ),
		);
	}

	/**
	 * A logged-in administrator, who may read drafts elsewhere, still gets a 404 for a draft by current and
	 * old slug: the route answers for published resources only, whoever asks.
	 */
	public function test_draft_is_not_found_for_an_administrator(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$id = $this->resource( 'admin-original' );
		$this->rename( $id, 'admin-renamed' );
		wp_update_post(
			array(
				'ID'          => $id,
				'post_status' => 'draft',
			)
		);

		$this->assertTrue( current_user_can( 'edit_post', $id ) );
		$this->assert_not_found( 'admin-renamed' );
		$this->assert_not_found( 'admin-original' );
	}

	/**
	 * When an unpublished resource and a published one both once had a slug, core's lookup returns one of
	 * them with no ordering and no status filter, and today it returns the unpublished one, so the slug is a
	 * 404. Pinned so a change in core shows up here (ADR 0029).
	 */
	public function test_unpublished_holder_of_an_old_slug_hides_a_published_one(): void {
		$draft = $this->resource( 'twin-a' );
		$this->rename( $draft, 'twin-draft' );
		wp_update_post(
			array(
				'ID'          => $draft,
				'post_status' => 'draft',
			)
		);
		$published = $this->resource( 'twin-a' );
		$this->rename( $published, 'twin-published' );

		$this->assertLessThan( $published, $draft );
		$this->assertContains( 'twin-a', get_post_meta( $draft, '_wp_old_slug', false ) );
		$this->assertContains( 'twin-a', get_post_meta( $published, '_wp_old_slug', false ) );
		$this->assertSame( $draft, $this->core_find( 'twin-a', PostType::NAME ), 'Core now picks another holder of the old slug; revisit ADR 0029.' );
		$this->assert_not_found( 'twin-a' );
	}

	/**
	 * A slug no resource has or had is a 404.
	 */
	public function test_unknown_slug_is_not_found(): void {
		$this->resource( 'something-else' );

		$this->assert_not_found( 'no-such-resource' );
	}

	/**
	 * An unknown slug is a 404 even when the global post is a published resource: core's lookup returns 0,
	 * and `get_post( 0 )` would return the global post.
	 */
	public function test_unknown_slug_is_not_found_when_the_global_post_is_a_resource(): void {
		$GLOBALS['post'] = get_post( $this->resource( 'the-global-post' ) ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- setting the global post is what this test checks.

		try {
			$this->assert_not_found( 'no-such-resource' );
		} finally {
			unset( $GLOBALS['post'] );
		}
	}

	/**
	 * Percent-encoded and multibyte slugs that match nothing are a 404, not a 500.
	 *
	 * @dataProvider encoded_slugs
	 *
	 * @param string $slug The slug sent.
	 */
	public function test_encoded_or_multibyte_unknown_slug_is_not_found( string $slug ): void {
		$this->assert_not_found( $slug );
	}

	/**
	 * Cases for test_encoded_or_multibyte_unknown_slug_is_not_found().
	 *
	 * @return array<string, array{string}>
	 */
	public static function encoded_slugs(): array {
		return array(
			'percent-encoded octets' => array( '%e6%97%a5%e6%9c%ac' ),
			'a stray percent sign'   => array( '100%-sure' ),
			'raw multibyte'          => array( '日本語のスラッグ' ),
			'mixed'                  => array( 'caf%C3%A9-日本' ),
			'200 bytes of multibyte' => array( str_repeat( '日', 66 ) . 'ab' ),
		);
	}

	/**
	 * A slug that only another post type has, now or before, does not resolve.
	 */
	public function test_other_post_types_slugs_do_not_resolve(): void {
		$post = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_name'   => 'a-blog-post',
			)
		);
		$this->rename( $post, 'a-renamed-blog-post' );

		$this->assertContains( 'a-blog-post', get_post_meta( $post, '_wp_old_slug', false ) );
		$this->assert_not_found( 'a-blog-post' );
		$this->assert_not_found( 'a-renamed-blog-post' );
	}

	/**
	 * A published resource without exactly one type is a 404 by current and old slug, since the response
	 * schema requires one. PHP calls are the way such a resource exists; REST saves refuse it.
	 *
	 * @dataProvider type_counts
	 *
	 * @param int $count How many types the resource has.
	 */
	public function test_resource_without_exactly_one_type_is_not_found( int $count ): void {
		$id = $this->resource( 'original' );
		$this->rename( $id, 'renamed' );

		$types = array_slice( array( $this->type['id'], self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ) ), 0, $count );
		wp_set_object_terms( $id, $types, Taxonomies::TYPE );

		$this->assertCount( $count, wp_get_object_terms( $id, Taxonomies::TYPE ) );
		$this->assert_not_found( 'renamed' );
		$this->assert_not_found( 'original' );
	}

	/**
	 * Cases for test_resource_without_exactly_one_type_is_not_found().
	 *
	 * @return array<string, array{int}>
	 */
	public static function type_counts(): array {
		return array(
			'no type'   => array( 0 ),
			'two types' => array( 2 ),
		);
	}

	/**
	 * A resource whose one type has a reserved slug is a 404: the schema rejects `topic` and `page` as a type,
	 * and a percent-encoded form reads as one of them in a URL. The plugin refuses such a slug on insert and
	 * decodes `%74opic` to `topic` on save (ADR 0024), so the test plants the slug in the row core writes,
	 * after every plugin filter, as a term stored before those rules existed.
	 *
	 * @dataProvider reserved_type_slugs
	 *
	 * @param string $slug The type's slug.
	 */
	public function test_resource_with_a_reserved_type_slug_is_not_found( string $slug ): void {
		$reserved = $this->with_legacy_term_slug(
			$slug,
			static fn(): int => self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) )
		);
		$id       = $this->resource( 'reserved-typed' );
		wp_set_object_terms( $id, $reserved, Taxonomies::TYPE );

		$this->assertSame( $slug, get_term( $reserved )->slug );
		$this->assert_not_found( 'reserved-typed' );
	}

	/**
	 * Cases for test_resource_with_a_reserved_type_slug_is_not_found().
	 *
	 * @return array<string, array{string}>
	 */
	public static function reserved_type_slugs(): array {
		return array(
			'topic'           => array( 'topic' ),
			'page'            => array( 'page' ),
			'percent-encoded' => array( '%74opic' ),
		);
	}

	/**
	 * A missing `slug` is a 400 in core's error shape.
	 */
	public function test_missing_slug_is_a_400(): void {
		$response = $this->resolve( null );

		$this->assert_error( $response, 400, 'rest_missing_callback_param' );
	}

	/**
	 * A slug that is empty, empty once sanitized, longer than 200 bytes, or not a string is a 400.
	 *
	 * @dataProvider invalid_slugs
	 *
	 * @param mixed $slug The parameter sent.
	 */
	public function test_invalid_slug_is_a_400( mixed $slug ): void {
		$response = $this->resolve( $slug );

		$this->assert_error( $response, 400, 'rest_invalid_param' );
	}

	/**
	 * Cases for test_invalid_slug_is_a_400().
	 *
	 * @return array<string, array{mixed}>
	 */
	public static function invalid_slugs(): array {
		return array(
			'empty'                => array( '' ),
			'empty once sanitized' => array( '!!!' ),
			'201 bytes'            => array( str_repeat( 'a', 201 ) ),
			'201 bytes in UTF-8'   => array( str_repeat( '日', 67 ) ),
			'an array'             => array( array( 'a-slug' ) ),
		);
	}

	/**
	 * A slug of exactly the maximum length is accepted and looked up.
	 */
	public function test_slug_of_the_maximum_length_is_looked_up(): void {
		$this->assert_not_found( str_repeat( 'a', ResolveRoute::MAX_SLUG_LENGTH ) );
	}

	/**
	 * The route is public: an anonymous request resolves.
	 */
	public function test_anonymous_request_resolves(): void {
		$id = $this->resource( 'public-slug' );
		wp_set_current_user( 0 );

		$this->assert_resolves( 'public-slug', $id, 'public-slug' );
	}

	/**
	 * The route puts back the main query's vars that core's lookup reads.
	 */
	public function test_main_query_vars_are_restored(): void {
		$id = $this->resource( 'first' );
		$this->rename( $id, 'second' );
		set_query_var( 'name', 'unrelated' );
		set_query_var( 'year', '2020' );

		$this->assert_resolves( 'first', $id, 'second' );

		$this->assertSame( 'unrelated', get_query_var( 'name' ) );
		$this->assertSame( '2020', get_query_var( 'year' ) );
	}

	/**
	 * A query var that was absent before the lookup is absent after it, not left set to an empty string.
	 */
	public function test_absent_main_query_vars_stay_absent(): void {
		global $wp_query;

		$id = $this->resource( 'first' );
		$this->rename( $id, 'second' );
		unset( $wp_query->query_vars['monthnum'], $wp_query->query_vars['day'] );
		set_query_var( 'year', '2020' );

		$this->assert_resolves( 'first', $id, 'second' );

		$this->assertArrayNotHasKey( 'monthnum', $wp_query->query_vars );
		$this->assertArrayNotHasKey( 'day', $wp_query->query_vars );
		$this->assertSame( '2020', $wp_query->query_vars['year'] );
	}

	/**
	 * A year in the main query does not narrow the lookup, which ignores the date parts.
	 */
	public function test_date_query_vars_do_not_narrow_the_lookup(): void {
		$id = $this->resource( 'first' );
		$this->rename( $id, 'second' );
		set_query_var( 'year', '1999' );

		$this->assert_resolves( 'first', $id, 'second' );
	}

	/**
	 * Pins what the route assumes of core's private `_find_post_by_old_slug()`: it exists, reads the slug
	 * from the main query's `name` var, matches only the post type it is given, returns an int ID or 0, and
	 * does not filter by status. A core change to any of that fails here before it breaks resolving.
	 */
	public function test_core_old_slug_finder_behaves_as_assumed(): void {
		$this->assertTrue( function_exists( ResolveRoute::CORE_OLD_SLUG_FINDER ), 'Core no longer has _find_post_by_old_slug(); old slugs stop resolving.' );

		$resource = $this->resource( 'resource-before' );
		$this->rename( $resource, 'resource-after' );
		$post = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_name'   => 'post-before',
			)
		);
		$this->rename( $post, 'post-after' );
		$draft = $this->resource( 'draft-before' );
		$this->rename( $draft, 'draft-after' );
		wp_update_post(
			array(
				'ID'          => $draft,
				'post_status' => 'draft',
			)
		);

		$this->assertSame( $resource, $this->core_find( 'resource-before', PostType::NAME ) );
		$this->assertSame( 0, $this->core_find( 'resource-after', PostType::NAME ), 'A current slug is not an old slug.' );
		$this->assertSame( 0, $this->core_find( 'no-such-slug', PostType::NAME ) );
		$this->assertSame( 0, $this->core_find( 'post-before', PostType::NAME ), 'Another post type\'s old slug matched.' );
		$this->assertSame( $post, $this->core_find( 'post-before', 'post' ) );
		$this->assertSame( $draft, $this->core_find( 'draft-before', PostType::NAME ), 'Core now filters by status; the route\'s own check may be redundant.' );
	}

	/**
	 * Without core's lookup, old slugs are a 404 and current slugs still resolve.
	 */
	public function test_without_the_core_finder_only_current_slugs_resolve(): void {
		$route = new ResolveRoute( 'resource_hub_tests_no_such_function' );
		$id    = $this->resource( 'first' );
		$this->rename( $id, 'second' );

		$current = $this->as_response( $route->respond( $this->request( 'second' ) ) );
		$this->assertSame( 200, $current->get_status() );
		$this->assert_schema( 'resolve-response', $current->get_data() );
		$this->assertSame( $id, $current->get_data()['id'] );

		$this->assert_error( $this->as_response( $route->respond( $this->request( 'first' ) ) ), 404, ResolveRoute::NOT_FOUND );
	}

	/**
	 * Creates a published resource of the test's type.
	 *
	 * @param string $slug Its slug.
	 * @return int Post ID.
	 */
	private function resource( string $slug ): int {
		$id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_name'   => $slug,
			)
		);
		wp_set_object_terms( $id, $this->type['id'], Taxonomies::TYPE );

		return $id;
	}

	/**
	 * Changes a published post's slug, which makes core record the old one in `_wp_old_slug`.
	 *
	 * @param int    $id   Post ID.
	 * @param string $slug The new slug.
	 */
	private function rename( int $id, string $slug ): void {
		wp_update_post(
			array(
				'ID'        => $id,
				'post_name' => $slug,
			)
		);
		$this->assertSame( $slug, get_post_field( 'post_name', $id ) );
	}

	/**
	 * Calls core's lookup the way the route does, then clears the query var.
	 *
	 * @param string $slug      The slug.
	 * @param string $post_type Post type.
	 */
	private function core_find( string $slug, string $post_type ): int {
		set_query_var( 'name', $slug );
		$id = _find_post_by_old_slug( $post_type );
		set_query_var( 'name', '' );

		return $id;
	}

	/**
	 * A resolve request, with `slug` unless it is null.
	 *
	 * @param mixed $slug The parameter, or null to leave it out.
	 */
	private function request( mixed $slug ): WP_REST_Request {
		$request = new WP_REST_Request( 'GET', '/' . ResolveRoute::NAMESPACE . ResolveRoute::ROUTE );

		if ( null !== $slug ) {
			$request->set_query_params( array( 'slug' => $slug ) );
		}

		return $request;
	}

	/**
	 * Dispatches a resolve request through the REST server.
	 *
	 * @param mixed $slug The parameter, or null to leave it out.
	 */
	private function resolve( mixed $slug ): WP_REST_Response {
		return rest_get_server()->dispatch( $this->request( $slug ) );
	}

	/**
	 * What the server would send for a callback's return value.
	 *
	 * @param WP_REST_Response|WP_Error $result The callback's result.
	 */
	private function as_response( WP_REST_Response|WP_Error $result ): WP_REST_Response {
		return $result instanceof WP_Error ? rest_convert_error_to_response( $result ) : $result;
	}

	/**
	 * Asserts a slug resolves to a resource of the test's type, in a schema-valid body.
	 *
	 * @param string $slug    The slug queried.
	 * @param int    $id      The expected post ID.
	 * @param string $current The expected current slug.
	 */
	private function assert_resolves( string $slug, int $id, string $current ): void {
		$response = $this->resolve( $slug );

		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assert_schema( 'resolve-response', $response->get_data() );
		$this->assertSame(
			array(
				'id'   => $id,
				'type' => $this->type['slug'],
				'slug' => $current,
			),
			$response->get_data()
		);
	}

	/**
	 * Asserts a slug is a schema-valid 404.
	 *
	 * @param string $slug The slug queried.
	 */
	private function assert_not_found( string $slug ): void {
		$this->assert_error( $this->resolve( $slug ), 404, ResolveRoute::NOT_FOUND );
	}

	/**
	 * Asserts a response is a schema-valid core error with this status and code.
	 *
	 * @param WP_REST_Response $response The response.
	 * @param int              $status   Expected HTTP status.
	 * @param string           $code     Expected error code.
	 */
	private function assert_error( WP_REST_Response $response, int $status, string $code ): void {
		$data = $response->get_data();

		$this->assertSame( $status, $response->get_status(), (string) wp_json_encode( $data ) );
		$this->assert_schema( 'wp-error', $data );
		$this->assertSame( $code, $data['code'] );
		$this->assertSame( $status, $data['data']['status'] );
	}

	/**
	 * Asserts data is valid against a contract schema.
	 *
	 * @param string $schema Schema file name without `.schema.json`.
	 * @param mixed  $data   The data.
	 */
	private function assert_schema( string $schema, mixed $data ): void {
		$this->assertNull( SchemaValidator::errors( $schema, $data ) );
	}
}
