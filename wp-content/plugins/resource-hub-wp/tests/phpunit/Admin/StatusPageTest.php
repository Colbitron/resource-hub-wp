<?php
/**
 * Settings > Resource Hub: the status page, the fallback options and the test button (see `docs/architecture/revalidation.md`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Admin;

use ResourceHub\Admin\ResultText;
use ResourceHub\Admin\StatusPage;
use ResourceHub\Revalidation\Config;
use ResourceHub\Revalidation\Payload;
use ResourceHub\Revalidation\ResourceEvents;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use ResourceHub\Revalidation\Revalidation;
use ResourceHub\Revalidation\Sender;
use ResourceHub\Tests\Revalidation\RevalidationTestCase;
use RuntimeException;
use WPDieException;

/**
 * Tests for {@see StatusPage}. The HTTP mock from the base class answers the test button's send.
 */
final class StatusPageTest extends RevalidationTestCase {
	/**
	 * A secret that meets the rule: 32 printable ASCII characters or more, no whitespace.
	 */
	private const STORED_SECRET = 'stored-secret-0123456789abcdefghijk';

	/**
	 * How the "Last test" cell and the notice's paragraph open: with the style that wraps a long message.
	 */
	private const CELL   = '<td style="overflow-wrap:anywhere">';
	private const NOTICE = '<p style="overflow-wrap:anywhere">';

	/**
	 * The page under test.
	 *
	 * @var StatusPage
	 */
	private StatusPage $page;

