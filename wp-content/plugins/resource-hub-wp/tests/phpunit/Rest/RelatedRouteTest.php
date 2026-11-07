<?php
/**
 * `GET /resource-hub/v1/related/{id}?count=n` (see `packages/ui/README.md`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Rest;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\RelatedCache;
use ResourceHub\Rest\RelatedRoute;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Every 200 is checked against `related-response` and every error against `wp-error` in `packages/ui/schemas/`.
 * Resources are created oldest first, so a later call to {@see RelatedRouteTest::resource()} is a newer resource.
 */
final class RelatedRouteTest extends WP_UnitTestCase {
	/**
	 * A type term ID every resource gets.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * Two topic term IDs.
	 *
	 * @var array{int, int}
	 */
	private array $topics;

	/**
	 * The publish date of the last resource created, as a timestamp.
	 *
	 * @var int
	 */
	private int $clock;

	/**
	 * Creates one type and two topics.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->type   = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$this->topics = array(
			self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) ),
			self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) ),
		);
		$this->clock  = time() - DAY_IN_SECONDS;
	}

	/**
	 * Picks come first in the editor's order, then the fill, newest first.
	 */
	public function test_picks_first_in_editor_order_then_newest_by_topic(): void {
		$older  = $this->resource( array( 0 ) );
		$newer  = $this->resource( array( 0 ) );
		$pick_a = $this->resource();
		$pick_b = $this->resource();
		$post   = $this->resource( array( 0 ), array( $pick_b, $pick_a ) );

		$this->assert_items(
			array(
				array( $pick_b, 'pick' ),
				array( $pick_a, 'pick' ),
				array( $newer, 'topic' ),
				array( $older, 'topic' ),
			),
			$this->related( $post, 10 )
		);
	}

	/**
	 * The fill covers every topic the resource has, with no ranking by how many topics overlap: a newer
	 * resource sharing one topic comes before an older one sharing both.
	 */
	public function test_fill_has_no_overlap_ranking(): void {
		$both = $this->resource( array( 0, 1 ) );
		$one  = $this->resource( array( 1 ) );
		$post = $this->resource( array( 0, 1 ) );

		$this->assert_items(
			array(
				array( $one, 'topic' ),
				array( $both, 'topic' ),
			),
			$this->related( $post, 10 )
		);
	}

