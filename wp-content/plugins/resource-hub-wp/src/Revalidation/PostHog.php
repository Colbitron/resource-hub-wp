<?php
/**
 * The optional PostHog record of every result.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * Sends one `revalidation_result` event per batch to PostHog when both constants are set (ADR 0032).
 *
 * It is the only record of a force delete's or a term delete's outcome, and the only history: meta
 * keeps the last result per object. The request has the same 3-second timeout as the send, its
 * response is ignored, and nothing retries it: logging must never become a second thing that can fail.
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
		$body = array(
			'api_key'     => $this->key,
			'event'       => self::EVENT,
			'distinct_id' => '' !== $host ? $host : 'unknown',
			'timestamp'   => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'properties'  => array(
				'$lib'        => 'resource-hub',
				'batch_id'    => $batch_id,
				'status'      => $result->status,
				'outcome'     => $result->outcome,
				'code'        => $result->code,
				'duration_ms' => $result->duration_ms,
				'event_count' => count( $events ),
				'events'      => array_map( array( self::class, 'summarize' ), $events ),
			),
		);

		$json = wp_json_encode( $body );

		if ( false === $json ) {
			return;
		}

		wp_remote_post(
			$this->host . '/capture/',
			array(
				'timeout'             => self::TIMEOUT,
				'limit_response_size' => self::RESPONSE_LIMIT,
				'headers'             => array( 'Content-Type' => 'application/json' ),
				'body'                => $json,
			)
		);
	}

	/**
	 * The fields that identify an event in PostHog: type, event, ID, slug, and the taxonomy for a term.
	 *
	 * @param array<string, mixed> $event The event.
	 * @return array<string, mixed>
	 */
	private static function summarize( array $event ): array {
		$summary = array(
			'type'  => $event['type'],
			'event' => $event['event'],
			'id'    => $event['id'],
			'slug'  => $event['slug'],
		);

		if ( 'term' === $event['type'] ) {
			$summary['taxonomy'] = $event['taxonomy'];
		}

		return $summary;
	}
}
