<?php
/**
 * Relevanssi's settings, held in code.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;

/**
 * Pins the Relevanssi settings the search depends on, through `pre_option_*` filters.
 *
 * Relevanssi (the free plugin, installed from `site-plugins/`) reads every setting with
 * `get_option()`, so a `pre_option_{$name}` filter answers for it before the database is asked.
 * The settings therefore live here, are reviewed and deployed like the rest of the code, and
 * cost no database write: nothing is stored on activation or deploy, and a save on Relevanssi's
 * settings screen writes a row that is never read. The settings screen shows these values,
 * since it reads them through `get_option()` as well. Line references are to Relevanssi 4.28.8.
 *
 * - **Search logging off.** `relevanssi_log_queries` is already `off` by default
 *   (`lib/install.php:111`), but a stored `on` would make every search insert a row into
 *   `wp_relevanssi_log` (`lib/search.php:630`). Pinned so a search never writes to the database.
 * - **Only resources and pages are indexed.** `relevanssi_index_post_types` defaults to posts and
 *   pages (`lib/install.php:108`); it limits both the index build (`lib/indexing.php:216`) and the
 *   types a search may return (`lib/search.php:782`).
 * - **The resource summary is indexed.** `relevanssi_index_fields` takes a comma-separated list
 *   of meta keys (`lib/common.php:336`); only `summary` holds text a reader would search for.
 *   `source_url` is a URL and `related_picks` a list of IDs.
 * - **Only published posts are indexed.** Relevanssi indexes drafts, pending, private and scheduled
 *   posts too by default (`relevanssi_valid_status`, `lib/indexing.php:267`), and leaves it to each
 *   search to filter them out. A public route queries this index, so nothing unpublished is put in
 *   it at all: one missed filter in a query can then never leak it. The same list decides both the
 *   full build (`lib/indexing.php:333`) and the save-time update (`relevanssi_insert_edit()`,
 *   `lib/indexing.php:889`), which drops a post from the index once it is unpublished, trashed or
 *   scheduled, and adds it back when it is published. On each save of a post outside the list,
 *   Relevanssi also writes an empty `_relevanssi_noindex_reason` meta row, its own bookkeeping.
 *   Password-protected posts are published, so they are indexed; the search route filters them.
 * - **Topic and type names are indexed.** `relevanssi_index_taxonomies_list` adds each listed
 *   taxonomy's term names to the post's index (`lib/indexing.php:564`). `resource_flag` is left
 *   out: it is not public, and its one term, `featured`, is a code-managed marker rather than
 *   anything a reader searches for.
 *
 * Changing any of these changes what the index holds, so the index must be rebuilt afterwards.
 * {@see fingerprint()} reads them all, as Relevanssi will see them, into the stamp
 * {@see SearchIndex} compares, so a change to any of them makes the deploy's
 * `wp resource-hub search-index` rebuild; a new setting that changes what is indexed must be added
 * there too.
 *
 * One behaviour is set through Relevanssi's own filter instead of an option:
 *
 * - **A search Relevanssi does not answer keeps core's search.** Relevanssi answers a search in
 *   `posts_pre_query` (`lib/init.php:22`), and core then runs no SQL of its own. Separately, on
 *   `posts_request` it replaces the SQL of every search query outside the admin that covers an
 *   indexed type with `WHERE 1=2` (`lib/common.php:580`), whether or not it will answer it; it
 *   answers only the main query or one that sets the `relevanssi` query var (`lib/search.php:34`
 *   and `:57`). So any other search came back empty: `wp post list --s=…` found nothing, as would
 *   a plugin's own `WP_Query` with `s`. Returning false from `relevanssi_prevent_default_request`
 *   stops the blanking. A search Relevanssi answers is unaffected, because core skips its SQL
 *   once `posts_pre_query` has supplied the posts.
 *
 * Not set here, on purpose: **Relevanssi stays off in the REST API.** A REST request's
 * `WP_Query` is never the main query, so Relevanssi does not answer it, and its own
 * `rest_api_init` callback (`lib/init.php:507`) removes the blanking above for REST requests;
 * so `/wp/v2/resources?search=` and the editor's related-picks search keep core's search. (The
 * same callback also removes a `the_posts` hook that 4.28.8 no longer adds.) A query opts in
 * with the `relevanssi` query var set to true, which is how the plugin's search route will ask
 * for it. {@see RelevanssiFoundPosts} keeps such a query's `found_posts` right.
 *
 * Every filter is harmless without Relevanssi: nothing else reads these options, so the plugin
 * registers them unconditionally and works the same when Relevanssi is absent.
 */
