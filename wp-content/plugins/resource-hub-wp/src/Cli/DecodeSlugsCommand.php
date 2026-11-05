<?php
/**
 * WP-CLI wrapper around the legacy slug repair.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Cli;

use ResourceHub\ContentModel\LegacySlugs;
use WP_CLI;
use WP_CLI\Utils;

/**
 * Lists, and with `--apply` decodes, resource and term slugs still stored with a percent escape the
 * front end's router decodes (ADR 0024).
 *
 * Registered as `wp resource-hub decode-slugs` only when WP-CLI is running; the work happens in
 * {@see LegacySlugs}, which prints nothing, so PHPUnit can exercise it without this class.
 */
final class DecodeSlugsCommand {
	/**
	 * Lists, and with --apply decodes, slugs stored with a percent escape.
	 *
	 * Covers every resource, topic, type and flag whose stored slug has an escape
	 * of `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, which the front end's router decodes
	 * (ADR 0024). Each row shows the decoded slug and anything already holding it.
	 * Changes nothing unless given `--apply`.
	 *
	 * With `--apply`, saves each one through core (`wp_update_post()` or
	 * `wp_update_term()`), so the slug is decoded, the old one kept in
	 * `_wp_old_slug`, uniqueness checked and the front end revalidated, as on any
	 * save. A term whose decoded slug another term has is skipped and reported:
	 * core refuses the save, and an editor must type a new slug for it.
	 *
	 * ## OPTIONS
	 *
	 * [--apply]
	 * : Save each listed object so its slug is decoded. Without it, this is a dry run.
	 *
	 * [--format=<format>]
	 * : How to print the rows.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - csv
	 *   - json
	 *   - yaml
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp resource-hub decode-slugs
	 *     wp resource-hub decode-slugs --apply
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		$apply  = (bool) Utils\get_flag_value( $assoc_args, 'apply', false );
		$format = (string) Utils\get_flag_value( $assoc_args, 'format', 'table' );
		$repair = new LegacySlugs();

		if ( ! $apply ) {
			$rows = $repair->scan();

			if ( array() === $rows ) {
				WP_CLI::success( 'No resource or term slug is stored with an escape the router decodes.' );
				return;
			}

			Utils\format_items( $format, array_map( static fn( array $row ): array => self::display( $row ), $rows ), array( 'object', 'id', 'status', 'slug', 'decoded', 'collision' ) );

			$blocked = count( array_filter( array_column( $rows, 'blocked' ) ) );

			WP_CLI::log(
				sprintf(
					'Dry run, nothing changed: %d to decode, %d blocked by a collision. Run again with --apply to save them.',
					count( $rows ) - $blocked,
					$blocked
				)
			);
			return;
		}

		$rows = $repair->apply();

		if ( array() === $rows ) {
			WP_CLI::success( 'No resource or term slug is stored with an escape the router decodes.' );
			return;
		}

		Utils\format_items( $format, array_map( static fn( array $row ): array => self::display( $row ), $rows ), array( 'object', 'id', 'status', 'slug', 'stored', 'result', 'message' ) );

		$counts  = array_count_values( array_column( $rows, 'result' ) );
		$summary = sprintf( '%d decoded, %d skipped, %d failed.', $counts['decoded'] ?? 0, $counts['skipped'] ?? 0, $counts['failed'] ?? 0 );

		if ( count( $rows ) !== ( $counts['decoded'] ?? 0 ) ) {
			// Exit non-zero so a script notices what is left; the saves made are kept and revalidated at shutdown.
			WP_CLI::error( $summary . ' Type a new slug for each skipped or failed object.' );
		}

		WP_CLI::success( $summary );
	}

	/**
	 * A row as printed: an empty decoded slug says where core takes the slug from instead.
	 *
	 * @param array<string, mixed> $row A row from {@see LegacySlugs}.
	 * @return array<string, mixed>
	 */
	private static function display( array $row ): array {
		if ( '' === $row['decoded'] ) {
			$row['decoded'] = 'resource' === $row['object'] ? '(empty: from the title)' : '(empty: from the name)';
		}

		return $row;
	}
}
