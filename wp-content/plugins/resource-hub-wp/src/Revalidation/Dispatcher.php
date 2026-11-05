<?php
/**
 * When and how a batch leaves the request.
 *
 * This file is a critical path: it is read line by line before merge.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * At `shutdown`, turns the request's queue into batches of at most 25 and schedules one WP-Cron
 * single event per batch, with the full payload as the event's arguments, then spawns cron
 * (ADRs 0012, 0014). The cron callback sends, records and logs; it never reads the post again.
 *
 * Before batching, each `publish` and `update` event is refreshed from its post, so it carries the
 * state the request left behind ({@see ResourceEvents::refresh()}), and every event has its slugs
 * decoded ({@see Payload::decode_slugs()}), because one slug the front end refuses would fail the
 * whole batch with a 400 (ADR 0024). Then a resource event whose top-level `types` is not exactly
 * one element is held back: the schema requires one, so sending it would fail the whole batch with
 * a 400 too. It is recorded on that resource as a failure with a plain
 * message, and the rest of the batch goes out. An `update` whose current state is valid but whose
 * `previous.types` is not is sent as an `update` with the current type standing in for the earlier
 * ones ({@see ResourceState::with_valid_previous_types()}), so the save that fixes a resource's type
 * goes out and the old slug and topics are still revalidated.
 *
 * Two cases are delivered synchronously at `shutdown` instead of through cron. Under WP-CLI there is
 * no editor to block and no later request to pick cron up, so the batch is sent at once and the
 * result printed. When the front-end URL or the secret is unset there is nothing to send: the
 * "not configured" result is recorded straight away, with no cron event and no loopback request,
 * so an unconfigured site never pays for a send on every save.
 */
final class Dispatcher {
	/**
	 * The cron hook. Its arguments are the batch ID and the payload.
	 */
	public const CRON_HOOK = 'resource_hub_send_revalidation';

	/**
	 * Constructor.
	 *
	 * @param Queue       $queue       The per-request queue.
	 * @param Sender      $sender      Makes the request.
	 * @param ResultStore $store       Records the result in meta.
	 * @param PostHog     $posthog     Logs the result.
	 * @param bool|null   $synchronous Send at `shutdown` instead of scheduling cron; null means "when running under WP-CLI".
	 */
	public function __construct(
		private Queue $queue,
		private Sender $sender,
		private ResultStore $store,
		private PostHog $posthog,
		private ?bool $synchronous = null
	) {
		$this->synchronous ??= defined( 'WP_CLI' ) && WP_CLI;
	}

	/**
	 * Hooks `shutdown` and the cron callback.
	 */
	public function register(): void {
		add_action( 'shutdown', array( $this, 'flush' ) );
		add_action( self::CRON_HOOK, array( $this, 'run' ), 10, 2 );
	}

	/**
	 * `shutdown`: schedules or delivers every batch queued during this request and empties the queue.
	 *
	 * Each batch gets a fresh ID. It travels in the cron arguments, so two batches with identical
	 * payloads are two cron events (core drops a duplicate hook-and-arguments pair scheduled within
	 * ten minutes of the first), and it ties the meta on each object to the PostHog event. Should core
	 * refuse to schedule, the batch is delivered now rather than lost; it has already written its own
	 * `pending`, so its result is guarded like a cron batch's ({@see ResultStore::record()}).
	 *
	 * @return array<int, Result> The results decided in this request: held-back events and synchronous sends.
	 */
	public function flush(): array {
		$events = $this->queue->events();
		$this->queue->clear();

		$results   = array();
		$sendable  = array();
		$scheduled = false;

		foreach ( $events as $event ) {
			if ( 'resource' === $event['type'] ) {
				$event = ResourceEvents::refresh( $event );
			}

			$event = Payload::decode_slugs( $event );

			if ( 'resource' === $event['type'] ) {
				if ( ! ResourceState::has_one_type( $event ) ) {
					$results[] = $this->hold_back( $event );
					continue;
				}

				$event = ResourceState::with_valid_previous_types( $event );
			}

			$sendable[] = $event;
		}

		foreach ( array_chunk( $sendable, Queue::BATCH_SIZE ) as $batch ) {
			$batch_id = wp_generate_uuid4();
			$payload  = Payload::build( $batch );

			if ( $this->synchronous || ! Config::is_configured() ) {
				$results[] = $this->deliver( $batch_id, $payload );
				continue;
			}

			$this->store->mark_pending( $batch_id, $batch );

			if ( true !== wp_schedule_single_event( time(), self::CRON_HOOK, array( $batch_id, $payload ), true ) ) {
				$results[] = $this->deliver( $batch_id, $payload, true );
				continue;
			}

			$scheduled = true;
		}

		if ( $scheduled ) {
			spawn_cron();
		}

		foreach ( $results as $result ) {
			$this->print( $result );
		}

		return $results;
	}

