<?php
/**
 * The `resource-hub/related` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\RelatedBlock;
use ResourceHub\Blocks\SharedCard;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\RelatedCache;
use ResourceHub\Rest\RelatedItems;
use WP_Block;
use WP_Block_Type_Registry;
use WP_REST_Request;
use WP_UnitTestCase;

/**
 * The section's markup is `MarkupParityTest`'s, against the contract's `related.html`; the selection's
 * rules are `RelatedRouteTest`'s. This holds the block's own: which post it renders, that its list is
 * the route's from the route's cache entry, which rows it drops, and its registration.
 */
final class RelatedBlockTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * A type term's ID; every resource gets it.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * A topic term's ID.
	 *
	 * @var int
	 */
	private int $topic;

	/**
	 * The publish date of the last resource created, as a timestamp.
	 *
	 * @var int
	 */
	private int $clock;

	/**
	 * One type and one topic, under pretty permalinks (see `RelatedResourcesBlockTest::set_up()`).
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$this->assertTrue(
			WP_Block_Type_Registry::get_instance()->is_registered( RelatedBlock::NAME ),
			'The block is not registered: run `pnpm build` so build/related/block.json exists.'
		);

		$this->type  = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Guide',
				'slug'     => 'guide',
			)
		);
		$this->topic = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Caching',
				'slug'     => 'caching',
			)
		);
		$this->clock = time() - DAY_IN_SECONDS;
		self::use_type_accents( array() );
	}

	/**
	 * Back to plain permalinks and the build's table.
	 */
	public function tear_down(): void {
		self::reset_type_accents();
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * The compiled block.json: the callback, the context, no attributes, no wrapper supports, and the two
	 * shared handles the row blocks share, with no stylesheet of its own.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( RelatedBlock::NAME );

		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'postId', 'postType' ), $type->uses_context );
		$this->assertArrayNotHasKey( 'attributes', wp_json_file_decode( dirname( __DIR__, 3 ) . '/build/related/block.json', array( 'associative' => true ) ), 'The block has no attributes of its own.' );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );
		$this->assertSame( array( SharedTokens::HANDLE, SharedCard::HANDLE ), $type->style_handles );
		$this->assertFileDoesNotExist( dirname( __DIR__, 3 ) . '/build/related/style-index.css' );
	}

	/**
	 * The section: the front end's heading and id, the picks first in the editor's order, then the newest
	 * sharing a topic, each a row at `h3` linking its permalink, inside one list.
	 */
	public function test_renders_picks_then_topic_matches_as_rows(): void {
		$older = $this->resource( 'Older match', array( $this->topic ) );
		$newer = $this->resource( 'Newer match', array( $this->topic ) );
		$pick  = $this->resource( 'The pick' );
		$host  = $this->resource( 'The host', array( $this->topic ), array( $pick ) );

		$html = $this->render( $host );

		$this->assertStringStartsWith(
			'<section class="rh-related" aria-labelledby="rh-related-heading">'
			. '<h2 class="rh-related__heading" id="rh-related-heading">Related resources</h2>'
			. '<ul class="rh-card-grid" role="list"><li><article class="rh-card">',
			$html
		);
		$this->assertStringEndsWith( '</article></li></ul></section>', $html );
		$this->assertSame( 3, substr_count( $html, '<li><article class="rh-card">' ) );
		$this->assertSame( 3, substr_count( $html, '<h3 class="rh-card__title">' ) );
		$this->assertSame(
			array( get_permalink( $pick ), get_permalink( $newer ), get_permalink( $older ) ),
			$this->links( $html ),
			'Picks first, then the fill newest first, never the host.'
		);
		$this->assertStringNotContainsString( 'wp-block-', $html, 'No block wrapper.' );
	}

	/**
	 * The list is the route's: the block fills the route's cache entry for the default count, and reads
	 * what is there, so a list the route stored is the list the block shows.
	 */
	public function test_shares_the_routes_cache_entry(): void {
		$match = $this->resource( 'A match', array( $this->topic ) );
		$other = $this->resource( 'Another resource' );
		$host  = $this->resource( 'The host', array( $this->topic ) );

		$this->assertSame( array( get_permalink( $match ) ), $this->links( $this->render( $host ) ) );
		$this->assertSame(
			array(
				array(
					'id'     => $match,
					'source' => RelatedItems::SOURCE_TOPIC,
				),
			),
			wp_cache_get_salted( RelatedCache::key( $host, RelatedItems::DEFAULT_COUNT ), RelatedCache::GROUP, RelatedCache::salt() )
		);

		wp_cache_set_salted(
			RelatedCache::key( $host, RelatedItems::DEFAULT_COUNT ),
			array(
				array(
					'id'     => $other,
					'source' => RelatedItems::SOURCE_PICK,
				),
			),
			RelatedCache::GROUP,
			RelatedCache::salt(),
			RelatedCache::EXPIRY
		);

		$this->assertSame( array( get_permalink( $other ) ), $this->links( $this->render( $host ) ), 'The planted entry is what the block renders.' );
	}

	/**
	 * At most the default count of rows, the count the front end's section asks for.
	 */
	public function test_renders_the_default_count_at_most(): void {
		for ( $i = 0; $i < RelatedItems::DEFAULT_COUNT + 2; $i++ ) {
			$this->resource( "Match {$i}", array( $this->topic ) );
		}
		$host = $this->resource( 'The host', array( $this->topic ) );

		$this->assertCount( RelatedItems::DEFAULT_COUNT, $this->links( $this->render( $host ) ) );
	}

	/**
	 * A related resource with an empty title or without exactly one type gets no row, and one that is no
	 * longer published when the cached list is rendered is left out; the section renders nothing when no
	 * row is left.
	 */
	public function test_drops_rows_the_front_end_drops(): void {
		$blank   = $this->resource( '&nbsp;', array( $this->topic ) );
		$untyped = $this->resource( 'Untyped', array( $this->topic ) );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$shown = $this->resource( 'Shown', array( $this->topic ) );
		$host  = $this->resource( 'The host', array( $this->topic ) );

		$html = $this->render( $host );

		$this->assertSame( array( get_permalink( $shown ) ), $this->links( $html ) );
		$this->assertStringNotContainsString( 'Untitled resource', $html );
		$this->assertStringNotContainsString( 'Untyped', $html );

		// The cached list still names the shown one; unpublishing it through a path that does not bump the
		// salt (a direct status write) leaves the entry, and the block leaves the row out.
		wp_cache_set_salted(
			RelatedCache::key( $host, RelatedItems::DEFAULT_COUNT ),
			array(
				array(
					'id'     => $shown,
					'source' => RelatedItems::SOURCE_TOPIC,
				),
				array(
					'id'     => $blank,
					'source' => RelatedItems::SOURCE_TOPIC,
				),
			),
			RelatedCache::GROUP,
			RelatedCache::salt(),
			RelatedCache::EXPIRY
		);
		global $wpdb;
		$wpdb->update( $wpdb->posts, array( 'post_status' => 'draft' ), array( 'ID' => $shown ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Bypasses the hooks on purpose, so the cached list stays.
		clean_post_cache( $shown );

		$this->assertSame( '', $this->render( $host ), 'No row left, so no section.' );
	}

	/**
	 * Anything but a published resource with exactly one type, or one nothing is related to, renders nothing.
	 */
	public function test_renders_nothing_without_a_published_resource_or_relations(): void {
		$this->resource( 'Someone else', array( $this->topic ) );

		$this->assertSame( '', $this->render( null ), 'No context.' );
		$this->assertSame( '', $this->render( self::factory()->post->create() ), 'A post.' );
		$this->assertSame( '', $this->render( $this->resource( 'Alone' ) ), 'No picks and no topics.' );
		$this->assertSame( '', $this->render( $this->resource( 'A draft', array( $this->topic ), array(), array( 'post_status' => 'draft' ) ) ), 'A draft.' );
		$this->assertSame( '', $this->render( $this->resource( 'Wrong context', array( $this->topic ) ), 'post' ), 'A postType context that is not resource.' );

		$untyped = $this->resource( 'No type', array( $this->topic ) );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$this->assertSame( '', $this->render( $untyped ), 'A host without exactly one type, as the article\'s other blocks.' );
	}

	/**
	 * A host that is not published renders nothing even for an editor who may preview it, and leaves no
	 * entry in the cache the public related route answers from: the selection is computed for published
	 * hosts only.
	 */
	public function test_unpublished_host_renders_nothing_for_an_editor(): void {
		$this->resource( 'A match', array( $this->topic ) );
		$draft = $this->resource( 'A draft', array( $this->topic ), array(), array( 'post_status' => 'draft' ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertTrue( current_user_can( 'read_post', $draft ) );

		$this->assertSame( '', $this->render( $draft ) );
		$this->assertFalse( wp_cache_get_salted( RelatedCache::key( $draft, RelatedItems::DEFAULT_COUNT ), RelatedCache::GROUP, RelatedCache::salt() ), 'No cache entry for the draft.' );
	}

	/**
	 * In a single template, `do_blocks()` gives the block the global post as its context.
	 */
	public function test_renders_the_global_post(): void {
		$this->resource( 'A match', array( $this->topic ) );
		$GLOBALS['post'] = get_post( $this->resource( 'The host', array( $this->topic ) ) ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The loop's global post, which a single template sets.
		$html            = do_blocks( '<!-- wp:resource-hub/related /-->' );
		unset( $GLOBALS['post'] );

		$this->assertStringStartsWith( '<section class="rh-related"', $html );
	}

	/**
	 * The editor's preview endpoint renders the section of the `post_id` the editor sends.
	 */
	public function test_editor_preview_renders_the_post_it_is_sent(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->resource( 'A match', array( $this->topic ) );

		$request = new WP_REST_Request( 'GET', '/wp/v2/block-renderer/' . RelatedBlock::NAME );
		$request->set_query_params(
			array(
				'context' => 'edit',
				'post_id' => $this->resource( 'The host', array( $this->topic ) ),
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertStringStartsWith( '<section class="rh-related"', $response->get_data()['rendered'] );
	}

	/**
	 * A published resource of the type, with topics and picks, one second newer than the last.
	 *
	 * @param string               $title  Its title.
	 * @param int[]                $topics Topic term IDs.
	 * @param int[]                $picks  Post IDs to store as `related_picks`.
	 * @param array<string, mixed> $args   More `wp_insert_post()` arguments.
	 */
	private function resource( string $title, array $topics = array(), array $picks = array(), array $args = array() ): int {
		$this->clock += 1;
		$date         = gmdate( 'Y-m-d H:i:s', $this->clock );
		$id           = self::factory()->post->create(
			array_merge(
				array(
					'post_type'     => PostType::NAME,
					'post_status'   => 'publish',
					'post_title'    => $title,
					'post_date'     => $date,
					'post_date_gmt' => $date,
				),
				$args
			)
		);
		wp_set_object_terms( $id, array( $this->type ), Taxonomies::TYPE );
		wp_set_object_terms( $id, $topics, Taxonomies::TOPIC );

		if ( array() !== $picks ) {
			update_post_meta( $id, Meta::RELATED_PICKS, $picks );
		}

		return $id;
	}

	/**
	 * The block rendered through `WP_Block` with the post as its context.
	 *
	 * @param int|null    $post      The context's post, or none.
	 * @param string|null $post_type The context's post type; the post's own when null.
	 */
	private function render( ?int $post, ?string $post_type = null ): string {
		$parsed = array(
			'blockName'    => RelatedBlock::NAME,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);

		return ( new WP_Block(
			$parsed,
			null === $post ? array() : array(
				'postId'   => $post,
				'postType' => $post_type ?? get_post_type( $post ),
			)
		) )->render();
	}

	/**
	 * The rows' links, in order.
	 *
	 * @param string $html The render.
	 * @return string[]
	 */
	private function links( string $html ): array {
		preg_match_all( '/<a class="rh-card__link" href="([^"]+)"/', $html, $matches );

		return $matches[1];
	}
}
