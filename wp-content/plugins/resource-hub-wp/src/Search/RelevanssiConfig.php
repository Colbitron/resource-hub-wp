<?php
/**
 * Relevanssi's settings, held in code.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Search;

use ResourceHub\Blocks\RelatedResourcesBlock;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;

/**
 * Pins the Relevanssi settings the search depends on, through `pre_option_*` filters and
 * Relevanssi's own filters.
 *
 * Relevanssi (the free plugin, installed from `site-plugins/`) reads every setting with
 * `get_option()`, so a `pre_option_{$name}` filter answers for it before the database is asked.
 * The settings in {@see PINNED} therefore live here, are reviewed and deployed like the rest of the
 * code, and cost no database write: nothing is stored on activation or deploy (Relevanssi's own
 * `add_option()` sees the filtered value and stores nothing), and a save on Relevanssi's settings
 * screen writes a row that is never read. The screen shows these values, since it reads them
 * through `get_option()` too, but cannot change what Relevanssi does. Line references are to
 * Relevanssi 4.28.8.
 *
 * - **Search logging off.** `relevanssi_log_queries` is already `off` by default
 *   (`lib/install.php:111`), but a stored `on` would make every search insert a row into
 *   `wp_relevanssi_log` (`lib/search.php:630`). Pinned so a search never writes to the database.
 * - **Admin searches stay core's.** `relevanssi_admin_search` off, its default, so the admin's
 *   list-table searches never depend on the index.
 * - **Only resources and pages are indexed.** `relevanssi_index_post_types` defaults to posts and
 *   pages (`lib/install.php:108`); it limits both the index build (`lib/indexing.php:216`) and the
 *   types a search may return (`lib/search.php:782`).
 * - **The resource summary is indexed.** `relevanssi_index_fields` takes a comma-separated list
 *   of meta keys (`lib/common.php:336`); only `summary` holds text a reader would search for, so
 *   the list is that one key.
 *   `source_url` is a URL and `related_picks` a list of IDs.
 * - **Topic and type names are indexed.** `relevanssi_index_taxonomies_list` adds each listed
 *   taxonomy's term names to the post's index (`lib/indexing.php:564`). `resource_flag` is left
 *   out: it is not public, and its one term, `featured`, is a code-managed marker rather than
 *   anything a reader searches for.
 * - **Nothing else is indexed with a post.** No comments (`relevanssi_index_comments` `none`), no
 *   author name, no excerpt: resources keep their reader-facing text in the title, the body and the
 *   summary. Words of three letters or more, Relevanssi's default (`relevanssi_min_word_length`),
 *   with its default punctuation rules (`relevanssi_punctuation`): hyphens, quotes and ampersands
 *   become spaces.
 * - **Shortcodes are not run at index time.** `relevanssi_expand_shortcodes` defaults to `on`
 *   (`lib/install.php:95`), which runs `do_shortcode()` over every post body as it is indexed
 *   (`lib/utils.php:192`). Pinned off: a shortcode's output is generated content that belongs to
 *   whatever it renders, not to the post, and goes stale as soon as that changes; the CMS's
 *   content uses blocks, not shortcodes. With it off, Relevanssi strips the shortcodes instead.
 *
 * {@see fingerprint()} reads every setting that changes what the index holds, as Relevanssi will
 * see it: the pinned ones above, the unpinned ones in {@see FINGERPRINTED} (the stopword list,
 * which the settings screen does change, and settings that cannot matter here today), the indexed
 * statuses, and {@see INDEX_LOGIC}, this plugin's own version of how it shapes the index. The stamp
 * {@see SearchIndex} compares is built from it, so a change to any of them makes the next
 * `wp resource-hub search-index` rebuild. A new setting or filter that changes what is indexed must
 * be added there, and a change to the filters below must raise {@see INDEX_LOGIC}.
 *
 * Three behaviours are set through Relevanssi's own filters instead of options:
 *
 * - **Only published posts are indexed.** Relevanssi indexes drafts, pending, private and scheduled
 *   posts too by default (`relevanssi_valid_status`, `lib/indexing.php:267`), and leaves it to each
 *   search to filter them out. A public route queries this index, so nothing unpublished is put in
 *   it at all: one missed filter in a query can then never leak it. The same list decides both the
 *   full build (`lib/indexing.php:333`) and the save-time update (`relevanssi_insert_edit()`,
 *   `lib/indexing.php:889`), which drops a post from the index once it is unpublished, trashed or
 *   scheduled, and adds it back when it is published. On each save of a post outside the list,
 *   Relevanssi also writes an empty `_relevanssi_noindex_reason` meta row, its own bookkeeping.
 *   Password-protected posts are published, so they are indexed; the search route filters them.
 * - **The related-resources block is not indexed into the post that holds it.** Relevanssi
 *   renders every block of a post body to index it (`lib/compatibility/gutenberg.php`), so a page
 *   holding the block took the listed resources' titles, types and summaries as its own words: a
 *   search for a resource returned every page that merely listed it, the entry went stale whenever
 *   that list changed, and every rebuild ran the block's queries. Relevanssi's
 *   `relevanssi_block_to_render` filter, applied to each block, inner blocks and synced patterns
 *   included, before it is rendered, drops the blocks in {@see UNINDEXED_BLOCKS}, so their render
 *   callbacks never run at index time. That is narrower than turning off block rendering for the
 *   whole body (`relevanssi_render_blocks`), which would index the raw saved markup instead and
 *   lose the output of every other dynamic block, and earlier than removing the block's HTML
 *   from the rendered body on `relevanssi_post_content`, which would still run its queries.
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
 * with the `relevanssi` query var set to true, which is how the plugin's search route asks for
 * it. {@see RelevanssiFoundPosts} keeps such a query's `found_posts` right.
 *
 * Every filter is harmless without Relevanssi: nothing else reads these options, so the plugin
 * registers them unconditionally and works the same when Relevanssi is absent.
 */
