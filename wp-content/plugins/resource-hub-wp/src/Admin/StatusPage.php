<?php
/**
 * Settings > Resource Hub: the revalidation status page.
 *
 * This file is a critical path: its capability and nonce checks and its option sanitizers are read
 * line by line before merge.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Admin;

use ResourceHub\ContentModel\PostType;
use ResourceHub\Revalidation\Config;
use ResourceHub\Revalidation\Revalidation;
use WP_Post;
use WP_Query;

/**
 * A status page first (ADR 0019): which source supplies the front-end URL and the secret, the URL
 * itself, whether PostHog is on, and the last test's result. It never prints the secret, not even
 * in part. Below that, a form writes the two fallback options the constants win over, and a
 * "Send test revalidation" button sends a real `update` event through
 * {@see Revalidation::send_update_for()} for the most recently modified published resource or one
 * chosen in the picker. The test's result is recorded like any other, in that resource's meta and
 * in PostHog, plus a non-autoloaded option this page reads.
 */
final class StatusPage {
	/**
	 * The page's slug under Settings.
	 */
	public const SLUG = 'resource-hub';

	/**
	 * Who may see the page, write the options and press the button.
	 */
	public const CAPABILITY = 'manage_options';

	/**
	 * The Settings API group the two fallback options belong to.
	 */
	public const OPTION_GROUP = 'resource_hub';

	/**
	 * The option names: the constants' names in lower case, as {@see Config} reads them.
	 */
	public const URL_OPTION    = 'resource_hub_frontend_url';
	public const SECRET_OPTION = 'resource_hub_revalidate_secret';

	/**
	 * The non-autoloaded option holding the last test's result.
	 */
	public const LAST_TEST_OPTION = 'resource_hub_last_test';

	/**
	 * The `admin-post.php` action and its nonce action.
	 */
	public const TEST_ACTION = 'resource_hub_send_test';

	/**
	 * Query argument the test handler redirects back with, so the page can say what happened.
	 */
	public const RESULT_ARG = 'rh_test';

	/**
	 * The values RESULT_ARG may carry; any other value shows nothing.
	 */
	public const RESULTS = array( 'sent', 'none', 'not_published' );

	/**
	 * How many recently modified published resources the picker lists before a search.
	 */
	public const PICKER_LIMIT = 20;

	/**
	 * Script handle for the picker's search.
	 */
	public const HANDLE = 'resource-hub-status-page';

	/**
	 * Absolute path to the plugin's main file, for `plugins_url()`.
	 *
	 * @var string
	 */
	private string $plugin_file;

	/**
	 * Constructor.
	 *
	 * @param string $plugin_file Absolute path to the plugin's main file.
	 */
	public function __construct( string $plugin_file ) {
		$this->plugin_file = $plugin_file;
	}

