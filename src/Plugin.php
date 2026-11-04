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
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Editor\SidebarAssets;

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
		add_action( 'enqueue_block_editor_assets', array( new SidebarAssets( $this->file ), 'enqueue' ) );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command( 'resource-hub seed', SeedCommand::class );
		}
	}

	/**
	 * Absolute path to the plugin's main file.
	 */
	public function file(): string {
		return $this->file;
	}
}
