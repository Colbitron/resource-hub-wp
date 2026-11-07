<?php
/**
 * The `related_picks` meta rule, exercised directly and through the REST API.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\MetaRules;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Tests for `related_picks`: one case per clause of the docblock on `MetaRules::sanitize_related_picks()`,
 * the self-drop filters, and the REST `edit` context.
 */
final class RelatedPicksTest extends WP_UnitTestCase {
	/**
	 * A type term ID every resource here gets, so REST saves pass the one-type rule.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * The core test case unregisters every meta key in tear_down(), so register ours again per test, and
	 * start a fresh REST server: the posts controller caches its item schema, and the `meta` property's
	 * per-field `context` comes from the keys registered when that schema was first built.
	 *
	 * The fields only: the self-drop filters under test are the ones the plugin hooked at `init`, so each
	 * write runs the one handler production runs, not a second copy as well.
	 */
	public function set_up(): void {
		parent::set_up();
		( new Meta() )->register_fields();
		$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound

		$this->type = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
	}

	/**
	 * Drops the server built for this test, so its schema does not outlive the meta keys it was built from.
	 */
	public function tear_down(): void {
		$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
		parent::tear_down();
	}

	/**
	 * The field is a single, REST-exposed array of positive integers on `resource`, at most ten, shown in
	 * the `edit` context only.
	 */
	public function test_meta_is_registered_for_rest_in_the_edit_context_only(): void {
		$registered = get_registered_meta_keys( 'post', PostType::NAME );

		$this->assertArrayHasKey( Meta::RELATED_PICKS, $registered );
		$this->assertTrue( $registered[ Meta::RELATED_PICKS ]['single'] );
		$this->assertSame( 'array', $registered[ Meta::RELATED_PICKS ]['type'] );
		$this->assertSame( array(), $registered[ Meta::RELATED_PICKS ]['default'] );

		$schema = $registered[ Meta::RELATED_PICKS ]['show_in_rest']['schema'];

		$this->assertSame( 'integer', $schema['items']['type'] );
		$this->assertSame( 1, $schema['items']['minimum'] );
		$this->assertSame( MetaRules::RELATED_PICKS_MAX, $schema['maxItems'] );
		$this->assertSame( array( 'edit' ), $schema['context'] );
	}

	/**
	 * One case per clause of the docblock on MetaRules::sanitize_related_picks().
	 *
	 * @dataProvider pick_cases
	 *
	 * @param mixed $input    Raw value.
	 * @param int[] $expected Sanitized value.
	 */
	public function test_sanitize_related_picks( mixed $input, array $expected ): void {
		$this->assertSame( $expected, MetaRules::sanitize_related_picks( $input ) );
	}

	/**
	 * Cases for test_sanitize_related_picks().
	 *
	 * @return array<string, array{0: mixed, 1: int[]}>
	 */
	public static function pick_cases(): array {
		return array(
			'a lone ID is not a list'               => array( 7, array() ),
			'a string is not a list'                => array( '7', array() ),
			'null is an empty list'                 => array( null, array() ),
			'ints above zero are kept'              => array( array( 3, 1, 2 ), array( 3, 1, 2 ) ),
			'digit strings are kept as ints'        => array( array( '3', '10' ), array( 3, 10 ) ),
			'zero is dropped'                       => array( array( 0, 5 ), array( 5 ) ),
			'negatives are dropped'                 => array( array( -1, 5 ), array( 5 ) ),
			'floats are dropped'                    => array( array( 5.0, 1.5, 6 ), array( 6 ) ),
			'booleans are dropped'                  => array( array( true, false, 6 ), array( 6 ) ),
			'null items are dropped'                => array( array( null, 6 ), array( 6 ) ),
			'nested arrays are dropped'             => array( array( array( 5 ), 6 ), array( 6 ) ),
			'strings with more than digits'         => array( array( '7 ', ' 7', '1e3', '-1', 'abc', '', '7.0' ), array() ),
			'leading zeros are not the value'       => array( array( '007', '0', '000' ), array( 7 ) ),
			'digits up to PHP_INT_MAX are kept'     => array( array( (string) PHP_INT_MAX ), array( PHP_INT_MAX ) ),
			'digits past PHP_INT_MAX are dropped'   => array( array( '9223372036854775808', '99999999999999999999', 6 ), array( 6 ) ),
			'keys are dropped'                      => array(
				array(
					'a' => 5,
					'b' => 6,
				),
				array( 5, 6 ),
			),
			'a repeat keeps its first position'     => array( array( 5, 6, 5, 7, 6 ), array( 5, 6, 7 ) ),
			'a repeat across int and string'        => array( array( 5, '5', 6 ), array( 5, 6 ) ),
			'cut to the first ten after the dedupe' => array( array( 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 ), array( 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ) ),
		);
	}