final class RelevanssiConfig {
	/**
	 * This plugin's version of how it shapes the index, beyond the options: raise it whenever a
	 * filter here changes what a build would write, so the next deploy rebuilds.
	 *
	 * 1: published posts only, the related-resources block left out.
	 */
	public const INDEX_LOGIC = 1;

	/**
	 * The post types Relevanssi indexes and may return.
	 *
	 * @var string[]
	 */
	public const POST_TYPES = array( PostType::NAME, 'page' );

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
	 * Blocks whose output is never indexed into the post that holds them.
	 *
	 * @var string[]
	 */
	public const UNINDEXED_BLOCKS = array( RelatedResourcesBlock::NAME );

	/**
	 * Every pinned option, with the value Relevanssi reads for it.
	 *
	 * @var array<string, mixed>
	 */
	public const PINNED = array(
		'relevanssi_log_queries'           => 'off',
		'relevanssi_admin_search'          => 'off',
		'relevanssi_index_post_types'      => self::POST_TYPES,
		'relevanssi_index_fields'          => Meta::SUMMARY,
		'relevanssi_index_taxonomies_list' => self::TAXONOMIES,
		'relevanssi_index_comments'        => 'none',
		'relevanssi_index_author'          => 'off',
		'relevanssi_index_excerpt'         => 'off',
		'relevanssi_min_word_length'       => '3',
		'relevanssi_expand_shortcodes'     => 'off',
		'relevanssi_punctuation'           => array(
			'quotes'     => 'replace',
			'hyphens'    => 'replace',
			'ampersands' => 'replace',
		),
	);

	/**
	 * Options that change what is indexed but are left to Relevanssi, so the stamp follows them:
	 * the stopword list, which the settings screen edits; the shortcodes disabled while indexing,
	 * moot while expansion is off; attachment and internal-link indexing, moot while only resources
	 * and pages are indexed; and the SEO plugins' noindex rule, moot while none is installed.
	 *
	 * @var string[]
	 */
	public const FINGERPRINTED = array(
		'relevanssi_stopwords',
		'relevanssi_disable_shortcodes',
		'relevanssi_index_image_files',
		'relevanssi_internal_links',
		'relevanssi_seo_noindex',
	);

	/**
	 * Hooks the option filters and Relevanssi's own.
	 */
	public function register(): void {
		foreach ( array_keys( self::PINNED ) as $option ) {
			add_filter( "pre_option_{$option}", array( $this, 'pinned' ), 10, 2 );
		}

		add_filter( 'relevanssi_prevent_default_request', '__return_false' );
		add_filter( 'relevanssi_valid_status', array( $this, 'index_statuses' ) );
		add_filter( 'relevanssi_block_to_render', array( $this, 'block_to_render' ) );
	}

	/**
	 * Every setting that decides what the index holds, read the way Relevanssi reads it, so a filter
	 * added elsewhere counts too. The post statuses come from Relevanssi's own filter, with its
	 * default as the starting value.
	 *
	 * @return array<string, mixed>
	 */
	public static function fingerprint(): array {
		$options = array();

		foreach ( array_merge( array_keys( self::PINNED ), self::FINGERPRINTED ) as $option ) {
			$options[ $option ] = get_option( $option );
		}

		return array(
			'logic'    => self::INDEX_LOGIC,
			'options'  => $options,
			'statuses' => apply_filters( 'relevanssi_valid_status', array( 'publish', 'draft', 'private', 'pending', 'future' ) ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Relevanssi's filter, read as Relevanssi applies it.
		);
	}

	/**
	 * `pre_option_{$option}` for every pinned option: the value in {@see PINNED}.
	 *
	 * @param mixed  $pre    The value another filter supplied, or false.
	 * @param string $option The option's name.
	 * @return mixed
	 */
	public function pinned( $pre, $option ) {
		return array_key_exists( (string) $option, self::PINNED ) ? self::PINNED[ $option ] : $pre;
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
	 * `relevanssi_block_to_render`: drops a block in {@see UNINDEXED_BLOCKS} before Relevanssi
	 * renders it for the index.
	 *
	 * @param mixed $block The parsed block, or a falsy value another filter returned.
	 * @return mixed The block, or null to leave it out.
	 */
	public function block_to_render( $block ) {
		if ( is_array( $block ) && in_array( $block['blockName'] ?? null, self::UNINDEXED_BLOCKS, true ) ) {
			return null;
		}

		return $block;
	}
}
