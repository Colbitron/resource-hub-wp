<?php
/**
 * The meta rules, exercised directly and through the REST API.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\MetaRules;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Tests for `summary` and `source_url`.
 */
final class MetaTest extends WP_UnitTestCase {
	/**
	 * The core test case unregisters every meta key in tear_down(), so register ours again per test. The
	 * fields only: the plugin's own filters are still hooked, and a second copy would run every write twice.
	 */
	public function set_up(): void {
		parent::set_up();
		( new Meta() )->register_fields();
	}

	/**
	 * Both fields are registered single, REST-exposed strings on `resource`. Only `summary` has a
	 * schema rule; `source_url` has no `format`, so core does not run `sanitize_url()` before ours.
	 */
	public function test_meta_is_registered_for_rest(): void {
		$registered = get_registered_meta_keys( 'post', PostType::NAME );

		foreach ( array( Meta::SUMMARY, Meta::SOURCE_URL ) as $key ) {
			$this->assertArrayHasKey( $key, $registered );
			$this->assertTrue( $registered[ $key ]['single'] );
			$this->assertSame( 'string', $registered[ $key ]['type'] );
			$this->assertIsArray( $registered[ $key ]['show_in_rest'] );
		}

		$this->assertSame( MetaRules::SUMMARY_MAX_LENGTH, $registered[ Meta::SUMMARY ]['show_in_rest']['schema']['maxLength'] );
		$this->assertArrayNotHasKey( 'format', $registered[ Meta::SOURCE_URL ]['show_in_rest']['schema'] );
	}

	/**
	 * Summary, one case per clause of the docblock on MetaRules::sanitize_summary().
	 *
	 * @dataProvider summary_cases
	 *
	 * @param mixed  $input    Raw value.
	 * @param string $expected Sanitized value.
	 */
	public function test_sanitize_summary( mixed $input, string $expected ): void {
		$this->assertSame( $expected, MetaRules::sanitize_summary( $input ) );
	}

	/**
	 * Cases for test_sanitize_summary().
	 *
	 * @return array<string, array{0: mixed, 1: string}>
	 */
	public function summary_cases(): array {
		$max = MetaRules::SUMMARY_MAX_LENGTH;

		return array(
			'non-scalar is empty'                => array( array( 'not', 'text' ), '' ),
			'true is cast to 1'                  => array( true, '1' ),
			'integer is cast'                    => array( 42, '42' ),
			'invalid UTF-8 empties the value'    => array( "ab\xC3\x28cd", '' ),
			'lone less-than is kept'             => array( '1<2', '1<2' ),
			'lone less-than with text after it'  => array( 'Under <5 minutes', 'Under <5 minutes' ),
			'lone less-than at the end'          => array( 'end<', 'end<' ),
			'specials after a lone less-than'    => array( "a<b & \"c\" 'd'", "a<b & \"c\" 'd'" ),
			'specials before a lone less-than'   => array( '"a" & b<c', '"a" & b<c' ),
			'tags go and line breaks stay'       => array( "<p>Line one</p>\n<em>Line</em> two", "Line one\nLine two" ),
			'script and style contents go'       => array( '<style>p{color:red}</style><script>alert(1)</script>y', 'y' ),
			'less-than to the next greater-than' => array( 'x<y and y>z', 'xz' ),
			'typed entities are decoded'         => array( '1 &lt; 2 &amp; 3 &gt; 0 &quot;q&quot; &#039;s&#039;', "1 < 2 & 3 > 0 \"q\" 's'" ),
			'an entity-typed tag becomes text'   => array( '&lt;b&gt;x', '<b>x' ),
			'which a later save removes'         => array( '<b>x', 'x' ),
			'other entities are not decoded'     => array( '&copy; 2026 <x', '&copy; 2026 <x' ),
			'line endings normalised, tabs kept' => array( "  a\r\n\tb\rc  ", "a\n\tb\nc" ),
			'percent signs are left alone'       => array( '100%ad off', '100%ad off' ),
			'cut at the limit in characters'     => array( str_repeat( 'é', $max + 50 ), str_repeat( 'é', $max ) ),
			'tags do not count toward the limit' => array( '<b>' . str_repeat( 'a', $max ) . '</b>', str_repeat( 'a', $max ) ),
			'all less-than at the limit stays'   => array( str_repeat( '<', $max ), str_repeat( '<', $max ) ),
			'the cut applies after decoding'     => array( str_repeat( '&amp;', $max + 1 ), str_repeat( '&', $max ) ),
		);
	}

