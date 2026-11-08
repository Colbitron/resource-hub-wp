<?php
/**
 * Relevanssi as the plugin configures it, searched the way the search route will search it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Search\RelevanssiConfig;
use ResourceHub\Search\SearchIndex;
use WP_Query;
use WP_REST_Request;
use WP_UnitTestCase;

/**
 * Each test builds the index through {@see SearchIndex}, as `wp resource-hub search-index --force`
 * does, then searches with `'relevanssi' => true`, the query var that turns Relevanssi on for a
 * query that is not the main one (Relevanssi 4.28.8, `lib/search.php:57`). {@see BuildsSearchIndex}
 * keeps those builds inside the test's transaction.
 *
 * "Core's search" below is a `WP_Query` with `s` and no `relevanssi` var, which Relevanssi does not
 * answer; it reads the title, excerpt and content alone, so it shows a match came from the index.
 */
final class RelevanssiSearchTest extends WP_UnitTestCase {
	use BuildsSearchIndex;

	/**
	 * A type term every resource gets.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * How many Relevanssi searches have run, counted on `relevanssi_hits_filter`.
	 *
	 * @var int
	 */
	private int $relevanssi_searches = 0;

	/**
	 * Makes index builds safe inside the test's transaction, counts Relevanssi's searches and
	 * creates a type.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_transaction_safe_builds();

		add_filter(
			'relevanssi_hits_filter',
			function ( array $data ): array {
				++$this->relevanssi_searches;
				return $data;
			}
		);

		$this->type = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
	}

	/**
	 * A word that appears only in a resource's summary finds it, and core's search, which reads
	 * the title, excerpt and content alone, does not: the summary meta is in the index.
	 */
	public function test_finds_a_resource_by_a_word_only_in_its_summary(): void {
		$id    = $this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.' );
		$other = $this->resource( 'Another resource', 'Nothing to see here.' );
		$this->build_index();

		$this->assertSame( array( $id ), $this->search( 'zephyrine' )->posts );
		$this->assertSame( array(), $this->core_search( 'zephyrine' )->posts );
		$this->assertNotContains( $other, $this->search( 'zephyrine' )->posts );
	}

