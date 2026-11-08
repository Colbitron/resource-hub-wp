<?php
/**
 * WP-CLI wrapper around the search index build.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Cli;

use ResourceHub\Search\SearchIndex;
use WP_CLI;

/**
 * Rebuilds Relevanssi's search index.
 *
 * Registered as `wp resource-hub search-index` only when WP-CLI is running; the work happens in
 * {@see SearchIndex}, which prints nothing, so PHPUnit can exercise it without this class.
 */
final class SearchIndexCommand {
	/**
	 * Rebuilds the Relevanssi search index from scratch.
	 *
	 * Empties the index, then indexes every resource and page with the summary
	 * and the topic and type names, as the plugin's Relevanssi settings select.
	 * Run it after activating Relevanssi and after changing those settings. Safe
	 * to run again: each run leaves the same index. Fails when Relevanssi is not
	 * active.
	 *
	 * ## EXAMPLES
	 *
	 *     wp resource-hub search-index
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Named arguments (none).
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		unset( $args, $assoc_args );

		$result = ( new SearchIndex() )->build();

		if ( is_wp_error( $result ) ) {
			WP_CLI::error( $result->get_error_message() );
		}

		if ( ! $result['complete'] ) {
			WP_CLI::error( sprintf( 'The index build stopped after %d posts.', $result['indexed'] ) );
		}

		WP_CLI::success( sprintf( 'Search index rebuilt: %d posts indexed.', $result['indexed'] ) );
	}
}
