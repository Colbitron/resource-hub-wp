<?php
/**
 * Crawlers are told to stay away from the whole CMS (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Lockdown;

/**
 * `robots.txt` disallows everything, and every theme response says `noindex`.
 *
 * The 404s are what keep the content out of search; these are the signals on top. The virtual
 * `robots.txt` core serves is replaced through its `robots_txt` filter, at the latest priority so
 * nothing appends to it (core adds a `Sitemap:` line at priority 0): a crawler that obeys it never
 * fetches a page. For crawlers that reach a response some other way, every theme page gets a meta
 * robots `noindex` through `wp_robots`, and every front-end response gets an `X-Robots-Tag: noindex`
 * header through `wp_headers`, which `send_headers()` applies before the 404 decision, so the 404s
 * carry it too. REST responses already carry that header: `WP_REST_Server::serve_request()` sends
 * it on every one, as `admin-ajax.php` does, so the plugin adds nothing there and a PHPUnit test
 * pins it. No physical file is written: the VIP rules forbid filesystem writes, and the filter
 * covers the host as long as no `robots.txt` file shadows it.
 */
final class Robots {
	/**
	 * The header name.
	 */
	public const HEADER = 'X-Robots-Tag';

	/**
	 * The header value and the meta robots directive.
	 */
	public const NOINDEX = 'noindex';

	/**
	 * Hooks the filters.
	 */
	public function register(): void {
		// The VIP reminder to flush VIP's robots.txt cache is for VIP's platform; this host has no such cache.
		add_filter( 'robots_txt', array( $this, 'disallow_all' ), PHP_INT_MAX ); // phpcs:ignore WordPressVIPMinimum.Hooks.RestrictedHooks.robots_txt
		add_filter( 'wp_robots', array( $this, 'noindex' ) );
		add_filter( 'wp_headers', array( $this, 'add_header' ) );
	}

	/**
	 * The whole of `robots.txt`. Hooked to `robots_txt`.
	 *
	 * @param mixed $output What core and earlier filters built; replaced.
	 */
	public function disallow_all( $output ): string {
		unset( $output );

		return "User-agent: *\nDisallow: /\n";
	}

	/**
	 * Adds `noindex` to the meta robots directives. Hooked to `wp_robots`.
	 *
	 * @param mixed $robots Directives so far, keyed by name.
	 * @return array<string, bool|string>
	 */
	public function noindex( $robots ): array {
		$robots = is_array( $robots ) ? $robots : array();

		$robots[ self::NOINDEX ] = true;

		return $robots;
	}

	/**
	 * Adds the header to a front-end response. Hooked to `wp_headers`.
	 *
	 * @param mixed $headers Headers `send_headers()` will send, keyed by name.
	 * @return array<string, mixed>
	 */
	public function add_header( $headers ): array {
		$headers = is_array( $headers ) ? $headers : array();

		$headers[ self::HEADER ] = self::NOINDEX;

		return $headers;
	}
}
