<?php
/**
 * The sanitize and auth rules for the `resource` meta fields.
 *
 * This file is a critical path: it is read line by line before merge. Keep each method small
 * and its docblock a plain statement of the rule it enforces.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

/**
 * Sanitizers and the auth callback for `summary`, `source_url` and `related_picks`.
 */
final class MetaRules {
	/**
	 * Longest `summary`, in characters (Unicode code points). The REST schema rejects longer
	 * input with a 400, the sanitizer cuts longer values from other write paths, and the editor
	 * panel shows the limit.
	 */
	public const SUMMARY_MAX_LENGTH = 300;

	/**
	 * Most `related_picks` a resource stores, and the most items the related route returns. The
	 * REST schema rejects a longer list with a 400, and the sanitizer cuts longer lists from other
	 * write paths.
	 */
	public const RELATED_PICKS_MAX = 10;

	/**
	 * Rule: `summary` is stored as plain text: markup is removed, entities are decoded, and nothing
	 * is HTML-escaped, so whoever displays it escapes it like any other text. Because entities are
	 * decoded, text typed as `&lt;script&gt;` is stored as the characters `<script>`; that is text,
	 * not markup, and output escaping shows it literally. The rule is not idempotent: sanitising a
	 * stored value again treats those characters as a tag and removes them.
	 *
	 * In order:
	 * - A non-scalar becomes an empty string. A scalar is cast to a string (`true` is "1").
	 * - Invalid UTF-8 empties the whole value. (Core checks only when the site charset is UTF-8,
	 *   which is the default.)
	 * - A `<` with no `>` after it before the next `<` is not a tag, and it is kept: `1<2` and
	 *   `Under <5 minutes` are stored as typed. Core's `wp_pre_kses_less_than()` escapes it so
	 *   the next step leaves it alone, and the decoding step after that undoes the escaping.
	 * - Everything else `wp_strip_all_tags()` treats as a tag is removed, and so are the
	 *   contents of `script` and `style` elements. `x<y and y>z` is stored as `xz`.
	 * - Core's `wp_specialchars_decode()` then turns the entities it knows (`&amp;`, `&lt;`, `&gt;`,
	 *   `&quot;`, `&#039;`, and decimal forms such as `&#34;` and `&#60;`) into characters, once,
	 *   including entities that were typed: `1 &lt; 2` is stored as `1 < 2`, and `&lt;b&gt;` as
	 *   the text `<b>`, which a later save removes as a tag. Other entities are left as typed:
	 *   `&copy;`, `&nbsp;`, `&apos;`, and hex forms such as `&#x3C;`.
	 * - Line endings become `\n`, tabs are kept, and leading and trailing whitespace is trimmed.
	 * - The result is cut to SUMMARY_MAX_LENGTH characters, so a stored value never exceeds the
	 *   schema's `maxLength`. That matters because core checks stored meta against the schema
	 *   when it reads it back and serves a longer value as `null`. Over REST, longer input never
	 *   gets this far: the schema rejects it.
	 *
	 * Two simpler rules were rejected. `wp_strip_all_tags()` alone deletes everything from a lone
	 * `<` to the next `>` or the end, so `Under <5 minutes` would be stored as `Under`. Core's
	 * `sanitize_textarea_field()` stores a lone `<` as `&lt;`, so the value is not plain text,
	 * and 300 `<` either grow to 1,200 characters (cut first; served as `null`) or shrink to 75
	 * `&lt;` (cut last, which can also split an entity).
	 *
	 * @param mixed $value Raw value.
	 */
	public static function sanitize_summary( mixed $value ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}

		$text = wp_check_invalid_utf8( (string) $value );
		$text = wp_strip_all_tags( wp_pre_kses_less_than( $text ), false );
		$text = wp_specialchars_decode( $text, ENT_QUOTES );
		$text = trim( str_replace( array( "\r\n", "\r" ), "\n", $text ) );

