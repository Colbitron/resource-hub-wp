<?php
/**
 * The headless CMS sends no pingbacks, trackbacks, update-service pings or enclosure fetches.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Security;

/**
 * Takes away core's queueing and sending of outgoing pings.
 *
 * When a `post` is published, core's `_publish_post_hook()` (on `publish_post`, priority 5)
 * adds `_pingme` meta when the `default_pingback_flag` option is on, `_encloseme` meta always,
 * and `_trackbackme` meta when the post's `to_ping` field holds URLs. It then schedules a
 * `do_pings` cron event, unless one is already scheduled. That event runs `do_all_pings()`,
 * which fires the `do_all_pings` action. Core hooks four senders to that action at priority 10:
 * `do_all_pingbacks()` fetches the links in a queued post's content to find a pingback server
 * and pings it; `do_all_trackbacks()` posts to each `to_ping` URL; `generic_ping()` pings every
 * service in the `ping_sites` option; and `do_all_enclosures()` sends a HEAD request to the
 * links in a queued post's content. So publishing one ordinary post makes the CMS request
 * third-party URLs that an editor put in the content. The CMS is headless and has no use for any
 * of this.
 *
 * Checked against core 6.9.11, 7.0.8 and 7.1.4: the `publish_post` and `do_all_pings` hooks,
 * `_publish_post_hook()`, `do_all_pings()`, the four senders and their registrations in
 * `default-filters.php` are identical in all three. `do_enclose()` and `do_trackbacks()` differ
 * only cosmetically (null coalescing in place of `isset()`, and an unused argument dropped from a
 * `the_content` call), with no change in behaviour. 7.1 adds the environment check described
 * below.
 *
 * There are two switches, because there are two ends and neither covers the other:
 *
 * - The queue: `_publish_post_hook()` is removed from `publish_post`. A publish then writes no
 *   `_pingme`, `_encloseme` or `_trackbackme` meta and schedules no `do_pings` event. This
 *   covers every way a `post` reaches `publish`: the editor, a scheduled post published by cron,
 *   and a PHP or WP-CLI caller. An import that defines `WP_IMPORTING` never queued them: the
 *   function returns before the queue when that constant is set. It also fires
 *   `xmlrpc_publish_post` during an XML-RPC request, but {@see XmlRpc} has already turned XML-RPC
 *   off, so nothing is lost.
 * - The senders: the four callbacks are removed from `do_all_pings`. `generic_ping()` does not
 *   depend on the queue. It pings every `ping_sites` service whenever the action runs, so a
 *   `do_pings` event scheduled before this switch, or by another plugin, would still send it.
 *   The other three would still act on queue meta stored before this switch. Removing them
 *   also needs no data migration. Stale meta stays in the database, where nothing reads it.
 *
 * Enclosures are in scope, though they are a fetch, not a ping. Removing the queue's hook stops
 * `_encloseme` with the rest, because one function queues them all, and core has no hook that
 * keeps enclosures without the pings. The fetch is still an outbound request from the CMS to
 * any URL in the content, like a pingback's discovery request. Its only product is `enclosure`
 * meta, which core's RSS and Atom feeds (`rss_enclosure()`, `atom_enclosure()`) and XML-RPC read.
 * The front end does not read it, {@see XmlRpc} has turned XML-RPC off, and the lockdown
 * ({@see \ResourceHub\Lockdown\Gate}) answers feeds with a 404 for anonymous visitors. So its
 * sender is removed too.
 *
 * Both switches remove core's own callbacks at boot, after `wp-includes/default-filters.php` has
 * added them. Nothing is filtered at runtime, and no option is written. The Settings screens
 * still show "Attempt to notify any blogs linked to from the post" and "Update Services". Those
 * options are stored but now do nothing.
 *
 * Resources never queued these pings. Core's `wp_transition_post_status()` fires
 * `publish_{$post_type}`, so a resource fires `publish_resource` and never `publish_post`, and
 * core hooks `_publish_post_hook()` to `publish_post` alone. The same is true of pages.
 * `OutgoingPingsTest` publishes a resource with a link and `to_ping` set, to confirm it.
 *
 * Three other switches were rejected:
 *
 * - Core's `wp_should_disable_pings_for_environment` filter, returning true. It exists only from
 *   WordPress 7.1, and the plugin's floor is 6.9. It also acts only on the senders. On
 *   `do_all_pings` at priority 1 it removes three of the four senders and leaves
 *   `do_all_enclosures()` in place. A publish still writes the queue meta and schedules the
 *   event. With this class's two switches in place, the filter would change nothing on 7.1.
 *   Using it as well would add a second code path for no gain.
 * - Filtering `default_pingback_flag` to false and emptying `ping_sites`. That stops pingbacks
 *   and update services, but not trackbacks: `_trackbackme` is queued whenever `to_ping` holds
 *   URLs, whatever the options say. It also leaves `_encloseme` and the event. Emptying an option
 *   is a write to every environment's database as well.
 * - Removing `do_all_pings()` from `do_pings`. That leaves the queue writes in place and still
 *   sends from any direct call to `do_all_pings()`.
 *
 * A plugin or PHP caller that calls `pingback()`, `trackback()`, `weblog_ping()` or
 * `do_enclose()` directly is not stopped. Core itself makes no such call outside the senders
 * above. Incoming pings are a separate path: {@see Pings} closes every post to them.
 */
final class OutgoingPings {
	/**
	 * Core's callbacks on `do_all_pings`, each added at priority 10 in `default-filters.php`.
	 *
	 * @var string[]
	 */
	public const SENDERS = array( 'do_all_pingbacks', 'do_all_enclosures', 'do_all_trackbacks', 'generic_ping' );

	/**
	 * Removes the queueing hook and the senders.
	 */
	public function register(): void {
		remove_action( 'publish_post', '_publish_post_hook', 5 );

		foreach ( self::SENDERS as $sender ) {
			remove_action( 'do_all_pings', $sender );
		}
	}
}
