<?php
/**
 * `GET /resource-hub/v1/search?q=…&page=n` (see `packages/ui/README.md`, "Search").
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Rest;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\NoCacheHeader;
use ResourceHub\Rest\RelatedCache;
use ResourceHub\Rest\SearchCache;
use ResourceHub\Rest\SearchRoute;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Every 200 is checked against `search-response` and every error against `wp-error` in
 * `packages/ui/schemas/`. These tests must pass with Relevanssi active and without it, when core's
 * search answers: they assert which posts match, how many and how they page, never the order within
 * a page, which is the engine's. Each test searches for a word no other content holds, so only the
 * posts it made can match.
 */
final class SearchRouteTest extends WP_UnitTestCase {
	/**
	 * The word every matching post's title holds.
	 */
	private const WORD = 'zephyrquill';

	/**
	 * The publish date of the last post created, as a timestamp.
	 *
	 * @var int
	 */
	private int $clock;

	/**
	 * Starts the clock a day back, so every post made is in the past and one second newer than the last.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->clock = time() - DAY_IN_SECONDS;
	}

	/**
	 * Published resources and pages with no password match; drafts, pending, private, trashed and
	 * password-protected ones, posts, and published content without the word do not.
	 */
	public function test_only_published_resources_and_pages_match(): void {
		$resource = $this->post( PostType::NAME );
		$page     = $this->post( 'page' );

		$this->post( PostType::NAME, 'publish', 'nothing to see' );
		$this->post( 'post' );

		foreach ( array( PostType::NAME, 'page' ) as $type ) {
			foreach ( array( 'draft', 'pending', 'private', 'trash' ) as $status ) {
				$this->post( $type, $status );
			}

			$this->post( $type, 'publish', self::WORD . ' locked', 'secret' );
		}

		$this->assert_results(
			array(
				$resource => PostType::NAME,
				$page     => 'page',
			),
			2,
			1,
			$this->search( self::WORD )
		);
	}

