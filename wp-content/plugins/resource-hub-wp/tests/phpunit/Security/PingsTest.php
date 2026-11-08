<?php
/**
 * Every post is closed to pings; the reasons are in `src/Security/Pings.php`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Security;

use WP_UnitTestCase;

/**
 * `pings_open()` is false for every post type, whatever the post stores.
 */
final class PingsTest extends WP_UnitTestCase {
	/**
	 * Unregisters the post type one test adds.
	 */
	public function tear_down(): void {
		unregister_post_type( 'rh_pings_probe' );

		parent::tear_down();
	}

	/**
	 * An ordinary post stored with `ping_status` open is closed.
	 */
	public function test_open_post_is_closed(): void {
		$this->assert_closed_though_stored_open( $this->create_open( 'post' ) );
	}

	/**
	 * A page stored with `ping_status` open is closed.
	 */
	public function test_open_page_is_closed(): void {
		$this->assert_closed_though_stored_open( $this->create_open( 'page' ) );
	}

	/**
	 * A resource is created closed, as before, and stays closed.
	 */
	public function test_resource_is_closed(): void {
		$resource = self::factory()->post->create(
			array(
				'post_type'   => 'resource',
				'post_status' => 'publish',
			)
		);

		$this->assertSame( 'closed', get_post( $resource )->ping_status );
		$this->assertFalse( pings_open( $resource ) );
	}

	/**
	 * A resource stored with `ping_status` open, which only a PHP caller can write, is closed.
	 */
	public function test_open_resource_is_closed(): void {
		$this->assert_closed_though_stored_open( $this->create_open( 'resource' ) );
	}

	/**
	 * With the host's `default_ping_status` at `open`, a new post stores `open` and is closed.
	 */
	public function test_host_option_does_not_open_pings(): void {
		update_option( 'default_ping_status', 'open' );

		$post = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$this->assert_closed_though_stored_open( $post );
	}

	/**
	 * A post type registered later that supports trackbacks is closed too.
	 */
	public function test_post_type_registered_later_is_closed(): void {
		register_post_type(
			'rh_pings_probe',
			array(
				'public'   => true,
				'supports' => array( 'title', 'editor', 'trackbacks' ),
			)
		);

		$this->assert_closed_though_stored_open( $this->create_open( 'rh_pings_probe' ) );
	}

	/**
	 * Another plugin's filter at the default priority cannot reopen a post.
	 */
	public function test_another_filter_cannot_reopen(): void {
		add_filter( 'pings_open', '__return_true' );

		$this->assertFalse( pings_open( $this->create_open( 'post' ) ) );
	}

	/**
	 * Core sends no `X-Pingback` header for a single post stored open, because it asks
	 * `pings_open()` first. Logged in, because an anonymous single post is a 404 under the
	 * lockdown (ADR 0031) and core adds no header to a 404 whatever this switch does.
	 */
	public function test_core_adds_no_pingback_header(): void {
		$post = $this->create_open( 'post' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$headers = array();

		add_filter(
			'wp_headers',
			static function ( $sent ) use ( &$headers ) {
				$headers = $sent;
				return $sent;
			},
			9
		);

		$this->go_to( get_permalink( $post ) );

		$this->assertTrue( is_singular(), 'The request should reach the single post, or this test checks nothing.' );
		$this->assertArrayNotHasKey( 'X-Pingback', $headers );
	}

	/**
	 * The plugin's filter is what closes the post: without it, core reports it open. The
	 * other tests would pass for the wrong reason if this failed.
	 */
	public function test_post_is_open_without_the_filter(): void {
		$post = $this->create_open( 'post' );

		$this->assertSame( PHP_INT_MAX, has_filter( 'pings_open', '__return_false' ) );

		remove_filter( 'pings_open', '__return_false', PHP_INT_MAX );

		$this->assertTrue( pings_open( $post ) );
	}

	/**
	 * Creates a published post of the type with `ping_status` open.
	 *
	 * @param string $post_type Post type.
	 * @return int Post ID.
	 */
	private function create_open( string $post_type ): int {
		return self::factory()->post->create(
			array(
				'post_type'   => $post_type,
				'post_status' => 'publish',
				'ping_status' => 'open',
			)
		);
	}

	/**
	 * Asserts the post stores `ping_status` open, so the test checks something, and that
	 * `pings_open()` is false for it.
	 *
	 * @param int $post Post ID.
	 */
	private function assert_closed_though_stored_open( int $post ): void {
		$this->assertSame( 'open', get_post( $post )->ping_status, 'The post should store ping_status open, or this test checks nothing.' );
		$this->assertFalse( pings_open( $post ) );
	}
}
