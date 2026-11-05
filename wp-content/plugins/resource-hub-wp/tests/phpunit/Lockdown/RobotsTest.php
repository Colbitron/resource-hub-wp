<?php
/**
 * The robots.txt disallows everything and every response says noindex (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Lockdown;

use ResourceHub\Lockdown\Robots;

/**
 * The robots.txt body, the meta robots tag, the front-end header, and the REST header core sends.
 */
final class RobotsTest extends LockdownTestCase {
	/**
	 * The whole of robots.txt is "disallow everything", with nothing appended, logged in or not.
	 */
	public function test_robots_txt_disallows_everything(): void {
		$this->assertSame( "User-agent: *\nDisallow: /\n", get_echo( 'do_robots' ) );

		$this->logged_in();
		$this->assertSame( "User-agent: *\nDisallow: /\n", get_echo( 'do_robots' ) );
	}

	/**
	 * The meta robots tag carries noindex.
	 */
	public function test_meta_robots_noindex(): void {
		$this->assertMatchesRegularExpression( "/<meta name='robots' content='[^']*\\bnoindex\\b/", get_echo( 'wp_robots' ) );
		$this->assertSame( array( 'noindex' => true ), $this->robots()->noindex( array() ) );
		$this->assertSame( array( 'noindex' => true ), $this->robots()->noindex( 'not an array' ) );
	}

	/**
	 * Every front-end response gets the header, through the filter `send_headers()` applies.
	 */
	public function test_front_end_header(): void {
		$this->assertSame( 10, has_filter( 'wp_headers', array( $this->robots(), 'add_header' ) ) );

		$headers = $this->robots()->add_header( array( 'X-Pingback' => 'kept' ) );

		$this->assertSame( 'kept', $headers['X-Pingback'] );
		$this->assertSame( Robots::NOINDEX, $headers[ Robots::HEADER ] );
		$this->assertSame( array( Robots::HEADER => Robots::NOINDEX ), $this->robots()->add_header( null ) );
	}

	/**
	 * REST responses carry the header from core; this pins that, since the plugin relies on it.
	 */
	public function test_rest_header_comes_from_core(): void {
		$server = rest_get_server();
		$server->serve_request( '/wp/v2/resources' );

		$this->assertSame( Robots::NOINDEX, $server->sent_headers[ Robots::HEADER ] );
	}

	/**
	 * The instance the plugin registered.
	 */
	private function robots(): Robots {
		return $this->registered( 'wp_headers', Robots::class );
	}
}