	/**
	 * Summary over REST as an editor: the schema checks the length of the raw input, then the
	 * sanitizer runs; the stored value is what the create response and a later read return.
	 *
	 * @dataProvider rest_summary_cases
	 *
	 * @param string $input    Value sent.
	 * @param string $expected Value stored and returned.
	 */
	public function test_rest_summary( string $input, string $expected ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource( array( Meta::SUMMARY => $input ) );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( $expected, $response->get_data()['meta'][ Meta::SUMMARY ] );
		$this->assertSame( $expected, get_post_meta( $response->get_data()['id'], Meta::SUMMARY, true ) );

		// Core checks stored meta against the schema on read; a value past maxLength would come back null.
		$read = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/resources/' . $response->get_data()['id'] ) );
		$this->assertSame( $expected, $read->get_data()['meta'][ Meta::SUMMARY ] );
	}

	/**
	 * Cases for test_rest_summary().
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function rest_summary_cases(): array {
		$max = MetaRules::SUMMARY_MAX_LENGTH;

		return array(
			'html is stripped'                => array( '<strong>Bold</strong> claim <a href="https://example.com">link</a>', 'Bold claim link' ),
			'1<2'                             => array( '1<2', '1<2' ),
			'a<b at the limit'                => array( str_repeat( 'x', $max - 3 ) . 'a<b', str_repeat( 'x', $max - 3 ) . 'a<b' ),
			'all less-than at the limit'      => array( str_repeat( '<', $max ), str_repeat( '<', $max ) ),
			'multibyte at the limit'          => array( str_repeat( 'é', $max ), str_repeat( 'é', $max ) ),
			'script element and its contents' => array( '<script>x</script>y', 'y' ),
			'invalid UTF-8'                   => array( "ab\xC3\x28cd", '' ),
		);
	}

	/**
	 * A summary longer than the schema allows is a 400, not a silent truncation, over REST. The
	 * limit counts characters, so one multibyte character over is rejected too.
	 *
	 * @dataProvider overlong_summary_cases
	 *
	 * @param string $input Value sent.
	 */
	public function test_rest_rejects_overlong_summary( string $input ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource( array( Meta::SUMMARY => $input ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'rest_too_long', $response->get_data()['code'] );
	}

	/**
	 * Cases for test_rest_rejects_overlong_summary().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function overlong_summary_cases(): array {
		return array(
			'ascii'     => array( str_repeat( 'a', MetaRules::SUMMARY_MAX_LENGTH + 1 ) ),
			'multibyte' => array( str_repeat( 'é', MetaRules::SUMMARY_MAX_LENGTH + 1 ) ),
		);
	}

	/**
	 * Source URL, one case or more per clause of the docblock on MetaRules::sanitize_source_url().
	 *
	 * @dataProvider source_url_cases
	 *
	 * @param mixed  $input    Raw value.
	 * @param string $expected Sanitized value.
	 */
	public function test_sanitize_source_url( mixed $input, string $expected ): void {
		$this->assertSame( $expected, MetaRules::sanitize_source_url( $input ) );
	}

	/**
	 * Cases for test_sanitize_source_url().
	 *
	 * @return array<string, array{0: mixed, 1: string}>
	 */
	public function source_url_cases(): array {
		return array(
			'https'                       => array( 'https://example.com/guide?x=1#top', 'https://example.com/guide?x=1#top' ),
			'http, trimmed'               => array( ' http://example.org/a ', 'http://example.org/a' ),
			'not a string'                => array( array( 'https://example.com' ), '' ),
			'empty'                       => array( '', '' ),
			'javascript'                  => array( 'javascript:alert(1)', '' ),
			'ftp'                         => array( 'ftp://example.com/file.pdf', '' ),
			'mailto'                      => array( 'mailto:someone@example.com', '' ),
			'data'                        => array( 'data:text/html;base64,PHA+', '' ),
			'bare host'                   => array( 'example.com', '' ),
			'relative with leading slash' => array( '/resources/local', '' ),
			'relative without slash'      => array( 'docs/guide.html', '' ),
			'parent-relative'             => array( '../up', '' ),
			'prose'                       => array( 'not a url', '' ),
			'protocol-relative'           => array( '//example.com/x', '' ),
			'scheme without slashes'      => array( 'http:example.com', '' ),
			'scheme with backslashes'     => array( 'https:\\\\evil.com', '' ),
			'integer'                     => array( 123, '' ),
			'boolean'                     => array( true, '' ),
			'scheme in upper case'        => array( 'HTTPS://Example.com/A', 'https://Example.com/A' ),
			'space becomes %20'           => array( 'https://example.com/a b', 'https://example.com/a%20b' ),
			'newline and tab deleted'     => array( "https://exa\nmple.com/p\tq", 'https://example.com/pq' ),
			'angle brackets and quotes'   => array( 'https://example.com/<x>"y"', 'https://example.com/xy' ),
			'encoded line break deleted'  => array( 'https://example.com/a%0Ab%0dc', 'https://example.com/abc' ),
			'user and password removed'   => array( 'https://user:pass@example.com/x', 'https://example.com/x' ),
			'user removed'                => array( 'http://user@example.com', 'http://example.com' ),
			'at sign in the path kept'    => array( 'https://example.com/a@b?c=d@e', 'https://example.com/a@b?c=d@e' ),
			'backslash before at sign'    => array( 'https://evil.example\\@good.example/', 'https://good.example/' ),
			'scheme only'                 => array( 'http://', '' ),
			'no host'                     => array( 'http:///example.com', '' ),
			'host is not validated'       => array( 'https://not a host', 'https://not%20a%20host' ),
		);
	}

	/**
	 * The auth callback follows edit_post: an editor may write meta on any resource, a subscriber on none.
	 */
	public function test_auth_callback_follows_edit_post(): void {
		$post_id = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertTrue( current_user_can( 'edit_post_meta', $post_id, Meta::SUMMARY ) );
		$this->assertTrue( current_user_can( 'edit_post_meta', $post_id, Meta::SOURCE_URL ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertFalse( current_user_can( 'edit_post_meta', $post_id, Meta::SUMMARY ) );
		$this->assertFalse( current_user_can( 'edit_post_meta', $post_id, Meta::SOURCE_URL ) );
	}

	/**
	 * The callback takes all six arguments core passes and ignores `$allowed`, so an earlier
	 * callback that returns null (or false) neither errors nor changes the answer.
	 */
	public function test_auth_callback_ignores_allowed(): void {
		$post_id   = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		$editor_id = self::factory()->user->create( array( 'role' => 'editor' ) );

		$this->assertTrue( MetaRules::can_edit_post( null, Meta::SUMMARY, $post_id, $editor_id, 'edit_post_meta', array( 'edit_others_posts' ) ) );
		$this->assertTrue( MetaRules::can_edit_post( false, Meta::SUMMARY, $post_id, $editor_id, 'edit_post_meta', array() ) );

		add_filter( 'auth_post_meta_' . Meta::SUMMARY . '_for_' . PostType::NAME, '__return_null', 5 );

		wp_set_current_user( $editor_id );
		$this->assertTrue( current_user_can( 'edit_post_meta', $post_id, Meta::SUMMARY ) );
	}

	/**
	 * Source URL over REST as an editor: the value reaches the sanitizer unchanged (no `format`
	 * in the schema), so the stored value is what the sanitizer's rule says.
	 *
	 * @dataProvider rest_source_url_cases
	 *
	 * @param string $input    Value sent.
	 * @param string $expected Value stored and returned.
	 */
	public function test_rest_source_url( string $input, string $expected ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource( array( Meta::SOURCE_URL => $input ) );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( $expected, $response->get_data()['meta'][ Meta::SOURCE_URL ] );
		$this->assertSame( $expected, get_post_meta( $response->get_data()['id'], Meta::SOURCE_URL, true ) );
	}

	/**
	 * Cases for test_rest_source_url().
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function rest_source_url_cases(): array {
		return array(
			'https'                       => array( 'https://example.com/claim', 'https://example.com/claim' ),
			'javascript'                  => array( 'javascript:alert(1)', '' ),
			'ftp'                         => array( 'ftp://example.com/file.pdf', '' ),
			'mailto'                      => array( 'mailto:someone@example.com', '' ),
			'data'                        => array( 'data:text/html;base64,PHA+', '' ),
			'bare host'                   => array( 'example.com', '' ),
			'relative with leading slash' => array( '/resources/local', '' ),
			'relative without slash'      => array( 'docs/guide.html', '' ),
			'scheme without slashes'      => array( 'http:example.com', '' ),
			'space'                       => array( 'https://example.com/a b', 'https://example.com/a%20b' ),
			'credentials'                 => array( 'https://user:pass@example.com/x', 'https://example.com/x' ),
		);
	}

	/**
	 * A non-string source URL over REST fails the schema's `type` check: 400, nothing stored.
	 *
	 * @dataProvider rest_non_string_source_url_cases
	 *
	 * @param mixed $input Value sent.
	 */
	public function test_rest_rejects_non_string_source_url( mixed $input ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource( array( Meta::SOURCE_URL => $input ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'rest_invalid_type', $response->get_data()['code'] );
	}

	/**
	 * Cases for test_rest_rejects_non_string_source_url().
	 *
	 * @return array<string, array{0: mixed}>
	 */
	public function rest_non_string_source_url_cases(): array {
		return array(
			'integer' => array( 123 ),
			'boolean' => array( true ),
		);
	}

	/**
	 * A subscriber cannot update meta over REST: 403.
	 */
	public function test_rest_subscriber_cannot_update_meta(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/resources/' . $post_id );
		$request->set_body_params( array( 'meta' => array( Meta::SUMMARY => 'Nope' ) ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( '', get_post_meta( $post_id, Meta::SUMMARY, true ) );
	}

	/**
	 * Both fields appear under `meta` in a public read, with their defaults when unset.
	 */
	public function test_rest_read_exposes_meta_with_defaults(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
			)
		);

		$response = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/resources/' . $post_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '', $response->get_data()['meta'][ Meta::SUMMARY ] );
		$this->assertSame( '', $response->get_data()['meta'][ Meta::SOURCE_URL ] );
	}

	/**
	 * POSTs a new resource with the given meta as the current user. A draft: the meta rules are
	 * the same at every status, and a public resource must also have a type, a topic and a
	 * non-blank summary (OneType, RequiredFields), which is their tests' concern, not this one's.
	 *
	 * @param array<string, mixed> $meta Meta values to send.
	 */
	private function create_resource( array $meta ): WP_REST_Response {
		$request = new WP_REST_Request( 'POST', '/wp/v2/resources' );
		$request->set_body_params(
			array(
				'title'  => 'A resource',
				'status' => 'draft',
				'meta'   => $meta,
			)
		);

		return rest_get_server()->dispatch( $request );
	}
}
