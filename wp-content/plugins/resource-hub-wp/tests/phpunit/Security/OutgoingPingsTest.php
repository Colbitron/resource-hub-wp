<?php
/**
 * The CMS queues and sends no outgoing pings; the reasons are in `src/Security/OutgoingPings.php`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Security;

use ResourceHub\Security\OutgoingPings;
use WP_UnitTestCase;

/**
 * Publishing queues no pings, and `do_all_pings()`, which the `do_pings` cron event runs, sends
 * nothing.
 *
 * Every test runs with the options that make core ping: `default_pingback_flag` on, a service
 * in `ping_sites` and the site public. Core 7.1 refuses outgoing pings outside the `production`
 * environment type, and wp-env's type is `local`, so `wp_should_disable_pings_for_environment` is
 * filtered to false to behave as a production host does. The filter does not exist before 7.1,
 * where adding it changes nothing. Every HTTP request is caught at `pre_http_request` and
 * answered with an empty 200, so nothing leaves the container.
 */
final class OutgoingPingsTest extends WP_UnitTestCase {
	/**
	 * A third-party link in the content: the pingback and enclosure target.
	 */
	private const LINK = 'https://example.com/linked-article/';

	/**
	 * A trackback URL in `to_ping`.
	 */
	private const TRACKBACK = 'https://example.org/trackback/';

	/**
	 * An update service in `ping_sites`.
	 */
	private const SERVICE = 'https://rpc.example.net/';

	/**
	 * URLs of the HTTP requests made during the test.
	 *
	 * @var string[]
	 */
	private array $requests = array();

	/**
	 * Turns on every option that makes core ping, and records HTTP requests instead of sending them.
	 */
	public function set_up(): void {
		parent::set_up();

		update_option( 'default_pingback_flag', '1' );
		update_option( 'ping_sites', self::SERVICE );
		update_option( 'blog_public', '1' );
		wp_clear_scheduled_hook( 'do_pings' );

		add_filter( 'wp_should_disable_pings_for_environment', '__return_false' );

		$this->requests = array();

		add_filter(
			'pre_http_request',
			function ( $response, $args, $url ) {
				unset( $response, $args );

				$this->requests[] = $url;

				return array(
					'headers'  => array(),
					'body'     => '',
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'cookies'  => array(),
					'filename' => null,
				);
			},
			10,
			3
		);
	}

	/**
	 * Publishing a post with a link and a trackback URL queues no pings and schedules no event.
	 */
	public function test_publishing_a_post_queues_nothing(): void {
		$this->assert_nothing_queued( $this->publish( 'post' ) );
	}

	/**
	 * Publishing a resource queues nothing either, and never did: a resource fires
	 * `publish_resource`, not `publish_post`, where core's queueing hook is. This test confirms
	 * core's behaviour, so it passes without the plugin's switch too.
	 */
	public function test_publishing_a_resource_queues_nothing(): void {
		$publish_post     = did_action( 'publish_post' );
		$publish_resource = did_action( 'publish_resource' );

		$resource = $this->publish( 'resource' );

		$this->assertSame( $publish_resource + 1, did_action( 'publish_resource' ), 'The resource should have been published, or this test checks nothing.' );
		$this->assertSame( $publish_post, did_action( 'publish_post' ) );
		$this->assert_nothing_queued( $resource );
	}

	/**
	 * `do_all_pings()` sends no request, even for a post whose pings were queued before the
	 * switch, and with a service in `ping_sites`.
	 */
	public function test_do_all_pings_sends_nothing(): void {
		$this->queue_stale( $this->publish( 'post' ) );

		do_all_pings();

		$this->assertSame( array(), $this->requests );
	}

	/**
	 * The plugin's switch is what stops the queue: with core's hook put back, the same publish
	 * queues all three and schedules the event. The first test would pass for the wrong reason if
	 * this failed.
	 */
	public function test_core_queues_pings_without_the_switch(): void {
		$this->assertFalse( has_action( 'publish_post', '_publish_post_hook' ) );

		add_action( 'publish_post', '_publish_post_hook', 5, 1 );

		$post = $this->publish( 'post' );

		$this->assertSame( array( '1' ), get_post_meta( $post, '_pingme', false ) );
		$this->assertSame( array( '1' ), get_post_meta( $post, '_encloseme', false ) );
		$this->assertSame( array( '1' ), get_post_meta( $post, '_trackbackme', false ) );
		$this->assertIsInt( wp_next_scheduled( 'do_pings' ) );
	}

