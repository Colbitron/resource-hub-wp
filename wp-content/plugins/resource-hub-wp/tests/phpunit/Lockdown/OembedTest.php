<?php
/**
 * The oEmbed discovery links are gone; the oEmbed REST endpoint stays (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Lockdown;

/**
 * The two `wp_head` hooks core adds for the links, and the route the REST API keeps.
 */
final class OembedTest extends LockdownTestCase {
	/**
	 * Neither copy of the discovery links is hooked, so the head of a page has none.
	 */
	public function test_discovery_links_are_unhooked(): void {
		$this->assertFalse( has_action( 'wp_head', 'wp_oembed_add_discovery_links' ) );

		$this->logged_in();
		$this->go_to( get_permalink( $this->resource() ) );

		$this->assertStringNotContainsString( 'json+oembed', get_echo( 'wp_head' ) );
	}

	/**
	 * The REST endpoint is still registered.
	 */
	public function test_rest_endpoint_stays(): void {
		$this->assertArrayHasKey( '/oembed/1.0/embed', rest_get_server()->get_routes( 'oembed/1.0' ) );
	}
}
