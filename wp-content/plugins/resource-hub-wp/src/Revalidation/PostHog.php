<?php
/**
 * The optional PostHog record of every result.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * Sends one anonymous `revalidation_result` event per batch to PostHog when both constants are set.
 *
 * It is the only record of a force delete's or a term delete's outcome, and the only history: meta
 * keeps the last result per object. The request has the same 3-second timeout as the send, its
 * response is ignored, and nothing retries it: logging must never become a second thing that can fail.
 *
 * Rejected sinks: an option or a custom table (storage that grows without bound, and a table needs raw
 * SQL), a log file (no filesystem writes at runtime), and logging on the front end only, because the
 * front end cannot record a request that never reached it, such as a timeout or a missing
 * configuration. Sampling and rollups for high volume are tracked in issue #17.
 */
final class PostHog {
	/**
	 * The event name.
	 */
	public const EVENT = 'revalidation_result';

	/**
	 * Seconds to wait for PostHog.
	 */
	public const TIMEOUT = 3;

	/**
	 * Most bytes of PostHog's answer read. The answer is ignored, so it only needs to be bounded.
	 */
	public const RESPONSE_LIMIT = 1024;

	/**
	 * PostHog's documented single-event capture path, appended to the host.
	 */
	public const ENDPOINT = '/i/v0/e/';

	/**
	 * Prefix of the `distinct_id`, so the ID names the CMS and can never match a person's.
	 */
	public const DISTINCT_ID_PREFIX = 'resource-hub-cms:';

	/**
	 * The project API key; empty when PostHog is off.
	 *
	 * @var string
	 */
	private string $key;

	/**
	 * The PostHog host with no trailing slash; empty when PostHog is off.
	 *
	 * @var string
	 */
	private string $host;

	/**
	 * Constructor. The arguments exist so tests can turn PostHog on and off; the plugin reads the constants.
	 *
	 * @param string|null $key  Project API key; null reads {@see Config::posthog_key()}.
	 * @param string|null $host PostHog host; null reads {@see Config::posthog_host()}.
	 */
	public function __construct( ?string $key = null, ?string $host = null ) {
		$this->key  = $key ?? Config::posthog_key();
		$this->host = untrailingslashit( $host ?? Config::posthog_host() );
	}

	/**
	 * Whether both the key and the host are set.
	 */
	public function is_enabled(): bool {
		return '' !== $this->key && '' !== $this->host;
	}

	/**
	 * Records a batch's result. Does nothing when PostHog is not configured.
	 *
	 * @param string                           $batch_id The batch.
	 * @param array<int, array<string, mixed>> $events   Its events.
	 * @param Result                           $result   What the front end answered.
	 */
	public function capture( string $batch_id, array $events, Result $result ): void {
		if ( ! $this->is_enabled() ) {
			return;
		}

		$host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$site = '' !== $host ? $host : 'unknown';

		// Anonymous, with no person profile: the "person" would be the server.
		$body = array(
			'api_key'     => $this->key,
			'event'       => self::EVENT,
			'distinct_id' => self::DISTINCT_ID_PREFIX . $site,
			'timestamp'   => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'properties'  => array(
				'$process_person_profile' => false,
				'$lib'                    => 'resource-hub',
				'site'                    => $site,
				'batch_id'                => $batch_id,
				'status'                  => $result->status,
				'outcome'                 => $result->outcome,
				'code'                    => $result->code,
				'duration_ms'             => $result->duration_ms,
				'event_count'             => count( $events ),
				'events'                  => array_map( array( self::class, 'summarize' ), $events ),
			),
		);

		$json = wp_json_encode( $body );

		if ( false === $json ) {
			return;
		}

		wp_remote_post(
			$this->host . self::ENDPOINT,
			array(
				'timeout'             => self::TIMEOUT,
				'limit_response_size' => self::RESPONSE_LIMIT,
				'headers'             => array( 'Content-Type' => 'application/json' ),
				'body'                => $json,
			)
		);
	}

	/**
	 * The fields that identify an event in PostHog: type, event, ID, the slug (the path for a page), and
	 * the taxonomy for a term.
	 *
	 * @param array<string, mixed> $event The event.
	 * @return array<string, mixed>
	 */
	private static function summarize( array $event ): array {
		$summary = array(
			'type'  => $event['type'],
			'event' => $event['event'],
			'id'    => $event['id'],
		);

		if ( 'page' === $event['type'] ) {
			$summary['path'] = $event['path'];
		} else {
			$summary['slug'] = $event['slug'];
		}

		if ( 'term' === $event['type'] ) {
			$summary['taxonomy'] = $event['taxonomy'];
		}

		return $summary;
	}
}
