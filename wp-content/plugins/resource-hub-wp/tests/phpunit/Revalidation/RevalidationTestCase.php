<?php
/**
 * Shared setup for the revalidation tests: a clean queue, mocked HTTP, and schema assertions.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\Config;
use ResourceHub\Revalidation\Queue;
use ResourceHub\Revalidation\Revalidation;
use WP_Error;
use WP_UnitTestCase;

/**
 * Base class. Every HTTP request is intercepted with `pre_http_request`, recorded in `$this->requests`,
 * and answered by `$this->responder`, which defaults to a 200 with an empty `revalidated` list.
 */
abstract class RevalidationTestCase extends WP_UnitTestCase {
	/**
	 * The plugin's own queue, cleared before and after every test.
	 *
	 * @var Queue
	 */
	protected Queue $queue;

	/**
	 * Every request made during the test: `url` and the `args` passed to the HTTP API.
	 *
	 * @var array<int, array{url: string, args: array<string, mixed>}>
	 */
	protected array $requests = array();

	/**
	 * Answers requests. Receives the URL and args, returns a response array or a WP_Error.
	 *
	 * @var callable
	 */
	protected $responder;

	/**
	 * Clears the queue, installs the HTTP mock and a default responder.
	 */
	public function set_up(): void {
		parent::set_up();

		$instance = Revalidation::instance();
		$this->assertNotNull( $instance, 'The plugin did not register Revalidation.' );

		$this->queue = $instance->queue();
		$this->queue->clear();

		$this->requests  = array();
		$this->responder = static fn(): array => self::http_response( 200, '{"revalidated":[]}' );

		add_filter( 'pre_http_request', array( $this, 'intercept_http' ), 10, 3 );
	}

	/**
	 * Leaves nothing queued for the process-end `shutdown` flush.
	 */
	public function tear_down(): void {
		$this->queue->clear();
		parent::tear_down();
	}

	/**
	 * `pre_http_request`: records the request and returns the responder's answer instead of making it.
	 *
	 * @param false|array<string, mixed>|WP_Error $preempt Whether to short-circuit. Ignored.
	 * @param array<string, mixed>                $args    Request arguments.
	 * @param string                              $url     Request URL.
	 * @return array<string, mixed>|WP_Error
	 */
	public function intercept_http( mixed $preempt, array $args, string $url ): array|WP_Error {
		$this->requests[] = array(
			'url'  => $url,
			'args' => $args,
		);

		return ( $this->responder )( $url, $args );
	}

	/**
	 * A response array in the shape the HTTP API returns.
	 *
	 * @param int    $code HTTP status.
	 * @param string $body Body.
	 * @return array<string, mixed>
	 */
	public static function http_response( int $code, string $body ): array {
		return array(
			'headers'  => array(),
			'body'     => $body,
			'response' => array(
				'code'    => $code,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	/**
	 * Sets the front-end URL and secret through the options the constants fall back to.
	 *
	 * @param string $url    Front-end origin. Given with a trailing slash to prove it is stripped.
	 * @param string $secret The bearer secret: 32 characters or more, or {@see Config::is_configured()} is false.
	 */
	protected function configure( string $url = 'https://hub.example/', string $secret = 'test-secret-0123456789abcdefghijklmn' ): void {
		update_option( strtolower( Config::FRONTEND_URL ), $url );
		update_option( strtolower( Config::REVALIDATE_SECRET ), $secret );
	}

	/**
	 * The requests made to the front end's revalidate route.
	 *
	 * @return array<int, array{url: string, args: array<string, mixed>}>
	 */
	protected function revalidate_requests(): array {
		return array_values(
			array_filter(
				$this->requests,
				static fn( array $request ): bool => str_ends_with( $request['url'], '/api/revalidate/' )
			)
		);
	}

	/**
	 * Creates a term in one of the two taxonomies and clears the queue of its `create` event.
	 *
	 * @param string $taxonomy `resource_topic` or `resource_type`.
	 * @param string $slug     Term slug.
	 * @param string $name     Term name; defaults to the slug.
	 */
	protected function make_term( string $taxonomy, string $slug, string $name = '' ): int {
		$term_id = self::factory()->term->create(
			array(
				'taxonomy' => $taxonomy,
				'slug'     => $slug,
				'name'     => '' !== $name ? $name : $slug,
			)
		);
		$this->queue->clear();

		return $term_id;
	}

	/**
	 * Creates a resource with one type and some topics and clears the queue of its creation event.
	 *
	 * @param string   $status Post status.
	 * @param string   $slug   Post slug.
	 * @param string   $type   Type slug; the term is created if missing.
	 * @param string[] $topics Topic slugs; the terms are created if missing.
	 */
	protected function make_resource( string $status, string $slug, string $type = 'webinar', array $topics = array() ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => $status,
				'post_name'   => $slug,
				'post_title'  => ucfirst( str_replace( '-', ' ', $slug ) ),
			)
		);

		wp_set_object_terms( $post_id, array( $this->term_id( Taxonomies::TYPE, $type ) ), Taxonomies::TYPE );
		wp_set_object_terms(
			$post_id,
			array_map( fn( string $topic ): int => $this->term_id( Taxonomies::TOPIC, $topic ), $topics ),
			Taxonomies::TOPIC
		);
		// A REST save of a public resource needs a stored summary (RequiredFields); events never carry it.
		update_post_meta( $post_id, Meta::SUMMARY, 'Summary of ' . $slug );

		$this->queue->clear();

		return $post_id;
	}

	/**
	 * The ID of a term by slug, creating it when it does not exist yet.
	 *
	 * @param string $taxonomy Taxonomy.
	 * @param string $slug     Slug.
	 */
	protected function term_id( string $taxonomy, string $slug ): int {
		$existing = get_term_by( 'slug', $slug, $taxonomy );

		if ( $existing instanceof \WP_Term ) {
			return $existing->term_id;
		}

		return $this->make_term( $taxonomy, $slug );
	}

	/**
	 * Asserts that a request body validates against `revalidate-request.schema.json`.
	 *
	 * @param array<string, mixed> $payload The body.
	 */
	protected function assert_valid_request( array $payload ): void {
		$errors = SchemaValidator::errors( 'revalidate-request', $payload );

		$this->assertNull( $errors, "Payload does not match the request schema:\n{$errors}\n" . wp_json_encode( $payload, JSON_PRETTY_PRINT ) );
	}

	/**
	 * Asserts that the queue holds exactly one event, that it validates as a one-event batch, and returns it.
	 *
	 * @return array<string, mixed>
	 */
	protected function assert_single_queued_event(): array {
		$events = $this->queue->events();

		$this->assertCount( 1, $events, 'Expected exactly one queued event, got: ' . wp_json_encode( $events ) );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $events,
			)
		);

		return $events[0];
	}
}
