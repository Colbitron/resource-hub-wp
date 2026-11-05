<?php
/**
 * A resource or term slug never stores an escape the front end's router decodes (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

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
 *
 * One narrow difference from typing the decoded slug: core renames a post `…__trashed` when it is
 * trashed, and before checking uniqueness it also renames a trashed post that still holds the bare
 * slug (one trashed before WordPress 5.4, or edited in the trash), comparing with the slug as
 * typed. So `case%2dstudy`, when such a trashed resource holds `case-study`, becomes
 * `case-study-2`, where typing `case-study` would take the slug from it.
 */
final class SlugEscapes {
	/**
	 * The term slugs this applies to.
	 */
	public const TAXONOMIES = array( Taxonomies::TOPIC, Taxonomies::TYPE, Taxonomies::FLAG );

	/**
	 * Hooks the decoding.
	 */
	public function register(): void {
		add_filter( 'pre_wp_unique_post_slug', array( $this, 'unique_post_slug' ), 10, 6 );
		add_filter( 'wp_insert_post_data', array( $this, 'post_data' ), 10, 2 );
		// After core's own `sanitize_title`, hooked to `pre_term_slug` at 10.
		add_filter( 'pre_term_slug', array( $this, 'term_slug' ), 11, 2 );
	}

	/**
	 * Rule: decode each `%XX` whose character is in `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, in either hex
	 * case, once; leave every other escape as it is; then, if anything was decoded, sanitize the
	 * result with `sanitize_title()`. A slug with nothing to decode is returned unchanged.
	 *
	 * The input is a slug as `sanitize_title()` leaves it, where every `%` starts an escape. Then
	 * one pass is enough: an escape left encoded keeps its own two hex digits, so no decoded
	 * character can join a `%` to form a new escape, and `sanitize_title()` adds escapes only for
	 * bytes above 0x7F.
	 *
	 * @param string $slug A sanitized slug.
	 * @return string The slug with no such escape; '' if nothing is left once core sanitizes it.
	 */
	public static function decode( string $slug ): string {
		$decoded = preg_replace_callback(
			'/%([0-9A-Fa-f]{2})/',
			static function ( array $escape ): string {
				$char = chr( (int) hexdec( $escape[1] ) );

				return 1 === preg_match( "/^[A-Za-z0-9\\-_.!~*'()]$/", $char ) ? $char : $escape[0];
			},
			$slug
		);

		if ( null === $decoded || $decoded === $slug ) {
			return $slug;
		}

		return sanitize_title( $decoded );
	}

	/**
	 * Gives a resource whose slug has such an escape core's unique slug for the decoded form.
	 * Hooked to `pre_wp_unique_post_slug`, which core does not reach for `draft`, `pending` and
	 * `auto-draft`; post_data() covers those.
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

		return wp_unique_post_slug( $decoded, (int) $post_id, (string) $post_status, $post_type, (int) $post_parent );
	}

	/**
	 * Decodes a resource's slug that reaches the row with such an escape: one saved as `draft`,
	 * `pending` or `auto-draft`, for which core checks no uniqueness, or one an earlier
	 * `pre_wp_unique_post_slug` filter answered for. Hooked to `wp_insert_post_data`.
	 *
	 * @param array<string, mixed> $data    Slashed post data about to be written.
	 * @param array<string, mixed> $postarr Sanitized post data as given.
	 * @return array<string, mixed>
	 */
	public function post_data( $data, $postarr ) {
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
}