final class RelevanssiConfig {
	/**
	 * The post types Relevanssi indexes and may return.
	 *
	 * @var string[]
	 */
	public const POST_TYPES = array( PostType::NAME, 'page' );

	/**
	 * The meta keys whose values are indexed.
	 *
	 * @var string[]
	 */
	public const META_KEYS = array( Meta::SUMMARY );

	/**
	 * The taxonomies whose term names are indexed with each post.
	 *
	 * @var string[]
	 */
	public const TAXONOMIES = array( Taxonomies::TOPIC, Taxonomies::TYPE );

	/**
	 * The post statuses Relevanssi indexes.
	 *
	 * @var string[]
	 */
	public const STATUSES = array( 'publish' );

	/**
	 * Hooks the option filters.
	 */
	public function register(): void {
		add_filter( 'pre_option_relevanssi_log_queries', array( $this, 'log_queries' ) );
		add_filter( 'pre_option_relevanssi_index_post_types', array( $this, 'index_post_types' ) );
		add_filter( 'pre_option_relevanssi_index_fields', array( $this, 'index_fields' ) );
		add_filter( 'pre_option_relevanssi_index_taxonomies_list', array( $this, 'index_taxonomies' ) );
		add_filter( 'relevanssi_prevent_default_request', '__return_false' );
		add_filter( 'relevanssi_valid_status', array( $this, 'index_statuses' ) );
	}

	/**
	 * Every setting that decides what the index holds, read the way Relevanssi reads it, so a filter
	 * added elsewhere counts too. The post statuses come from Relevanssi's own filter, with its
	 * default as the starting value.
	 *
	 * @return array<string, mixed>
	 */
	public static function fingerprint(): array {
		return array(
			'post_types' => get_option( 'relevanssi_index_post_types' ),
			'fields'     => get_option( 'relevanssi_index_fields' ),
			'taxonomies' => get_option( 'relevanssi_index_taxonomies_list' ),
			'statuses'   => apply_filters( 'relevanssi_valid_status', array( 'publish', 'draft', 'private', 'pending', 'future' ) ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Relevanssi's filter, read as Relevanssi applies it.
		);
	}

	/**
	 * `relevanssi_log_queries`: never log a search.
	 *
	 * @return string Relevanssi's off value.
	 */
	public function log_queries(): string {
		return 'off';
	}

	/**
	 * `relevanssi_index_post_types`: resources and pages.
	 *
	 * @return string[]
	 */
	public function index_post_types(): array {
		return self::POST_TYPES;
	}

	/**
	 * `relevanssi_index_fields`: the summary meta, in Relevanssi's comma-separated form.
	 *
	 * @return string
	 */
	public function index_fields(): string {
		return implode( ',', self::META_KEYS );
	}

	/**
	 * `relevanssi_valid_status`: published posts only.
	 *
	 * @return string[]
	 */
	public function index_statuses(): array {
		return self::STATUSES;
	}

	/**
	 * `relevanssi_index_taxonomies_list`: the topic and type taxonomies.
	 *
	 * @return string[]
	 */
	public function index_taxonomies(): array {
		return self::TAXONOMIES;
	}
}
