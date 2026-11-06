<?php
/**
 * Configuration: constants first, options second, and what the status page can ask.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\Revalidation\Config;
use WP_UnitTestCase;

/**
 * Tests for {@see Config} (see `docs/architecture/revalidation.md`). The constants are undefined in the test run, so the option
 * fallback is what can be exercised; the constant branch is the same code with `defined()` true.
 */
final class ConfigTest extends WP_UnitTestCase {
	/**
	 * Unset, nothing is configured and every source is `none`.
	 */
	public function test_unset(): void {
		$this->assertFalse( defined( Config::FRONTEND_URL ), 'The test run must not define the constant.' );
		$this->assertSame( '', Config::frontend_url() );
		$this->assertSame( '', Config::secret() );
		$this->assertFalse( Config::is_configured() );
		$this->assertSame( 'none', Config::source_of( Config::FRONTEND_URL ) );
		$this->assertSame( 'none', Config::source_of( Config::REVALIDATE_SECRET ) );
		$this->assertFalse( Config::posthog_enabled() );
	}

	/**
	 * The options named after the constants in lower case supply the values. The URL is trimmed and
	 * loses its trailing slash; both are needed before anything is configured.
	 */
	public function test_options_fall_back(): void {
		update_option( 'resource_hub_frontend_url', ' https://hub.example/ ' );

		$this->assertSame( 'https://hub.example', Config::frontend_url() );
		$this->assertSame( 'option', Config::source_of( Config::FRONTEND_URL ) );
		$this->assertFalse( Config::is_configured() );

		update_option( 'resource_hub_revalidate_secret', 'abcdefghijklmnopqrstuvwxyz012345' );

		$this->assertSame( 'abcdefghijklmnopqrstuvwxyz012345', Config::secret() );
		$this->assertSame( 'option', Config::source_of( Config::REVALIDATE_SECRET ) );
		$this->assertTrue( Config::is_configured() );
	}

	/**
	 * The secret is not trimmed, because the front end does not trim its own: a stray newline is kept,
	 * so the rule refuses it and nothing is configured, rather than a value being sent that differs
	 * from the one an operator would copy to the front end.
	 */
	public function test_secret_is_not_trimmed(): void {
		update_option( 'resource_hub_frontend_url', 'https://hub.example' );
		update_option( 'resource_hub_revalidate_secret', " abcdefghijklmnopqrstuvwxyz012345\n" );

		$this->assertSame( " abcdefghijklmnopqrstuvwxyz012345\n", Config::secret() );
		$this->assertSame( 'option', Config::source_of( Config::REVALIDATE_SECRET ) );
		$this->assertFalse( Config::is_configured() );
	}

	/**
	 * The rule both sides share: 32 to 256 printable ASCII characters, 0x21 to 0x7E.
	 */
	public function test_is_valid_secret(): void {
		$this->assertTrue( Config::is_valid_secret( str_repeat( 'a', 32 ) ) );
		$this->assertTrue( Config::is_valid_secret( str_repeat( '~', 256 ) ) );
		$this->assertFalse( Config::is_valid_secret( '' ) );
		$this->assertFalse( Config::is_valid_secret( str_repeat( 'a', 31 ) ) );
		$this->assertFalse( Config::is_valid_secret( str_repeat( 'a', 257 ) ) );
		$this->assertFalse( Config::is_valid_secret( str_repeat( 'a', 32 ) . "\n" ) );
		$this->assertFalse( Config::is_valid_secret( str_repeat( 'a', 16 ) . ' ' . str_repeat( 'a', 16 ) ) );
		$this->assertFalse( Config::is_valid_secret( str_repeat( 'a', 31 ) . 'é' ) );
		$this->assertFalse( Config::is_valid_secret( str_repeat( 'a', 32 ) . "\x7F" ) );
	}

	/**
	 * A non-string option is treated as unset.
	 */
	public function test_non_string_option_is_unset(): void {
		update_option( 'resource_hub_frontend_url', array( 'not' => 'a string' ) );

		$this->assertSame( '', Config::frontend_url() );
		$this->assertSame( 'none', Config::source_of( Config::FRONTEND_URL ) );
	}
}
