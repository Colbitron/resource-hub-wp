<?php
/**
 * A locked-out request is never redirected (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Lockdown;

use ResourceHub\ContentModel\PostType;

/**
 * Each redirect core would send from a 404, shown to fire for a logged-in user and to be off for
 * an anonymous one. `redirect_canonical()` is called with `$do_redirect` false, which returns the
 * URL it would have sent instead of sending it; the old-slug and admin-location redirects and
 * `wp_redirect()` itself exit after redirecting, so their guards are checked by registration, and
 * the Playwright spec checks for a `Location` header end to end.
 */
final class NoRedirectsTest extends LockdownTestCase {
	/**
	 * The guards are in place only once an anonymous request has been locked: not before, and not
	 * for a logged-in user.
	 */
	public function test_guards_are_request_scoped(): void {
		$url = get_permalink( $this->resource() );
		$this->assertGuards( false );

		$this->go_to( $url );
		$this->assertGuards( true );
	}

	/**
	 * A logged-in request registers nothing.
	 */
	public function test_logged_in_requests_register_no_guards(): void {
		$this->logged_in();
		$this->go_to( get_permalink( $this->resource() ) );

		$this->assertGuards( false );
	}

	/**
	 * `?p=` would be sent to the pretty permalink; locked out, it is not.
	 */
	public function test_plain_query_is_not_sent_to_the_permalink(): void {
		$id  = self::factory()->post->create( array( 'post_name' => 'hello-there' ) );
		$url = home_url( '/?p=' . $id );

		$this->go_to( $url );
		$this->assertTrue( is_404() );
		$this->assertNull( redirect_canonical( $url, false ) );

		$this->logged_in();
		$this->go_to( $url );
		$this->assertSame( get_permalink( $id ), redirect_canonical( $url, false ) );
	}

	/**
	 * A partial slug would be guessed to the resource's permalink; locked out, it is not.
	 */
	public function test_partial_slug_is_not_guessed(): void {
		$id  = $this->resource( 'the-headless-handbook', 'ebook' );
		$url = home_url( '/resources/ebook/the-headless/' );

		$this->go_to( $url );
		$this->assertTrue( is_404() );
		$this->assertNull( redirect_canonical( $url, false ) );

		$this->logged_in();
		$this->go_to( $url );
		$this->assertTrue( is_404() );
		$this->assertSame( get_permalink( $id ), redirect_canonical( $url, false ) );
	}

	/**
	 * An old slug would be sent to the current one; locked out, the old-slug lookup finds nothing.
	 */
	public function test_old_slug_finds_no_post(): void {
		$id = $this->resource( 'old-name', 'ebook' );
		wp_update_post(
			array(
				'ID'        => $id,
				'post_name' => 'new-name',
			)
		);
		$url = home_url( '/resources/ebook/old-name/' );

		$this->go_to( $url );
		$this->assertTrue( is_404() );
		$this->assertSame( $id, _find_post_by_old_slug( PostType::NAME ), 'Core would have redirected.' );
		$this->assertSame( 10, has_filter( 'old_slug_redirect_post_id', '__return_zero' ) );
	}

	/**
	 * `/login` and `/admin` would be sent to wp-login.php and wp-admin; locked out, that hook is gone.
	 */
	public function test_admin_locations_are_unhooked(): void {
		$this->go_to( home_url( '/login/' ) );
		$this->assertTrue( is_404() );
		$this->assertFalse( has_action( 'template_redirect', 'wp_redirect_admin_locations' ) );

		$this->logged_in();
		$this->go_to( home_url( '/login/' ) );
		$this->assertSame( 1000, has_action( 'template_redirect', 'wp_redirect_admin_locations' ) );
	}

	/**
	 * Whether every request-scoped guard is registered, or none is.
	 *
	 * @param bool $on Expected state.
	 */
	private function assertGuards( bool $on ): void {
		$registered = $on ? 10 : false;

		$this->assertSame( $registered, has_filter( 'redirect_canonical', '__return_false' ) );
		$this->assertSame( $registered, has_filter( 'old_slug_redirect_post_id', '__return_zero' ) );
		$this->assertSame( $registered, has_filter( 'wp_redirect', '__return_false' ) );
		$this->assertSame( $registered, has_filter( 'wp_sitemaps_enabled', '__return_false' ) );
		$this->assertSame( $on ? false : 1000, has_action( 'template_redirect', 'wp_redirect_admin_locations' ) );
	}
}
