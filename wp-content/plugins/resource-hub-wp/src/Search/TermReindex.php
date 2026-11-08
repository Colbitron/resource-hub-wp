<?php
/**
 * Re-indexes the resources of a renamed or deleted topic or type.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

/**
 * Keeps term names in the search index current when a term changes rather than a post.
 *
 * Relevanssi re-indexes a post when the post is saved, and indexes its topic and type names with
 * it ({@see RelevanssiConfig}), but nothing re-indexes posts when one of those terms is renamed or
 * deleted: 4.28.8 hooks no term action. A renamed topic would stay searchable under its old name,
 * and a deleted one under its name, until the next full rebuild, which the deploy now runs only
 * when the settings change ({@see SearchIndex}).
 *
 * - **What.** For `resource_topic` and `resource_type` ({@see RelevanssiConfig::TAXONOMIES}): a
 *   rename, seen by comparing the name taken at `edit_terms`, before core writes it, with the name
 *   at `edited_{taxonomy}`, as {@see \ResourceHub\Revalidation\TermEvents} does; and a deletion, whose
 *   posts are read at `pre_delete_term`, before core removes the relationships. A slug or
 *   description change re-indexes nothing, since only names are indexed.
 * - **When.** Out of the request, as the revalidation hook sends: the post IDs collected during the
 *   request are scheduled at `shutdown` as single WP-Cron events of at most {@see BATCH_SIZE} IDs
 *   each, so saving a term with many resources costs the editor one cron schedule, and each cron run
 *   is bounded. Under WP-CLI there is no later request to run cron, so they are re-indexed at
 *   `shutdown` straight away; so are they if core refuses to schedule the event.
 * - **How.** Each post goes through `relevanssi_insert_edit()`, Relevanssi's own save-time update,
 *   so it is indexed if it is published and removed from the index if not, under the same rules as
 *   a save.
 * - **Absent Relevanssi.** Nothing is queued or run; the next full rebuild after Relevanssi is
 *   activated covers it ({@see SearchIndex}).
 */
final class TermReindex {
	/**
	 * The cron hook. Its one argument is a list of post IDs.
	 */
	public const CRON_HOOK = 'resource_hub_reindex_posts';

	/**
	 * Most post IDs in one cron event.
	 */
	public const BATCH_SIZE = 50;

	/**
	 * The registered instance.
	 *
	 * @var TermReindex|null
	 */
	private static ?TermReindex $instance = null;

	/**
	 * Term names by term ID, taken at `edit_terms`.
	 *
	 * @var array<int, string>
	 */
	private array $names = array();

	/**
	 * Post IDs to re-index, as keys.
	 *
	 * @var array<int, true>
	 */
	private array $queue = array();

	/**
	 * Constructor.
	 *
	 * @param bool|null $synchronous Re-index at `shutdown` instead of scheduling cron; null means "when running under WP-CLI".
	 */
	public function __construct( private ?bool $synchronous = null ) {
		$this->synchronous ??= defined( 'WP_CLI' ) && WP_CLI;
	}

	/**
	 * Hooks the term actions, `shutdown` and the cron callback.
	 */
	public function register(): void {
		add_action( 'edit_terms', array( $this, 'snapshot' ), 10, 2 );
		add_action( 'pre_delete_term', array( $this, 'on_delete' ), 10, 2 );

		foreach ( RelevanssiConfig::TAXONOMIES as $taxonomy ) {
			add_action( "edited_{$taxonomy}", array( $this, 'on_edited' ), 10, 1 );
		}

		add_action( 'shutdown', array( $this, 'flush' ) );
		add_action( self::CRON_HOOK, array( $this, 'run' ) );

		self::$instance = $this;
	}

	/**
	 * The registered instance, or null before {@see TermReindex::register()} has run.
	 */
	public static function instance(): ?TermReindex {
		return self::$instance;
	}

	/**
	 * `edit_terms`: remembers a topic's or type's name before core changes it.
	 *
	 * @param int    $term_id  The term.
	 * @param string $taxonomy Its taxonomy.
	 */
	public function snapshot( int $term_id, string $taxonomy ): void {
		if ( ! in_array( $taxonomy, RelevanssiConfig::TAXONOMIES, true ) ) {
			return;
		}

		$term = get_term( $term_id, $taxonomy );

		if ( $term instanceof \WP_Term ) {
			$this->names[ $term_id ] = $term->name;
		}
	}

	/**
	 * `edited_{taxonomy}`: queues the term's posts when its name changed.
	 *
	 * @param int $term_id The term.
	 */
	public function on_edited( int $term_id ): void {
		$before = $this->names[ $term_id ] ?? null;
		unset( $this->names[ $term_id ] );

		$term = get_term( $term_id );

		if ( ! $term instanceof \WP_Term || $before === $term->name ) {
			return;
		}

		$this->queue_term_posts( $term_id, $term->taxonomy );
	}

	/**
	 * `pre_delete_term`: queues a topic's or type's posts while they still have it.
	 *
	 * @param mixed $term_id  The term.
	 * @param mixed $taxonomy Its taxonomy.
	 */
	public function on_delete( $term_id, $taxonomy ): void {
		if ( in_array( $taxonomy, RelevanssiConfig::TAXONOMIES, true ) ) {
			$this->queue_term_posts( (int) $term_id, (string) $taxonomy );
		}
	}

	/**
	 * The post IDs queued so far in this request.
	 *
	 * @return int[]
	 */
	public function queued(): array {
		return array_keys( $this->queue );
	}

	/**
	 * `shutdown`: schedules, or under WP-CLI runs, the re-indexing of every queued post, and empties
	 * the queue.
	 */
	public function flush(): void {
		$ids         = $this->queued();
		$this->queue = array();

		if ( array() === $ids || ! ( new SearchIndex() )->available() ) {
			return;
		}

		$scheduled = false;

		foreach ( array_chunk( $ids, self::BATCH_SIZE ) as $batch ) {
			if ( ! $this->synchronous && true === wp_schedule_single_event( time(), self::CRON_HOOK, array( $batch ), true ) ) {
				$scheduled = true;
				continue;
			}

			$this->run( $batch );
		}

		if ( $scheduled ) {
			spawn_cron();
		}
	}

	/**
	 * The cron callback: re-indexes each post as a save would.
	 *
	 * @param mixed $ids Post IDs.
	 */
	public function run( $ids ): void {
		if ( ! is_array( $ids ) || ! function_exists( 'relevanssi_insert_edit' ) ) {
			return;
		}

		foreach ( array_slice( $ids, 0, self::BATCH_SIZE ) as $id ) {
			if ( is_numeric( $id ) && (int) $id > 0 ) {
				relevanssi_insert_edit( (int) $id );
			}
		}
	}

	/**
	 * Adds every post that has a term to the queue.
	 *
	 * @param int    $term_id  The term.
	 * @param string $taxonomy Its taxonomy.
	 */
	private function queue_term_posts( int $term_id, string $taxonomy ): void {
		if ( ! ( new SearchIndex() )->available() ) {
			return;
		}

		$ids = get_objects_in_term( $term_id, $taxonomy );

		if ( ! is_array( $ids ) ) {
			return;
		}

		foreach ( $ids as $id ) {
			$this->queue[ (int) $id ] = true;
		}
	}
}