	/**
	 * Each removed sender is one that would send: put back alone, it makes the request named.
	 * The `do_all_pings()` test would pass for the wrong reason if this failed.
	 *
	 * @dataProvider senders
	 *
	 * @param string $sender   Core's callback on `do_all_pings`.
	 * @param string $requests URL the sender requests.
	 */
	public function test_core_sends_without_the_switch( string $sender, string $requests ): void {
		$this->assertFalse( has_action( 'do_all_pings', $sender ) );

		$this->queue_stale( $this->publish( 'post' ) );

		add_action( 'do_all_pings', $sender, 10, 0 );

		do_all_pings();

		$this->assertContains( $requests, $this->requests );
	}

	/**
	 * Core's senders and the URL each one requests.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function senders(): array {
		return array(
			'do_all_pingbacks'  => array( 'do_all_pingbacks', self::LINK ),
			'do_all_enclosures' => array( 'do_all_enclosures', self::LINK ),
			'do_all_trackbacks' => array( 'do_all_trackbacks', self::TRACKBACK ),
			'generic_ping'      => array( 'generic_ping', self::SERVICE ),
		);
	}

	/**
	 * Every sender the plugin removes has a case above, and they are all of core's senders: after
	 * boot, nothing is left on `do_all_pings` but 7.1's environment check at priority 1, which
	 * older cores do not have. A sender a later core adds fails this test.
	 */
	public function test_every_sender_has_a_case(): void {
		$this->assertSame( OutgoingPings::SENDERS, array_keys( self::senders() ) );

		$expected = array();
		if ( function_exists( 'wp_maybe_disable_outgoing_pings_for_environment' ) ) {
			$expected[] = '1 wp_maybe_disable_outgoing_pings_for_environment';
		}

		$left = array();
		if ( isset( $GLOBALS['wp_filter']['do_all_pings'] ) ) {
			foreach ( $GLOBALS['wp_filter']['do_all_pings']->callbacks as $priority => $callbacks ) {
				foreach ( array_keys( $callbacks ) as $callback ) {
					$left[] = $priority . ' ' . $callback;
				}
			}
		}

		$this->assertEqualsCanonicalizing( $expected, $left );
	}

	/**
	 * Publishes a post of the type with a third-party link in its content and a trackback URL.
	 *
	 * @param string $post_type Post type.
	 * @return int Post ID.
	 */
	private function publish( string $post_type ): int {
		$post = self::factory()->post->create(
			array(
				'post_type'    => $post_type,
				'post_status'  => 'publish',
				'post_content' => '<p>See <a href="' . self::LINK . '">this article</a>.</p>',
				'to_ping'      => self::TRACKBACK,
			)
		);

		$this->assertSame( self::TRACKBACK, get_post( $post )->to_ping, 'The post should store to_ping, or this test checks nothing.' );

		return $post;
	}

	/**
	 * Stores the queue meta core wrote on publish before the switch, as on a host that had it.
	 *
	 * @param int $post Post ID.
	 */
	private function queue_stale( int $post ): void {
		add_post_meta( $post, '_pingme', '1', true );
		add_post_meta( $post, '_encloseme', '1', true );
		add_post_meta( $post, '_trackbackme', '1' );
	}

	/**
	 * Asserts the post has no queue meta and no `do_pings` event is scheduled.
	 *
	 * @param int $post Post ID.
	 */
	private function assert_nothing_queued( int $post ): void {
		$this->assertSame( array(), get_post_meta( $post, '_pingme', false ) );
		$this->assertSame( array(), get_post_meta( $post, '_encloseme', false ) );
		$this->assertSame( array(), get_post_meta( $post, '_trackbackme', false ) );
		$this->assertFalse( wp_next_scheduled( 'do_pings' ) );
	}
}