	/**
	 * The answer is the same for an administrator, who may read drafts and whom core's search would
	 * show password-protected posts, as for an anonymous reader: the cache key does not name the reader.
	 */
	public function test_the_answer_does_not_depend_on_who_asks(): void {
		$resource = $this->post( PostType::NAME );
		$this->post( 'page', 'publish', self::WORD . ' locked', 'secret' );
		$this->post( PostType::NAME, 'draft' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$this->assert_results( array( $resource => PostType::NAME ), 1, 1, $this->search( self::WORD ) );

		wp_set_current_user( 0 );
		wp_cache_set_last_changed( RelatedCache::GROUP );

		$this->assert_results( array( $resource => PostType::NAME ), 1, 1, $this->search( self::WORD ) );
	}

	/**
	 * The posts page is never a match while a static front page is set, since the front end never serves
	 * it, and its absence is not counted; with `show_on_front` on `posts` it is an ordinary page.
	 */
	public function test_the_posts_page_is_left_out_while_it_is_one(): void {
		$page       = $this->post( 'page' );
		$front      = $this->post( 'page', 'publish', 'Home' );
		$posts_page = $this->post( 'page' );
		update_option( 'page_on_front', $front );
		update_option( 'page_for_posts', $posts_page );
		update_option( 'show_on_front', 'page' );

		$this->assert_results( array( $page => 'page' ), 1, 1, $this->search( self::WORD ) );

		update_option( 'show_on_front', 'posts' );

		$this->assert_results(
			array(
				$page       => 'page',
				$posts_page => 'page',
			),
			2,
			1,
			$this->search( self::WORD )
		);
	}

	/**
	 * Twelve to a page: the pages split the matches between them, none twice and none lost, and a page
	 * past the last is a 200 with no items and the same counts.
	 */
	public function test_results_are_paged_twelve_at_a_time(): void {
		$expected = array();

		for ( $i = 0; $i < SearchRoute::PER_PAGE + 2; $i++ ) {
			$expected[ $this->post( 0 === $i % 3 ? 'page' : PostType::NAME ) ] = 0 === $i % 3 ? 'page' : PostType::NAME;
		}

		$first  = $this->search( self::WORD, 1 );
		$second = $this->search( self::WORD, 2 );
		$third  = $this->search( self::WORD, 3 );

		$this->assert_page( SearchRoute::PER_PAGE, 14, 2, $first );
		$this->assert_page( 2, 14, 2, $second );
		$this->assert_page( 0, 14, 2, $third );
		$this->assertSame( SearchRoute::PER_PAGE, 12 );

		$seen = $this->items_by_id( $first ) + $this->items_by_id( $second );
		ksort( $seen );
		ksort( $expected );

		$this->assertCount( 14, $seen, 'A match was listed on both pages.' );
		$this->assertSame( $expected, $seen );
	}

	/**
	 * More matches than ten pages hold: `total` is the true count, `pages` stops at 10, the tenth page is
	 * full, and the matches past it are counted and never listed.
	 */
	public function test_pages_stop_at_ten_and_total_counts_everything(): void {
		$all = SearchRoute::PER_PAGE * SearchRoute::MAX_PAGE + 1;

		for ( $i = 0; $i < $all; $i++ ) {
			$this->post( PostType::NAME );
		}

		$this->assert_page( SearchRoute::PER_PAGE, $all, SearchRoute::MAX_PAGE, $this->search( self::WORD, 1 ) );
		$this->assert_page( SearchRoute::PER_PAGE, $all, SearchRoute::MAX_PAGE, $this->search( self::WORD, SearchRoute::MAX_PAGE ) );
	}

	/**
	 * Nothing matching is a 200 with no items and both counts 0.
	 */
	public function test_no_match_is_an_empty_200(): void {
		$this->post( PostType::NAME, 'publish', 'nothing to see' );

		$this->assert_results( array(), 0, 0, $this->search( self::WORD ) );
	}

	/**
	 * Every run of whitespace, Unicode whitespace included, is one space, and the ends are trimmed.
	 *
	 * @dataProvider normalised_queries
	 *
	 * @param string $raw      The query as sent.
	 * @param string $expected The query as searched.
	 */
	public function test_the_query_is_trimmed_and_collapsed( string $raw, string $expected ): void {
		$this->assertSame( $expected, SearchRoute::normalize_query( $raw ) );
	}

	/**
	 * Cases for test_the_query_is_trimmed_and_collapsed().
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function normalised_queries(): array {
		return array(
			'as is'               => array( 'case study', 'case study' ),
			'ends trimmed'        => array( "  case study\t", 'case study' ),
			'runs collapsed'      => array( "case \t\n\r\x0B\x0C study", 'case study' ),
			'no-break space'      => array( "case\u{00A0}study", 'case study' ),
			'next line'           => array( "case\u{0085}study", 'case study' ),
			'ideographic space'   => array( "\u{3000}case\u{3000}\u{2003}study\u{3000}", 'case study' ),
			'line separator'      => array( "case\u{2028}study", 'case study' ),
			'zero width kept'     => array( "case\u{200B}study", "case\u{200B}study" ),
			'byte order mark'     => array( "case\u{FEFF}study", "case\u{FEFF}study" ),
			'tags left as text'   => array( '<b>x</b>', '<b>x</b>' ),
			'case kept'           => array( 'Case Study', 'Case Study' ),
			'multibyte unchanged' => array( '日本語', '日本語' ),
		);
	}

	/**
	 * Not a string, or not valid UTF-8, normalises to null.
	 */
	public function test_a_query_that_is_not_a_utf8_string_normalises_to_null(): void {
		$this->assertNull( SearchRoute::normalize_query( array( 'ab' ) ) );
		$this->assertNull( SearchRoute::normalize_query( 12 ) );
		$this->assertNull( SearchRoute::normalize_query( "ab\xFF" ) );
	}

	/**
	 * `q` missing, not a string, not UTF-8, or outside 2 to 100 characters once normalised is a 400.
	 *
	 * @dataProvider invalid_queries
	 *
	 * @param mixed  $q    The parameter sent, or null to leave it out.
	 * @param string $code The error code.
	 */
	public function test_invalid_query_is_a_400( mixed $q, string $code ): void {
		$this->assert_error( $this->search( $q ), 400, $code );
	}

	/**
	 * Cases for test_invalid_query_is_a_400().
	 *
	 * @return array<string, array{mixed, string}>
	 */
	public static function invalid_queries(): array {
		return array(
			'missing'                 => array( null, 'rest_missing_callback_param' ),
			'empty'                   => array( '', 'rest_invalid_param' ),
			'one character'           => array( 'a', 'rest_invalid_param' ),
			'one once trimmed'        => array( '  a  ', 'rest_invalid_param' ),
			'whitespace only'         => array( " \t\u{3000} ", 'rest_invalid_param' ),
			'101 characters'          => array( str_repeat( 'a', 101 ), 'rest_invalid_param' ),
			'101 multibyte'           => array( str_repeat( 'é', 101 ), 'rest_invalid_param' ),
			'an array'                => array( array( 'ab' ), 'rest_invalid_param' ),
			'not UTF-8'               => array( "ab\xFF", 'rest_invalid_param' ),
			'101 with collapsed runs' => array( str_repeat( 'a ', 50 ) . 'a', 'rest_invalid_param' ),
		);
	}

	/**
	 * The ends of the length range are accepted, counted in characters once normalised, not in bytes
	 * and not as sent.
	 */
	public function test_query_length_bounds_are_accepted(): void {
		foreach ( array( 'ab', str_repeat( 'é', 100 ), str_repeat( 'a', 50 ) . str_repeat( ' ', 300 ) . str_repeat( 'b', 49 ), '   ab   ' ) as $q ) {
			$this->assert_results( array(), 0, 0, $this->search( $q ), (string) strlen( $q ) );
		}
	}

	/**
	 * A `page` outside 1 to 10, or not an integer, is a 400.
	 *
	 * @dataProvider invalid_pages
	 *
	 * @param mixed $page The parameter sent.
	 */
	public function test_invalid_page_is_a_400( mixed $page ): void {
		$this->assert_error( $this->search( self::WORD, $page ), 400, 'rest_invalid_param' );
	}

	/**
	 * Cases for test_invalid_page_is_a_400().
	 *
	 * @return array<string, array{mixed}>
	 */
	public static function invalid_pages(): array {
		return array(
			'zero'     => array( 0 ),
			'eleven'   => array( 11 ),
			'negative' => array( -1 ),
			'a word'   => array( 'abc' ),
			'a float'  => array( '2.5' ),
			'empty'    => array( '' ),
			'an array' => array( array( 1 ) ),
		);
	}

	/**
	 * The ends of the page range are accepted, and a missing page is the first.
	 */
	public function test_page_bounds_are_accepted(): void {
		$this->post( PostType::NAME );

		$this->assert_page( 1, 1, 1, $this->search( self::WORD ) );
		$this->assert_page( 1, 1, 1, $this->search( self::WORD, 1 ) );
		$this->assert_page( 0, 1, 1, $this->search( self::WORD, SearchRoute::MAX_PAGE ) );
		$this->assert_page( 0, 1, 1, $this->search( self::WORD, '10' ) );
	}

	/**
	 * The plugin sends the same no-cache header on this route as on the others (ADR 0043), on a 200 and
	 * on a 400.
	 */
	public function test_anonymous_responses_carry_the_no_cache_header(): void {
		wp_set_current_user( 0 );

		foreach ( array(
			200 => self::WORD,
			400 => 'a',
		) as $status => $q ) {
			// `dispatch()` stops before `rest_post_dispatch`, where the plugin's filter runs; apply it as `serve_request()` would.
			$request = new WP_REST_Request( 'GET', '/' . SearchRoute::NAMESPACE . SearchRoute::ROUTE );
			$request->set_query_params( array( 'q' => $q ) );
			$server   = rest_get_server();
			$response = apply_filters( 'rest_post_dispatch', rest_ensure_response( $server->dispatch( $request ) ), $server, $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound

			$this->assertSame( $status, $response->get_status() );
			$this->assertSame( NoCacheHeader::VALUE, $response->get_headers()['Cache-Control'] ?? '', (string) $status );
		}
	}

	/**
	 * The first answer is stored under `search:{md5(q)}:{page}` in the `resource_hub` group with the
	 * plugin's salt, and the next request for the same normalised query and page is answered from it,
	 * however its whitespace was sent. Another page is another entry.
	 */
	public function test_second_call_is_answered_from_the_cache(): void {
		$resource = $this->post( PostType::NAME, 'publish', self::WORD . ' case study' );
		$query    = self::WORD . ' case';
		$first    = $this->search( $query );

		$this->assert_results( array( $resource => PostType::NAME ), 1, 1, $first );
		$this->assertSame( 'search:' . md5( $query ) . ':1', SearchCache::key( $query, 1 ) );
		$this->assertSame( $first->get_data(), wp_cache_get_salted( SearchCache::key( $query, 1 ), RelatedCache::GROUP, SearchCache::salt() ) );

		$planted = $this->plant( $query, 1 );

		$this->assertSame( $planted, $this->search( $query )->get_data() );
		$this->assertSame( $planted, $this->search( "  {$query}\u{00A0}" )->get_data(), 'The normalised query names the entry.' );
		$this->assert_page( 0, 1, 1, $this->search( $query, 2 ), 'Another page is another entry.' );
	}

	/**
	 * An entry stored under an older salt is a miss: a bump of the plugin's `last_changed` stamp, of the
	 * search-only stamp, or publishing a resource that matches makes the next request search again.
	 */
	public function test_an_entry_is_a_miss_once_the_salt_moves(): void {
		$resource = $this->post( PostType::NAME );
		$draft    = $this->post( PostType::NAME, 'draft' );
		$this->search( self::WORD );
		$planted = $this->plant( self::WORD, 1 );

		$this->assertSame( $planted, $this->search( self::WORD )->get_data() );

		wp_cache_set_last_changed( RelatedCache::GROUP );

		$this->assert_results( array( $resource => PostType::NAME ), 1, 1, $this->search( self::WORD ) );

		$this->plant( self::WORD, 1 );
		( new SearchCache() )->bump();

		$this->assert_results( array( $resource => PostType::NAME ), 1, 1, $this->search( self::WORD ), 'The search-only stamp is part of the salt.' );

		$this->plant( self::WORD, 1 );
		$salt_before = RelatedCache::salt();
		wp_publish_post( $draft );

		$this->assertNotSame( $salt_before, RelatedCache::salt(), 'Publishing a resource did not bump the salt.' );
		$this->assert_results(
			array(
				$resource => PostType::NAME,
				$draft    => PostType::NAME,
			),
			2,
			1,
			$this->search( self::WORD )
		);
	}

	/**
	 * Each change a search can see and the related lists cannot turns the search-only stamp over and
	 * leaves the related lists' stamp alone: a page published, edited, put behind a password, trashed or
	 * deleted; Settings > Reading; and a type term made, renamed or deleted.
	 *
	 * @dataProvider search_only_changes
	 *
	 * @param string $change Which change to make.
	 */
	public function test_a_change_only_search_sees_moves_the_salt( string $change ): void {
		$page    = $this->post( 'page' );
		$draft   = $this->post( 'page', 'draft' );
		$type    = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$salt    = SearchCache::salt();
		$related = RelatedCache::salt();

		match ( $change ) {
			'page published'   => wp_publish_post( $draft ),
			'page edited'      => wp_update_post(
				array(
					'ID'         => $page,
					'post_title' => self::WORD . ' renamed',
				)
			),
			'page locked'      => wp_update_post(
				array(
					'ID'            => $page,
					'post_password' => 'secret',
				)
			),
			'page trashed'     => wp_trash_post( $page ),
			'page deleted'     => wp_delete_post( $page, true ),
			'reading settings' => update_option( 'show_on_front', 'page' === get_option( 'show_on_front' ) ? 'posts' : 'page' ),
			'type created'     => self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ),
			'type renamed'     => wp_update_term( $type, Taxonomies::TYPE, array( 'name' => 'Renamed' ) ),
			'type deleted'     => wp_delete_term( $type, Taxonomies::TYPE ),
		};

		$this->assertNotSame( $salt, SearchCache::salt(), 'The search salt did not move.' );
		$this->assertSame( $related, RelatedCache::salt(), 'The related lists were emptied too.' );
	}

	/**
	 * Cases for test_a_change_only_search_sees_moves_the_salt().
	 *
	 * @return array<string, array{string}>
	 */
	public static function search_only_changes(): array {
		$changes = array( 'page published', 'page edited', 'page locked', 'page trashed', 'page deleted', 'reading settings', 'type created', 'type renamed', 'type deleted' );

		return array_combine( $changes, array_map( static fn( string $change ): array => array( $change ), $changes ) );
	}

	/**
	 * Saves no search can see keep the cache: a draft page saved as a draft, and a plain post published.
	 */
	public function test_an_unrelated_save_keeps_the_cache(): void {
		$draft = $this->post( 'page', 'draft' );
		$this->search( self::WORD );
		$planted = $this->plant( self::WORD, 1 );

		wp_update_post(
			array(
				'ID'         => $draft,
				'post_title' => self::WORD . ' still a draft',
			)
		);
		$this->post( 'post' );

		$this->assertSame( $planted, $this->search( self::WORD )->get_data() );
	}

	/**
	 * Creates a post of a type and status whose title holds the test's word, one second newer than the
	 * last. A resource gets no terms: search does not need them.
	 *
	 * @param string $type     Post type.
	 * @param string $status   Post status; `trash` publishes the post first and then trashes it.
	 * @param string $title    The title.
	 * @param string $password The post password, or '' for none.
	 * @return int Post ID.
	 */
	private function post( string $type, string $status = 'publish', string $title = self::WORD . ' guide', string $password = '' ): int {
		$this->clock += 1;
		$date         = gmdate( 'Y-m-d H:i:s', $this->clock );
		$id           = self::factory()->post->create(
			array(
				'post_type'     => $type,
				'post_status'   => 'trash' === $status ? 'publish' : $status,
				'post_title'    => $title,
				'post_content'  => 'Body text.',
				'post_password' => $password,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			)
		);

		if ( 'trash' === $status ) {
			wp_trash_post( $id );
		}

		return $id;
	}

	/**
	 * Stores a recognisable answer under the current salt, in place of whatever the route stored.
	 *
	 * @param string $query The normalised query.
	 * @param int    $page  The page.
	 * @return array{items: array<int, array{id: int, type: string}>, total: int, pages: int} The answer stored.
	 */
	private function plant( string $query, int $page ): array {
		$planted = array(
			'items' => array(
				array(
					'id'   => 424242,
					'type' => 'page',
				),
			),
			'total' => 1,
			'pages' => 1,
		);
		wp_cache_set_salted( SearchCache::key( $query, $page ), $planted, RelatedCache::GROUP, SearchCache::salt(), RelatedCache::EXPIRY );

		return $planted;
	}

	/**
	 * Dispatches a search request through the REST server.
	 *
	 * @param mixed $q    The `q` parameter, or null to leave it out.
	 * @param mixed $page The `page` parameter, or null to leave it out.
	 */
	private function search( mixed $q, mixed $page = null ): WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/' . SearchRoute::NAMESPACE . SearchRoute::ROUTE );
		$params  = array();

		if ( null !== $q ) {
			$params['q'] = $q;
		}

		if ( null !== $page ) {
			$params['page'] = $page;
		}

		$request->set_query_params( $params );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * A response's items as type by ID.
	 *
	 * @param WP_REST_Response $response The response.
	 * @return array<int, string>
	 */
	private function items_by_id( WP_REST_Response $response ): array {
		$items = array();

		foreach ( $response->get_data()['items'] as $item ) {
			$items[ $item['id'] ] = $item['type'];
		}

		return $items;
	}

	/**
	 * Asserts a schema-valid 200 with these counts and this many items.
	 *
	 * @param int              $items    How many items the page holds.
	 * @param int              $total    The expected `total`.
	 * @param int              $pages    The expected `pages`.
	 * @param WP_REST_Response $response The response.
	 * @param string           $message  Shown on failure.
	 */
	private function assert_page( int $items, int $total, int $pages, WP_REST_Response $response, string $message = '' ): void {
		$data = $response->get_data();

		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $data ) );
		$this->assertNull( SchemaValidator::errors( 'search-response', $data ), $message );
		$this->assertCount( $items, $data['items'], $message );
		$this->assertSame( $total, $data['total'], $message );
		$this->assertSame( $pages, $data['pages'], $message );
	}

	/**
	 * Asserts a schema-valid 200 whose items are exactly these, in any order, with these counts.
	 *
	 * @param array<int, string> $expected Type by post ID.
	 * @param int                $total    The expected `total`.
	 * @param int                $pages    The expected `pages`.
	 * @param WP_REST_Response   $response The response.
	 * @param string             $message  Shown on failure.
	 */
	private function assert_results( array $expected, int $total, int $pages, WP_REST_Response $response, string $message = '' ): void {
		$this->assert_page( count( $expected ), $total, $pages, $response, $message );

		$actual = $this->items_by_id( $response );
		ksort( $actual );
		ksort( $expected );

		$this->assertSame( $expected, $actual, $message );
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
		$this->assertNull( SchemaValidator::errors( 'wp-error', $data ) );
		$this->assertSame( $code, $data['code'] );
		$this->assertSame( $status, $data['data']['status'] );
	}
}
