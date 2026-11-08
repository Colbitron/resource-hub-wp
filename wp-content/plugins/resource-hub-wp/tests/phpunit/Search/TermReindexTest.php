<?php
/**
 * A renamed or deleted topic or type is re-indexed; the reasons are in `src/Search/TermReindex.php`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Search\TermReindex;
use WP_Query;
use WP_UnitTestCase;

/**
 * Drives the plugin's own registered instance, which queues during the request and schedules cron
 * at `shutdown` (here called as {@see TermReindex::flush()}), then runs the scheduled event by hand
 * as WP-Cron would.
 */
final class TermReindexTest extends WP_UnitTestCase {
	use BuildsSearchIndex;

	/**
	 * A topic named "Quillwort studies".
	 *
	 * @var int
	 */
	private int $topic;

	/**
	 * A type named "Fernbrake".
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * Makes builds safe, empties anything other tests queued, and creates the two terms.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_transaction_safe_builds();

		$this->reindexer()->flush();
		wp_unschedule_hook( TermReindex::CRON_HOOK );

		$this->topic = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Quillwort studies',
			)
		);
		$this->type  = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Fernbrake',
			)
		);
	}

	/**
	 * Renaming a topic re-indexes its resources from cron: the new name finds them once the event
	 * has run, and the old name no longer does. A resource without the topic is not queued.
	 */
	public function test_renaming_a_topic_reindexes_its_resources(): void {
		$with    = $this->resource();
		$without = $this->resource( false );
		$this->build_index();
		$this->assertSame( array( $with ), $this->search( 'quillwort' ) );

		wp_update_term( $this->topic, Taxonomies::TOPIC, array( 'name' => 'Bramblewood studies' ) );

		$this->assertSame( array( $with ), $this->reindexer()->queued() );
		$this->assertSame( array(), $this->search( 'bramblewood' ), 'Re-indexed inside the request.' );
		$this->assertNotContains( $without, $this->reindexer()->queued() );

		$this->run_scheduled( array( array( $with ) ) );

		$this->assertSame( array( $with ), $this->search( 'bramblewood' ) );
		$this->assertSame( array(), $this->search( 'quillwort' ) );
	}

	/**
	 * Renaming a type re-indexes its resources too.
	 */
	public function test_renaming_a_type_reindexes_its_resources(): void {
		$id = $this->resource();
		$this->build_index();

		wp_update_term( $this->type, Taxonomies::TYPE, array( 'name' => 'Hollyoak' ) );
		$this->run_scheduled( array( array( $id ) ) );

		$this->assertSame( array( $id ), $this->search( 'hollyoak' ) );
		$this->assertSame( array(), $this->search( 'fernbrake' ) );
	}

	/**
	 * Deleting a topic re-indexes the resources that had it, so its name no longer finds them.
	 */
	public function test_deleting_a_topic_reindexes_its_resources(): void {
		$id = $this->resource();
		$this->build_index();

		wp_delete_term( $this->topic, Taxonomies::TOPIC );
		$this->run_scheduled( array( array( $id ) ) );

		$this->assertSame( array(), $this->search( 'quillwort' ) );
		$this->assertGreaterThan( 0, $this->index_rows( $id ) );
	}

	/**
	 * A slug or description change, or a change to a taxonomy that is not indexed, queues nothing.
	 */
	public function test_other_term_changes_queue_nothing(): void {
		$this->resource();
		$flag = self::factory()->term->create( array( 'taxonomy' => Taxonomies::FLAG ) );

		wp_update_term(
			$this->topic,
			Taxonomies::TOPIC,
			array(
				'slug'        => 'quillwort-renamed',
				'description' => 'Changed.',
			)
		);
		wp_update_term( $flag, Taxonomies::FLAG, array( 'name' => 'Renamed flag' ) );

		$this->assertSame( array(), $this->reindexer()->queued() );
		$this->reindexer()->flush();
		$this->assertFalse( wp_next_scheduled( TermReindex::CRON_HOOK ) );
	}

