<?php
/**
 * The CMS's theme pages are for logged-in users only (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Lockdown;

/**
 * Registers the lockdown: anonymous visitors get a 404 from every page the theme would render,
 * with no redirect, while crawlers are told to stay away from the whole CMS.
 *
 * The front end is the only public site. {@see Gate} turns an anonymous theme-page request into
 * a 404 before any redirect can run and {@see NoRedirects} keeps it one; {@see Sitemaps} switches
 * core sitemaps off for anonymous visitors whatever the gate decides; {@see Robots} disallows
 * the CMS in `robots.txt` and marks every response `noindex`; {@see Oembed} drops the discovery
 * links that would advertise the embed pages. The REST API, the admin, the login page, cron and
 * the uploads directory are untouched, because none of them goes through the theme.
 */
final class Lockdown {
	/**
	 * Registers every hook. Called once from {@see \ResourceHub\Plugin::boot()}.
	 */
	public function register(): void {
		( new Gate() )->register();
		( new Sitemaps() )->register();
		( new Robots() )->register();
		( new Oembed() )->register();
	}
}
