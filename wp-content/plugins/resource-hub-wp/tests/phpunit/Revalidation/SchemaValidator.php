<?php
/**
 * Validates payloads against the contract schemas in `packages/ui/schemas/`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;
use RuntimeException;

/**
 * One validator for the test run, with every schema registered under its `$id` so the cross-file
 * `$ref`s to `common.schema.json` resolve (ADR 0010). The schemas are read from the repository's
 * `packages/ui/schemas/`, which wp-env mounts into the tests container at the same path relative to
 * the WordPress root as it has relative to the repository root (ADR 0042).
 */
final class SchemaValidator {
	/**
	 * The validator, built on first use.
	 *
	 * @var Validator|null
	 */
	private static ?Validator $validator = null;

	/**
	 * The `$id` of each schema by file name without `.schema.json`.
	 *
	 * @var array<string, string>
	 */
	private static array $ids = array();

	/**
	 * Where the schemas are: `packages/ui/schemas/` at the repository root, four directories above this file's plugin.
	 */
	public static function schemas_dir(): string {
		return dirname( __DIR__, 6 ) . '/packages/ui/schemas';
	}

	/**
	 * Where the package's fixtures are.
	 */
	public static function fixtures_dir(): string {
		return dirname( __DIR__, 6 ) . '/packages/ui/fixtures';
	}

	/**
	 * Validates data against one schema and returns null, or the formatted errors when it fails.
	 *
	 * The data is round-tripped through JSON first, so what is checked is exactly what `wp_json_encode()`
	 * would send: PHP arrays become JSON arrays or objects the way the sender's body does.
	 *
	 * @param string $schema File name without `.schema.json`, such as `revalidate-request`.
	 * @param mixed  $data   The payload as PHP values.
	 *
	 * @throws RuntimeException When no schema has that name.
	 */
	public static function errors( string $schema, mixed $data ): ?string {
		$validator = self::validator();

		if ( ! isset( self::$ids[ $schema ] ) ) {
			throw new RuntimeException( esc_html( "No schema named {$schema} in " . self::schemas_dir() ) );
		}

		$result = $validator->validate( json_decode( (string) wp_json_encode( $data ) ), self::$ids[ $schema ] );

		if ( $result->isValid() ) {
			return null;
		}

		return (string) wp_json_encode( ( new ErrorFormatter() )->format( $result->error() ), JSON_PRETTY_PRINT );
	}

	/**
	 * Builds the validator once and registers every schema under its `$id`.
	 *
	 * @throws RuntimeException When the schemas directory is missing or a schema cannot be read.
	 */
	private static function validator(): Validator {
		if ( null !== self::$validator ) {
			return self::$validator;
		}

		$files = glob( self::schemas_dir() . '/*.schema.json' );

		if ( ! is_array( $files ) || array() === $files ) {
			throw new RuntimeException( esc_html( 'No schemas found in ' . self::schemas_dir() . '. Is packages/ui mapped in .wp-env.json?' ) );
		}

		$validator = new Validator();
		$resolver  = $validator->resolver();

		if ( null === $resolver ) {
			throw new RuntimeException( 'The JSON Schema validator has no resolver.' );
		}

		foreach ( $files as $file ) {
			$schema = wp_json_file_decode( $file );

			if ( ! is_object( $schema ) || ! isset( $schema->{'$id'} ) ) {
				throw new RuntimeException( esc_html( "Could not read {$file} or it has no \$id." ) );
			}

			$resolver->registerRaw( $schema, $schema->{'$id'} );
			self::$ids[ basename( $file, '.schema.json' ) ] = $schema->{'$id'};
		}

		self::$validator = $validator;

		return $validator;
	}
}
