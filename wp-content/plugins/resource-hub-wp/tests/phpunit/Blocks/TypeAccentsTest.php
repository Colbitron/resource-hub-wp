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
	/**
	 * Back to the build's table for the next test.
	 */
	public function tear_down(): void {
		self::use_table( null );
		parent::tear_down();
	}

	/**
	 * Replaces the table `TypeAccents` read on first use, for a test that needs a term's own ID in it; null reads the build again.
	 *
	 * Term IDs in the tests database are whatever the auto-increment gives, never the CMS's, so a render
	 * test maps the term it created instead.
	 *
	 * @param array<int, array{slug: string, accent: string}>|null $table The table, or null.
	 */
	public static function use_table( ?array $table ): void {
		( new \ReflectionProperty( TypeAccents::class, 'table' ) )->setValue( null, $table );
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

		foreach ( TypeAccents::table() as $id => $row ) {
			$this->assertSame( $row['accent'], TypeAccents::accent( $term( $id, $row['slug'] ) ), $row['slug'] );
		}
		$this->assertSame( 'cobalt', TypeAccents::accent( $term( 7, 'case-study' ) ) );
		$this->assertSame( TypeAccents::NEUTRAL, TypeAccents::accent( $term( 999, 'article' ) ) );
		$this->assertSame( TypeAccents::NEUTRAL, TypeAccents::accent( $term( 3, 'renamed' ) ) );
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
}