	/**
	 * Loads the admin includes the page uses, logs in an administrator, and turns the handler's
	 * redirect into an exception so the test regains control before `exit`.
	 */
	public function set_up(): void {
		parent::set_up();

		require_once ABSPATH . 'wp-admin/includes/admin.php';

		$this->page = new StatusPage( dirname( __DIR__, 3 ) . '/resource-hub.php' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		add_filter(
			'wp_redirect',
			static function ( string $location ): string {
				throw new RuntimeException( esc_url_raw( $location ) );
			}
		);
	}

	/**
	 * Clears the request globals and the options the tests set.
	 */
	public function tear_down(): void {
		$_POST    = array();
		$_REQUEST = array();
		delete_option( StatusPage::LAST_TEST_OPTION );
		delete_option( StatusPage::URL_OPTION );
		delete_option( StatusPage::SECRET_OPTION );
		parent::tear_down();
	}

	/**
	 * Submits the test form as the current user, with a valid nonce unless told otherwise. The hidden
	 * default is the one the page would render now, unless given.
	 *
	 * @param int      $resource_id The chosen resource, or 0 for the default.
	 * @param bool     $with_nonce  Whether to include a valid nonce.
	 * @param int|null $default_id  The hidden default's ID; null means what the page would render now.
	 */
	private function submit( int $resource_id = 0, bool $with_nonce = true, ?int $default_id = null ): void {
		$_POST = array(
			'resource_id'         => (string) $resource_id,
			'default_resource_id' => (string) ( $default_id ?? StatusPage::default_resource()?->ID ?? 0 ),
		);

		if ( $with_nonce ) {
			$_REQUEST['_wpnonce'] = wp_create_nonce( StatusPage::TEST_ACTION );
		}
	}

	/**
	 * Runs the handler and returns the `rh_test` value it redirected with.
	 */
	private function handle(): string {
		try {
			$this->page->handle_test();
		} catch ( RuntimeException $redirect ) {
			$query = (string) wp_parse_url( $redirect->getMessage(), PHP_URL_QUERY );
			parse_str( $query, $args );

			$this->assertStringStartsWith( StatusPage::url(), $redirect->getMessage() );

			return (string) ( $args[ StatusPage::RESULT_ARG ] ?? '' );
		}

		$this->fail( 'The handler did not redirect.' );
	}

	/**
	 * A user without `manage_options` is refused with a 403 before anything else is read.
	 */
	public function test_handler_needs_manage_options(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->make_resource( 'publish', 'guarded' );
		$this->submit();

		try {
			$this->page->handle_test();
			$this->fail( 'The editor was not refused.' );
		} catch ( WPDieException $refusal ) {
			$this->assertStringContainsString( 'not allowed', $refusal->getMessage() );
		}

		$this->assertSame( array(), $this->requests );
		$this->assertNull( StatusPage::last_test() );
	}

	/**
	 * A missing or wrong nonce is refused by `check_admin_referer()`.
	 */
	public function test_handler_needs_a_nonce(): void {
		$this->make_resource( 'publish', 'guarded' );
		$this->submit( 0, false );

		$this->expectException( WPDieException::class );
		$this->page->handle_test();
	}

	/**
	 * With nothing chosen, the button sends a real `update` for the most recently modified published
	 * resource, and the result lands in that resource's meta and in the non-autoloaded option, body
	 * included, so the page can word it as the editor does.
	 */
	public function test_handler_sends_for_the_most_recently_modified_resource(): void {
		$this->configure();
		$older = $this->make_resource( 'publish', 'older', 'webinar', array( 'performance' ) );
		$newer = $this->make_resource( 'publish', 'newer', 'ebook' );
		$this->make_resource( 'draft', 'draft-newest' );
		$this->set_modified( $older, '2026-01-01 10:00:00' );
		$this->set_modified( $newer, '2026-06-01 10:00:00' );
		$this->responder = static fn(): array => self::http_response( 200, '{"revalidated":["/resources/"]}' );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );

		$sent = $this->revalidate_requests();
		$this->assertCount( 1, $sent );
		$body = json_decode( $sent[0]['args']['body'], true );
		$this->assertSame( 'update', $body['events'][0]['event'] );
		$this->assertSame( $newer, $body['events'][0]['id'] );
		$this->assertSame( array( 'ebook' ), $body['events'][0]['types'] );
		$this->assert_valid_request( $body );

		$meta = ResultStore::read_post( $newer );
		$this->assertSame( Result::SENT, $meta['status'] );
		$this->assertSame( Result::OK, $meta['outcome'] );
		$this->assertNull( ResultStore::read_post( $older ) );

		$option = StatusPage::last_test();
		$this->assertSame( $newer, $option['resource_id'] );
		$this->assertSame( Result::OK, $option['outcome'] );
		$this->assertSame( 200, $option['code'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $option['time'] );
		$this->assertSame( '{"revalidated":["/resources/"]}', $option['body'] );
		$this->assertFalse( $option['truncated'] );

		wp_cache_delete( 'alloptions', 'options' );
		$this->assertArrayNotHasKey( StatusPage::LAST_TEST_OPTION, wp_load_alloptions(), 'The last test must not be autoloaded.' );
	}

	/**
	 * The default is the one the page named when it was rendered, carried in the hidden field: a
	 * resource modified after the page loaded does not take its place.
	 */
	public function test_handler_sends_the_default_the_page_showed(): void {
		$this->configure();
		$shown = $this->make_resource( 'publish', 'shown' );
		$this->set_modified( $shown, '2026-01-01 10:00:00' );
		$this->assertStringContainsString( 'name="default_resource_id" value="' . $shown . '"', StatusPage::html() );

		$later = $this->make_resource( 'publish', 'modified-after-render' );
		$this->set_modified( $later, '2026-06-01 10:00:00' );
		$this->submit( 0, true, $shown );

		$this->assertSame( 'sent', $this->handle() );
		$this->assertSame( $shown, StatusPage::last_test()['resource_id'] );

		$sent = $this->revalidate_requests();
		$this->assertCount( 1, $sent );
		$this->assertSame( $shown, json_decode( $sent[0]['args']['body'], true )['events'][0]['id'] );
	}

	/**
	 * A chosen published resource is the one sent; a chosen draft or a non-resource is refused and
	 * nothing is sent.
	 */
	public function test_handler_honours_the_picker(): void {
		$this->configure();
		$chosen = $this->make_resource( 'publish', 'chosen' );
		$this->make_resource( 'publish', 'newest' );
		$this->submit( $chosen );

		$this->assertSame( 'sent', $this->handle() );
		$this->assertSame( $chosen, StatusPage::last_test()['resource_id'] );
		$this->assertCount( 1, $this->revalidate_requests() );

		$draft = $this->make_resource( 'draft', 'a-draft' );
		$this->submit( $draft );
		$this->assertSame( 'not_published', $this->handle() );

		$page = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$this->submit( $page );
		$this->assertSame( 'not_published', $this->handle() );

		$this->assertCount( 1, $this->revalidate_requests() );
		$this->assertSame( $chosen, StatusPage::last_test()['resource_id'] );
	}

	/**
	 * On a site whose cron never ran, the resource holds a stuck `pending` from a save. The test has no
	 * `pending` of its own, so its result is written over that one, and "Last test" shows the result
	 * the send returned, not the stuck `pending`.
	 */
	public function test_handler_records_its_own_result_over_a_stuck_pending(): void {
		$this->configure();
		$post_id = $this->make_resource( 'publish', 'stuck' );
		Revalidation::instance()->store()->mark_pending( 'never-sent', array( ResourceEvents::update_event_for( get_post( $post_id ) ) ) );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_post( $post_id )['status'] );
		$this->responder = static fn(): array => self::http_response( 401, '{"error":"unauthorized"}' );
		$this->submit( $post_id );

		$this->assertSame( 'sent', $this->handle() );

		$meta = ResultStore::read_post( $post_id );
		$this->assertSame( Result::UNAUTHORIZED, $meta['outcome'] );
		$this->assertNotSame( 'never-sent', $meta['batch_id'] );

		$option = StatusPage::last_test();
		$this->assertSame( Result::FAILED, $option['status'] );
		$this->assertSame( Result::UNAUTHORIZED, $option['outcome'] );
		$this->assertSame( $post_id, $option['resource_id'] );

		$html = StatusPage::html();
		$this->assertStringContainsString( 'the secret does not match (401)', $html );
		$this->assertStringNotContainsString( 'Revalidation is pending', $html );
	}

