<?php
/**
 * Plugin entry point: wires every component onto WordPress hooks.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub;

use ResourceHub\Cli\SeedCommand;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\OneType;
use ResourceHub\ContentModel\Permalink;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\ReservedTypeSlugs;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\ContentModel\UsedTypes;
use ResourceHub\Editor\SidebarAssets;
use ResourceHub\Rest\ResolveRoute;
use ResourceHub\Revalidation\Revalidation;

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
		( new ReservedTypeSlugs() )->register();
		( new Permalink() )->register();
		( new UsedTypes() )->register();
		add_action( 'enqueue_block_editor_assets', array( new SidebarAssets( $this->file ), 'enqueue' ) );
		( new Revalidation() )->register();
		add_action( 'rest_api_init', array( new ResolveRoute(), 'register' ) );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command( 'resource-hub seed', SeedCommand::class );
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
	 */
	public static function activate(): void {
		( new PostType() )->register();
		( new Taxonomies() )->register();
		delete_option( 'rewrite_rules' );
	}

	/**
	 * Absolute path to the plugin's main file.
	 */
	public function file(): string {
		return $this->file;
	}
}
