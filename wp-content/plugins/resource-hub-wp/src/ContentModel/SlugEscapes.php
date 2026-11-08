<?php
/**
 * A resource or term slug never stores an escape the front end's router decodes (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use ResourceHub\Rest\RouteMatch;
use WP_Error;
use WP_REST_Request;
use WP_REST_Terms_Controller;

/**
 * Decodes, on save, the percent escapes of the characters `encodeURIComponent()` leaves
 * unescaped, `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, in `resource` post slugs and in `resource_topic`,
 * `resource_type` and `resource_flag` term slugs.
 *
 * `sanitize_title()` keeps every well-formed escape an editor types, so `case%2dstudy` would be
 * stored as it is. Next.js decodes escapes of that set in route params, so the page for such a
 * slug would receive `case-study`, which is not its slug: it could not be reached at its own URL.
 * Every other escape (`%e6%97%a5`, `%20`, `%2f`, `%25` and the rest) is left encoded. The decoded
 * slug then goes through `sanitize_title()` again, so core decides what `.`, `~`, `!`, `'` and the
 * other decoded characters become, and core's uniqueness check runs on the result.
 *
 * Where each save path is caught, before core checks the slug is unique:
 * - posts, published or any status core checks: `pre_wp_unique_post_slug`, at the start of
 *   `wp_unique_post_slug()`, which every `wp_insert_post()` and `wp_update_post()` call reaches
 *   (REST, the block editor, the classic form, Quick Edit, Bulk Edit, WP-CLI, PHP); it answers with
 *   core's own uniqueness check run on the decoded slug;
 * - posts as `draft`, `pending` or `auto-draft`, for which core checks no uniqueness:
 *   `wp_insert_post_data`, the last point before core writes the row;
 * - a term slug that is given (REST, the Topics and Types screens' add and edit forms, Quick
 *   Edit, WP-CLI, PHP) and the stored slug an edit carries over: `pre_term_slug`, inside
 *   `sanitize_term()`, before `wp_insert_term()` and `wp_update_term()` check for a duplicate or
 *   make the slug unique;
 * - a term slug generated from the name needs nothing: core runs `sanitize_text_field()` on a
 *   term's name on save (`pre_term_name`), which strips every percent escape from it.
 * A slug already stored with such an escape is decoded the next time its post or term is saved.
 * A cron publish of a scheduled resource (`wp_publish_post()`) writes only the status and reaches
 * none of these hooks, so `wp resource-hub decode-slugs` repairs whatever is left.
 *
 * Core renames a post `…__trashed` when it is trashed, and before checking uniqueness it also
 * renames any trashed post that still holds the bare slug (one trashed before WordPress 5.4, or
 * edited in the trash), comparing with the slug as typed. unique_post_slug() does the same with
 * the decoded slug, so `case%2dstudy` takes `case-study` from such a trashed resource exactly as
 * typing `case-study` would. It does so only inside `wp_insert_post()`, as core does: the
 * editor's permalink preview reaches the same filter and must not change data.
 *
 * A legacy term whose decoded slug another term in its taxonomy already has cannot be saved, not
 * even by an edit that leaves the slug alone: core's `wp_update_term()` refuses with
 * `duplicate_term_slug`, and the editor must type a new slug. That error has no HTTP status, so
 * over REST it would be a 500; for the three taxonomies here it is given a 400.
 */
final class SlugEscapes {
	/**
	 * The term slugs this applies to.
	 */
	public const TAXONOMIES = array( Taxonomies::TOPIC, Taxonomies::TYPE, Taxonomies::FLAG );

	/**
	 * The IDs of the resources `wp_insert_post()` is saving, 0 for a new one, innermost save last:
	 * each pushed by mark_save() and popped by post_data(), so a save nested inside another leaves
	 * the outer one's mark in place. Empty outside a save. Only a save renames a trashed post.
	 *
	 * @var int[]
	 */
	private array $saving = array();