	/**
	 * Hooks the page, its settings, the test handler and its notice.
	 */
	public function register(): void {
		add_action( 'admin_menu', array( $this, 'add_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_post_' . self::TEST_ACTION, array( $this, 'handle_test' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
		add_action( 'admin_notices', array( $this, 'test_notice' ) );
		add_filter( 'removable_query_args', array( $this, 'removable_query_args' ) );
		add_filter( 'wp_default_autoload_value', array( $this, 'default_autoload' ), 10, 2 );
		add_filter( 'pre_update_option_' . self::URL_OPTION, array( $this, 'keep_off_autoload' ), 10, 3 );
		add_filter( 'pre_update_option_' . self::SECRET_OPTION, array( $this, 'keep_off_autoload' ), 10, 3 );
	}

	/**
	 * Creates the two fallback options with autoload off. Only a revalidation send and this page read
	 * them, so there is no reason to load them on every request; the secret in particular stays out of
	 * `alloptions`. `options.php` saves through `update_option()` with no autoload argument, which for
	 * a new option asks this filter (WordPress 6.6+). Hooked to `wp_default_autoload_value`.
	 *
	 * @param mixed  $autoload The default so far: null, or what an earlier filter chose.
	 * @param string $option   The option being added.
	 * @return mixed False for the two fallback options, else unchanged.
	 */
	public function default_autoload( $autoload, $option ) {
		return in_array( $option, array( self::URL_OPTION, self::SECRET_OPTION ), true ) ? false : $autoload;
	}

	/**
	 * Turns autoload off for a fallback option that already existed with it on, for example one
	 * stored before this plugin set it. `update_option()` with no autoload argument keeps the stored
	 * flag, so the flag is set here, on every save. This filter runs after the sanitizer and before
	 * core's check for an unchanged value, so it also runs when the value is the same, as when the
	 * secret field is left empty to keep the stored secret; `update_option_{$option}` would not.
	 * Core skips the flag's write when it is already off. Hooked to `pre_update_option_{$option}` for
	 * both options; the value passes through unchanged.
	 *
	 * @param mixed  $value     The new value, already sanitized.
	 * @param mixed  $old_value The previous value.
	 * @param string $option    The option.
	 * @return mixed The new value, unchanged.
	 */
	public function keep_off_autoload( $value, $old_value, $option ) {
		unset( $old_value );
		wp_set_option_autoload_values( array( (string) $option => false ) );

		return $value;
	}

	/**
	 * Adds the page under Settings. Hooked to `admin_menu`.
	 */
	public function add_page(): void {
		add_options_page(
			__( 'Resource Hub', 'resource-hub' ),
			__( 'Resource Hub', 'resource-hub' ),
			self::CAPABILITY,
			self::SLUG,
			array( $this, 'render' )
		);
	}

	/**
	 * Registers the two fallback options with their sanitizers. Hooked to `admin_init`. Neither is
	 * exposed over REST, so the secret never leaves the server.
	 */
	public function register_settings(): void {
		register_setting(
			self::OPTION_GROUP,
			self::URL_OPTION,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( $this, 'sanitize_frontend_url' ),
				'show_in_rest'      => false,
				'default'           => '',
			)
		);

		register_setting(
			self::OPTION_GROUP,
			self::SECRET_OPTION,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( $this, 'sanitize_secret' ),
				'show_in_rest'      => false,
				'default'           => '',
			)
		);
	}

	/**
	 * The front-end URL option's sanitizer: the site's origin only, `https://` except for
	 * `http://localhost` and `http://127.0.0.1` in development, with any port, and no path, query,
	 * fragment or credentials; a trailing slash is dropped. The send appends `/api/revalidate`, so a
	 * path would double it. An empty value clears the option. Anything else is refused with a
	 * settings error and the stored value is kept.
	 *
	 * A null value means the field was not submitted at all, which is what `options.php` passes when
	 * the field is disabled because its constant is defined: the stored value is kept, as the secret's
	 * sanitizer does.
	 *
	 * @param mixed $value The submitted value.
	 */
	public function sanitize_frontend_url( $value ): string {
		if ( null === $value ) {
			return self::stored( self::URL_OPTION );
		}

		$value = is_string( $value ) ? trim( $value ) : '';

		if ( '' === $value ) {
			return '';
		}

		$url = untrailingslashit( sanitize_url( $value, array( 'http', 'https' ) ) );

		if ( '' !== $url && self::is_acceptable_url( $url ) ) {
			return $url;
		}

		add_settings_error(
			self::URL_OPTION,
			'resource_hub_invalid_url',
			__( 'The front-end URL was not saved: give the front end\'s origin only, such as https://hub.example, with no path, query string or fragment. It must start with https://, or with http://localhost or http://127.0.0.1 for development.', 'resource-hub' )
		);

		return self::stored( self::URL_OPTION );
	}

	/**
	 * An option's stored string value, or an empty string.
	 *
	 * @param string $option The option.
	 */
	private static function stored( string $option ): string {
		$stored = get_option( $option, '' );

		return is_string( $stored ) ? $stored : '';
	}

	/**
	 * The secret option's sanitizer. A new secret must pass {@see Config::is_valid_secret()}: 32 to
	 * 256 printable ASCII characters with no whitespace, the rule the front end applies to its own
	 * `REVALIDATE_SECRET`. It is checked as submitted, not trimmed or cleaned, because a secret
	 * with a stray space or newline could never match. Anything else is refused with a settings
	 * error that never repeats the value, and the stored secret is kept. The field is never
	 * prefilled, so an empty submission keeps the stored secret rather than clearing it, and so does
	 * null, which `options.php` saves when the field is disabled because its constant is defined.
	 *
	 * @param mixed $value The submitted value.
	 */
	public function sanitize_secret( $value ): string {
		if ( ! is_string( $value ) || '' === $value ) {
			return self::stored( self::SECRET_OPTION );
		}

		if ( Config::is_valid_secret( $value ) ) {
			return $value;
		}

		add_settings_error(
			self::SECRET_OPTION,
			'resource_hub_invalid_secret',
			__( 'The revalidation secret was not saved: it must be 32 to 256 printable ASCII characters, with no spaces, tabs or line breaks. The stored secret is unchanged.', 'resource-hub' )
		);

		return self::stored( self::SECRET_OPTION );
	}

	/**
	 * Whether a URL is one the option accepts: see {@see StatusPage::sanitize_frontend_url()}.
	 *
	 * @param string $url A URL that `sanitize_url()` has already passed.
	 */
	public static function is_acceptable_url( string $url ): bool {
		$parts = wp_parse_url( $url );

		if ( ! is_array( $parts ) || empty( $parts['host'] ) || empty( $parts['scheme'] ) ) {
			return false;
		}

		if ( isset( $parts['query'] ) || isset( $parts['fragment'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return false;
		}

		if ( '' !== trim( (string) ( $parts['path'] ?? '' ), '/' ) ) {
			return false;
		}

		return self::is_secure_enough( $parts['scheme'], $parts['host'] );
	}

	/**
	 * Whether a configured URL carries the secret safely: HTTPS, or plain HTTP to the local machine only.
	 *
	 * @param string $scheme URL scheme.
	 * @param string $host   URL host.
	 */
	public static function is_secure_enough( string $scheme, string $host ): bool {
		if ( 'https' === strtolower( $scheme ) ) {
			return true;
		}

		return 'http' === strtolower( $scheme ) && in_array( strtolower( $host ), array( 'localhost', '127.0.0.1' ), true );
	}

	/**
	 * The `admin-post.php` handler behind "Send test revalidation": checks the capability and the
	 * nonce, picks the resource, sends through the same path a save takes, records the result in
	 * the non-autoloaded option, and redirects back to the page.
	 */
	public function handle_test(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to send a test revalidation.', 'resource-hub' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( self::TEST_ACTION );

		// The picker's own choice, else the default the page named when it was rendered, so the
		// resource sent is always the one the label showed.
		$resource_id = isset( $_POST['resource_id'] ) ? absint( $_POST['resource_id'] ) : 0;

		if ( 0 === $resource_id ) {
			$resource_id = isset( $_POST['default_resource_id'] ) ? absint( $_POST['default_resource_id'] ) : 0;
		}

		if ( 0 === $resource_id ) {
			$this->redirect( 'none' );
			return;
		}

		$resource = get_post( $resource_id );

		if ( ! $resource instanceof WP_Post || PostType::NAME !== $resource->post_type || 'publish' !== $resource->post_status ) {
			$this->redirect( 'not_published' );
			return;
		}

		$revalidation = Revalidation::instance();
		$result       = $revalidation ? $revalidation->send_update_for( $resource->ID ) : null;

		if ( null === $result ) {
			$this->redirect( 'none' );
			return;
		}

		// The option keeps the result this send returned, never a re-read of the resource's meta, which
		// another send may have written since. It drops the body, which no screen shows, and adds when
		// the test ran and which resource it was.
		$record = $result->to_array();
		unset( $record['body'] );
		$record['time']        = gmdate( 'Y-m-d\TH:i:s\Z' );
		$record['resource_id'] = $resource->ID;

		update_option( self::LAST_TEST_OPTION, $record, false );

		$this->redirect( 'sent' );
	}

	/**
	 * The last test's record, or null when no test has run.
	 *
	 * @return array<string, mixed>|null
	 */
	public static function last_test(): ?array {
		$value = get_option( self::LAST_TEST_OPTION );

		return is_array( $value ) && array() !== $value ? $value : null;
	}

	/**
	 * The most recently modified published resource, or null when none is published.
	 */
	public static function default_resource(): ?WP_Post {
		$found = self::recent_published( 1 );

		return $found[0] ?? null;
	}

	/**
	 * The most recently modified published resources, newest first.
	 *
	 * @param int $limit How many at most.
	 * @return WP_Post[]
	 */
	public static function recent_published( int $limit ): array {
		$query = new WP_Query(
			array(
				'post_type'              => PostType::NAME,
				'post_status'            => 'publish',
				'orderby'                => 'modified',
				'order'                  => 'DESC',
				'posts_per_page'         => $limit,
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		return array_values( array_filter( $query->posts, static fn( $post ): bool => $post instanceof WP_Post ) );
	}

	/**
	 * The page's URL.
	 */
	public static function url(): string {
		return admin_url( 'options-general.php?page=' . self::SLUG );
	}

	/**
	 * Loads the picker's search script on this page only. Hooked to `admin_enqueue_scripts`.
	 *
	 * @param string $hook_suffix The current admin page.
	 */
	public function enqueue( $hook_suffix ): void {
		if ( 'settings_page_' . self::SLUG !== $hook_suffix ) {
			return;
		}

		if ( ! is_readable( dirname( __DIR__, 2 ) . '/build/admin/status-page.asset.php' ) ) {
			return;
		}

		$asset = require dirname( __DIR__, 2 ) . '/build/admin/status-page.asset.php';

		wp_enqueue_script(
			self::HANDLE,
			plugins_url( 'build/admin/status-page.js', $this->plugin_file ),
			$asset['dependencies'] ?? array(),
			$asset['version'] ?? false,
			true
		);

		wp_set_script_translations( self::HANDLE, 'resource-hub' );
	}

	/**
	 * Says what the test button did, after its redirect. Hooked to `admin_notices`.
	 */
	public function test_notice(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		if ( ! $screen || 'settings_page_' . self::SLUG !== $screen->id ) {
			return;
		}

		// Display only: the argument picks a message and changes nothing, so no nonce applies.
		$what = isset( $_GET[ self::RESULT_ARG ] ) ? sanitize_key( wp_unslash( $_GET[ self::RESULT_ARG ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		if ( '' === $what ) {
			return;
		}

		echo self::test_notice_html( $what ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- test_notice_html() escapes every value it prints.
	}

	/**
	 * The notice for a test outcome: the recorded result for `sent`, a plain error for `none` and
	 * `not_published`, and nothing for any other value, which the handler never sends.
	 *
	 * @param string   $what `sent`, `none` or `not_published`.
	 * @param int|null $now  Unix time for the stale check; null means now.
	 */
	public static function test_notice_html( string $what, ?int $now = null ): string {
		if ( ! in_array( $what, self::RESULTS, true ) ) {
			return '';
		}

		if ( 'sent' === $what ) {
			$record = self::last_test();

			if ( null === $record ) {
				return '';
			}

			return '<div class="notice notice-' . esc_attr( ResultText::level( $record ) ) . ' is-dismissible"><p>' . esc_html( ResultText::sentence( $record, $now ) ) . '</p></div>';
		}

		$message = 'not_published' === $what
			? __( 'The test was not sent: that resource is not a published resource.', 'resource-hub' )
			: __( 'The test was not sent: no resource is published.', 'resource-hub' );

		return '<div class="notice notice-error is-dismissible"><p>' . esc_html( $message ) . '</p></div>';
	}

	/**
	 * Lets core drop RESULT_ARG from the address bar once the notice is shown. Hooked to `removable_query_args`.
	 *
	 * @param string[] $args Query arguments core removes.
	 * @return string[]
	 */
	public function removable_query_args( $args ): array {
		$args   = (array) $args;
		$args[] = self::RESULT_ARG;

		return $args;
	}

	/**
	 * Prints the page. The menu callback; core has already checked the capability for the menu,
	 * and the check is repeated here so the rule is stated where the output is.
	 */
	public function render(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'resource-hub' ), '', array( 'response' => 403 ) );
		}

		echo self::html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- html() escapes every value it prints.
	}

	/**
	 * The page's HTML.
	 *
	 * @param int|null $now Unix time for the stale check and relative times; null means now.
	 */
	public static function html( ?int $now = null ): string {
		return '<div class="wrap">'
			. '<h1>' . esc_html__( 'Resource Hub', 'resource-hub' ) . '</h1>'
			. self::status_section( $now )
			. self::test_section()
			. self::settings_section()
			. '</div>';
	}

	/**
	 * The status table: sources, the URL, PostHog and the last test.
	 *
	 * @param int|null $now Unix time for the stale check and relative times; null means now.
	 */
	private static function status_section( ?int $now ): string {
		$url        = Config::frontend_url();
		$url_source = Config::source_of( Config::FRONTEND_URL );
		$url_cell   = 'none' === $url_source
			? '<em>' . esc_html__( 'Not set', 'resource-hub' ) . '</em>'
			: '<code>' . esc_html( $url ) . '</code> ' . esc_html( self::source_words( $url_source, Config::FRONTEND_URL ) );

		$parts = wp_parse_url( $url );

		if ( 'none' !== $url_source && is_array( $parts ) && ! self::is_secure_enough( (string) ( $parts['scheme'] ?? '' ), (string) ( $parts['host'] ?? '' ) ) ) {
			$url_cell .= '<br>' . esc_html__( 'Warning: not HTTPS. The secret travels in a header, so it is sent in the clear.', 'resource-hub' );
		}

		$secret_source = Config::source_of( Config::REVALIDATE_SECRET );
		$secret_cell   = 'none' === $secret_source
			? '<em>' . esc_html__( 'Not set', 'resource-hub' ) . '</em>'
			: esc_html( __( 'Set', 'resource-hub' ) . ' ' . self::source_words( $secret_source, Config::REVALIDATE_SECRET ) );

		if ( Config::has_invalid_secret() ) {
			$secret_cell .= '<br>' . esc_html__( 'Warning: this secret is not 32 to 256 printable ASCII characters with no spaces, tabs or line breaks, so nothing is sent until it is replaced. The front end refuses such a secret too.', 'resource-hub' );
		}

		$posthog_cell = Config::posthog_enabled()
			/* translators: %s: the PostHog host. */
			? esc_html( sprintf( __( 'Configured, sending to %s', 'resource-hub' ), Config::posthog_host() ) )
			: '<em>' . esc_html__( 'Not configured: results are recorded on each resource and term only.', 'resource-hub' ) . '</em>';

		return '<h2>' . esc_html__( 'Revalidation status', 'resource-hub' ) . '</h2>'
			. '<table class="widefat striped">'
			. '<tbody>'
			. '<tr><th scope="row">' . esc_html__( 'Front-end URL', 'resource-hub' ) . '</th><td>' . $url_cell . '</td></tr>'
			. '<tr><th scope="row">' . esc_html__( 'Revalidation secret', 'resource-hub' ) . '</th><td>' . $secret_cell . '</td></tr>'
			. '<tr><th scope="row">' . esc_html__( 'PostHog logging', 'resource-hub' ) . '</th><td>' . $posthog_cell . '</td></tr>'
			. '<tr><th scope="row">' . esc_html__( 'Last test', 'resource-hub' ) . '</th><td>' . self::last_test_cell( $now ) . '</td></tr>'
			. '</tbody></table>';
	}

	/**
	 * "from the constant RESOURCE_HUB_…" or "from the option", for the status table.
	 *
	 * @param string $source   `constant` or `option`.
	 * @param string $constant The constant's name.
	 */
	private static function source_words( string $source, string $constant ): string {
		if ( 'constant' === $source ) {
			/* translators: %s: the PHP constant's name. */
			return sprintf( __( '(from the constant %s)', 'resource-hub' ), $constant );
		}

		/* translators: %s: the option's name. */
		return sprintf( __( '(from the option %s, set below)', 'resource-hub' ), strtolower( $constant ) );
	}

	/**
	 * The "Last test" cell: the result sentence, when, and which resource, linked to its editor.
	 *
	 * @param int|null $now Unix time for the stale check and the relative time; null means now.
	 */
	private static function last_test_cell( ?int $now ): string {
		$record = self::last_test();

		if ( null === $record ) {
			return '<em>' . esc_html__( 'No test sent yet.', 'resource-hub' ) . '</em>';
		}

		$html = esc_html( ResultText::sentence( $record, $now ) );
		$when = ResultText::relative_time( $record, $now );

		if ( '' !== $when ) {
			$html .= ' <time datetime="' . esc_attr( gmdate( 'c', (int) ResultText::timestamp( $record ) ) ) . '" title="' . esc_attr( ResultText::local_time( $record ) ) . '">' . esc_html( $when ) . '</time>';
		}

		$resource = get_post( (int) ( $record['resource_id'] ?? 0 ) );

		if ( $resource instanceof WP_Post ) {
			$title = self::title_of( $resource );
			$link  = get_edit_post_link( $resource );
			$html .= '<br>' . esc_html__( 'Resource:', 'resource-hub' ) . ' '
				. ( $link ? '<a href="' . esc_url( $link ) . '">' . esc_html( $title ) . '</a>' : esc_html( $title ) );
		}

		return $html;
	}

	/**
	 * The "Send test revalidation" form: the picker and the button, disabled with a reason when
	 * nothing is published. The disabled button keeps `aria-disabled` rather than `disabled`, so it
	 * stays in the tab order and announces its reason, which is also visible text beside it. The
	 * default resource is resolved here, once, and its ID travels in a hidden field, so the label and
	 * the resource sent always match.
	 */
	private static function test_section(): string {
		$recent = self::recent_published( self::PICKER_LIMIT );
		$html   = '<h2>' . esc_html__( 'Send test revalidation', 'resource-hub' ) . '</h2>'
			. '<p>' . esc_html__( 'Sends a real update event for one published resource, so a pass proves the whole path a save takes: the secret, the request body and the revalidation of that resource\'s pages. The result is recorded on the resource like the result of a save.', 'resource-hub' ) . '</p>';

		if ( array() === $recent ) {
			return $html
				. '<p><button type="button" class="button button-primary disabled" aria-disabled="true" aria-describedby="rh-test-disabled">' . esc_html__( 'Send test revalidation', 'resource-hub' ) . '</button> '
				. '<span class="description" id="rh-test-disabled">' . esc_html__( 'The button is disabled because no resource is published. A test sends a real event for a published resource, so there is nothing to send yet.', 'resource-hub' ) . '</span></p>';
		}

		$options = '<option value="">' . esc_html(
			/* translators: %s: the title of the most recently modified published resource. */
			sprintf( __( 'Most recently modified: %s', 'resource-hub' ), self::title_of( $recent[0] ) )
		) . '</option>';

		foreach ( $recent as $resource ) {
			$options .= '<option value="' . esc_attr( (string) $resource->ID ) . '">' . esc_html( self::title_of( $resource ) ) . '</option>';
		}

		return $html
			. '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" id="rh-test-form">'
			. wp_nonce_field( self::TEST_ACTION, '_wpnonce', true, false )
			. '<input type="hidden" name="action" value="' . esc_attr( self::TEST_ACTION ) . '">'
			. '<input type="hidden" name="default_resource_id" value="' . esc_attr( (string) $recent[0]->ID ) . '">'
			. '<table class="form-table" role="presentation"><tbody>'
			. '<tr><th scope="row"><label for="rh-test-search">' . esc_html__( 'Find a resource', 'resource-hub' ) . '</label></th>'
			. '<td><input type="search" id="rh-test-search" class="regular-text" placeholder="' . esc_attr__( 'Search published resources', 'resource-hub' ) . '" autocomplete="off" aria-describedby="rh-test-search-help">'
			. '<p class="description" id="rh-test-search-help">' . esc_html__( 'Type to search the published resources; the list below updates. Without a search it lists the most recently modified ones.', 'resource-hub' ) . '</p>'
			. '<p class="description" id="rh-test-search-status" role="status" aria-live="polite"></p></td></tr>'
			. '<tr><th scope="row"><label for="rh-test-resource">' . esc_html__( 'Resource to send', 'resource-hub' ) . '</label></th>'
			. '<td><select name="resource_id" id="rh-test-resource">' . $options . '</select></td></tr>'
			. '</tbody></table>'
			. '<p class="submit"><button type="submit" class="button button-primary" id="rh-test-submit">' . esc_html__( 'Send test revalidation', 'resource-hub' ) . '</button></p>'
			. '</form>';
	}

	/**
	 * The fallback settings form, posted to `options.php`. A field whose constant is defined is
	 * disabled, because the constant wins. The secret field is never prefilled.
	 */
	private static function settings_section(): string {
		$url_constant    = 'constant' === Config::source_of( Config::FRONTEND_URL );
		$secret_constant = 'constant' === Config::source_of( Config::REVALIDATE_SECRET );
		$stored_url      = get_option( self::URL_OPTION, '' );
		$stored_url      = is_string( $stored_url ) ? $stored_url : '';
		$secret_stored   = 'none' !== Config::source_of( Config::REVALIDATE_SECRET );

		ob_start();
		settings_fields( self::OPTION_GROUP );
		$fields = (string) ob_get_clean();

		$secret_help = $secret_constant
			? __( 'Ignored while the constant is defined.', 'resource-hub' )
			: ( $secret_stored
				? __( 'A secret is stored. Enter a new one to replace it; leave this empty to keep it. It is never shown.', 'resource-hub' )
				: __( 'The bearer token the front end expects. It is never shown once saved.', 'resource-hub' ) );

		return '<h2>' . esc_html__( 'Fallback settings', 'resource-hub' ) . '</h2>'
			. '<p>' . esc_html__( 'The constants RESOURCE_HUB_FRONTEND_URL and RESOURCE_HUB_REVALIDATE_SECRET in wp-config.php win. These options are used only when a constant is not defined.', 'resource-hub' ) . '</p>'
			. '<p>' . esc_html__( 'Each field is saved on its own: a front-end URL that is refused keeps the stored URL, while a new secret in the same submission is still saved.', 'resource-hub' ) . '</p>'
			. '<form method="post" action="' . esc_url( admin_url( 'options.php' ) ) . '">'
			. $fields
			. '<table class="form-table" role="presentation"><tbody>'
			. '<tr><th scope="row"><label for="rh-frontend-url">' . esc_html__( 'Front-end URL', 'resource-hub' ) . '</label></th>'
			. '<td><input type="url" id="rh-frontend-url" name="' . esc_attr( self::URL_OPTION ) . '" class="regular-text code" value="' . esc_attr( $stored_url ) . '" placeholder="https://"' . ( $url_constant ? ' disabled' : '' ) . '>'
			. '<p class="description">' . esc_html( $url_constant ? __( 'Ignored while the constant is defined.', 'resource-hub' ) : __( 'The front end\'s origin only, with no path, such as https://hub.example; https:// only, with http://localhost or http://127.0.0.1 allowed for development.', 'resource-hub' ) ) . '</p></td></tr>'
			. '<tr><th scope="row"><label for="rh-revalidate-secret">' . esc_html__( 'Revalidation secret', 'resource-hub' ) . '</label></th>'
			. '<td><input type="password" id="rh-revalidate-secret" name="' . esc_attr( self::SECRET_OPTION ) . '" class="regular-text" value="" autocomplete="new-password"' . ( $secret_constant ? ' disabled' : '' ) . '>'
			. '<p class="description">' . esc_html( $secret_help ) . '</p></td></tr>'
			. '</tbody></table>'
			. get_submit_button( __( 'Save settings', 'resource-hub' ), 'secondary', 'submit', true, $url_constant && $secret_constant ? array( 'disabled' => 'disabled' ) : '' )
			. '</form>';
	}

	/**
	 * A resource's title for a label, or "(no title)".
	 *
	 * @param WP_Post $post The resource.
	 */
	private static function title_of( WP_Post $post ): string {
		$title = trim( wp_strip_all_tags( $post->post_title ) );

		return '' === $title ? __( '(no title)', 'resource-hub' ) : $title;
	}

	/**
	 * Redirects back to the page with RESULT_ARG set and ends the request. Separate so tests can
	 * catch the exit through `wp_redirect`.
	 *
	 * @param string $what `sent`, `none` or `not_published`.
	 */
	private function redirect( string $what ): void {
		wp_safe_redirect( add_query_arg( self::RESULT_ARG, $what, self::url() ) );
		exit;
	}
}