	/**
	 * A term with more resources than one batch holds is split into events of at most
	 * {@see TermReindex::BATCH_SIZE}.
	 */
	public function test_large_terms_are_split_into_bounded_events(): void {
		$ids = array();
		for ( $i = 0; $i <= TermReindex::BATCH_SIZE; $i++ ) {
			$ids[] = $this->resource();
		}

		wp_update_term( $this->topic, Taxonomies::TOPIC, array( 'name' => 'Bramblewood studies' ) );
		$this->reindexer()->flush();

		$batches = $this->scheduled_batches();
		$this->assertCount( 2, $batches );
		$this->assertCount( TermReindex::BATCH_SIZE, $batches[0] );
		$this->assertCount( 1, $batches[1] );

		$seen = array_merge( ...$batches );
		sort( $seen );
		sort( $ids );
		$this->assertSame( $ids, $seen );
	}

	/**
	 * Under WP-CLI, which has no later request to run cron, the posts are re-indexed at `shutdown`
	 * itself and nothing is scheduled.
	 */
	public function test_synchronous_reindexing_schedules_nothing(): void {
		$id = $this->resource();
		$this->build_index();

		$reindexer = new TermReindex( true );
		$reindexer->snapshot( $this->topic, Taxonomies::TOPIC );
		wp_update_term( $this->topic, Taxonomies::TOPIC, array( 'name' => 'Bramblewood studies' ) );
		$reindexer->on_edited( $this->topic );
		$this->reindexer()->flush();
		wp_unschedule_hook( TermReindex::CRON_HOOK );

		$reindexer->flush();

		$this->assertFalse( wp_next_scheduled( TermReindex::CRON_HOOK ) );
		$this->assertSame( array( $id ), $this->search( 'bramblewood' ) );
	}

	/**
	 * The plugin's registered instance.
	 */
	private function reindexer(): TermReindex {
		$instance = TermReindex::instance();
		$this->assertInstanceOf( TermReindex::class, $instance );

		return $instance;
	}

	/**
	 * Flushes the queue, checks the events scheduled are exactly these batches, and runs them as
	 * WP-Cron would.
	 *
	 * @param array<int, int[]> $expected The batches, in order.
	 */
	private function run_scheduled( array $expected ): void {
		$this->reindexer()->flush();
		$batches = $this->scheduled_batches();

		$this->assertSame( $expected, $batches );

		foreach ( $batches as $batch ) {
			do_action( TermReindex::CRON_HOOK, $batch ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.DynamicHooknameFound -- The plugin's own prefixed hook.
		}
	}

	/**
	 * The ID lists of the scheduled re-index events.
	 *
	 * @return array<int, int[]>
	 */
	private function scheduled_batches(): array {
		$batches = array();

		foreach ( _get_cron_array() as $hooks ) {
			foreach ( $hooks[ TermReindex::CRON_HOOK ] ?? array() as $event ) {
				$batches[] = $event['args'][0];
			}
		}

		return $batches;
	}

	/**
	 * Creates a published resource with the type and, unless told not to, the topic.
	 *
	 * @param bool $with_topic Whether to give it the topic.
	 * @return int The post ID.
	 */
	private function resource( bool $with_topic = true ): int {
		$id = self::factory()->post->create(
			array(
				'post_type'    => PostType::NAME,
				'post_status'  => 'publish',
				'post_title'   => 'Lantern almanac',
				'post_content' => 'Body text.',
			)
		);
		wp_set_object_terms( $id, $this->type, Taxonomies::TYPE );
		if ( $with_topic ) {
			wp_set_object_terms( $id, $this->topic, Taxonomies::TOPIC );
		}
		update_post_meta( $id, Meta::SUMMARY, 'A field guide.' );

		return $id;
	}

	/**
	 * The IDs Relevanssi finds for a word.
	 *
	 * @param string $term The search word.
	 * @return int[]
	 */
	private function search( string $term ): array {
		$query = new WP_Query(
			array(
				's'           => $term,
				'post_type'   => array( PostType::NAME, 'page' ),
				'post_status' => 'publish',
				'fields'      => 'ids',
				'relevanssi'  => true,
			)
		);

		return $query->posts;
	}
}
