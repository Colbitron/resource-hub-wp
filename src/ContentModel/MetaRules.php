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
 * Sanitizers and the auth callback for `summary` and `source_url`.
 */
final class MetaRules {
	/**
	 * Longest `summary` stored, in characters. The REST schema enforces the same number
	 * on the way in, and the editor panel shows it.
	 */
	public const SUMMARY_MAX_LENGTH = 300;

	/**
	 * Rule: `summary` is plain text. Tags are stripped, line breaks are kept, and the result is
	 * cut at SUMMARY_MAX_LENGTH characters. Anything that is not a scalar becomes an empty string.
	 *
	 * @param mixed $value Raw value.
	 */
	public static function sanitize_summary( mixed $value ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}

		$text = sanitize_textarea_field( (string) $value );

		return mb_substr( $text, 0, self::SUMMARY_MAX_LENGTH );
	}

	/**
	 * Rule: `source_url` is an absolute http or https URL or it is nothing. Every other scheme
	 * (javascript, ftp, mailto, data), relative paths, and non-scalars become an empty string.
	 *
	 * @param mixed $value Raw value.
	 */
	public static function sanitize_source_url( mixed $value ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}

		$url    = esc_url_raw( trim( (string) $value ), array( 'http', 'https' ) );
		$scheme = wp_parse_url( $url, PHP_URL_SCHEME );

		return in_array( $scheme, array( 'http', 'https' ), true ) ? $url : '';
	}

	/**
	 * Rule: a user may write either field exactly when they may edit the post it belongs to.
	 *
	 * Signature follows `register_meta()`'s `auth_callback`; only the post and user matter here.
	 *
	 * @param bool   $allowed  Whether the user can add the meta. Ignored; the post capability decides.
	 * @param string $meta_key Meta key being checked.
	 * @param int    $post_id  Post the meta belongs to.
	 * @param int    $user_id  User performing the action.
	 */
	public static function can_edit_post( bool $allowed, string $meta_key, int $post_id, int $user_id ): bool {
		return user_can( $user_id, 'edit_post', $post_id );
	}
}
