<?php
/**
 * Incoming trackbacks and pingbacks are off on the headless CMS.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Security;

/**
 * Closes every post of every type to pings, whatever its stored `ping_status`.
 *
 * Trackbacks arrive through `wp-trackback.php`, a separate entry point from XML-RPC
 * ({@see XmlRpc}), which stores a `trackback` comment whenever `pings_open()` is true for the
 * target post. Core's `post` type supports trackbacks, so with the host's `default_ping_status`
 * option at `open` any ordinary post would accept them, and so would a page or a resource that
 * an import or a PHP caller stored with `ping_status` open. The CMS is headless and has no
 * use for pings: a ping is spam stored in the comments table, behind an open write endpoint.
 *
 * The switch is the `pings_open` filter, returning false at `PHP_INT_MAX`, the priority
 * {@see XmlRpc} gives its method filter, so a filter another plugin adds at any lower priority
 * cannot reopen a post. A callback added later at `PHP_INT_MAX` itself would still run after this
 * one and win, because core runs callbacks of one priority in the order they were added; no
 * priority can rule that out. It answers at runtime, for every post type registered now or later,
 * so it does not depend on the host's `default_ping_status` option and needs no data migration: a
 * post stored with `ping_status` open before this switch is closed by it, and so is one an editor
 * opens later from the Discussion panel. Core asks `pings_open()` before it
 * stores a trackback (`wp-trackback.php`), before it accepts an XML-RPC pingback (which
 * {@see XmlRpc} has already removed) and before it sends the `X-Pingback` header on a single
 * post, so this one filter covers all three.
 *
 * Two switches on stored data were rejected. Filtering the `default_ping_status` option to
 * `closed` changes only posts created afterwards, and an editor, an import or a PHP caller can
 * still store `open` on one. Rewriting every stored `ping_status` to `closed` is a data migration
 * to run on every environment, and is only right until the next save stores `open` again. The
 * stored value and the REST API's `ping_status` field therefore still say `open` for a post saved
 * that way, and the Discussion panel's checkbox still saves; nothing on the front end reads them.
 *
 * Core's own switch, the `wp_should_disable_pings_for_environment` filter, was not used. It
 * exists only from WordPress 7.1, and the plugin's floor is 6.9. It also stops the pings this CMS
 * sends, which is a separate call. By default it refuses trackbacks only outside the `production`
 * environment type, so it protects wp-env but not a site whose type is `production`, which is
 * also what core assumes when none is set.
 *
 * The lockdown ({@see \ResourceHub\Lockdown\Gate}) does not close the endpoint either. It makes
 * an anonymous `wp-trackback.php?p=<id>` query a 404, so that form never finds a post. But
 * `wp-trackback.php/<id>` reads the ID from the path, so it does reach `pings_open()`.
 *
 * This was tested over HTTP by hand, with the tests site's `WP_ENVIRONMENT_TYPE` set to
 * `production` in an uncommitted override. A ping to `wp-trackback.php/<id>` for a post and for a
 * page, both stored open, was refused with the plugin active. With the plugin inactive, each was
 * stored as a `trackback` comment. There is no Playwright spec for it. wp-env's environment type
 * is `local`, so core refuses the ping before it asks `pings_open()`, and the spec would pass with
 * the plugin off, as the XML-RPC pingback would (`tests/e2e/xmlrpc.spec.js`). PHPUnit checks
 * `pings_open()` itself.
 *
 * Pings this CMS sends to other sites (pingbacks to the links in a post, trackbacks to its
 * `to_ping` URLs, from cron after a publish) are a different path, which this class does not
 * touch.
 */
final class Pings {
	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'pings_open', '__return_false', PHP_INT_MAX );
	}
}