	/**
	 * A word that appears only in a topic's name finds the resource that has the topic, and core's
	 * search does not: topic names are in the index.
	 */
	public function test_finds_a_resource_by_a_word_only_in_its_topic_name(): void {
		$topic = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Quillwort studies',
			)
		);
		$id    = $this->resource( 'Lantern almanac', 'A field guide.' );
		wp_set_object_terms( $id, $topic, Taxonomies::TOPIC );
		$this->resource( 'Another resource', 'A field guide.' );
		$this->build_index();

		$this->assertSame( array( $id ), $this->search( 'quillwort' )->posts );
		$this->assertSame( array(), $this->core_search( 'quillwort' )->posts );
	}

	/**
	 * A word that appears only in a type's name finds the resource of that type.
	 */
	public function test_finds_a_resource_by_a_word_only_in_its_type_name(): void {
		$type = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Fernbrake',
			)
		);
		$id   = $this->resource( 'Lantern almanac', 'A field guide.', $type );
		$this->resource( 'Another resource', 'A field guide.' );
		$this->build_index();

		$this->assertSame( array( $id ), $this->search( 'fernbrake' )->posts );
	}

	/**
	 * `found_posts` and `max_num_pages` count every match, not one page of them, and the pages
	 * split the matches with no repeat and no gap, for the IDs-only query the search route will
	 * run and for a query for full posts: with the posts cached, with the object cache emptied
	 * (an uncached request), and with one stray one-row query run after Relevanssi has answered,
	 * as a cache miss or another plugin's hook would. Relevanssi alone gets the IDs-only count
	 * wrong; {@see RelevanssiFoundPosts} fixes it, and the next test shows the failure without it.
	 *
	 * @dataProvider pagination_provider
	 *
	 * @param string $fields The `fields` query var.
	 * @param string $state  `warm`, `cold` or `stray`.
	 */
	public function test_pagination_counts_every_match( string $fields, string $state ): void {
		$ids = $this->marigold_resources();

		if ( 'stray' === $state ) {
			$this->run_a_stray_query_last();
		}

		$seen = array();
		foreach ( array(
			1 => 2,
			2 => 2,
			3 => 1,
		) as $page => $count ) {
			if ( 'cold' === $state ) {
				wp_cache_flush();
			}

			$query = $this->search( 'marigold', $page, 2, $fields );

			$this->assertSame( 5, $query->found_posts, "found_posts on page {$page}" );
			$this->assertSame( 3, (int) $query->max_num_pages, "max_num_pages on page {$page}" );
			$this->assertCount( $count, $query->posts, "posts on page {$page}" );

			foreach ( $query->posts as $post ) {
				$seen[] = 'ids' === $fields ? $post : $post->ID;
			}
		}

		sort( $ids );
		sort( $seen );
		$this->assertSame( $ids, $seen );
	}

	/**
	 * The query shapes and cache states the pagination test runs with.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function pagination_provider(): array {
		return array(
			'ids, warm cache'         => array( 'ids', 'warm' ),
			'ids, cold cache'         => array( 'ids', 'cold' ),
			'ids, stray query'        => array( 'ids', 'stray' ),
			'full posts, warm cache'  => array( '', 'warm' ),
			'full posts, cold cache'  => array( '', 'cold' ),
			'full posts, stray query' => array( '', 'stray' ),
		);
	}

	/**
	 * Without the plugin's `found_posts` filter, an IDs-only search reports the row count of
	 * whatever `SELECT` ran last, here the one-row stray query, instead of its five matches, so
	 * the test above can fail.
	 */
	public function test_relevanssi_alone_miscounts_an_ids_only_search(): void {
		$this->marigold_resources();
		$this->run_a_stray_query_last();
		remove_all_filters( 'found_posts' );

		$query = $this->search( 'marigold', 1, 2 );

		$this->assertSame( 1, $query->found_posts );
		$this->assertSame( 1, (int) $query->max_num_pages );
	}

	/**
	 * A search writes no row to Relevanssi's log, even with logging switched on in the database.
	 * Without the plugin's filter the same search does write one, so the check can fail.
	 *
	 * Relevanssi's activation stores no row for a pinned option, since `add_option()` sees the
	 * filtered value and stops, so the pin is lifted while `on` is stored.
	 */
	public function test_a_search_writes_no_log_row(): void {
		global $wpdb;
		$log = $wpdb->prefix . 'relevanssi_log';

		$this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.' );
		$this->build_index();

		remove_all_filters( 'pre_option_relevanssi_log_queries' );
		update_option( 'relevanssi_log_queries', 'on' );
		$this->assertSame( 'on', get_option( 'relevanssi_log_queries' ) );
		add_filter( 'pre_option_relevanssi_log_queries', array( new RelevanssiConfig(), 'pinned' ), 10, 2 );

		$before = $this->log_rows( $log );
		$this->assertCount( 1, $this->search( 'zephyrine' )->posts );
		$this->assertSame( $before, $this->log_rows( $log ), 'A search wrote to the log.' );

		remove_all_filters( 'pre_option_relevanssi_log_queries' );
		$this->search( 'zephyrine' );
		$this->assertSame( $before + 1, $this->log_rows( $log ), 'Without the filter, logging was expected to write a row.' );
	}

	/**
	 * Core's REST search for resources keeps core's search: Relevanssi runs no search for it, so a
	 * word only in the summary finds nothing there, while a word in the title still does.
	 */
	public function test_core_rest_search_does_not_use_relevanssi(): void {
		$id = $this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.' );
		$this->build_index();

		// A new server fires `rest_api_init`, as every real REST request does, so Relevanssi's own
		// REST callback runs too.
		$GLOBALS['wp_rest_server'] = null; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound

		$this->assertSame( array(), $this->rest_search( 'zephyrine' ) );
		$this->assertSame( array( $id ), $this->rest_search( 'lantern' ) );
		$this->assertSame( 0, $this->relevanssi_searches, 'Relevanssi ran a search for a REST request.' );

		$this->search( 'zephyrine' );
		$this->assertSame( 1, $this->relevanssi_searches );
	}

	/**
	 * The main query of a search page, which the CMS theme's search template will render for
	 * logged-in users, goes through Relevanssi with no code of the plugin's: a word only in the
	 * summary finds the resource.
	 */
	public function test_the_main_search_query_uses_relevanssi(): void {
		$id = $this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.' );
		$this->build_index();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->go_to( home_url( '/?s=zephyrine' ) );

		$this->assertTrue( is_search() );
		$this->assertSame( array( $id ), wp_list_pluck( $GLOBALS['wp_query']->posts, 'ID' ) );
		$this->assertSame( 1, $this->relevanssi_searches );
	}

	/**
	 * A search query Relevanssi does not answer, outside REST, still gets core's results: a title
	 * word finds the resource. Relevanssi alone would blank that query's SQL, which the second
	 * half shows.
	 */
	public function test_a_search_relevanssi_does_not_answer_keeps_core_search(): void {
		$id = $this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.' );
		$this->build_index();

		$this->assertSame( array( $id ), $this->core_search( 'lantern' )->posts );
		$this->assertSame( 0, $this->relevanssi_searches );

		remove_all_filters( 'relevanssi_prevent_default_request' );
		$this->assertSame( array(), $this->core_search( 'lantern' )->posts );
	}

	/**
	 * A draft, pending, private or scheduled resource never reaches `wp_relevanssi`, neither when it
	 * is saved nor in a full build, so no query against the index can return it.
	 *
	 * @dataProvider unpublished_provider
	 *
	 * @param string $status The post status.
	 */
	public function test_an_unpublished_resource_never_reaches_the_index( string $status ): void {
		$args = array( 'post_status' => $status );
		if ( 'future' === $status ) {
			$args['post_date'] = gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS );
		}
		$hidden    = $this->resource( 'Zephyrine almanac', 'A field guide to zephyrine glass.', null, $args );
		$published = $this->resource( 'Lantern almanac', 'A field guide.' );
		relevanssi_insert_edit( $hidden );

		$this->assertSame( $status, get_post_status( $hidden ) );
		$this->assertSame( 0, $this->index_rows( $hidden ), 'Indexed on save.' );

		$this->build_index();

		$this->assertSame( 0, $this->index_rows( $hidden ), 'Indexed by the full build.' );
		$this->assertGreaterThan( 0, $this->index_rows( $published ) );
	}

	/**
	 * The statuses Relevanssi would index by default that the plugin keeps out.
	 *
	 * @return array<string, array{string}>
	 */
	public static function unpublished_provider(): array {
		return array(
			'draft'     => array( 'draft' ),
			'pending'   => array( 'pending' ),
			'private'   => array( 'private' ),
			'scheduled' => array( 'future' ),
		);
	}

	/**
	 * Publishing adds a resource to the index and unpublishing, trashing and deleting take it out,
	 * each through Relevanssi's save-time update with no rebuild.
	 */
	public function test_status_changes_add_and_remove_a_resource(): void {
		$id = $this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.', null, array( 'post_status' => 'draft' ) );
		$this->build_index();
		$this->assertSame( 0, $this->index_rows( $id ) );

		wp_publish_post( $id );
		$this->assertGreaterThan( 0, $this->index_rows( $id ), 'Publishing did not index it.' );
		$this->assertSame( array( $id ), $this->search( 'zephyrine' )->posts, 'The summary was not indexed on publish.' );

		wp_update_post(
			array(
				'ID'          => $id,
				'post_status' => 'draft',
			)
		);
		$this->assertSame( 0, $this->index_rows( $id ), 'Unpublishing did not remove it.' );

		wp_publish_post( $id );
		$this->assertGreaterThan( 0, $this->index_rows( $id ) );

		wp_trash_post( $id );
		$this->assertSame( 0, $this->index_rows( $id ), 'Trashing did not remove it.' );

		wp_untrash_post( $id );
		$this->assertSame( 'draft', get_post_status( $id ) );
		$this->assertSame( 0, $this->index_rows( $id ), 'Restoring from the trash, as a draft, indexed it.' );

		wp_publish_post( $id );
		$this->assertGreaterThan( 0, $this->index_rows( $id ) );

		wp_delete_post( $id, true );
		$this->assertSame( 0, $this->index_rows( $id ), 'Deleting did not remove it.' );
	}

	/**
	 * Core cleaning a post's cache drops it from Relevanssi's in-request copy under both its keys, and
	 * leaves other posts there. Without that, the publish step of the test above finds nothing: the
	 * copy Relevanssi read while the post was a draft would still say draft.
	 */
	public function test_cleaning_a_post_cache_drops_relevanssis_copy(): void {
		global $relevanssi_post_array;
		$id    = $this->resource( 'Lantern almanac', 'A field guide.' );
		$other = $this->resource( 'Another resource', 'A field guide.' );
		$blog  = get_current_blog_id();

		$relevanssi_post_array[ $id ]                = get_post( $id ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
		$relevanssi_post_array[ "{$blog}|{$id}" ]    = get_post( $id ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
		$relevanssi_post_array[ "{$blog}|{$other}" ] = get_post( $other ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.

		clean_post_cache( $id );

		$this->assertArrayNotHasKey( $id, $relevanssi_post_array );
		$this->assertArrayNotHasKey( "{$blog}|{$id}", $relevanssi_post_array );
		$this->assertArrayHasKey( "{$blog}|{$other}", $relevanssi_post_array );
	}

	/**
	 * A page that holds only the related-resources block does not take the listed resources' words
	 * as its own, and the block is never rendered while the index is built. Without the plugin's
	 * filter the same page does take them, so the test can fail.
	 */
	public function test_the_related_block_is_not_indexed_into_its_page(): void {
		$topic    = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$resource = $this->resource( 'Lantern almanac', 'A field guide to zephyrine glass.' );
		wp_set_object_terms( $resource, $topic, Taxonomies::TOPIC );
		$page = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_title'   => 'Reading list',
				'post_content' => sprintf( '<!-- wp:resource-hub/related-resources {"topic":%d,"count":3} /-->', $topic ),
			)
		);
		$this->assertTrue( \WP_Block_Type_Registry::get_instance()->is_registered( 'resource-hub/related-resources' ), 'The block is not registered: run pnpm build.' );
		$this->assertStringContainsString( 'Lantern almanac', do_blocks( get_post( $page )->post_content ), 'The block rendered nothing, so the test proves nothing.' );

		$renders = 0;
		$count   = static function ( $content, array $block ) use ( &$renders ) {
			if ( 'resource-hub/related-resources' === $block['blockName'] ) {
				++$renders;
			}
			return $content;
		};
		add_filter( 'render_block', $count, 10, 2 );
		$this->build_index();
		remove_filter( 'render_block', $count, 10 );

		$this->assertSame( 0, $renders, 'The block was rendered for the index.' );
		$this->assertSame( array( $resource ), $this->search( 'zephyrine' )->posts );
		$this->assertSame( array( $resource ), $this->search( 'lantern' )->posts );

		remove_all_filters( 'relevanssi_block_to_render' );
		relevanssi_index_doc( $page, true, relevanssi_get_custom_fields(), true );
		$this->assertContains( $page, $this->search( 'zephyrine' )->posts, 'Without the filter the page was expected to take the listed summary.' );
	}

	/**
	 * A post type outside the configured two is not indexed, so it is never found.
	 */
	public function test_only_resources_and_pages_are_indexed(): void {
		$page = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_title'   => 'Zephyrine page',
				'post_content' => 'About.',
			)
		);
		self::factory()->post->create(
			array(
				'post_type'    => 'post',
				'post_title'   => 'Zephyrine post',
				'post_content' => 'About.',
			)
		);
		$this->build_index();

		$query = new WP_Query(
			array(
				's'          => 'zephyrine',
				'post_type'  => 'any',
				'relevanssi' => true,
				'fields'     => 'ids',
			)
		);

		$this->assertSame( array( $page ), $query->posts );
	}

	/**
	 * Five resources whose summaries share a word, one that does not, and the index built.
	 *
	 * @return int[] The five IDs.
	 */
	private function marigold_resources(): array {
		$ids = array();
		for ( $i = 0; $i < 5; $i++ ) {
			$ids[] = $this->resource( 'Resource ' . $i, 'A marigold almanac, part ' . $i . '.' );
		}
		$this->resource( 'Unrelated', 'Nothing to see here.' );
		$this->build_index();

		return $ids;
	}

	/**
	 * Runs a one-row `SELECT` on `posts_pre_query` after Relevanssi has answered there (it hooks at
	 * 99), so it is the last query before core's `SELECT FOUND_ROWS()`.
	 */
	private function run_a_stray_query_last(): void {
		add_filter(
			'posts_pre_query',
			static function ( $posts ) {
				global $wpdb;
				$wpdb->get_var( "SELECT ID FROM {$wpdb->posts} LIMIT 1" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				return $posts;
			},
			100
		);
	}

	/**
	 * Creates a published resource with one type and a summary.
	 *
	 * @param string               $title   The title.
	 * @param string               $summary The summary meta.
	 * @param int|null             $type    A type term ID, or null for the shared one.
	 * @param array<string, mixed> $args    More `wp_insert_post()` arguments, such as the status.
	 * @return int The post ID.
	 */
	private function resource( string $title, string $summary, ?int $type = null, array $args = array() ): int {
		$id = self::factory()->post->create(
			array_merge(
				array(
					'post_type'    => PostType::NAME,
					'post_status'  => 'publish',
					'post_title'   => $title,
					'post_content' => 'Body text.',
				),
				$args
			)
		);
		wp_set_object_terms( $id, $type ?? $this->type, Taxonomies::TYPE );
		update_post_meta( $id, Meta::SUMMARY, $summary );

		return $id;
	}

	/**
	 * Searches resources and pages with Relevanssi forced on.
	 *
	 * @param string $term     The search words.
	 * @param int    $page     The page.
	 * @param int    $per_page Results per page.
	 * @param string $fields   The `fields` query var.
	 */
	private function search( string $term, int $page = 1, int $per_page = 10, string $fields = 'ids' ): WP_Query {
		return new WP_Query(
			array(
				's'              => $term,
				'post_type'      => array( PostType::NAME, 'page' ),
				'post_status'    => 'publish',
				'posts_per_page' => $per_page,
				'paged'          => $page,
				'fields'         => $fields,
				'relevanssi'     => true,
			)
		);
	}

	/**
	 * The same search without Relevanssi.
	 *
	 * @param string $term The search words.
	 */
	private function core_search( string $term ): WP_Query {
		return new WP_Query(
			array(
				's'           => $term,
				'post_type'   => array( PostType::NAME, 'page' ),
				'post_status' => 'publish',
				'fields'      => 'ids',
			)
		);
	}

	/**
	 * Searches through core's REST collection for resources.
	 *
	 * @param string $term The search words.
	 * @return int[] The IDs returned.
	 */
	private function rest_search( string $term ): array {
		$request = new WP_REST_Request( 'GET', '/wp/v2/' . PostType::REST_BASE );
		$request->set_param( 'search', $term );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		return array_map( static fn( array $item ): int => $item['id'], $response->get_data() );
	}

	/**
	 * The number of rows in Relevanssi's log table.
	 *
	 * @param string $table The table name.
	 */
	private function log_rows( string $table ): int {
		global $wpdb;

		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
	}
}
