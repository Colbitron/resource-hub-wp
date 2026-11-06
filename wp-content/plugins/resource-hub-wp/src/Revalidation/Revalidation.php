<?php
/**
 * Wires the revalidation hook together.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\ContentModel\PostType;
use WP_Post;

/**
 * Builds the revalidation components once per request and registers their hooks.
 *
 * The flow: {@see ResourceEvents}, {@see TermEvents} and {@see PageEvents} put events on the {@see Queue};
 * at `shutdown` the {@see Dispatcher} batches them and schedules a cron send; the cron callback
 * runs the {@see Sender}, the {@see ResultStore} and {@see PostHog}.
 */
final class Revalidation {
	/**
	 * The instance {@see Plugin} registered, so tests and the status page can reach the same queue.
	 *
	 * @var Revalidation|null
	 */
	private static ?Revalidation $instance = null;

	/**
	 * The per-request queue.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Post hooks to events.
	 *
	 * @var ResourceEvents
	 */
	private ResourceEvents $resource_events;

	/**
	 * Term hooks to events.
	 *
	 * @var TermEvents
	 */
	private TermEvents $term_events;

	/**
	 * Page and Settings > Reading hooks to events.
	 *
	 * @var PageEvents
	 */
	private PageEvents $page_events;

	/**
	 * Result storage and its REST field.
	 *
	 * @var ResultStore
	 */
	private ResultStore $store;

	/**
	 * Batching, cron and delivery.
	 *
	 * @var Dispatcher
	 */
	private Dispatcher $dispatcher;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->queue           = new Queue();
		$this->resource_events = new ResourceEvents( $this->queue );
		$this->term_events     = new TermEvents( $this->queue );
		$this->page_events     = new PageEvents( $this->queue );
		$this->store           = new ResultStore();
		$this->dispatcher      = new Dispatcher( $this->queue, new Sender(), $this->store, new PostHog() );
	}

	/**
	 * Registers every hook. Called once from {@see Plugin::boot()}.
	 */
	public function register(): void {
		$this->resource_events->register();
		$this->term_events->register();
		$this->page_events->register();
		$this->dispatcher->register();
		add_action( 'rest_api_init', array( $this->store, 'register_rest_fields' ) );

		self::$instance = $this;
	}

	/**
	 * The registered instance, or null before {@see Revalidation::register()} has run.
	 */
	public static function instance(): ?Revalidation {
		return self::$instance;
	}

	/**
	 * The per-request queue.
	 */
	public function queue(): Queue {
		return $this->queue;
	}

	/**
	 * Batching, cron and delivery.
	 */
	public function dispatcher(): Dispatcher {
		return $this->dispatcher;
	}

	/**
	 * Result storage.
	 */
	public function store(): ResultStore {
		return $this->store;
	}

	/**
	 * Sends a real `update` event for one published resource now and returns the result, recorded
	 * like any other: the entry point for the status page's "Send test revalidation".
	 * Null when the post is not a published resource, because there is nothing real to send. A
	 * resource without exactly one type gets the same held-back failure a save would.
	 *
	 * @param int $post_id The resource.
	 */
	public function send_update_for( int $post_id ): ?Result {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post || PostType::NAME !== $post->post_type ) {
			return null;
		}

		$event = ResourceEvents::update_event_for( $post );

		if ( null === $event ) {
			return null;
		}

		return $this->dispatcher->send_one( $event );
	}
}
