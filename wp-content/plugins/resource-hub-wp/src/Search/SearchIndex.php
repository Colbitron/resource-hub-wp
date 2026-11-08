<?php
/**
 * Builds Relevanssi's index.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use WP_Error;

/**
 * Rebuilds the whole Relevanssi index from the posts {@see RelevanssiConfig} selects.
 *
 * The free Relevanssi registers no WP-CLI command (4.28.8 calls `WP_CLI` only for a progress
 * bar inside its build, `lib/indexing.php:346`), and its own build button is an admin AJAX
 * screen. So `wp resource-hub search-index` calls its build function, `relevanssi_build_index()`,
 * through this class, which prints nothing, so PHPUnit can run it without WP-CLI.
 *
 * - **When.** After Relevanssi is first activated, since its tables start empty, and after any
 *   change to {@see RelevanssiConfig}, since the index holds what that config selected when it was
 *   built. Between builds Relevanssi keeps the index current on its own: it re-indexes a post on
 *   `wp_after_insert_post`, after the post's terms and meta are saved (`lib/init.php:33`), and
 *   drops it on `delete_post`. It does not re-index posts when a term is renamed, so a renamed
 *   topic or type is searchable under its old name until those posts are saved or the index is
 *   rebuilt. The deploy rebuilds on every run.
 * - **Idempotent.** Called with `false`, the build truncates the index first
 *   (`lib/indexing.php:319`), then indexes every post of the configured types in an indexable
 *   status, so two runs leave the same index. While it runs, a search finds only the posts
 *   indexed so far.
 * - **Bounded.** One pass over those posts, with no batch limit: the work grows with the
 *   library, a few dozen posts here. A library large enough to need batches would call it with
 *   its offset and limit arguments instead; that is the scale path, not built.
 * - **Absent Relevanssi.** Answers with a `WP_Error` and changes nothing, so the plugin works
 *   whether or not Relevanssi is active.
 */
final class SearchIndex {
	/**
	 * Whether Relevanssi is loaded, so there is an index to build.
	 */
	public function available(): bool {
		return function_exists( 'relevanssi_build_index' );
	}

	/**
	 * Truncates the index and indexes every configured post again.
	 *
	 * @return array{complete: bool, indexed: int}|WP_Error The build's result, or an error when
	 *                                                      Relevanssi is not active.
	 */
	public function build() {
		if ( ! $this->available() ) {
			return new WP_Error( 'resource_hub_search_unavailable', 'Relevanssi is not active, so there is no search index to build.' );
		}

		list( $complete, $indexed ) = relevanssi_build_index( false );

		return array(
			'complete' => (bool) $complete,
			'indexed'  => (int) $indexed,
		);
	}
}
