<?php
/**
 * The shared type-accent table, read from the plugin's build.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use WP_Term;

/**
 * Which brand accent marks each resource type, by the `resource_type` term's ID, as the front end marks it.
 *
 * The table is the shared package's `type-accents.json` (`packages/ui/README.md`, "Type accents"), which
 * the front end imports from the workspace. The host never has the workspace: the deploy syncs only the
 * plugin's main file, `src/`, `build/` and `vendor/`. So the plugin's webpack build emits the file
 * unchanged as `build/type-accents.json`, beside the block's compiled stylesheet, and this class reads
 * that copy. `TypeAccentsTest` fails when the copy differs from the package's, so a stale build cannot
 * pass the gate. Rejected: a committed PHP copy of the table, which is a second source that can drift
 * between the test runs that catch it; reading `packages/ui/` at runtime, which is not on the host; and
 * generating PHP in the build, which needs escaping where a JSON copy needs none.
 *
 * The rule is the front end's `typeAccent()` (`apps/web/lib/type-accents.ts`): a term gets its row's
 * accent when the table has a row for its ID and the term's slug is the row's, and `neutral` otherwise,
 * a renamed type included, so a stale row never colours the wrong type. `neutral` matches none of
 * `card-labels.css`'s accent rules and is painted in the ink, and the front end writes it the same way.
 *
 * The file is read once per request, on first use, with core's `wp_json_file_decode()`. It is the
 * plugin's own build output, never written at runtime. A missing or unreadable file, or a row that is not
 * the schema's shape (an ID that is not a positive integer, a slug that is not a string, an accent that
 * is not one of the five), gives no row, so a broken build shows neutral marks. A file that is not
 * valid JSON also gives no rows; in production that is all, and under `WP_DEBUG` core's
 * `wp_json_file_decode()` raises an `E_USER_NOTICE` as well. Without a build the block is not
 * registered at all.
 */
final class TypeAccents {
	/**
	 * The `data-accent` value of a type the table does not know.
	 */
	public const NEUTRAL = 'neutral';

	/**
	 * The five brand accents, the schema's enum (`packages/ui/schemas/type-accents.schema.json`).
	 */
	public const ACCENTS = array( 'coral', 'cobalt', 'lemon', 'mint', 'grape' );

	/**
	 * The table by term ID, read on first use.
	 *
	 * @var array<int, array{slug: string, accent: string}>|null
	 */
	private static ?array $table = null;

	/**
	 * Where the build puts the table.
	 */
	public static function path(): string {
		return dirname( __DIR__, 2 ) . '/build/type-accents.json';
	}

	/**
	 * The accent for a `resource_type` term, or `neutral` when the table has no row for its ID and slug.
	 *
	 * @param WP_Term $term A `resource_type` term.
	 */
	public static function accent( WP_Term $term ): string {
		$row = self::table()[ $term->term_id ] ?? null;

		return null !== $row && $row['slug'] === $term->slug ? $row['accent'] : self::NEUTRAL;
	}

	/**
	 * The table from the build, by term ID.
	 *
	 * @return array<int, array{slug: string, accent: string}>
	 */
	public static function table(): array {
		if ( null === self::$table ) {
			self::$table = self::read( self::path() );
		}

		return self::$table;
	}

	/**
	 * A table file's rows by term ID, keeping only rows of the schema's shape; empty when the file cannot be read.
	 *
	 * @param string $file A file in `type-accents.json`'s shape.
	 * @return array<int, array{slug: string, accent: string}>
	 */
	public static function read( string $file ): array {
		if ( ! is_readable( $file ) ) {
			return array();
		}

		$data = wp_json_file_decode( $file, array( 'associative' => true ) );
		$rows = is_array( $data ) && isset( $data['types'] ) && is_array( $data['types'] ) ? $data['types'] : array();

		$table = array();

		foreach ( $rows as $row ) {
			if (
				is_array( $row )
				&& is_int( $row['id'] ?? null ) && $row['id'] > 0
				&& is_string( $row['slug'] ?? null )
				&& in_array( $row['accent'] ?? null, self::ACCENTS, true )
			) {
				$table[ $row['id'] ] = array(
					'slug'   => $row['slug'],
					'accent' => $row['accent'],
				);
			}
		}

		return $table;
	}
}
