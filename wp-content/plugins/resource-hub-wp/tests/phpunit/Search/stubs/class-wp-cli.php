<?php
/**
 * The few `WP_CLI` calls the plugin's commands make, for PHPUnit, where WP-CLI is never loaded.
 *
 * `success()`, `log()` and `warning()` record a line; `error()` records one and throws, as the
 * real one exits. Required by the command tests, and defined only when WP-CLI itself is not loaded.
 *
 * @package ResourceHub
 */

// phpcs:disable Generic.Files.OneObjectStructurePerFile, WordPress.NamingConventions.PrefixAllGlobals, PEAR.NamingConventions.ValidClassName, Squiz.Classes.ValidClassName, PSR1.Classes.ClassDeclaration.MissingNamespace -- WP-CLI's own class name, stubbed for tests.

if ( class_exists( 'WP_CLI' ) ) {
	return;
}

/**
 * Records what a command printed.
 */
final class WP_CLI {
	/**
	 * Each line printed, as `array( kind, message )`.
	 *
	 * @var array<int, array{0: string, 1: string}>
	 */
	public static array $lines = array();

	/**
	 * Records a success line.
	 *
	 * @param string $message The message.
	 */
	public static function success( $message ): void {
		self::$lines[] = array( 'success', (string) $message );
	}

	/**
	 * Records a plain line.
	 *
	 * @param string $message The message.
	 */
	public static function log( $message ): void {
		self::$lines[] = array( 'log', (string) $message );
	}

	/**
	 * Records a warning line.
	 *
	 * @param string $message The message.
	 */
	public static function warning( $message ): void {
		self::$lines[] = array( 'warning', (string) $message );
	}

	/**
	 * Records an error line and stops the command, as the real one exits.
	 *
	 * @param string $message The message.
	 * @throws \RuntimeException Always.
	 */
	public static function error( $message ): void {
		self::$lines[] = array( 'error', (string) $message );
		throw new \RuntimeException( (string) $message ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- A test double's message, never output.
	}
}
