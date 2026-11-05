<?php
/**
 * The robots.txt disallows everything and every theme response says noindex, nofollow (ADR 0031).
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
	 * The meta robots tag carries noindex and nofollow, and never follow beside them.
	 */
	public function test_meta_robots_noindex_nofollow(): void {
		$this->assertSame( PHP_INT_MAX, has_filter( 'wp_robots', array( $this->robots(), 'add_directives' ) ) );

		$tag = get_echo( 'wp_robots' );

		$this->assertMatchesRegularExpression( "/<meta name='robots' content='[^']*\\bnoindex\\b/", $tag );
		$this->assertMatchesRegularExpression( "/<meta name='robots' content='[^']*\\bnofollow\\b/", $tag );
		$this->assertDoesNotMatchRegularExpression( "/<meta name='robots' content='([^']*, )?follow\\b/", $tag );

		$expected = array(
			'noindex'  => true,
			'nofollow' => true,
		);
		$this->assertSame( array( 'noindex', 'nofollow' ), Robots::DIRECTIVES );
		$this->assertSame( $expected, $this->robots()->add_directives( array() ) );
		$this->assertSame( $expected, $this->robots()->add_directives( 'not an array' ) );
	}

	/**
	 * Core's follow, which it adds to search results and embeds on a public site, is dropped, and
	 * every other directive is kept.
	 */
	public function test_meta_robots_drops_core_follow(): void {
		update_option( 'blog_public', '1' );
		$from_core = wp_robots_no_robots( array( 'max-image-preview' => 'large' ) );
		$this->assertTrue( $from_core['follow'], 'Core adds follow on a public site.' );

		$robots = $this->robots()->add_directives( $from_core );

		$this->assertArrayNotHasKey( 'follow', $robots );
		$this->assertSame( 'large', $robots['max-image-preview'] );
		$this->assertTrue( $robots['noindex'] );
		$this->assertTrue( $robots['nofollow'] );
	}

	/**
	 * A logged-in visitor's search, which core marks noindex and follow on a public site, prints
	 * noindex and nofollow, and never follow on its own, through the real filter order.
	 */
	public function test_logged_in_search_meta_robots_through_the_filters(): void {
		update_option( 'blog_public', '1' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->go_to( '/?s=x' );

		$this->assertTrue( is_search() );
		$this->assertTrue( wp_robots_no_robots( array() )['follow'], 'Core adds follow on a public site.' );

		$tag = get_echo( 'wp_robots' );

		$this->assertMatchesRegularExpression( "/<meta name='robots' content='[^']*\\bnoindex\\b/", $tag );
		$this->assertMatchesRegularExpression( "/<meta name='robots' content='[^']*\\bnofollow\\b/", $tag );
		$this->assertDoesNotMatchRegularExpression( "/<meta name='robots' content='([^']*, )?follow\\b/", $tag );
	}

	/**
	 * Every front-end response gets the header, through the filter `send_headers()` applies.
	 */
	public function test_front_end_header(): void {
		$this->assertSame( 10, has_filter( 'wp_headers', array( $this->robots(), 'add_header' ) ) );
		$this->assertSame( 'noindex, nofollow', Robots::header_value() );

		$headers = $this->robots()->add_header( array( 'X-Pingback' => 'kept' ) );

		$this->assertSame( 'kept', $headers['X-Pingback'] );
		$this->assertSame( Robots::header_value(), $headers[ Robots::HEADER ] );
		$this->assertSame( array( Robots::HEADER => Robots::header_value() ), $this->robots()->add_header( null ) );
	}

	/**
	 * REST responses carry core's own header, `noindex` alone; this pins that, since the plugin relies on
	 * it and leaves REST alone.
	 */
	public function test_rest_header_comes_from_core(): void {
		$server = rest_get_server();
		$server->serve_request( '/wp/v2/resources' );

		$this->assertSame( 'noindex', $server->sent_headers[ Robots::HEADER ] );
	}

	/**
	 * The instance the plugin registered.
	 */
	private function robots(): Robots {
		return $this->registered( 'wp_headers', Robots::class );
	}
}