	/**
	 * A test that gets a 400 or 500 with an `error` string shows that message on the status page, in
	 * the "Last test" cell and in the notice after the redirect, in the sentence the block editor shows.
	 *
	 * @dataProvider front_end_errors
	 *
	 * @param int    $code     The front end's status.
	 * @param string $expected The sentence the page shows.
	 */
	public function test_test_shows_the_front_ends_error_message( int $code, string $expected ): void {
		$this->configure();
		$post_id         = $this->make_resource( 'publish', 'quoted' );
		$this->responder = static fn(): array => self::http_response( $code, '{"error":"Revalidation failed: fetch to the CMS timed out"}' );
		$this->submit( $post_id );

		$this->assertSame( 'sent', $this->handle() );

		$this->assertSame( $expected, ResultText::sentence( ResultStore::read_post( $post_id ) ), 'The editor reads the same sentence from the meta.' );
		$this->assertStringContainsString( self::CELL . esc_html( $expected ) . ' <time', StatusPage::html() );
		$this->assertStringContainsString( self::NOTICE . esc_html( $expected ) . '</p>', StatusPage::test_notice_html( 'sent' ) );
	}

	/**
	 * Cases for test_test_shows_the_front_ends_error_message().
	 *
	 * @return array<string, array{0: int, 1: string}>
	 */
	public function front_end_errors(): array {
		return array(
			'500 with an error' => array( 500, 'Revalidation failed on the front end (500). Revalidation failed: fetch to the CMS timed out' ),
			'400 with an error' => array( 400, 'Revalidation rejected: the front end could not read the request (400). Revalidation failed: fetch to the CMS timed out' ),
		);
	}

	/**
	 * A front end's message that holds markup is printed as text, in the cell and in the notice.
	 */
	public function test_test_escapes_the_front_ends_message(): void {
		$this->configure();
		$this->make_resource( 'publish', 'markup' );
		$this->responder = static fn(): array => self::http_response( 500, '{"error":"<script>alert(1)</script> & <b>bold</b>"}' );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );

		$escaped = 'Revalidation failed on the front end (500). &lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;';

