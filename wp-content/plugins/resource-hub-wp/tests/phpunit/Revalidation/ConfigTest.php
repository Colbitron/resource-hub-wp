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
 * Tests for {@see Config} (ADR 0019). The constants are undefined in the test run, so the option
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
	 * The options named after the constants in lower case supply the values, trimmed, with the URL's
	 * trailing slash removed; both are needed before anything is configured.
	 */
	public function test_options_fall_back(): void {
		update_option( 'resource_hub_frontend_url', ' https://hub.example/ ' );

		$this->assertSame( 'https://hub.example', Config::frontend_url() );
		$this->assertSame( 'option', Config::source_of( Config::FRONTEND_URL ) );
		$this->assertFalse( Config::is_configured() );

		update_option( 'resource_hub_revalidate_secret', " secret\n" );

		$this->assertSame( 'secret', Config::secret() );
		$this->assertSame( 'option', Config::source_of( Config::REVALIDATE_SECRET ) );
		$this->assertTrue( Config::is_configured() );
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
