<?php
/**
 * Plugin entry point: wires every component onto WordPress hooks.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub;

use ResourceHub\Admin\ListColumn;
use ResourceHub\Admin\StatusPage;
use ResourceHub\Admin\TermNotice;
use ResourceHub\Blocks\RelatedResourcesBlock;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\Cli\DecodeSlugsCommand;
use ResourceHub\Cli\SearchIndexCommand;
use ResourceHub\Cli\SeedCommand;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\OneType;
use ResourceHub\ContentModel\Permalink;
use ResourceHub\ContentModel\RequiredFields;
use ResourceHub\ContentModel\ReservedPageSlugs;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\ReservedTypeSlugs;
use ResourceHub\ContentModel\SlugEscapes;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\ContentModel\UsedTypes;
use ResourceHub\Editor\RequiredFieldsAssets;
use ResourceHub\Editor\RevalidationAssets;
use ResourceHub\Editor\SidebarAssets;
use ResourceHub\Lockdown\Lockdown;
use ResourceHub\Rest\NoCacheHeader;
use ResourceHub\Rest\PageRoute;
use ResourceHub\Rest\RelatedCache;
use ResourceHub\Rest\RelatedRoute;
use ResourceHub\Rest\ResolveRoute;
use ResourceHub\Rest\SearchCache;
use ResourceHub\Rest\SearchRoute;
use ResourceHub\Revalidation\Revalidation;
use ResourceHub\Search\RelevanssiConfig;
use ResourceHub\Search\RelevanssiFoundPosts;
use ResourceHub\Search\RelevanssiPostCache;
use ResourceHub\Search\SearchIndex;
use ResourceHub\Search\TermReindex;
use ResourceHub\Security\OutgoingPings;
use ResourceHub\Security\Pings;
use ResourceHub\Security\XmlRpc;

/**
 * Boots the plugin once per request.
 */
final class Plugin {
	/**
	 * Plugin version, mirrored from the file header.
	 */
	public const VERSION = '0.1.0';

	/**
	 * Absolute path to the plugin's main file.
	 *
	 * @var string
	 */
	private string $file;

	/**
	 * Tracks whether hooks have been registered so boot() is idempotent.
	 *
	 * @var bool
	 */
	private static bool $booted = false;

	/**
	 * Constructor.
	 *
	 * @param string $file Absolute path to the plugin's main file.
	 */
	public function __construct( string $file ) {
		$this->file = $file;
	}

	/**
	 * Registers hooks. Safe to call more than once; only the first call does work.
	 */
	public function boot(): void {
		if ( self::$booted ) {
			return;
		}

		self::$booted = true;

		add_action( 'init', array( new PostType(), 'register' ) );
		add_action( 'init', array( new Taxonomies(), 'register' ) );
		add_action( 'init', array( new Meta(), 'register' ) );
		( new OneType() )->register();
		( new RequiredFields() )->register();
		( new ReservedTypeSlugs() )->register();
		( new ReservedPageSlugs() )->register();
		( new SlugEscapes() )->register();
		( new Permalink() )->register();
		( new UsedTypes() )->register();
		add_action( 'enqueue_block_editor_assets', array( new SidebarAssets( $this->file ), 'enqueue' ) );
		add_action( 'enqueue_block_editor_assets', array( new RequiredFieldsAssets( $this->file ), 'enqueue' ) );
		add_action( 'enqueue_block_editor_assets', array( new RevalidationAssets( $this->file ), 'enqueue' ) );
		( new Revalidation() )->register();
		( new RelatedResourcesBlock() )->register();
		( new SharedTokens( $this->file ) )->register();
		add_action( 'rest_api_init', array( new ResolveRoute(), 'register' ) );
		add_action( 'rest_api_init', array( new PageRoute(), 'register' ) );
		$related_cache = new RelatedCache();
		$related_cache->register();
		add_action( 'rest_api_init', array( new RelatedRoute( $related_cache ), 'register' ) );
		$search_cache = new SearchCache();
		$search_cache->register();
		add_action( 'rest_api_init', array( new SearchRoute( $search_cache ), 'register' ) );
		( new ListColumn() )->register();
		( new TermNotice() )->register();
		( new StatusPage( $this->file ) )->register();
		( new Lockdown() )->register();
		( new NoCacheHeader() )->register();
		( new XmlRpc() )->register();
		( new Pings() )->register();
		( new OutgoingPings() )->register();
		( new RelevanssiConfig() )->register();
		( new RelevanssiFoundPosts() )->register();
		( new RelevanssiPostCache() )->register();
		( new SearchIndex() )->register();
		( new TermReindex() )->register();

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command( 'resource-hub seed', SeedCommand::class );
			\WP_CLI::add_command( 'resource-hub decode-slugs', DecodeSlugsCommand::class );
			\WP_CLI::add_command( 'resource-hub search-index', SearchIndexCommand::class );
		}
	}

	/**
	 * Makes pretty permalinks for resources work without a visit to Settings > Permalinks.
	 * Registered with `register_activation_hook()` in the entry file.
	 *
	 * It deletes the stored rewrite rules rather than calling `flush_rewrite_rules()`, which the
	 * VIP Minimum ruleset forbids. Core regenerates missing rules on the next request that needs
	 * them, after `init` has registered the post type and taxonomies, so the effect is the same
	 * flush, done lazily. The post type and taxonomies are also registered here so that anything
	 * regenerating the rules later in this same request already sees them. `wp rewrite flush`
	 * is the manual equivalent.
	 *
	 * It also forgets the search index's stamp, since Relevanssi indexed saves on its own defaults
	 * while the plugin was off, so the next `wp resource-hub search-index` rebuilds
	 * ({@see SearchIndex}).
	 */
	public static function activate(): void {
		( new PostType() )->register();
		( new Taxonomies() )->register();
		delete_option( 'rewrite_rules' );
		SearchIndex::forget();
	}

	/**
	 * Absolute path to the plugin's main file.
	 */
	public function file(): string {
		return $this->file;
	}
}
