<?php
/**
 * A locked-out request stays a 404: nothing redirects it (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Lockdown;

/**
 * Switches off every redirect core would send from a 404, for the rest of the request.
 *
 * Registered by {@see Gate} only once a request has been made a 404, so these hooks are scoped to
 * that request and never touch a logged-in user or the login flow. Core treats a 404 as a reason
 * to look for somewhere to send the visitor; each of those paths is closed:
 *
 * - `redirect_canonical()` guesses a permalink for a 404 (`redirect_guess_404_permalink()`), sends
 *   `?p=`, `?page_id=` and `?attachment_id=` to their pretty URLs, and fixes trailing slashes and
 *   the host. Its `redirect_canonical` filter, applied to the URL it settled on, aborts it when
 *   given false.
 * - `wp_old_slug_redirect()` sends an old slug, or an old date path, to the post's current URL.
 *   The `old_slug_redirect_post_id` filter at 0 means "no such post".
 * - `wp_redirect_admin_locations()` sends `/admin`, `/dashboard` and `/login` to wp-admin and
 *   wp-login.php when the path is a 404. It has no filter, so it is unhooked.
 * - `wp_redirect()` itself is the last resort: with its `wp_redirect` filter returning false it
 *   sends no `Location` header, so nothing else on the site, a plugin on the host included, can
 *   redirect the visitor either. The status stays the 404 the gate set.
 */
final class NoRedirects {
	/**
	 * Closes every redirect path for the current request.
	 */
	public function register(): void {
		add_filter( 'redirect_canonical', '__return_false' );
		add_filter( 'old_slug_redirect_post_id', '__return_zero' );
		remove_action( 'template_redirect', 'wp_redirect_admin_locations', 1000 );
		add_filter( 'wp_redirect', '__return_false' );
	}
}