	/**
	 * A pick that is not published now is skipped, and stays in the meta for when it is again.
	 *
	 * @dataProvider unpublished_statuses
	 *
	 * @param string $status The pick's status.
	 */
	public function test_unpublished_pick_is_skipped_and_kept( string $status ): void {
		$fill = $this->resource( array( 0 ) );
		$pick = $this->resource( array(), array(), $status );
		$post = $this->resource( array( 0 ), array( $pick ) );

		$this->assert_items( array( array( $fill, 'topic' ) ), $this->related( $post, 3 ) );
		$this->assertSame( array( $pick ), get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Cases for test_unpublished_pick_is_skipped_and_kept().
	 *
	 * @return array<string, array{string}>
	 */
	public static function unpublished_statuses(): array {
		return array(
			'draft'   => array( 'draft' ),
			'pending' => array( 'pending' ),
			'private' => array( 'private' ),
			'trash'   => array( 'trash' ),
		);
	}

	/**
	 * A pick that is a page, not a resource, is skipped too.
	 */
	public function test_pick_of_another_post_type_is_skipped(): void {
		$page = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);
		$post = $this->resource( array(), array( $page ) );

		$this->assert_items( array(), $this->related( $post, 3 ) );
	}

	/**
	 * A resource that is both a pick and in the fill appears once, as a pick.
	 */
	public function test_pick_also_in_the_fill_appears_once_as_a_pick(): void {
		$other = $this->resource( array( 0 ) );
		$pick  = $this->resource( array( 0 ) );
		$post  = $this->resource( array( 0 ), array( $pick ) );

		$this->assert_items(
			array(
				array( $pick, 'pick' ),
				array( $other, 'topic' ),
			),
			$this->related( $post, 3 )
		);
	}

	/**
	 * The resource is never in its own list, even as the newest in its topic, and a stored self-pick
	 * (a row written before the rule) is ignored rather than listed.
	 */
	public function test_the_resource_itself_is_never_listed(): void {
		$other = $this->resource( array( 0 ) );
		$post  = $this->resource( array( 0 ) );
		$this->store_picks( $post, array( $post ) );

		$this->assert_items( array( array( $other, 'topic' ) ), $this->related( $post, 3 ) );
	}

	/**
	 * The list stops at `count`: the first `count` picks win when there are more.
	 */
	public function test_more_picks_than_count_keeps_the_first(): void {
		$picks = array( $this->resource(), $this->resource(), $this->resource() );
		$post  = $this->resource( array(), $picks );

		$this->assert_items(
			array(
				array( $picks[0], 'pick' ),
				array( $picks[1], 'pick' ),
			),
			$this->related( $post, 2 )
		);
	}

	/**
	 * The fill takes only the slots the picks leave.
	 */
	public function test_fill_takes_the_remaining_slots(): void {
		$this->resource( array( 0 ) );
		$newer = $this->resource( array( 0 ) );
		$pick  = $this->resource();
		$post  = $this->resource( array( 0 ), array( $pick ) );

		$this->assert_items(
			array(
				array( $pick, 'pick' ),
				array( $newer, 'topic' ),
			),
			$this->related( $post, 2 )
		);
	}

	/**
	 * When the resource and every shown pick are the newest in the topic, the fill still fills every
	 * slot: the query asks for `count + 1` and drops them in PHP.
	 */
	public function test_fill_is_complete_when_the_newest_are_excluded(): void {
		$this->resource( array( 0 ) );
		$this->resource( array( 0 ) );
		$fill   = $this->resource( array( 0 ) );
		$pick_a = $this->resource( array( 0 ) );
		$pick_b = $this->resource( array( 0 ) );
		$post   = $this->resource( array( 0 ), array( $pick_a, $pick_b ) );

		$this->assert_items(
			array(
				array( $pick_a, 'pick' ),
				array( $pick_b, 'pick' ),
				array( $fill, 'topic' ),
			),
			$this->related( $post, 3 )
		);
	}

	/**
	 * At most ten items come back when the topic has more.
	 */
	public function test_count_ten_is_the_most(): void {
		for ( $i = 0; $i < 12; $i++ ) {
			$this->resource( array( 0 ) );
		}
		$post = $this->resource( array( 0 ) );

		$response = $this->related( $post, 10 );

		$this->assertCount( 10, $response->get_data()['items'] );
	}

	/**
	 * A resource with no topics gets its published picks alone.
	 */
	public function test_no_topics_gives_picks_alone(): void {
		$this->resource( array( 0 ) );
		$pick = $this->resource( array( 0 ) );
		$post = $this->resource( array(), array( $pick ) );

		$this->assert_items( array( array( $pick, 'pick' ) ), $this->related( $post, 3 ) );
	}

	/**
	 * A resource with neither topics nor picks, or whose topic nobody else has, gets an empty list.
	 */
	public function test_nothing_related_gives_an_empty_list(): void {
		$this->resource( array( 1 ) );
		$alone = $this->resource();
		$topic = $this->resource( array( 0 ) );

		$this->assert_items( array(), $this->related( $alone, 3 ) );
		$this->assert_items( array(), $this->related( $topic, 3 ) );
	}

	/**
	 * The fill holds published resources in the topic only: not drafts, not other topics, not pages or posts.
	 */
	public function test_fill_holds_published_resources_in_the_topic_only(): void {
		$this->resource( array( 0 ), array(), 'draft' );
		$this->resource( array( 1 ) );
		$page = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);
		wp_set_object_terms( $page, $this->topics[0], Taxonomies::TOPIC );
		$match = $this->resource( array( 0 ) );
		$post  = $this->resource( array( 0 ) );

		$this->assert_items( array( array( $match, 'topic' ) ), $this->related( $post, 10 ) );
	}

	/**
	 * `count` defaults to 3.
	 */
	public function test_count_defaults_to_three(): void {
		for ( $i = 0; $i < 5; $i++ ) {
			$this->resource( array( 0 ) );
		}
		$post = $this->resource( array( 0 ) );

		$response = $this->related( $post, null );

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( RelatedRoute::DEFAULT_COUNT, $response->get_data()['items'] );
	}

	/**
	 * A `count` outside 1 to 10, or not an integer, is a 400 in core's error shape.
	 *
	 * @dataProvider invalid_counts
	 *
	 * @param mixed $count The parameter sent.
	 */
	public function test_invalid_count_is_a_400( mixed $count ): void {
		$post = $this->resource();

		$this->assert_error( $this->related( $post, $count ), 400, 'rest_invalid_param' );
	}