		foreach ( array( StatusPage::html(), StatusPage::test_notice_html( 'sent' ) ) as $html ) {
			$this->assertStringContainsString( $escaped, $html );
			$this->assertStringNotContainsString( '<script>alert', $html );
			$this->assertStringNotContainsString( '<b>bold', $html );
		}
	}

	/**
	 * A test whose 500 body was over 1 KB, so cut before its message could be read, says the reply was
	 * too long to show, in the cell and in the notice.
	 */
	public function test_test_says_a_cut_reply_was_too_long(): void {
		$this->configure();
		$this->make_resource( 'publish', 'long-reply' );
		$this->responder = static fn(): array => self::http_response( 500, '{"error":"' . str_repeat( 'x', 2 * Result::BODY_LIMIT ) . '"}' );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );
		$this->assertTrue( StatusPage::last_test()['truncated'] );

		$expected = esc_html( 'Revalidation failed on the front end (500). The front end\'s reply was too long to show (over 1 KB).' );
		$this->assertStringContainsString( self::CELL . $expected . ' <time', StatusPage::html() );
		$this->assertStringContainsString( self::NOTICE . $expected . '</p>', StatusPage::test_notice_html( 'sent' ) );
	}

	/**
	 * A 500 whose body is a proxy's HTML page over 1 KB is cut, but it never held a message, so the page
	 * shows the plain sentence with no too-long note, as for a short HTML page.
	 */
	public function test_test_with_a_long_html_page_has_no_note(): void {
		$this->configure();
		$this->make_resource( 'publish', 'long-html' );
		$this->responder = static fn(): array => self::http_response( 500, '<!doctype html><title>502 Bad Gateway</title>' . str_repeat( '<p>proxy</p>', 200 ) );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );
		$this->assertTrue( StatusPage::last_test()['truncated'] );

		$expected = 'Revalidation failed on the front end (500).';
		$this->assertStringContainsString( self::CELL . $expected . ' <time', StatusPage::html() );
		$this->assertStringContainsString( self::NOTICE . $expected . '</p>', StatusPage::test_notice_html( 'sent' ) );
	}

	/**
	 * A front end's message of about 1 KB with no space in it wraps in the cell and the notice, rather
	 * than stretching the table past the screen.
	 */
	public function test_long_unbroken_message_wraps(): void {
		$this->configure();
		$this->make_resource( 'publish', 'unbroken' );
		$message         = str_repeat( 'x', 1000 );
		$this->responder = static fn(): array => self::http_response( 500, '{"error":"' . $message . '"}' );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );
		$this->assertFalse( StatusPage::last_test()['truncated'] );
		$this->assertSame( 'overflow-wrap:anywhere', StatusPage::WRAP_STYLE );
		$this->assertStringContainsString( self::CELL . 'Revalidation failed on the front end (500). ' . $message . ' <time', StatusPage::html() );
		$this->assertStringContainsString( self::NOTICE . 'Revalidation failed on the front end (500). ' . $message . '</p>', StatusPage::test_notice_html( 'sent' ) );
	}

	/**
	 * What quoted nothing before still quotes nothing: a 401, which never quotes its body, and a 400 or
	 * 500 whose short body is not the contract's JSON.
	 *
	 * @dataProvider unquoted_replies
	 *
	 * @param int    $code     The front end's status.
	 * @param string $body     Its body.
	 * @param string $expected The sentence the page shows, whole.
	 */
	public function test_test_without_a_message_is_unchanged( int $code, string $body, string $expected ): void {
		$this->configure();
		$this->make_resource( 'publish', 'unquoted' );
		$this->responder = static fn(): array => self::http_response( $code, $body );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );
		$this->assertFalse( StatusPage::last_test()['truncated'] );
		$this->assertStringContainsString( self::CELL . esc_html( $expected ) . ' <time', StatusPage::html() );
		$this->assertStringContainsString( self::NOTICE . esc_html( $expected ) . '</p>', StatusPage::test_notice_html( 'sent' ) );
	}

	/**
	 * Cases for test_test_without_a_message_is_unchanged().
	 *
	 * @return array<string, array{0: int, 1: string, 2: string}>
	 */
	public function unquoted_replies(): array {
		return array(
			'401 unauthorized'   => array( 401, '{"error":"unauthorized"}', 'Revalidation rejected: the secret does not match (401).' ),
			'500 HTML page'      => array( 500, '<html><body>Internal Server Error</body></html>', 'Revalidation failed on the front end (500).' ),
			'500 plain text'     => array( 500, 'Internal Server Error', 'Revalidation failed on the front end (500).' ),
			'400 JSON, no error' => array( 400, '{"message":"bad"}', 'Revalidation rejected: the front end could not read the request (400).' ),
			'500 error not text' => array( 500, '{"error":{"path":"events"}}', 'Revalidation failed on the front end (500).' ),
		);
	}

	/**
	 * With no published resource there is nothing real to send: the handler redirects with `none`.
	 */
	public function test_handler_with_nothing_published(): void {
		$this->configure();
		$this->make_resource( 'draft', 'only-a-draft' );
		$this->submit();

		$this->assertSame( 'none', $this->handle() );
		$this->assertSame( array(), $this->revalidate_requests() );
		$this->assertNull( StatusPage::last_test() );
	}

	/**
	 * Unconfigured, the test records "not configured" on the resource and in the option, like a save would.
	 */
	public function test_handler_records_not_configured(): void {
		$post_id = $this->make_resource( 'publish', 'unconfigured' );
		$this->submit();

		$this->assertSame( 'sent', $this->handle() );
		$this->assertSame( array(), $this->requests );
		$this->assertSame( Result::NOT_CONFIGURED, ResultStore::read_post( $post_id )['outcome'] );
		$this->assertSame( Result::NOT_CONFIGURED, StatusPage::last_test()['outcome'] );
	}

	/**
	 * The test's result notice reads the option; the other outcomes have plain messages.
	 */
	public function test_notice_after_the_redirect(): void {
		$this->assertSame( '', StatusPage::test_notice_html( 'sent' ) );

		update_option( StatusPage::LAST_TEST_OPTION, ResultTextTest::record( array( 'outcome' => Result::UNAUTHORIZED ) ), false );
		$this->assertStringContainsString( 'notice-error', StatusPage::test_notice_html( 'sent' ) );
		$this->assertStringContainsString( 'the secret does not match (401)', StatusPage::test_notice_html( 'sent' ) );

		$this->assertStringContainsString( 'no resource is published', StatusPage::test_notice_html( 'none' ) );
		$this->assertStringContainsString( 'not a published resource', StatusPage::test_notice_html( 'not_published' ) );
	}

	/**
	 * A value the handler never sends shows nothing, rather than a false "no resource is published".
	 */
	public function test_notice_ignores_unknown_values(): void {
		$this->make_resource( 'publish', 'published' );
		update_option( StatusPage::LAST_TEST_OPTION, ResultTextTest::record(), false );

		foreach ( array( 'bogus', 'sent2', 'error', 'nonee' ) as $what ) {
			$this->assertSame( '', StatusPage::test_notice_html( $what ), $what );
		}
	}

	/**
	 * With nothing published the button is disabled and says why; with a published resource the form
	 * is there, the default option names the most recently modified one, and the picker lists the rest.
	 */
	public function test_button_disabled_until_something_is_published(): void {
		$this->make_resource( 'draft', 'a-draft' );

		$html = StatusPage::html();
		$this->assertStringContainsString( 'aria-disabled="true" aria-describedby="rh-test-disabled">Send test revalidation</button>', $html );
		$this->assertStringContainsString( '<span class="description" id="rh-test-disabled">The button is disabled because no resource is published.', $html );
		$this->assertStringNotContainsString( 'id="rh-test-form"', $html );

		$older = $this->make_resource( 'publish', 'older-one' );
		$newer = $this->make_resource( 'publish', 'newer-one' );
		$this->set_modified( $older, '2026-01-01 10:00:00' );
		$this->set_modified( $newer, '2026-06-01 10:00:00' );

		$html = StatusPage::html();
		$this->assertStringContainsString( 'id="rh-test-form"', $html );
		$this->assertStringContainsString( '<option value="">Most recently modified: Newer one</option>', $html );
		$this->assertStringContainsString( '<option value="' . $older . '">Older one</option>', $html );
		$this->assertStringContainsString( 'name="action" value="' . StatusPage::TEST_ACTION . '"', $html );
		$this->assertStringContainsString( 'name="_wpnonce"', $html );
		$this->assertStringContainsString( 'name="default_resource_id" value="' . $newer . '"', $html );
		$this->assertStringContainsString( 'aria-describedby="rh-test-search-help"', $html );
		$this->assertStringContainsString( 'id="rh-test-search-help"', $html );
		$this->assertStringContainsString( 'id="rh-test-search-status" role="status" aria-live="polite"', $html );
		$this->assertStringNotContainsString( 'aria-disabled', $html );
		$this->assertSame( substr_count( $html, 'style=' ), substr_count( $html, 'style="' . StatusPage::WRAP_STYLE . '"' ), 'The only inline style is the one that wraps a long message.' );
	}

	/**
	 * The status table says where each value comes from and shows the URL, and the secret is never in
	 * the page, not even when the option holds it. Unset values read as not set.
	 */
	public function test_status_shows_sources_and_never_the_secret(): void {
		$html = StatusPage::html();
		$this->assertStringContainsString( 'Not set', $html );
		$this->assertStringContainsString( 'No test sent yet.', $html );
		$this->assertStringContainsString( 'Not configured: results are recorded', $html );

		$this->configure( 'https://hub.example/', 'sup3r-secret-value-0123456789abcdef' );

		$html = StatusPage::html();
		$this->assertStringContainsString( '<code>https://hub.example</code>', $html );
		$this->assertStringContainsString( 'from the option resource_hub_frontend_url', $html );
		$this->assertStringContainsString( 'Set (from the option resource_hub_revalidate_secret', $html );
		$this->assertStringNotContainsString( 'sup3r', $html );
		$this->assertStringNotContainsString( 'secret-value', $html );
		$this->assertStringContainsString( 'value="https://hub.example/"', $html, 'The form shows the option as stored; the sanitizer normalises on save.' );
		$this->assertStringContainsString( 'type="password" id="rh-revalidate-secret" name="resource_hub_revalidate_secret" class="regular-text" value=""', $html );
		$this->assertStringNotContainsString( 'Warning: not HTTPS', $html );
	}

	/**
	 * A configured URL that is not HTTPS, other than the local machine, is flagged on the page.
	 */
	public function test_status_flags_a_plain_http_url(): void {
		$this->configure( 'http://hub.example/' );
		$this->assertStringContainsString( 'Warning: not HTTPS', StatusPage::html() );

		$this->configure( 'http://localhost:3000/' );
		$this->assertStringNotContainsString( 'Warning: not HTTPS', StatusPage::html() );
	}

	/**
	 * The last test shows its sentence, its time and a link to the resource, and a stale `pending`
	 * reads as no answer recorded.
	 */
	public function test_status_shows_the_last_test(): void {
		$post_id = $this->make_resource( 'publish', 'tested-one' );
		$written = 1_800_000_000;
		update_option(
			StatusPage::LAST_TEST_OPTION,
			ResultTextTest::record(
				array(
					'status'      => ResultStore::PENDING,
					'outcome'     => ResultStore::PENDING,
					'time'        => gmdate( 'Y-m-d\TH:i:s\Z', $written ),
					'resource_id' => $post_id,
				)
			),
			false
		);

		$fresh = StatusPage::html( $written + 30 );
		$this->assertStringContainsString( 'Revalidation is pending', $fresh );
		$this->assertStringContainsString( '>Tested one</a>', $fresh );

		$stale = StatusPage::html( $written + 600 );
		$this->assertStringContainsString( 'No answer recorded: the send may not have run.', $stale );
	}

	/**
	 * The fallback options are registered in the group, with their sanitizers and no REST exposure.
	 */
	public function test_settings_are_registered(): void {
		$this->page->register_settings();

		$registered = get_registered_settings();
		$this->assertSame( StatusPage::OPTION_GROUP, $registered[ StatusPage::URL_OPTION ]['group'] );
		$this->assertSame( StatusPage::OPTION_GROUP, $registered[ StatusPage::SECRET_OPTION ]['group'] );
		$this->assertFalse( $registered[ StatusPage::SECRET_OPTION ]['show_in_rest'] );
		$this->assertFalse( $registered[ StatusPage::URL_OPTION ]['show_in_rest'] );

		$this->assertSame( 'https://hub.example', sanitize_option( StatusPage::URL_OPTION, 'https://hub.example/' ) );
	}

	/**
	 * The URL sanitizer accepts HTTPS and the local machine over HTTP, strips the trailing slash,
	 * clears on empty, and otherwise keeps the stored value with a settings error.
	 *
	 * @dataProvider urls
	 *
	 * @param string $input    What was submitted.
	 * @param string $expected What is stored.
	 * @param bool   $refused  Whether a settings error is added.
	 */
	public function test_sanitize_frontend_url( string $input, string $expected, bool $refused ): void {
		update_option( StatusPage::URL_OPTION, 'https://kept.example' );
		$before = count( get_settings_errors( StatusPage::URL_OPTION ) );

		$this->assertSame( $expected, $this->page->sanitize_frontend_url( $input ) );

		// Settings errors accumulate in a global for the whole run, so only the new ones count.
		$errors = get_settings_errors( StatusPage::URL_OPTION );
		$this->assertSame( $refused ? 1 : 0, count( $errors ) - $before );

		if ( $refused ) {
			$this->assertStringContainsString( 'origin only', end( $errors )['message'] );
			$this->assertStringContainsString( 'must start with https://', end( $errors )['message'] );
		}
	}

	/**
	 * A disabled field is not submitted, so `options.php` saves null: the stored URL is kept, not
	 * wiped, both from the sanitizer directly and through the Settings API.
	 */
	public function test_unsubmitted_url_keeps_the_stored_value(): void {
		$this->page->register_settings();
		update_option( StatusPage::URL_OPTION, 'https://kept.example' );

		$this->assertSame( 'https://kept.example', $this->page->sanitize_frontend_url( null ) );

		update_option( StatusPage::URL_OPTION, null );
		$this->assertSame( 'https://kept.example', get_option( StatusPage::URL_OPTION ) );

		update_option( StatusPage::SECRET_OPTION, self::STORED_SECRET );
		update_option( StatusPage::SECRET_OPTION, null );
		$this->assertSame( self::STORED_SECRET, get_option( StatusPage::SECRET_OPTION ) );
	}

	/**
	 * Both fallback options are stored with autoload off: a new one through the default-autoload
	 * filter, and one that already existed autoloaded once it is next saved, as `options.php` saves.
	 */
	public function test_fallback_options_are_not_autoloaded(): void {
		$this->page->register_settings();

		update_option( StatusPage::URL_OPTION, 'https://hub.example' );
		update_option( StatusPage::SECRET_OPTION, 'new-secret-0123456789abcdefghijklmnop' );

		wp_cache_delete( 'alloptions', 'options' );
		$loaded = wp_load_alloptions();
		$this->assertArrayNotHasKey( StatusPage::URL_OPTION, $loaded );
		$this->assertArrayNotHasKey( StatusPage::SECRET_OPTION, $loaded );
		$this->assertSame( 'new-secret-0123456789abcdefghijklmnop', get_option( StatusPage::SECRET_OPTION ) );

		delete_option( StatusPage::SECRET_OPTION );
		add_option( StatusPage::SECRET_OPTION, 'old-secret-0123456789abcdefghijklmnop', '', true );
		wp_cache_delete( 'alloptions', 'options' );
		$this->assertArrayHasKey( StatusPage::SECRET_OPTION, wp_load_alloptions(), 'The setup must start autoloaded.' );

		update_option( StatusPage::SECRET_OPTION, 'rotated-secret-0123456789abcdefghijkl' );

		wp_cache_delete( 'alloptions', 'options' );
		$this->assertArrayNotHasKey( StatusPage::SECRET_OPTION, wp_load_alloptions() );
		$this->assertSame( 'rotated-secret-0123456789abcdefghijkl', get_option( StatusPage::SECRET_OPTION ) );
	}

	/**
	 * A fallback option stored with the legacy `autoload = 'yes'` is switched off on any save, even
	 * one that leaves the value unchanged: the same URL saved again, the same secret saved again, and
	 * an empty secret field, which keeps the stored secret. Core skips `update_option_{$option}` for
	 * an unchanged value, so the flag is set before its check.
	 */
	public function test_legacy_autoloaded_option_is_switched_off_by_an_unchanged_save(): void {
		$this->page->register_settings();

		$cases = array(
			'same URL'     => array( StatusPage::URL_OPTION, 'https://hub.example', 'https://hub.example' ),
			'same secret'  => array( StatusPage::SECRET_OPTION, self::STORED_SECRET, self::STORED_SECRET ),
			'empty secret' => array( StatusPage::SECRET_OPTION, self::STORED_SECRET, '' ),
		);

		foreach ( $cases as $name => list( $option, $stored, $submitted ) ) {
			$this->force_legacy_autoload( $option, $stored );
			$this->assertArrayHasKey( $option, wp_load_alloptions(), "$name: the setup must start autoloaded." );

			update_option( $option, $submitted );

			wp_cache_delete( 'alloptions', 'options' );
			$this->assertArrayNotHasKey( $option, wp_load_alloptions(), "$name: the option must no longer be autoloaded." );
			$this->assertSame( $stored, get_option( $option ), "$name: the stored value must be kept." );
		}
	}

	/**
	 * Stores an option with `autoload = 'yes'`, the value WordPress used before 6.6, and clears the
	 * option caches so the next read sees the row as it is.
	 *
	 * @param string $option The option.
	 * @param string $value  Its value.
	 */
	private function force_legacy_autoload( string $option, string $value ): void {
		global $wpdb;

		delete_option( $option );
		add_option( $option, $value, '', true );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- The test needs a row core no longer writes; the caches are cleared below.
		$wpdb->update( $wpdb->options, array( 'autoload' => 'yes' ), array( 'option_name' => $option ) );

		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		wp_cache_delete( $option, 'options' );
	}

	/**
	 * Cases for test_sanitize_frontend_url().
	 *
	 * @return array<string, array{0: string, 1: string, 2: bool}>
	 */
	public function urls(): array {
		return array(
			'https'               => array( ' https://hub.example/ ', 'https://hub.example', false ),
			'https with a slash'  => array( 'https://hub.example//', 'https://hub.example', false ),
			'https with port'     => array( 'https://hub.example:8443/', 'https://hub.example:8443', false ),
			'https with path'     => array( 'https://hub.example/preview', 'https://kept.example', true ),
			'route as path'       => array( 'https://hub.example/api/revalidate', 'https://kept.example', true ),
			'route with a slash'  => array( 'https://hub.example/api/revalidate/', 'https://kept.example', true ),
			'localhost http'      => array( 'http://localhost:3000', 'http://localhost:3000', false ),
			'loopback http'       => array( 'http://127.0.0.1:3000/', 'http://127.0.0.1:3000', false ),
			'empty clears'        => array( '', '', false ),
			'plain http'          => array( 'http://hub.example', 'https://kept.example', true ),
			'no scheme'           => array( 'hub.example', 'https://kept.example', true ),
			'other scheme'        => array( 'ftp://hub.example', 'https://kept.example', true ),
			'query string'        => array( 'https://hub.example/?x=1', 'https://kept.example', true ),
			'fragment'            => array( 'https://hub.example/#top', 'https://kept.example', true ),
			'credentials'         => array( 'https://user:pass@hub.example', 'https://kept.example', true ),
			'javascript'          => array( 'javascript:alert(1)', 'https://kept.example', true ),
			'localhost lookalike' => array( 'http://localhost.evil.example', 'https://kept.example', true ),
		);
	}

	/**
	 * Exactly 32 printable ASCII characters: the shortest secret the rule accepts.
	 */
	private const SECRET_32 = 'abcdefghijklmnopqrstuvwxyz012345';

	/**
	 * Secrets the sanitizer refuses: each would fail the front end's own check, or never match its bearer.
	 *
	 * @return array<string, array{0: string}>
	 */
	public function weak_secrets(): array {
		return array(
			'too short'        => array( substr( self::SECRET_32, 0, 31 ) ),
			'contains a space' => array( 'abcdefghijklmnop qrstuvwxyz0123456' ),
			'trailing newline' => array( self::SECRET_32 . "\n" ),
			'leading space'    => array( ' ' . self::SECRET_32 ),
			'contains a tab'   => array( "abcdefghijklmnop\tqrstuvwxyz0123456" ),
			'non-ASCII'        => array( 'abcdefghijklmnopqrstuvwxyz01234é' ),
			'control char'     => array( "abcdefghijklmnop\x00qrstuvwxyz0123456" ),
			'whitespace only'  => array( str_repeat( ' ', 40 ) ),
			'too long'         => array( str_repeat( 'a', 257 ) ),
		);
	}

	/**
	 * A secret that breaks the rule is refused: the stored secret is kept, and one settings error says
	 * why in plain words without repeating the value.
	 *
	 * @dataProvider weak_secrets
	 *
	 * @param string $weak What was submitted.
	 */
	public function test_sanitize_secret_refuses( string $weak ): void {
		update_option( StatusPage::SECRET_OPTION, self::STORED_SECRET );
		$before = count( get_settings_errors( StatusPage::SECRET_OPTION ) );

		$this->assertSame( self::STORED_SECRET, $this->page->sanitize_secret( $weak ) );

		// Settings errors accumulate in a global for the whole run, so only the new ones count.
		$errors = get_settings_errors( StatusPage::SECRET_OPTION );
		$this->assertSame( 1, count( $errors ) - $before );

		$error = end( $errors );
		$this->assertSame( 'resource_hub_invalid_secret', $error['code'] );
		$this->assertStringContainsString( '32 to 256 printable ASCII characters', $error['message'] );
		$this->assertStringContainsString( 'The stored secret is unchanged.', $error['message'] );
		if ( '' !== trim( $weak ) ) {
			$this->assertStringNotContainsString( trim( $weak ), $error['message'] );
		}
	}

	/**
	 * Through the Settings API, as `options.php` saves, a refused secret leaves the stored one in place.
	 */
	public function test_refused_secret_keeps_the_stored_one_through_the_settings_api(): void {
		$this->page->register_settings();
		update_option( StatusPage::SECRET_OPTION, self::STORED_SECRET );

		update_option( StatusPage::SECRET_OPTION, self::SECRET_32 . "\n" );

		$this->assertSame( self::STORED_SECRET, get_option( StatusPage::SECRET_OPTION ) );
	}

	/**
	 * Secrets the rule accepts are stored exactly as submitted: 32 characters, 256, and every
	 * printable ASCII character from `!` to `~`.
	 */
	public function test_sanitize_secret_accepts(): void {
		update_option( StatusPage::SECRET_OPTION, self::STORED_SECRET );
		$before = count( get_settings_errors( StatusPage::SECRET_OPTION ) );

		$every = implode( '', array_map( 'chr', range( 0x21, 0x7E ) ) );

		foreach ( array( self::SECRET_32, str_repeat( 'a', 256 ), $every ) as $secret ) {
			$this->assertSame( $secret, $this->page->sanitize_secret( $secret ) );
		}

		$this->assertCount( $before, get_settings_errors( StatusPage::SECRET_OPTION ) );
	}

	/**
	 * The field is never prefilled, so an empty submission keeps the stored secret rather than
	 * clearing it, with no error; so do null (a disabled field) and a non-string. With nothing stored,
	 * an empty submission stores nothing.
	 */
	public function test_empty_secret_keeps_the_stored_one(): void {
		$this->assertSame( '', $this->page->sanitize_secret( '' ) );

		update_option( StatusPage::SECRET_OPTION, self::STORED_SECRET );
		$before = count( get_settings_errors( StatusPage::SECRET_OPTION ) );

		$this->assertSame( self::STORED_SECRET, $this->page->sanitize_secret( '' ) );
		$this->assertSame( self::STORED_SECRET, $this->page->sanitize_secret( null ) );
		$this->assertSame( self::STORED_SECRET, $this->page->sanitize_secret( array( 'not' => 'a string' ) ) );
		$this->assertCount( $before, get_settings_errors( StatusPage::SECRET_OPTION ) );

		$this->page->register_settings();
		update_option( StatusPage::SECRET_OPTION, '' );
		$this->assertSame( self::STORED_SECRET, get_option( StatusPage::SECRET_OPTION ) );
	}

	/**
	 * A stored option that breaks the rule, such as one saved before the rule existed, is flagged on
	 * the status page and sends nothing.
	 */
	public function test_weak_stored_option_shows_the_warning_and_sends_nothing(): void {
		$this->configure( 'https://hub.example/', 'short-legacy-secret' );

		$html = StatusPage::html();
		$this->assertStringContainsString( 'Set (from the option resource_hub_revalidate_secret', $html );
		$this->assertStringContainsString( 'Warning: this secret is not 32 to 256 printable ASCII characters', $html );
		$this->assertStringNotContainsString( 'short-legacy-secret', $html );

		$result = ( new Sender() )->send( Payload::build( array() ) );
		$this->assertSame( Result::NOT_CONFIGURED, $result->outcome );
		$this->assertSame( Result::INVALID_SECRET_MESSAGE, $result->error );
		$this->assertSame( array(), $this->requests );

		$this->configure();
		$this->assertStringNotContainsString( 'Warning: this secret', StatusPage::html() );
	}

	/**
	 * A stored option of whitespace only is a stored secret, untrimmed, everywhere on the page: the
	 * table says it is set from the option and warns, and the field's help says a secret is stored.
	 */
	public function test_whitespace_only_option_counts_as_stored(): void {
		$this->configure( 'https://hub.example/', " \n\t" );

		$html = StatusPage::html();
		$this->assertStringContainsString( 'Set (from the option resource_hub_revalidate_secret', $html );
		$this->assertStringContainsString( 'Warning: this secret is not 32 to 256 printable ASCII characters', $html );
		$this->assertStringContainsString( 'A secret is stored. Enter a new one to replace it', $html );
		$this->assertStringNotContainsString( 'The bearer token the front end expects.', $html );

		$this->configure( 'https://hub.example/', '' );

		$html = StatusPage::html();
		$this->assertStringNotContainsString( 'A secret is stored.', $html );
		$this->assertStringContainsString( 'The bearer token the front end expects.', $html );
	}

	/**
	 * A constant that breaks the rule, here a good secret with a trailing newline, is not trimmed: the
	 * status page names the constant as the source, warns, never shows the value, and nothing is sent.
	 * The constant cannot be undefined again, so this runs in its own process.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_weak_constant_shows_the_warning_and_sends_nothing(): void {
		define( 'RESOURCE_HUB_REVALIDATE_SECRET', self::SECRET_32 . "\n" );
		$this->configure( 'https://hub.example/', self::STORED_SECRET );

		$this->assertSame( self::SECRET_32 . "\n", Config::secret() );
		$this->assertSame( 'constant', Config::source_of( Config::REVALIDATE_SECRET ) );
		$this->assertFalse( Config::is_configured() );

		$html = StatusPage::html();
		$this->assertStringContainsString( 'Set (from the constant RESOURCE_HUB_REVALIDATE_SECRET)', $html );
		$this->assertStringContainsString( 'Warning: this secret is not 32 to 256 printable ASCII characters', $html );
		$this->assertStringNotContainsString( self::SECRET_32, $html );

		$this->assertSame( Result::NOT_CONFIGURED, ( new Sender() )->send( Payload::build( array() ) )->outcome );
		$this->assertSame( array(), $this->requests );
	}

	/**
	 * The page is under Settings, for `manage_options`.
	 */
	public function test_page_is_under_settings(): void {
		$this->page->add_page();

		$entries = array_filter(
			$GLOBALS['submenu']['options-general.php'] ?? array(),
			static fn( array $entry ): bool => StatusPage::SLUG === $entry[2]
		);
		$this->assertNotEmpty( $entries );

		foreach ( $entries as $entry ) {
			$this->assertSame( 'manage_options', $entry[1] );
		}

		$this->assertStringContainsString( 'options-general.php?page=resource-hub', StatusPage::url() );
		remove_submenu_page( 'options-general.php', StatusPage::SLUG );
	}

	/**
	 * Sets a post's modified time, to order the picker without waiting. Core always stamps an update
	 * with the current time, so the time is swapped in through `wp_insert_post_data`. The update
	 * queues a revalidation event; the queue is cleared so it never leaves the test.
	 *
	 * @param int    $post_id  The post.
	 * @param string $modified The GMT modified time.
	 */
	private function set_modified( int $post_id, string $modified ): void {
		$stamp = static function ( array $data ) use ( $modified ): array {
			$data['post_modified']     = $modified;
			$data['post_modified_gmt'] = $modified;

			return $data;
		};

		add_filter( 'wp_insert_post_data', $stamp );
		wp_update_post( array( 'ID' => $post_id ) );
		remove_filter( 'wp_insert_post_data', $stamp );
		$this->queue->clear();
	}
}
