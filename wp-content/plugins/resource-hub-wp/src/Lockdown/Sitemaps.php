<?php
/**
 * Core sitemaps are off for anonymous visitors (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Lockdown;

/**
 * Switches core sitemaps off for every request that is not logged in.
 *
 * The {@see Gate} already makes an anonymous sitemap request a 404; this is a second lock that
 * does not depend on the gate's decision. Core reads the `wp_sitemaps_enabled` filter on `init`,
 * in `WP_Sitemaps::init()`, and the filter is added when the plugin boots, before `init`. Off at
 * that point, core registers no sitemap providers, no `sitemap.xml` redirect and no `Sitemap:`
 * line in `robots.txt`, and its renderer on `template_redirect` reads the filter again and answers
 * any sitemap URL with a 404 of its own. The sitemap rewrite rules stay registered whatever the
 * filter says, so flushing them as an anonymous user changes nothing. A logged-in user keeps the
 * sitemaps.
 */
final class Sitemaps {
	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'wp_sitemaps_enabled', array( $this, 'enabled' ) );
	}

	/**
	 * Whether core sitemaps are on. Hooked to `wp_sitemaps_enabled`.
	 *
	 * @param mixed $enabled What core and earlier filters decided.
	 */
	public function enabled( $enabled ): bool {
		// Pluggable functions load after plugins; a call before then cannot know the user, so it fails closed.
		if ( ! function_exists( 'is_user_logged_in' ) ) {
			return false;
		}

		return (bool) $enabled && is_user_logged_in();
	}
}