	/**
	 * Cases for test_invalid_count_is_a_400().
	 *
	 * @return array<string, array{mixed}>
	 */
	public static function invalid_counts(): array {
		return array(
			'zero'     => array( 0 ),
			'eleven'   => array( 11 ),
			'negative' => array( -1 ),
			'a word'   => array( 'abc' ),
			'a float'  => array( '2.5' ),
			'empty'    => array( '' ),
		);
	}

	/**
	 * The ends of the range are accepted.
	 */
	public function test_count_bounds_are_accepted(): void {
		$post = $this->resource();

		$this->assertSame( 200, $this->related( $post, 1 )->get_status() );
		$this->assertSame( 200, $this->related( $post, 10 )->get_status() );
		$this->assertSame( 200, $this->related( $post, '7' )->get_status() );
	}

	/**
	 * An ID that is not a published resource is a 404 in core's error shape.
	 *
	 * @dataProvider not_found_ids
	 *
	 * @param string $which Which ID to send.
	 */
	public function test_not_a_published_resource_is_a_404( string $which ): void {
		$id = match ( $which ) {
			'draft'     => $this->resource( array(), array(), 'draft' ),
			'pending'   => $this->resource( array(), array(), 'pending' ),
			'private'   => $this->resource( array(), array(), 'private' ),
			'trash'     => $this->resource( array(), array(), 'trash' ),
			'a page'    => self::factory()->post->create(
				array(
					'post_type'   => 'page',
					'post_status' => 'publish',
				)
			),
			'a post'    => self::factory()->post->create( array( 'post_status' => 'publish' ) ),
			'unknown'   => $this->resource() + 1000,
			'zero'      => 0,
		};

		$this->assert_error( $this->related( $id, 3 ), 404, RelatedRoute::NOT_FOUND );
	}

	/**
	 * Cases for test_not_a_published_resource_is_a_404().
	 *
	 * @return array<string, array{string}>
	 */
	public static function not_found_ids(): array {
		return array(
			'draft'   => array( 'draft' ),
			'pending' => array( 'pending' ),
			'private' => array( 'private' ),
			'trash'   => array( 'trash' ),
			'a page'  => array( 'a page' ),
			'a post'  => array( 'a post' ),
			'unknown' => array( 'unknown' ),
			'zero'    => array( 'zero' ),
		);
	}

