<?php
/**
 * Where the revalidation settings come from.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * Reads the front-end URL, the revalidation secret and the optional PostHog settings.
 *
 * Each of the two revalidation values comes from a PHP constant when it is defined, falling back
 * to an option of the same name in lower case (ADR 0019). The PostHog values are constants only
 * (ADR 0032). None of them is ever committed; `wp-config.php` on the host and wp-env's `config`
 * define them. The secret never leaves this class except as the bearer header {@see Sender} sends.
 */
final class Config {
	/**
	 * Constant and, in lower case, option holding the front end's origin, such as `https://hub.example`.
	 */
	public const FRONTEND_URL = 'RESOURCE_HUB_FRONTEND_URL';

	/**
	 * Constant and, in lower case, option holding the bearer token the front end expects.
	 */
	public const REVALIDATE_SECRET = 'RESOURCE_HUB_REVALIDATE_SECRET';

	/**
	 * Constant holding the PostHog project API key. Optional.
	 */
	public const POSTHOG_KEY = 'RESOURCE_HUB_POSTHOG_KEY';

	/**
	 * Constant holding the PostHog host, such as `https://eu.i.posthog.com`. Optional.
	 */
	public const POSTHOG_HOST = 'RESOURCE_HUB_POSTHOG_HOST';

	/**
	 * Fewest characters a secret may have. The front end refuses a shorter `REVALIDATE_SECRET` too.
	 */
	public const SECRET_MIN_LENGTH = 32;

	/**
	 * Most characters a secret may have: room for any generated token, and a bound on the header.
	 */
	public const SECRET_MAX_LENGTH = 256;

	/**
	 * The front end's origin with no trailing slash, or an empty string when it is not set.
	 */
	public static function frontend_url(): string {
		return untrailingslashit( self::constant_or_option( self::FRONTEND_URL ) );
	}

	/**
	 * The revalidation secret exactly as its source holds it, or an empty string when it is not set.
	 * Unlike the other values it is not trimmed: the front end does not trim `REVALIDATE_SECRET`, so
	 * the value checked by {@see Config::is_valid_secret()} must be the value sent.
	 */
	public static function secret(): string {
		return self::constant_or_option( self::REVALIDATE_SECRET );
	}

	/**
	 * Whether a secret meets the rule both sides share: {@see Config::SECRET_MIN_LENGTH} to
	 * {@see Config::SECRET_MAX_LENGTH} printable ASCII characters (0x21 to 0x7E), so no whitespace,
	 * no control characters and nothing outside ASCII. A secret with a trailing newline or a space
	 * could never match the bearer token the front end expects.
	 *
	 * @param string $secret The secret to check.
	 */
	public static function is_valid_secret( string $secret ): bool {
		return 1 === preg_match( '/\A[\x21-\x7E]{' . self::SECRET_MIN_LENGTH . ',' . self::SECRET_MAX_LENGTH . '}\z/', $secret );
	}

	/**
	 * Whether both values a send needs are set, and the secret is valid. When this is false nothing
	 * is sent and the result is recorded as not configured; the status page says which value is at
	 * fault.
	 */
	public static function is_configured(): bool {
		return '' !== self::frontend_url() && self::is_valid_secret( self::secret() );
	}

	/**
	 * The PostHog project key, or an empty string when PostHog is off.
	 */
	public static function posthog_key(): string {
		return self::constant( self::POSTHOG_KEY );
	}

	/**
	 * The PostHog host with no trailing slash, or an empty string when PostHog is off.
	 */
	public static function posthog_host(): string {
		return untrailingslashit( self::constant( self::POSTHOG_HOST ) );
	}

	/**
	 * Whether PostHog logging is on: both constants are defined and non-empty.
	 */
	public static function posthog_enabled(): bool {
		return '' !== self::posthog_key() && '' !== self::posthog_host();
	}

	/**
	 * Which source supplies a revalidation value: `constant`, `option`, or `none`. For the status page,
	 * which shows the source without showing the value (ADR 0019).
	 *
	 * @param string $name One of {@see Config::FRONTEND_URL} or {@see Config::REVALIDATE_SECRET}.
	 */
	public static function source_of( string $name ): string {
		if ( '' !== self::constant( $name ) ) {
			return 'constant';
		}

		if ( '' !== self::option( $name ) ) {
			return 'option';
		}

		return 'none';
	}

	/**
	 * The constant's value when it is defined and non-empty, otherwise the option's.
	 *
	 * @param string $name Constant name.
	 */
	private static function constant_or_option( string $name ): string {
		$value = self::constant( $name );

		return '' !== $value ? $value : self::option( $name );
	}

	/**
	 * A constant's value as a string, trimmed except for the secret, or an empty string when it is
	 * undefined or not a string.
	 *
	 * @param string $name Constant name.
	 */
	private static function constant( string $name ): string {
		if ( ! defined( $name ) ) {
			return '';
		}

		return self::clean( $name, constant( $name ) );
	}

	/**
	 * An option's value as a string, trimmed except for the secret, or an empty string when it is
	 * unset or not a string. The option name is the constant's name in lower case, so there is one
	 * name to remember.
	 *
	 * @param string $name Constant name.
	 */
	private static function option( string $name ): string {
		return self::clean( $name, get_option( strtolower( $name ), '' ) );
	}

	/**
	 * A raw value as a string: trimmed, except the secret, which is kept exactly as given so that a
	 * stray space or newline is refused by {@see Config::is_valid_secret()} rather than hidden.
	 *
	 * @param string $name  Constant name.
	 * @param mixed  $value The constant's or option's value.
	 */
	private static function clean( string $name, $value ): string {
		if ( ! is_string( $value ) ) {
			return '';
		}

		return self::REVALIDATE_SECRET === $name ? $value : trim( $value );
	}
}
