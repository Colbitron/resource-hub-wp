<?php
/**
 * The type-accent table the plugin reads from its build (`packages/ui/README.md`, "Type accents").
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\TypeAccents;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_Term;
use WP_UnitTestCase;

/**
 * The parity test: the copy `pnpm build` puts in `build/` must be the shared package's table, which wp-env
 * mounts into the tests container beside the schemas (`.wp-env.json`), so a stale build or a hand-edited
 * copy fails here. Then the rule `TypeAccents::accent()` applies, the front end's `typeAccent()`.
 */
final class TypeAccentsTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * Back to the build's table for the next test.
	 */
	public function tear_down(): void {
		self::reset_type_accents();
		parent::tear_down();
	}

	/**
	 * The shared package's `type-accents.json`, decoded.
	 *
	 * @return array<string, mixed>
	 */
	private static function package_table(): array {
		$file = dirname( SchemaValidator::schemas_dir() ) . '/type-accents.json';
		self::assertFileIsReadable( $file, 'packages/ui is not mounted: run `pnpm env:start` after a change to .wp-env.json.' );

		return wp_json_file_decode( $file, array( 'associative' => true ) );
	}

	/**
	 * The build's copy is the package's table, value for value.
	 */
	public function test_build_copy_is_the_packages_table(): void {
		$this->assertFileIsReadable( TypeAccents::path(), 'No build/type-accents.json: run `pnpm build`.' );
		$this->assertSame(
			self::package_table(),
			wp_json_file_decode( TypeAccents::path(), array( 'associative' => true ) ),
			'build/type-accents.json differs from packages/ui/type-accents.json: run `pnpm build`.'
		);
	}

	/**
	 * The build's copy passes the contract's schema.
	 */
	public function test_build_copy_passes_the_schema(): void {
		$this->assertNull( SchemaValidator::errors( 'type-accents', wp_json_file_decode( TypeAccents::path() ) ) );
	}

	/**
	 * What the plugin reads is every row of the package's table, by term ID, none dropped.
	 */
	public function test_table_is_every_package_row_by_id(): void {
		$expected = array();
		foreach ( self::package_table()['types'] as $row ) {
			$expected[ $row['id'] ] = array(
				'slug'   => $row['slug'],
				'accent' => $row['accent'],
			);
		}

		$this->assertNotEmpty( $expected );
		$this->assertSame( $expected, TypeAccents::table() );
	}

	/**
	 * A term gets its row's accent by ID and slug; an unknown ID, or a known ID with another slug, is neutral.
	 */
	public function test_accent_by_id_and_slug(): void {
		$term = static fn ( int $id, string $slug ): WP_Term => new WP_Term(
			(object) array(
				'term_id'  => $id,
				'slug'     => $slug,
				'taxonomy' => Taxonomies::TYPE,
			)
		);

		$table = TypeAccents::table();
		$this->assertNotEmpty( $table );

		foreach ( $table as $id => $row ) {
			$this->assertSame( $row['accent'], TypeAccents::accent( $term( $id, $row['slug'] ) ), $row['slug'] );
			$this->assertSame( TypeAccents::NEUTRAL, TypeAccents::accent( $term( $id, $row['slug'] . '-renamed' ) ), "{$row['slug']} renamed" );
		}

		$unknown = max( array_keys( $table ) ) + 1;
		$this->assertSame( TypeAccents::NEUTRAL, TypeAccents::accent( $term( $unknown, reset( $table )['slug'] ) ), 'An ID with no row.' );
	}

	/**
	 * A file that cannot be read gives no rows; a row that is not the schema's shape is skipped, its neighbours kept.
	 */
	public function test_read_keeps_only_rows_of_the_schemas_shape(): void {
		$fixtures = SchemaValidator::fixtures_dir();

		$this->assertSame( array(), TypeAccents::read( $fixtures . '/valid/no-such-file.json' ) );
		$this->assertSame( array(), TypeAccents::read( $fixtures . '/valid/type-accents.empty.json' ) );
		$this->assertSame(
			array(
				12 => array(
					'slug'   => 'guide',
					'accent' => 'mint',
				),
				13 => array(
					'slug'   => 'explainer',
					'accent' => 'coral',
				),
			),
			TypeAccents::read( $fixtures . '/valid/type-accents.two-types.json' )
		);
		$this->assertSame( array(), TypeAccents::read( $fixtures . '/invalid/type-accents.unknown-accent.json' ) );
		$this->assertSame( array(), TypeAccents::read( $fixtures . '/invalid/type-accents.neutral-accent.json' ) );
		$this->assertSame( array(), TypeAccents::read( $fixtures . '/invalid/type-accents.string-id.json' ) );
		$this->assertSame( array(), TypeAccents::read( $fixtures . '/invalid/type-accents.missing-slug.json' ) );
		$this->assertSame( array(), TypeAccents::read( $fixtures . '/invalid/type-accents.bare-array.json' ) );
	}

	/**
	 * A bad row is skipped alone: the good row beside it survives.
	 */
	public function test_read_keeps_a_good_row_beside_a_bad_one(): void {
		$this->assertSame(
			array(
				12 => array(
					'slug'   => 'guide',
					'accent' => 'mint',
				),
			),
			TypeAccents::read( SchemaValidator::fixtures_dir() . '/invalid/type-accents.good-row-beside-bad-row.json' )
		);
	}

	/**
	 * A file that is not JSON gives no rows, and core reports why.
	 *
	 * Core's `wp_json_file_decode()` reports the failure through `wp_trigger_error()`, which always fires
	 * `wp_trigger_error_always_run` and raises an `E_USER_NOTICE` only under `WP_DEBUG`. The tests site
	 * defines `WP_DEBUG` as false, so the report is recorded through the action; an error handler for the
	 * one call catches the notice where `WP_DEBUG` is on, which PHPUnit would otherwise turn into an
	 * exception before `read()` returned, and it is always removed.
	 */
	public function test_read_gives_no_rows_for_a_file_that_is_not_json(): void {
		$reports = array();
		$record  = static function ( string $function_name, string $message ) use ( &$reports ): void {
			$reports[] = array( $function_name, $message );
		};
		$notices = array();
		add_action( 'wp_trigger_error_always_run', $record, 10, 2 );
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_set_error_handler -- A test catching core's notice for one call, restored in `finally`.
		set_error_handler(
			static function ( int $level, string $message ) use ( &$notices ): bool {
				$notices[] = array( $level, $message );
				return true;
			},
			E_USER_NOTICE
		);

		try {
			$rows = TypeAccents::read( __DIR__ . '/fixtures/type-accents.malformed.json' );
		} finally {
			restore_error_handler();
			remove_action( 'wp_trigger_error_always_run', $record, 10 );
		}

		$this->assertSame( array(), $rows );
		$this->assertCount( 1, $reports, 'Core reports the decoding error once.' );
		$this->assertSame( 'wp_json_file_decode', $reports[0][0] );
		$this->assertStringContainsString( 'Error when decoding a JSON file', $reports[0][1] );
		$this->assertCount( WP_DEBUG ? 1 : 0, $notices, 'A notice only under WP_DEBUG.' );
		if ( WP_DEBUG ) {
			$this->assertSame( E_USER_NOTICE, $notices[0][0] );
		}
	}
}
