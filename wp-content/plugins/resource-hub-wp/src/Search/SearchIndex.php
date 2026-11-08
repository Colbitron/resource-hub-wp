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
 *   `done`, as after its first activation, before any build); when its tables are not at the
 *   database version its code expects (`relevanssi_db_version`, below); or when the stamp stored at
 *   the last complete build differs from the current one: a hash of Relevanssi's version, the
 *   database version its code expects, the one its tables are at, and
 *   {@see RelevanssiConfig::fingerprint()}. So a Relevanssi upgrade or a change to what is indexed
 *   rebuilds, and an ordinary deploy is a no-op. `--force` rebuilds regardless.
 * - **Its tables first.** Relevanssi upgrades its tables only from `relevanssi_admin_init`, on an
 *   admin page load (`lib/init.php:184`), never from WP-CLI, so after an upgrade that changes its
 *   database version a build from the deploy would run on the old tables. Before building, this
 *   calls the same `relevanssi_create_database_tables()` with the version Relevanssi's code
 *   expects; it does nothing when the stored version already matches (`lib/init.php:311`), and
 *   otherwise runs `dbDelta()` and stores the new version. A build whose tables still are not at
 *   that version afterwards stores no stamp, so the next run tries again.
 * - **An interrupted build reads as stale.** The stamp is deleted before the build starts and
 *   written only after a complete one, so a build that was killed, timed out or stopped early
 *   (Relevanssi reports it incomplete) always leaves the index out of date for the next run.
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
	 * Runs the build: `relevanssi_build_index()` with `false`, unless a test supplies its own.
	 *
	 * @var \Closure(): array{0: bool, 1: int}
	 */
	private \Closure $builder;

	/**
	 * Constructor. Both arguments exist for tests; the plugin passes neither.
	 *
	 * @param \Closure|null $builder   The build to run, returning Relevanssi's `array( complete, indexed )`; null for Relevanssi's own.
	 * @param bool|null     $available Whether Relevanssi counts as loaded; null to check for its build function.
	 */
	public function __construct( ?\Closure $builder = null, private ?bool $available = null ) {
		$this->builder = $builder ?? static fn(): array => relevanssi_build_index( false );
	}

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
		return $this->available ?? function_exists( 'relevanssi_build_index' );
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
					'tables'     => get_option( 'relevanssi_db_version' ),
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

		if ( ! $this->tables_current() ) {
			return "Relevanssi's tables are not at its database version";
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

		self::forget();

		global $relevanssi_variables;
		if ( function_exists( 'relevanssi_create_database_tables' ) && isset( $relevanssi_variables['database_version'] ) ) {
			relevanssi_create_database_tables( $relevanssi_variables['database_version'] );
		}

		list( $complete, $indexed ) = ( $this->builder )();

		if ( $complete && $this->tables_current() ) {
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
	 * Whether Relevanssi's tables are at the database version its code expects.
	 */
	private function tables_current(): bool {
		global $relevanssi_variables;

		return isset( $relevanssi_variables['database_version'] )
			&& (int) get_option( 'relevanssi_db_version' ) === (int) $relevanssi_variables['database_version'];
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
