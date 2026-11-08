<?php
/**
 * Builds Relevanssi's index, only when it is out of date.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use WP_Error;

/**
 * Rebuilds the whole Relevanssi index when it no longer matches what {@see RelevanssiConfig}
 * selects, and otherwise leaves it alone.
 *
 * The free Relevanssi registers no WP-CLI command (4.28.8 calls `WP_CLI` only for a progress
 * bar inside its build, `lib/indexing.php:346`), and its own build button is an admin AJAX
 * screen. So `wp resource-hub search-index` calls its build function, `relevanssi_build_index()`,
 * through this class, which prints nothing, so PHPUnit can run it without WP-CLI.
 *
 * - **A full build empties the index first.** Called with `false`, Relevanssi truncates its table
 *   (`lib/indexing.php:319`) and then indexes every configured post, so while it runs a live search
 *   finds only what is indexed so far. Relevanssi has no full build that skips the truncate: with
 *   `true` it adds only the posts missing from the index (`lib/indexing.php:122`), and with an
 *   offset it re-reads a slice of 200 posts without removing their old rows first; neither drops a
 *   post that no longer belongs, so neither can apply a settings change. Hence the stamp below, so
 *   the deploy, which runs this on every merge, rebuilds only when it must.
 * - **When it rebuilds.** When Relevanssi has no complete index (`relevanssi_indexed` is not
 *   `done`, as after its first activation, before any build), or when the stamp stored at the last
 *   complete build differs from the current one: a hash of Relevanssi's version, its database
 *   version and {@see RelevanssiConfig::fingerprint()}. So a Relevanssi upgrade or a change to what
 *   is indexed rebuilds, and an ordinary deploy is a no-op. `--force` rebuilds regardless.
 * - **The stamp.** One option, {@see STAMP_OPTION}, not autoloaded, written by the CLI command
 *   after a complete build: at deploy time or by hand, never on a reader's request. It is deleted
 *   when Relevanssi is activated or deactivated and when this plugin is activated
 *   ({@see \ResourceHub\Plugin::activate()}), since Relevanssi keeps indexing saves on its own
 *   defaults while this plugin is off, and indexes nothing while it is off itself; the next run
 *   then rebuilds.
 * - **Between builds** Relevanssi keeps the index current on its own: it re-indexes a post on
 *   `wp_after_insert_post`, after the post's terms and meta are saved (`lib/init.php:33`), and drops
 *   it on `delete_post`. {@see TermReindex} covers what it misses, a renamed or deleted topic or
 *   type. A term assigned by a PHP or WP-CLI call after the save that created the post (the seeder
 *   does this) is missed too, until the post is saved again or the index is rebuilt with `--force`.
 * - **Bounded and idempotent.** One pass over the published resources and pages, with no batch
 *   limit: a few dozen posts here. Two builds leave the same index. A library large enough to need
 *   batches is the scale path, not built.
 * - **Absent Relevanssi.** Answers with a `WP_Error` and changes nothing, so the plugin works
 *   whether or not Relevanssi is active.
 */
final class SearchIndex {
	/**
	 * The option holding the stamp of the last complete build.
	 */
	public const STAMP_OPTION = 'resource_hub_search_index_stamp';

	/**
	 * Relevanssi's plugin basename, as the activation hooks pass it.
	 */
	private const RELEVANSSI_PLUGIN = 'relevanssi/relevanssi.php';

	/**
	 * Hooks the stamp's removal to Relevanssi's activation and deactivation.
	 */
	public function register(): void {
		add_action( 'activated_plugin', array( $this, 'forget_on_relevanssi_change' ) );
		add_action( 'deactivated_plugin', array( $this, 'forget_on_relevanssi_change' ) );
	}

	/**
	 * Whether Relevanssi is loaded, so there is an index to build.
	 */
	public function available(): bool {
		return function_exists( 'relevanssi_build_index' );
	}

	/**
	 * The stamp for the index as it would be built now.
	 */
	public function stamp(): string {
		global $relevanssi_variables;

		return md5(
			(string) wp_json_encode(
				array(
					'relevanssi' => $relevanssi_variables['plugin_version'] ?? null,
					'database'   => $relevanssi_variables['database_version'] ?? null,
					'config'     => RelevanssiConfig::fingerprint(),
				)
			)
		);
	}

	/**
	 * Why the index needs a rebuild, or null when it is current.
	 */
	public function stale_reason(): ?string {
		if ( 'done' !== get_option( 'relevanssi_indexed' ) ) {
			return 'Relevanssi has no complete index';
		}

		$stored = get_option( self::STAMP_OPTION );

		if ( ! is_string( $stored ) || '' === $stored ) {
			return 'no build has been recorded';
		}

		if ( $stored !== $this->stamp() ) {
			return "Relevanssi's version or the index settings changed";
		}

		return null;
	}

	/**
	 * Rebuilds the index when it is out of date, or always when forced, and records the stamp
	 * after a complete build.
	 *
	 * @param bool $force Rebuild even when the index is current.
	 * @return array{built: bool, reason: string, complete: bool, indexed: int}|WP_Error What
	 *         happened, or an error when Relevanssi is not active.
	 */
	public function build( bool $force = false ) {
		if ( ! $this->available() ) {
			return new WP_Error( 'resource_hub_search_unavailable', 'Relevanssi is not active, so there is no search index to build.' );
		}

		$reason = $force ? 'forced' : $this->stale_reason();

		if ( null === $reason ) {
			return array(
				'built'    => false,
				'reason'   => 'the index is current',
				'complete' => true,
				'indexed'  => 0,
			);
		}

		list( $complete, $indexed ) = relevanssi_build_index( false );

		if ( $complete ) {
			update_option( self::STAMP_OPTION, $this->stamp(), false );
		}

		return array(
			'built'    => true,
			'reason'   => $reason,
			'complete' => (bool) $complete,
			'indexed'  => (int) $indexed,
		);
	}

	/**
	 * Deletes the stamp, so the next run rebuilds.
	 */
	public static function forget(): void {
		delete_option( self::STAMP_OPTION );
	}

	/**
	 * Deletes the stamp when the plugin activated or deactivated is Relevanssi. Hooked to
	 * `activated_plugin` and `deactivated_plugin`.
	 *
	 * @param mixed $plugin The plugin's basename.
	 */
	public function forget_on_relevanssi_change( $plugin ): void {
		if ( self::RELEVANSSI_PLUGIN === $plugin ) {
			self::forget();
		}
	}
}