	/**
	 * An ID of 0 is a 404 even when the global post is a published resource, which `get_post( 0 )` would return.
	 */
	public function test_zero_is_a_404_when_the_global_post_is_a_resource(): void {
		$GLOBALS['post'] = get_post( $this->resource() ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- setting the global post is what this test checks.

		try {
			$this->assert_error( $this->related( 0, 3 ), 404, RelatedRoute::NOT_FOUND );
		} finally {
			unset( $GLOBALS['post'] );
		}
	}

	/**
	 * An administrator, who may read drafts elsewhere, gets the 404 for a draft too: the route answers for
	 * published resources only, whoever asks.
	 */
	public function test_draft_is_a_404_for_an_administrator(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$draft = $this->resource( array(), array(), 'draft' );

		$this->assertTrue( current_user_can( 'edit_post', $draft ) );
		$this->assert_error( $this->related( $draft, 3 ), 404, RelatedRoute::NOT_FOUND );
	}

	/**
	 * The route is public: an anonymous request is answered.
	 */
	public function test_anonymous_request_is_answered(): void {
		$other = $this->resource( array( 0 ) );
		$post  = $this->resource( array( 0 ) );
		wp_set_current_user( 0 );

		$this->assert_items( array( array( $other, 'topic' ) ), $this->related( $post, 3 ) );
	}

	/**
	 * The first answer is stored under `related:{id}:{count}` in the `resource_hub` group with the current
	 * salt, and the next request with the same ID and count is answered from it.
	 */
	public function test_second_call_is_answered_from_the_cache(): void {
		$other = $this->resource( array( 0 ) );
		$post  = $this->resource( array( 0 ) );

		$first = $this->related( $post, 3 );

		$this->assert_items( array( array( $other, 'topic' ) ), $first );
		$this->assertSame( $first->get_data()['items'], wp_cache_get_salted( RelatedCache::key( $post, 3 ), RelatedCache::GROUP, RelatedCache::salt() ) );

		$planted = array(
			array(
				'id'     => 424242,
				'source' => 'topic',
			),
		);
		wp_cache_set_salted( RelatedCache::key( $post, 3 ), $planted, RelatedCache::GROUP, RelatedCache::salt(), RelatedCache::EXPIRY );

		$this->assertSame( $planted, $this->related( $post, 3 )->get_data()['items'] );
		$this->assert_items( array( array( $other, 'topic' ) ), $this->related( $post, 2 ), 'Another count is another entry.' );
	}

	/**
	 * An entry stored under an older salt is a miss: publishing a resource turns the salt over, and the
	 * list is computed again.
	 */
	public function test_publishing_a_resource_empties_the_cache(): void {
		$other = $this->resource( array( 0 ) );
		$post  = $this->resource( array( 0 ) );
		$this->related( $post, 3 );
		wp_cache_set_salted(
			RelatedCache::key( $post, 3 ),
			array(
				array(
					'id'     => 424242,
					'source' => 'topic',
				),
			),
			RelatedCache::GROUP,
			RelatedCache::salt(),
			RelatedCache::EXPIRY
		);

		$newest = $this->resource( array( 0 ) );

		$this->assert_items(
			array(
				array( $newest, 'topic' ),
				array( $other, 'topic' ),
			),
			$this->related( $post, 3 )
		);
	}

	/**
	 * Creates a published resource (or one in another status) with the test's type, the given topics by
	 * index and the given picks, one second newer than the last.
	 *
	 * @param int[]  $topics Indexes into the test's topics.
	 * @param int[]  $picks  Post IDs to store as picks.
	 * @param string $status Post status.
	 * @return int Post ID.
	 */
	private function resource( array $topics = array(), array $picks = array(), string $status = 'publish' ): int {
		$this->clock += 1;
		$date         = gmdate( 'Y-m-d H:i:s', $this->clock );
		$id           = self::factory()->post->create(
			array(
				'post_type'     => PostType::NAME,
				'post_status'   => 'trash' === $status ? 'publish' : $status,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			)
		);
		wp_set_object_terms( $id, $this->type, Taxonomies::TYPE );

		if ( array() !== $topics ) {
			wp_set_object_terms( $id, array_map( fn( int $i ): int => $this->topics[ $i ], $topics ), Taxonomies::TOPIC );
		}

		if ( array() !== $picks ) {
			$this->store_picks( $id, $picks );
		}

		if ( 'trash' === $status ) {
			wp_trash_post( $id );
		}

		return $id;
	}

	/**
	 * Stores a picks list as a row, bypassing the filters, so a self-pick can be planted.
	 *
	 * @param int   $post  Post ID.
	 * @param int[] $picks The list.
	 */
	private function store_picks( int $post, array $picks ): void {
		remove_all_filters( 'add_post_metadata' );
		remove_all_filters( 'update_post_metadata' );
		update_post_meta( $post, Meta::RELATED_PICKS, $picks );
		$this->assertSame( $picks, get_post_meta( $post, Meta::RELATED_PICKS, true ) );
	}

	/**
	 * Dispatches a related request through the REST server.
	 *
	 * @param int   $id    The ID in the path.
	 * @param mixed $count The `count` parameter, or null to leave it out.
	 */
	private function related( int $id, mixed $count ): WP_REST_Response {
		$request = new WP_REST_Request( 'GET', '/' . RelatedRoute::NAMESPACE . '/related/' . $id );

		if ( null !== $count ) {
			$request->set_query_params( array( 'count' => $count ) );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Asserts a schema-valid 200 whose items are exactly these, in this order.
	 *
	 * @param array<int, array{int, string}> $expected ID and source pairs.
	 * @param WP_REST_Response               $response The response.
	 * @param string                         $message  Shown on failure.
	 */
	private function assert_items( array $expected, WP_REST_Response $response, string $message = '' ): void {
		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assertNull( SchemaValidator::errors( 'related-response', $response->get_data() ) );
		$this->assertSame(
			array_map(
				static fn( array $pair ): array => array(
					'id'     => $pair[0],
					'source' => $pair[1],
				),
				$expected
			),
			$response->get_data()['items'],
			$message
		);
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