	/**
	 * Hooks the decoding.
	 */
	public function register(): void {
		add_filter( 'wp_insert_post_parent', array( $this, 'mark_save' ), 10, 4 );
		add_filter( 'pre_wp_unique_post_slug', array( $this, 'unique_post_slug' ), 10, 6 );
		add_filter( 'wp_insert_post_data', array( $this, 'post_data' ), 10, 2 );
		// After core's own `sanitize_title`, hooked to `pre_term_slug` at 10.
		add_filter( 'pre_term_slug', array( $this, 'term_slug' ), 11, 2 );
		add_filter( 'rest_request_after_callbacks', array( $this, 'duplicate_term_slug_status' ), 10, 3 );
	}

	/**
	 * Rule: decode each `%XX` whose character is in `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, in either hex
	 * case; leave every other escape as it is; sanitize the result with `sanitize_title()`; and
	 * repeat until no such escape is left. A slug with nothing to decode is returned unchanged.
	 *
	 * One pass is not enough, because `sanitize_title()` can create an escape. It protects each
	 * escape as `---XX---`, strips stray `%`, and turns every `---XX---` back into `%XX`, so dashes
	 * decoded from `%2d`, two literal hex digits and the protected form of a kept escape can make a
	 * new one: `%2d%2d%2d41%20` decodes to `---41%20`, which core sanitizes to `%4120`. The next
	 * pass decodes that `%41`.
	 *
	 * @param string $slug A sanitized slug.
	 * @return string The slug with no such escape; '' if nothing is left once core sanitizes it,
	 *                or if the pass cap below is reached.
	 */
	public static function decode( string $slug ): string {
		// Each pass strictly shortens the slug, so the loop ends. Decoding turns at least one
		// three-byte escape into one byte. `sanitize_title()` never lengthens a string of ASCII
		// characters and escapes: it adds five bytes for each escape it protects and removes five
		// for each `---XX---` it restores, and a protected escape it does not restore has lost its
		// leading dashes to a restore that ends there, so it restores at least as many as it
		// protects; every other step removes or replaces bytes. The cap is that bound, kept as a
		// guard against a `sanitize_title` filter that lengthens slugs.
		$passes_left = intdiv( strlen( $slug ), 2 ) + 1;

		while ( self::has_router_escape( $slug ) ) {
			if ( 0 === $passes_left-- ) {
				return '';
			}

			$slug = sanitize_title( self::decode_once( $slug ) );
		}

		return $slug;
	}

	/**
	 * One decoding pass: each escape of a character in the set replaced by the character, every
	 * other escape kept. '' if the pattern fails, so no escape survives a failure.
	 *
	 * @param string $slug A sanitized slug.
	 */
	private static function decode_once( string $slug ): string {
		$decoded = preg_replace_callback(
			'/%([0-9A-Fa-f]{2})/',
			static function ( array $escape ): string {
				$char = self::escaped_char( $escape[1] );

				return self::router_decodes( $char ) ? $char : $escape[0];
			},
			$slug
		);

		return $decoded ?? '';
	}

