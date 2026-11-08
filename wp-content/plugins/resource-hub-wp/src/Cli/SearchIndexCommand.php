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
use WP_CLI\Utils;

/**
 * Rebuilds Relevanssi's search index when it is out of date.
 *
 * Registered as `wp resource-hub search-index` only when WP-CLI is running; the work happens in
 * {@see SearchIndex}, which prints nothing, so PHPUnit can exercise it without this class.
 */
final class SearchIndexCommand {
	/**
	 * Constructor. WP-CLI passes nothing; a test passes its own index.
	 *
	 * @param SearchIndex|null $index The index to build; null for the plugin's.
	 */
	public function __construct( private ?SearchIndex $index = null ) {
	}

	/**
	 * Rebuilds the Relevanssi search index if it is out of date.
	 *
	 * The index is out of date when Relevanssi has no complete index (as after
	 * its first activation), or when Relevanssi's version or the plugin's index
	 * settings changed since the last build. Otherwise this changes nothing. A
	 * rebuild empties the index, then indexes every published resource and page
	 * with its summary and topic and type names. Fails when Relevanssi is not
	 * active.
	 *
	 * ## OPTIONS
	 *
	 * [--force]
	 * : Rebuild even when the index is current, as after terms were assigned by
	 * a script after their posts were saved.
	 *
	 * ## EXAMPLES
	 *
	 *     wp resource-hub search-index
	 *     wp resource-hub search-index --force
	 *
	 * @param string[]             $args       Positional arguments (none).
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	public function __invoke( array $args, array $assoc_args ): void {
		unset( $args );

		$result = ( $this->index ?? new SearchIndex() )->build( (bool) Utils\get_flag_value( $assoc_args, 'force', false ) );

		if ( is_wp_error( $result ) ) {
			WP_CLI::error( $result->get_error_message() );
		}

		if ( ! $result['built'] ) {
			WP_CLI::success( 'Search index is current; nothing rebuilt. Use --force to rebuild anyway.' );
			return;
		}

		if ( ! $result['complete'] ) {
			WP_CLI::error( sprintf( 'The index build stopped after %d posts.', $result['indexed'] ) );
		}

		WP_CLI::success( sprintf( 'Search index rebuilt (%s): %d posts indexed.', $result['reason'], $result['indexed'] ) );
	}
}