	/**
	 * `without_self()` drops the post's own ID and reindexes; a list without it is returned as is.
	 */
	public function test_without_self(): void {
		$this->assertSame( array( 5, 7 ), MetaRules::without_self( array( 5, 9, 7 ), 9 ) );
		$this->assertSame( array( 5, 7 ), MetaRules::without_self( array( 5, 7 ), 9 ) );
		$this->assertSame( array(), MetaRules::without_self( array( 9 ), 9 ) );
	}

	/**
	 * `update_post_meta()` stores the list without the post's own ID; the rest is kept in order.
	 */
	public function test_update_post_meta_drops_the_post_itself(): void {
		$post  = $this->resource();
		$other = $this->resource();
		$third = $this->resource();

		$this->assertNotFalse( update_post_meta( $post, Meta::RELATED_PICKS, array( $other, $post, $third ) ) );
		$this->assertSame( array( $other, $third ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * `add_post_meta()` does the same, so no write path stores a self-pick.
	 */
	public function test_add_post_meta_drops_the_post_itself(): void {
		$post  = $this->resource();
		$other = $this->resource();

		$this->assertNotFalse( add_post_meta( $post, Meta::RELATED_PICKS, array( $post, $other ), true ) );
		$this->assertSame( array( $other ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * A non-unique `add_post_meta()` drops it too.
	 */
	public function test_non_unique_add_post_meta_drops_the_post_itself(): void {
		$post  = $this->resource();
		$other = $this->resource();

		$this->assertNotFalse( add_post_meta( $post, Meta::RELATED_PICKS, array( $post, $other ) ) );
		$this->assertSame( array( array( $other ) ), get_post_meta( $post, Meta::RELATED_PICKS, false ) );
	}

	/**
	 * A list that is only the post itself stores an empty list, read back as the default.
	 */
	public function test_a_list_of_only_the_post_itself_is_empty(): void {
		$post = $this->resource();

		$this->assertNotFalse( update_post_meta( $post, Meta::RELATED_PICKS, array( $post ) ) );
		$this->assertSame( array(), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Saving `[ other, self ]` over a stored `[ other ]` changes nothing and reports success rather than
	 * the `false` core gives an unchanged value, which the REST layer would turn into a 500.
	 */
	public function test_an_update_that_only_adds_the_post_itself_succeeds(): void {
		$post  = $this->resource();
		$other = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );

		$this->assertTrue( update_post_meta( $post, Meta::RELATED_PICKS, array( $other, $post ) ) );
		$this->assertSame( array( $other ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * With a `$prev_value` that is not what is stored, the update is core's to answer, and core answers
	 * `false` and writes nothing; the unchanged-value shortcut does not turn that into success.
	 */
	public function test_an_update_with_a_mismatched_prev_value_fails_as_in_core(): void {
		$post  = $this->resource();
		$other = $this->resource();
		$third = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );

		$this->assertFalse( update_post_meta( $post, Meta::RELATED_PICKS, array( $other, $post ), array( $third ) ) );
		$this->assertSame( array( $other ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * With a matching `$prev_value`, the update is redone without the post itself and replaces that row.
	 */
	public function test_an_update_with_a_matching_prev_value_drops_the_post_itself(): void {
		$post  = $this->resource();
		$other = $this->resource();
		$third = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );

		$this->assertTrue( update_post_meta( $post, Meta::RELATED_PICKS, array( $third, $post ), array( $other ) ) );
		$this->assertSame( array( $third ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * A `related_picks` key on another post type is not this field, and the filters leave it as written,
	 * the post's own ID included.
	 */
	public function test_the_same_key_on_another_post_type_is_untouched(): void {
		$post = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$this->assertNotFalse( update_post_meta( $post, Meta::RELATED_PICKS, array( $post, 5 ) ) );
		$this->assertSame( array( $post, 5 ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );

		$this->assertNotFalse( add_post_meta( $post, Meta::RELATED_PICKS, array( $post ) ) );
		$this->assertSame( array( array( $post, 5 ), array( $post ) ), get_post_meta( $post, Meta::RELATED_PICKS, false ) );
	}

	/**
	 * The plugin hooks one self-drop handler on each filter, and these tests add none of their own.
	 */
	public function test_each_filter_has_one_handler(): void {
		global $wp_filter;

		$methods = array(
			'add_post_metadata'    => 'drop_self_on_add',
			'update_post_metadata' => 'drop_self_on_update',
		);

		foreach ( $methods as $hook => $method ) {
			$handlers = 0;

			foreach ( $wp_filter[ $hook ]->callbacks as $callbacks ) {
				foreach ( $callbacks as $callback ) {
					if ( is_array( $callback['function'] ) && $callback['function'][0] instanceof Meta && $method === $callback['function'][1] ) {
						++$handlers;
					}
				}
			}

			$this->assertSame( 1, $handlers, $hook );
		}
	}

	/**
	 * The filters leave every other key alone.
	 */
	public function test_other_meta_is_untouched(): void {
		$post = $this->resource();

		update_post_meta( $post, 'unrelated_list', array( $post, 5 ) );

		$this->assertSame( array( $post, 5 ), get_post_meta( $post, 'unrelated_list', true ) );
	}

	/**
	 * An editor's REST save stores the sanitized list and gets it back in the response, which core
	 * prepares in the `edit` context.
	 */
	public function test_rest_write_stores_the_sanitized_list(): void {
		$post  = $this->resource();
		$other = $this->resource();
		$third = $this->resource();
		$this->as_editor();

		$response = $this->update( $post, array( 'meta' => array( Meta::RELATED_PICKS => array( $other, $post, $third, $other ) ) ) );

		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assertSame( array( $other, $third ), $response->get_data()['meta'][ Meta::RELATED_PICKS ] );
		$this->assertSame( array( $other, $third ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * A REST save that names an unpublished resource keeps it: picks are checked at read time, not here.
	 */
	public function test_rest_write_keeps_an_unpublished_pick(): void {
		$post  = $this->resource();
		$draft = $this->resource( 'draft' );
		$this->as_editor();

		$response = $this->update( $post, array( 'meta' => array( Meta::RELATED_PICKS => array( $draft ) ) ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $draft ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Over REST the schema counts a numeric string and an integral float as integers, and core casts both
	 * to ints before the sanitizer runs, so both are stored.
	 */
	public function test_rest_write_casts_numeric_strings_and_integral_floats(): void {
		$post  = $this->resource();
		$other = $this->resource();
		$third = $this->resource();
		$this->as_editor();

		$response = $this->update( $post, array( 'meta' => array( Meta::RELATED_PICKS => array( (string) $other, (float) $third ) ) ) );

		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assertSame( array( $other, $third ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Over REST core casts every string `rest_is_integer()` accepts with `(int)` before the sanitizer
	 * runs, so a digit string past PHP_INT_MAX is stored as PHP_INT_MAX and `'1e3'` as 1000, where a
	 * PHP caller's write would drop both. Pinned as it is: no post has either ID, and the related route
	 * skips missing picks.
	 */
	public function test_rest_write_casts_oversized_and_exponent_strings(): void {
		$post = $this->resource();
		$this->as_editor();

		$response = $this->update( $post, array( 'meta' => array( Meta::RELATED_PICKS => array( '99999999999999999999', '1e3' ) ) ) );

		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assertSame( array( PHP_INT_MAX, 1000 ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Over REST the schema refuses what the sanitizer would drop or cut, with a 400 in core's `WP_Error`
	 * shape whose message names the field. The code is the one `rest_validate_value_from_schema()` gives
	 * for the failing keyword, which core's meta fields return as is rather than wrapping in `rest_invalid_param`.
	 *
	 * @dataProvider rejected_rest_lists
	 *
	 * @param mixed  $sent The list sent.
	 * @param string $code The error code expected.
	 */
	public function test_rest_rejects_an_invalid_list( mixed $sent, string $code ): void {
		$post = $this->resource();
		$this->as_editor();

		$response = $this->update( $post, array( 'meta' => array( Meta::RELATED_PICKS => $sent ) ) );
		$data     = $response->get_data();

		$this->assertSame( 400, $response->get_status(), (string) wp_json_encode( $data ) );
		$this->assertSame( $code, $data['code'] );
		$this->assertStringContainsString( Meta::RELATED_PICKS, $data['message'] );
		$this->assertSame( array(), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Cases for test_rest_rejects_an_invalid_list().
	 *
	 * @return array<string, array{mixed, string}>
	 */
	public static function rejected_rest_lists(): array {
		return array(
			'a string item' => array( array( 'abc' ), 'rest_invalid_type' ),
			'a zero item'   => array( array( 0 ), 'rest_out_of_bounds' ),
			'a float item'  => array( array( 1.5 ), 'rest_invalid_type' ),
			'eleven items'  => array( range( 1, 11 ), 'rest_too_many_items' ),
			'not a list'    => array( 'abc', 'rest_invalid_type' ),
		);
	}

	/**
	 * A subscriber cannot write the field over REST: 403, nothing stored.
	 */
	public function test_rest_subscriber_cannot_write(): void {
		$post  = $this->resource();
		$other = $this->resource();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$response = $this->update( $post, array( 'meta' => array( Meta::RELATED_PICKS => array( $other ) ) ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( array(), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * The anonymous `view` read the front end makes has `summary` and `source_url` under `meta` and no
	 * `related_picks`, on the single item and in the collection.
	 */
	public function test_anonymous_view_reads_never_include_the_picks(): void {
		$post  = $this->resource();
		$other = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );
		wp_set_current_user( 0 );

		$single = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE . '/' . $post ) );

		$this->assertSame( 200, $single->get_status() );
		$this->assertArrayHasKey( Meta::SUMMARY, $single->get_data()['meta'] );
		$this->assertArrayHasKey( Meta::SOURCE_URL, $single->get_data()['meta'] );
		$this->assertArrayNotHasKey( Meta::RELATED_PICKS, $single->get_data()['meta'] );

		$list = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE ) );

		$this->assertSame( 200, $list->get_status() );
		$this->assertNotEmpty( $list->get_data() );

		foreach ( $list->get_data() as $item ) {
			$this->assertArrayNotHasKey( Meta::RELATED_PICKS, $item['meta'] );
		}
	}

	/**
	 * Asking for `meta` or `meta.related_picks` with `_fields` does not bring the picks into an anonymous
	 * read: the context filter runs first. `_fields` is applied on `rest_post_dispatch`, as `serve_request()`
	 * applies it, so the response is the one an anonymous client would get.
	 */
	public function test_anonymous_fields_reads_never_include_the_picks(): void {
		$post  = $this->resource();
		$other = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );
		wp_set_current_user( 0 );

		foreach ( array( 'meta', 'meta.' . Meta::RELATED_PICKS ) as $fields ) {
			$request = new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE . '/' . $post );
			$request->set_query_params( array( '_fields' => $fields ) );
			$server   = rest_get_server();
			$response = apply_filters( 'rest_post_dispatch', rest_ensure_response( $server->dispatch( $request ) ), $server, $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound

			$this->assertSame( 200, $response->get_status(), $fields );
			$this->assertArrayNotHasKey( Meta::RELATED_PICKS, (array) ( $response->get_data()['meta'] ?? array() ), $fields );
		}
	}

	/**
	 * Asking for the `edit` context anonymously is core's 401, so the context cannot be used to see the picks.
	 */
	public function test_anonymous_edit_context_is_refused(): void {
		$post = $this->resource();
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE . '/' . $post );
		$request->set_query_params( array( 'context' => 'edit' ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 401, $response->get_status() );
		$this->assertSame( 'rest_forbidden_context', $response->get_data()['code'] );
	}

	/**
	 * An editor's `edit`-context read, the one the block editor makes, has the picks.
	 */
	public function test_editor_edit_context_read_includes_the_picks(): void {
		$post  = $this->resource();
		$other = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );
		$this->as_editor();

		$request = new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE . '/' . $post );
		$request->set_query_params( array( 'context' => 'edit' ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $other ), $response->get_data()['meta'][ Meta::RELATED_PICKS ] );
	}

	/**
	 * An editor's `view`-context read has no picks either: the context, not the capability, decides.
	 */
	public function test_editor_view_context_read_has_no_picks(): void {
		$post  = $this->resource();
		$other = $this->resource();
		update_post_meta( $post, Meta::RELATED_PICKS, array( $other ) );
		$this->as_editor();

		$response = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE . '/' . $post ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayNotHasKey( Meta::RELATED_PICKS, $response->get_data()['meta'] );
	}

	/**
	 * Creates a resource with one type.
	 *
	 * @param string $status Post status.
	 * @return int Post ID.
	 */
	private function resource( string $status = 'publish' ): int {
		$id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => $status,
			)
		);
		wp_set_object_terms( $id, $this->type, Taxonomies::TYPE );

		return $id;
	}

	/**
	 * Makes an editor the current user.
	 */
	private function as_editor(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
	}

	/**
	 * POSTs an update to a resource as the current user.
	 *
	 * @param int                  $post   Post ID.
	 * @param array<string, mixed> $params Body parameters.
	 */
	private function update( int $post, array $params ): WP_REST_Response {
		$request = new WP_REST_Request( 'POST', '/wp/v2/' . PostType::REST_BASE . '/' . $post );
		$request->set_body_params( $params );

		return rest_get_server()->dispatch( $request );
	}
}