	/**
	 * Whether a slug holds an escape of a character in `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, in either
	 * hex case: one the front end's router would decode.
	 *
	 * @param string $slug A slug.
	 */
	public static function has_router_escape( string $slug ): bool {
		if ( false === preg_match_all( '/%([0-9A-Fa-f]{2})/', $slug, $matches ) ) {
			return false;
		}

		foreach ( $matches[1] as $hex ) {
			if ( self::router_decodes( self::escaped_char( $hex ) ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * A slug read from the database, in the form a save would store it now. A slug with no escape
	 * of that set is returned exactly as stored. One with such an escape, stored before this rule
	 * or written by a path that skips the save hooks, goes through what a save does:
	 * `sanitize_title()`, then decode(). For readers of stored slugs that must never pass such an
	 * escape on, such as the revalidation payload.
	 *
	 * @param string $slug A stored slug.
	 * @return string The slug with no such escape; '' if nothing is left once core sanitizes it.
	 */
	public static function decode_stored( string $slug ): string {
		if ( ! self::has_router_escape( $slug ) ) {
			return $slug;
		}

		return self::decode( sanitize_title( $slug ) );
	}

	/**
	 * The character two hex digits name.
	 *
	 * @param string $hex Two hex digits.
	 */
	private static function escaped_char( string $hex ): string {
		return chr( (int) hexdec( $hex ) );
	}

	/**
	 * Whether the router decodes an escape of this character: `encodeURIComponent()` leaves it unescaped.
	 *
	 * @param string $char One byte.
	 */
	private static function router_decodes( string $char ): bool {
		return 1 === preg_match( "/^[A-Za-z0-9\\-_.!~*'()]$/", $char );
	}

	/**
	 * Marks the start of a `wp_insert_post()` save of a resource that will go ahead, so that
	 * unique_post_slug() renames a trashed post only within it. Hooked to `wp_insert_post_parent`,
	 * which only `wp_insert_post()` applies. In core 7.1.4 it comes after every early return of the
	 * save (empty content, an invalid date), before its `wp_unique_post_slug()` call, and with no
	 * return between it and `wp_insert_post_data`, where post_data() pops the mark; so no stopped
	 * save leaves a mark behind. Both hooks are given the same `$postarr`, so the mark is pushed and
	 * popped for the same saves. A save nested inside, started by a filter between the two hooks,
	 * pushes and pops its own mark.
	 *
	 * @param mixed                $post_parent Post parent ID, returned as given.
	 * @param mixed                $post_id     Post ID, 0 for a new post.
	 * @param array<string, mixed> $new_postarr Parsed post data. Unused.
	 * @param array<string, mixed> $postarr     Sanitized post data as given, defaults filled in.
	 * @return mixed The parent as given.
	 */
	public function mark_save( $post_parent, $post_id, $new_postarr, $postarr ) {
		if ( self::is_resource_save( $postarr ) ) {
			$this->saving[] = (int) $post_id;
		}

		return $post_parent;
	}

	/**
	 * Whether the post data `wp_insert_post()` gives its filters as `$postarr` is a resource's.
	 *
	 * @param mixed $postarr Sanitized post data as given.
	 */
	private static function is_resource_save( $postarr ): bool {
		return is_array( $postarr ) && PostType::NAME === ( $postarr['post_type'] ?? '' );
	}

	/**
	 * Gives a resource whose slug has such an escape core's unique slug for the decoded form.
	 * Hooked to `pre_wp_unique_post_slug`, which core does not reach for `draft`, `pending` and
	 * `auto-draft`; post_data() covers those.
	 *
	 * Before that, inside a save of this post that is not a trashing, it renames any trashed post
	 * holding the bare decoded slug, as `wp_insert_post()` does for the slug as typed and through
	 * the same core function and filter, so the decoded slug is freed exactly as a typed one is.
	 * Core's other caller of `wp_unique_post_slug()`, `get_sample_permalink()` (the classic
	 * editor's permalink preview), also reaches this for a resource whose stored slug still has
	 * such an escape; outside a save it renames nothing, so opening the screen changes no data, and
	 * the preview may show a `-2` suffix that the save itself then avoids by renaming.
	 *
	 * @param string|null $override    Null, or an earlier filter's slug, which is kept.
	 * @param string      $slug        Sanitized slug.
	 * @param int         $post_id     Post ID.
	 * @param string      $post_status Post status.
	 * @param string      $post_type   Post type.
	 * @param int         $post_parent Parent post ID.
	 * @return string|null Null to let core check the slug as it is, else the slug to use.
	 */
	public function unique_post_slug( $override, $slug, $post_id, $post_status, $post_type, $post_parent ) {
		if ( null !== $override || PostType::NAME !== $post_type || ! is_string( $slug ) ) {
			return $override;
		}

		$decoded = self::decode( $slug );

		if ( $decoded === $slug ) {
			return null;
		}

		// An empty slug is left to core, which then uses the title or the post ID.
		if ( '' === $decoded ) {
			return '';
		}

		$in_save = array() !== $this->saving && end( $this->saving ) === (int) $post_id;

		// Core's own filter, applied as `wp_insert_post()` applies it, so a site that turns the rename off for typed slugs turns it off here too.
		if ( $in_save && 'trash' !== $post_status && apply_filters( 'add_trashed_suffix_to_trashed_posts', true, $decoded, (int) $post_id ) ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- core's hook, not ours.
			wp_add_trashed_suffix_to_post_name_for_trashed_posts( $decoded, (int) $post_id );
		}

		return wp_unique_post_slug( $decoded, (int) $post_id, (string) $post_status, $post_type, (int) $post_parent );
	}

	/**
	 * Decodes a resource's slug that reaches the row with such an escape: one saved as `draft`,
	 * `pending` or `auto-draft`, for which core checks no uniqueness, or one an earlier
	 * `pre_wp_unique_post_slug` filter answered for. Hooked to `wp_insert_post_data`, where it also
	 * pops the mark mark_save() pushed for this save.
	 *
	 * @param array<string, mixed> $data    Slashed post data about to be written.
	 * @param array<string, mixed> $postarr Sanitized post data as given.
	 * @return array<string, mixed>
	 */
	public function post_data( $data, $postarr ) {
		if ( self::is_resource_save( $postarr ) ) {
			array_pop( $this->saving );
		}

		if ( ! isset( $data['post_type'], $data['post_name'] ) || PostType::NAME !== $data['post_type'] ) {
			return $data;
		}

		$slug    = (string) $data['post_name'];
		$decoded = self::decode( $slug );

		if ( $decoded === $slug ) {
			return $data;
		}

		// For `draft`, `pending` and `auto-draft` this returns the decoded slug as it is; for any other status it makes it unique.
		$data['post_name'] = '' === $decoded ? '' : wp_unique_post_slug(
			$decoded,
			(int) ( $postarr['ID'] ?? 0 ),
			(string) $data['post_status'],
			PostType::NAME,
			(int) $data['post_parent']
		);

		return $data;
	}

	/**
	 * Decodes a term slug that is given, or carried over from the stored term by an edit, before
	 * core checks it for duplicates. An empty result makes core generate the slug from the name,
	 * as it does for any slug that sanitizes to nothing. Hooked to `pre_term_slug`.
	 *
	 * @param mixed  $slug     Slug, sanitized by core.
	 * @param string $taxonomy Taxonomy slug.
	 * @return mixed
	 */
	public function term_slug( $slug, $taxonomy ) {
		if ( ! is_string( $slug ) || ! in_array( $taxonomy, self::TAXONOMIES, true ) ) {
			return $slug;
		}

		return self::decode( $slug );
	}

	/**
	 * Gives core's `duplicate_term_slug` error a 400 when a REST edit of a term in one of the three
	 * taxonomies returns it without a status, as the terms controller does when `wp_update_term()`
	 * refuses a slug another term has. The editor must type a new slug; a 500 would say the server
	 * failed. Hooked to `rest_request_after_callbacks`.
	 *
	 * That hook is given the handler but not the route pattern core matched, so the request is an
	 * edit of one of the three taxonomies' terms when both hold: the handler's callback is a terms
	 * controller's `update_item`, and the request's path matches the single-term pattern one of
	 * their terms controllers registers ({@see RouteMatch::term_item()}) with core's own match,
	 * without regard to case. `/WP/v2/Resource_Topic/{id}` and `?rest_route=/WP/v2/…` reach that
	 * handler and get the 400; another plugin's handler on a pattern that also matches the path
	 * keeps its own answer.
	 *
	 * @param mixed           $response The route's result: a response, or an error.
	 * @param mixed           $handler  The route handler core matched.
	 * @param WP_REST_Request $request  The request.
	 * @return mixed The result, with the status added when it applies.
	 */
	public function duplicate_term_slug_status( $response, $handler, $request ) {
		if ( ! $response instanceof WP_Error || 'duplicate_term_slug' !== $response->get_error_code() || ! $request instanceof WP_REST_Request ) {
			return $response;
		}

		if ( ! RouteMatch::is_handler( $handler, WP_REST_Terms_Controller::class, 'update_item' ) || ! self::any_term_route( $request->get_route() ) ) {
			return $response;
		}

		$data = $response->get_error_data();

		if ( is_array( $data ) && isset( $data['status'] ) ) {
			return $response;
		}

		$response->add_data( array_merge( is_array( $data ) ? $data : array(), array( 'status' => 400 ) ) );

		return $response;
	}

	/**
	 * Whether a requested path matches the single-term route of any of the three taxonomies.
	 *
	 * @param string $path The requested route, `WP_REST_Request::get_route()`.
	 */
	private static function any_term_route( string $path ): bool {
		foreach ( self::TAXONOMIES as $taxonomy ) {
			if ( null !== RouteMatch::params( RouteMatch::term_item( $taxonomy ), $path ) ) {
				return true;
			}
		}

		return false;
	}
}
