<?php
/**
 * Core sitemaps are off for anonymous visitors (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Lockdown;

use ResourceHub\Lockdown\Sitemaps;

/**
 * The `wp_sitemaps_enabled` filter, hooked from boot, independent of the gate.
 */
final class SitemapsTest extends LockdownTestCase {
	/**
	 * Off for an anonymous visitor and on for a logged-in user, with no request made, so the answer
	 * does not wait for the gate.
	 */
	public function test_off_for_anonymous_visitors(): void {
		$this->assertSame( 10, has_filter( 'wp_sitemaps_enabled', array( $this->sitemaps(), 'enabled' ) ) );
		$this->assertFalse( wp_sitemaps_get_server()->sitemaps_enabled() );

		$this->logged_in();
		$this->assertTrue( wp_sitemaps_get_server()->sitemaps_enabled() );
	}

	/**
	 * Logged in, it keeps what core decided, such as off for a site that discourages search engines.
	 */
	public function test_keeps_cores_answer_for_logged_in_users(): void {
		$this->logged_in();

		$this->assertFalse( $this->sitemaps()->enabled( false ) );
		$this->assertTrue( $this->sitemaps()->enabled( true ) );
	}

	/**
	 * The instance the plugin registered.
	 */
	private function sitemaps(): Sitemaps {
		return $this->registered( 'wp_sitemaps_enabled', Sitemaps::class );
	}
}