		return mb_substr( $text, 0, self::SUMMARY_MAX_LENGTH );
	}

	/**
	 * Rule: `source_url` is empty, or an absolute http or https URL with a host.
	 *
	 * In order:
	 * - A non-scalar becomes an empty string. A scalar is cast to a string and trimmed.
	 * - Unless the result starts with `http://` or `https://` (in any letter case) it becomes
	 *   empty. So do other schemes (javascript, ftp, mailto, data), bare hosts (`example.com`),
	 *   relative paths with or without a leading slash, protocol-relative `//host` URLs, forms
	 *   without the two slashes (`http:example.com`, `https:\\evil.com`), and the string forms
	 *   of numbers and booleans.
	 * - Core's `esc_url_raw()` cleans the rest: the scheme is lowercased, spaces become `%20`,
	 *   characters a URL cannot hold (newlines, tabs, `<`, `>`, `"`, backslash, and others) are
	 *   deleted, and so are percent-encoded line breaks (`%0a`, `%0d`).
	 * - Credentials (`user:password@` or `user@`, meaning everything from `://` to the last `@`
	 *   before the path, query, or fragment) are removed, because the stored value is public
	 *   over REST and on the front end. `https://user:pass@example.com/x` is stored as
	 *   `https://example.com/x`. This runs after the cleaning above, so in
	 *   `https://evil.example\@good.example/` the backslash is gone first and the result is
	 *   `https://good.example/`.
	 * - Unless what is left has a non-empty host, it becomes empty (`http://`, `http:///path`).
	 *   The host is not checked further: it need not resolve or be a valid domain name.
	 * - There is no length cap beyond what the `meta_value` column (LONGTEXT) holds.
	 *
	 * @param mixed $value Raw value.
	 */
	public static function sanitize_source_url( mixed $value ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}

		$raw = trim( (string) $value );

		if ( 1 !== preg_match( '#^https?://#i', $raw ) ) {
			return '';
		}

		$url  = esc_url_raw( $raw, array( 'http', 'https' ) );
		$url  = (string) preg_replace( '#^(https?://)[^/?\#]*@#i', '$1', $url );
		$host = wp_parse_url( $url, PHP_URL_HOST );

		return is_string( $host ) && '' !== $host ? $url : '';
	}

	/**
	 * Rule: `related_picks` is an ordered list of at most RELATED_PICKS_MAX distinct post IDs, none of
	 * them the resource's own. The IDs are not checked against the posts table: a pick that is not a
	 * published resource is kept and skipped when the related route reads the list, so an editor's
	 * choice survives the pick being unpublished and republished.
	 *
	 * In order:
	 * - Anything but an array becomes an empty list: a lone ID, a string, a number, null.
	 * - An item is kept, as an int, when it is an int greater than zero or a string of ASCII digits
	 *   whose value is greater than zero and at most PHP_INT_MAX (`'7'` and `'007'` are kept as 7).
	 *   Everything else is dropped, silently: zero, negatives, every float (`5.0` as well as `1.5`),
	 *   `true`, null, nested arrays, strings with anything but digits (`'7 '`, `'1e3'`, `'-1'`,
	 *   `'abc'`), and digit strings past PHP_INT_MAX, which a cast would turn into PHP_INT_MAX.
	 * - Over REST, the schema runs first. It rejects with a 400 what is not an integer (`1.5`,
	 *   `'abc'`) and what is below 1, but it counts the numeric string `'5'` and the integral float
	 *   `5.0` as integers, and core then casts both to the int 5 before this sanitizer sees them, so
	 *   both are stored as 5. Only PHP callers (`update_post_meta()` and the like) reach this rule
	 *   with a float, and `5.0` from them is dropped: floats are not IDs, and accepting the integral
	 *   ones would add a third kind of input to a rule that is read line by line.
	 * - Keys are dropped, so the stored value is a list in the order given.
	 * - A repeated ID keeps its first position and loses the later ones.
	 * - The list is cut to the first RELATED_PICKS_MAX items, so a stored value never exceeds the
	 *   schema's `maxItems`. That matters because core checks stored meta against the schema when it
	 *   reads it back and serves a longer value as `null`.
	 * - The resource's own ID is dropped, by {@see MetaRules::without_self()} from the
	 *   `add_post_metadata` and `update_post_metadata` filters that {@see Meta} hooks, because core's
	 *   sanitize callback is not told which post the value is for. Those filters run after this
	 *   sanitizer, so a list of RELATED_PICKS_MAX that includes the resource stores one fewer.
	 *
	 * @param mixed $value Raw value.
	 * @return int[]
	 */
	public static function sanitize_related_picks( mixed $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$picks = array();

		foreach ( $value as $item ) {
			if ( is_string( $item ) && ctype_digit( $item ) ) {
				// A cast turns digits past PHP_INT_MAX into PHP_INT_MAX. Casting back shows whether the
				// value fit: if not, null drops it below. Leading zeros are not part of the value.
				$item = ltrim( $item, '0' ) === (string) (int) $item ? (int) $item : null;
			}

			if ( ! is_int( $item ) || $item <= 0 || in_array( $item, $picks, true ) ) {
				continue;
			}

			$picks[] = $item;
		}

		return array_slice( $picks, 0, self::RELATED_PICKS_MAX );
	}

	/**
	 * Rule: a resource is never its own pick. The clause of {@see MetaRules::sanitize_related_picks()}
	 * that needs the post ID.
	 *
	 * @param int[] $picks A sanitized list.
	 * @param int   $post_id The resource the list belongs to.
	 * @return int[] The list without `$post_id`, reindexed.
	 */
	public static function without_self( array $picks, int $post_id ): array {
		return array_values( array_filter( $picks, static fn( int $pick ): bool => $pick !== $post_id ) );
	}

	/**
	 * Rule: a user may write any of the fields exactly when they may edit the post it belongs to.
	 *
	 * Core already requires `edit_post` before it asks this callback (it maps `edit_post_meta`
	 * to `edit_post`), so this repeats that check. It is explicit by design, so the rule is
	 * stated in one place and does not depend on core's mapping.
	 *
	 * Core passes six arguments to `register_meta()`'s `auth_callback`: `$allowed`, `$meta_key`,
	 * `$object_id` (the post), `$user_id`, `$cap` (such as `edit_post_meta`), and `$caps` (the
	 * primitive capabilities core already requires). Only the post and the user matter. The last
	 * two are not declared, because PHP passes extra arguments to a callback without complaint and
	 * the coding standards reject a declared parameter that is never used.
	 *
	 * @param mixed  $allowed  Whether an earlier callback allowed it; any type, even null. Ignored.
	 * @param string $meta_key Meta key being checked. Ignored; the rule is the same for every field.
	 * @param int    $post_id  Post the meta belongs to.
	 * @param int    $user_id  User performing the action.
	 */
	public static function can_edit_post( mixed $allowed, string $meta_key, int $post_id, int $user_id ): bool {
		return user_can( $user_id, 'edit_post', $post_id );
	}
}
