<?php
/**
 * The one test seam onto `TypeAccents`' table.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ReflectionProperty;
use ResourceHub\Blocks\TypeAccents;

/**
 * Lets a test replace the table `TypeAccents` reads on first use, and put the build's back.
 *
 * Term IDs in the tests database are whatever the auto-increment gives, never the CMS's, so a test that
 * renders a row maps the term it created instead. A trait here rather than a test-only setter on
 * `TypeAccents`: nothing test-only ships to the host, and the reflection on the private memo lives in this
 * one file, where a rename of the property fails every caller loudly. A class that uses it calls
 * `reset_type_accents()` in `tear_down()`.
 */
trait SetsTypeAccentsTable {
	/**
	 * Replaces the table for this test.
	 *
	 * @param array<int, array{slug: string, accent: string}> $table The table by term ID.
	 */
	private static function use_type_accents( array $table ): void {
		( new ReflectionProperty( TypeAccents::class, 'table' ) )->setValue( null, $table );
	}

	/**
	 * Forgets any table, so the next read is the build's again.
	 */
	private static function reset_type_accents(): void {
		( new ReflectionProperty( TypeAccents::class, 'table' ) )->setValue( null, null );
	}
}
