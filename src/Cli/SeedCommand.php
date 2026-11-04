<?php
/**
 * WP-CLI wrapper around the seeder.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Cli;

use ResourceHub\Seed\Seeder;
use WP_CLI;

/**
 * Seeds the resources library with fictional sample content.
 *
 * Registered as `wp resource-hub seed` only when WP-CLI is running; the work happens in
 * {@see Seeder}, which prints nothing, so PHPUnit can exercise it without this class.
 */
final class SeedCommand {
	/**
	 * Creates sample types, topics, and resources. Safe to run more than once.
	 *
	 * ## OPTIONS
	 *
	 * [--count=<count>]
	 * : How many resources to ensure exist, up to the size of the built-in catalogue.
	 * ---
	 * default: 12
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp resource-hub seed
	 *     wp resource-hub seed --count=16
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		$count = (int) ( $assoc_args['count'] ?? Seeder::DEFAULT_COUNT );

		if ( $count < 1 ) {
			WP_CLI::error( '--count must be at least 1.' );
		}

		$result = ( new Seeder() )->seed( $count );

		foreach ( $result['errors'] as $error ) {
			WP_CLI::warning( $error );
		}

		$summary = sprintf(
			'%d resources created, %d already present (%d total); %d terms in place.',
			$result['created'],
			$result['skipped'],
			$result['total'],
			$result['terms']
		);

		if ( ! empty( $result['errors'] ) ) {
			// Exit non-zero so a script that seeds and carries on notices the missing terms.
			WP_CLI::error( sprintf( '%s %d term assignments failed; see the warnings above.', $summary, count( $result['errors'] ) ) );
		}

		WP_CLI::success( $summary );
	}
}
