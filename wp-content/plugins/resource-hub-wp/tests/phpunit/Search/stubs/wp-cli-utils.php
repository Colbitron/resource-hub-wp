<?php
/**
 * `WP_CLI\Utils\get_flag_value()`, for PHPUnit, where WP-CLI is never loaded: a flag's value as
 * the real one reads it for the flags the plugin's commands take.
 *
 * @package ResourceHub
 */

// phpcs:disable WordPress.NamingConventions.PrefixAllGlobals -- WP-CLI's own function, stubbed for tests.

namespace WP_CLI\Utils;

if ( ! function_exists( __NAMESPACE__ . '\\get_flag_value' ) ) {
	/**
	 * A flag's value, or the fallback when it was not given.
	 *
	 * @param array<string, mixed> $assoc_args The named arguments.
	 * @param string               $flag       The flag.
	 * @param mixed                $fallback   The value when the flag is absent.
	 * @return mixed
	 */
	function get_flag_value( $assoc_args, $flag, $fallback = null ) {
		return $assoc_args[ $flag ] ?? $fallback;
	}
}