	/**
	 * The cron callback: sends the payload it was given, with no reading of the post.
	 *
	 * @param string                                                        $batch_id The batch.
	 * @param array{version: int, events: array<int, array<string, mixed>>} $payload  The body built at schedule time.
	 */
	public function run( string $batch_id, array $payload ): void {
		$this->deliver( $batch_id, $payload, true );
	}

	/**
	 * Sends one event now, as a batch of one: the status page's test button (ADR 0019). Its slugs are
	 * decoded as at `shutdown` ({@see Payload::decode_slugs()}). A resource
	 * event without exactly one type is held back and recorded like any other, and one whose
	 * `previous.types` alone is invalid is sent with the current type in its place, as at `shutdown`.
	 *
	 * @param array<string, mixed> $event The event.
	 */
	public function send_one( array $event ): Result {
		$event = Payload::decode_slugs( $event );

		if ( 'resource' === $event['type'] ) {
			if ( ! ResourceState::has_one_type( $event ) ) {
				return $this->hold_back( $event );
			}

			$event = ResourceState::with_valid_previous_types( $event );
		}

		return $this->deliver( wp_generate_uuid4(), Payload::build( array( $event ) ) );
	}

	/**
	 * Sends one batch now, records the result on every object in it, and logs it. The one path every
	 * send takes: cron, the fallback when core refuses to schedule, WP-CLI, an unconfigured site, and
	 * the status page's test button.
	 *
	 * @param string                                                        $batch_id          The batch.
	 * @param array{version: int, events: array<int, array<string, mixed>>} $payload           The body.
	 * @param bool                                                          $wrote_own_pending True only from the cron callback and from the fallback that sends at
	 *                                                                                         once when core refuses to schedule: the batch wrote its own
	 *                                                                                         `pending` before it was sent, so the store keeps another batch's
	 *                                                                                         newer `pending` ({@see ResultStore::record()}).
	 */
	public function deliver( string $batch_id, array $payload, bool $wrote_own_pending = false ): Result {
		$events = is_array( $payload['events'] ?? null ) ? $payload['events'] : array();
		$result = $this->sender->send( $payload );

		$this->store->record( $batch_id, $events, $result, $wrote_own_pending );
		$this->posthog->capture( $batch_id, $events, $result );

		return $result;
	}

	/**
	 * Records a resource event that cannot be sent as a failure on its resource, and logs it, under
	 * its own batch ID so the PostHog event names it.
	 *
	 * @param array<string, mixed> $event The resource event.
	 */
	private function hold_back( array $event ): Result {
		$batch_id = wp_generate_uuid4();
		$result   = Result::no_single_type();

		$this->store->record( $batch_id, array( $event ), $result );
		$this->posthog->capture( $batch_id, array( $event ), $result );

		return $result;
	}

	/**
	 * Prints a result under WP-CLI: a log line for an accepted batch, a warning for anything else.
	 *
	 * @param Result $result The result.
	 */
	private function print( Result $result ): void {
		if ( ! class_exists( '\WP_CLI' ) ) {
			return;
		}

		if ( Result::SENT === $result->status ) {
			\WP_CLI::log( $result->describe() );
		} else {
			\WP_CLI::warning( $result->describe() );
		}
	}
}
