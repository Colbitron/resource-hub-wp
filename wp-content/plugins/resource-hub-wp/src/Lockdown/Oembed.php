<?php
/**
 * The oEmbed discovery links are removed (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Lockdown;

/**
 * Removes the `<link rel="alternate" type="application/json+oembed">` tags from page heads.
 *
 * They advertise the oEmbed endpoint and the `/embed/` pages, which anonymous visitors cannot see.
 * Core hooks `wp_oembed_add_discovery_links()` to `wp_head` twice, at 4 and at 10, and documents
 * removing it at 10 as the way to switch the links off; both are removed so no copy is left.
 *
 * The oEmbed REST endpoint, `/wp-json/oembed/1.0/embed`, stays registered: the REST API is public
 * by ADR 0031, removing a route would be a contract change, and the endpoint only describes an
 * embed page that is itself a 404 to anyone it could matter to.
 */
final class Oembed {
	/**
	 * Unhooks the discovery links.
	 */
	public function register(): void {
		remove_action( 'wp_head', 'wp_oembed_add_discovery_links', 4 );
		remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );
	}
}
