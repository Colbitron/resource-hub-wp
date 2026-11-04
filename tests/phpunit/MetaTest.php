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
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Tests for `summary` and `source_url`.
 */
final class MetaTest extends WP_UnitTestCase {
	/**
	 * The core test case unregisters every meta key in tear_down(), so register ours again per test.
	 */
	public function set_up(): void {
		parent::set_up();
		( new Meta() )->register();
	}

	/**
	 * Both fields are registered single, REST-exposed strings on `resource`.
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
		$this->assertSame( 'uri', $registered[ Meta::SOURCE_URL ]['show_in_rest']['schema']['format'] );
	}

	/**
	 * Summary: tags go, line breaks stay, length is capped.
	 */
	public function test_sanitize_summary(): void {
		$this->assertSame( "Line one\nLine two", MetaRules::sanitize_summary( "<p>Line one</p>\n<em>Line</em> two<script>alert(1)</script>" ) );
		$this->assertSame( '', MetaRules::sanitize_summary( array( 'not', 'text' ) ) );
		$this->assertSame( MetaRules::SUMMARY_MAX_LENGTH, mb_strlen( MetaRules::sanitize_summary( str_repeat( 'é', MetaRules::SUMMARY_MAX_LENGTH + 50 ) ) ) );
	}

	/**
	 * Source URL: http and https survive, everything else is emptied.
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
			'https'        => array( 'https://example.com/guide?x=1#top', 'https://example.com/guide?x=1#top' ),
			'http'         => array( ' http://example.org/a ', 'http://example.org/a' ),
			'javascript'   => array( 'javascript:alert(1)', '' ),
			'ftp'          => array( 'ftp://example.com/file.pdf', '' ),
			'mailto'       => array( 'mailto:someone@example.com', '' ),
			'data'         => array( 'data:text/html;base64,PHA+', '' ),
			'relative'     => array( '/resources/local', '' ),
			'empty'        => array( '', '' ),
			'not a string' => array( array( 'https://example.com' ), '' ),
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
	 * An editor creating a resource over REST with HTML in the summary gets stripped text back.
	 */
	public function test_rest_create_strips_html_from_summary(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource(
			array(
				Meta::SUMMARY    => '<strong>Bold</strong> claim <a href="https://example.com">link</a>',
				Meta::SOURCE_URL => 'https://example.com/claim',
			)
		);

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'Bold claim link', $response->get_data()['meta'][ Meta::SUMMARY ] );
		$this->assertSame( 'https://example.com/claim', $response->get_data()['meta'][ Meta::SOURCE_URL ] );
		$this->assertSame( 'Bold claim link', get_post_meta( $response->get_data()['id'], Meta::SUMMARY, true ) );
	}

	/**
	 * A summary longer than the schema allows is a 400, not a silent truncation, over REST.
	 */
	public function test_rest_rejects_overlong_summary(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource( array( Meta::SUMMARY => str_repeat( 'a', MetaRules::SUMMARY_MAX_LENGTH + 1 ) ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'rest_too_long', $response->get_data()['code'] );
	}

	/**
	 * Non-http(s) schemes are accepted by the request and stored as an empty string.
	 *
	 * Core's `format: uri` only sanitizes with `sanitize_url()` (it does not validate with
	 * `wp_http_validate_url()`), so `javascript:` is already empty when it reaches the sanitizer
	 * and `ftp:` is emptied by the sanitizer itself. Either way the response is 201 and the stored
	 * value is ''.
	 *
	 * @dataProvider rejected_scheme_cases
	 *
	 * @param string $url A URL with a scheme the field does not accept.
	 */
	public function test_rest_empties_non_http_source_url( string $url ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->create_resource( array( Meta::SOURCE_URL => $url ) );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( '', $response->get_data()['meta'][ Meta::SOURCE_URL ] );
		$this->assertSame( '', get_post_meta( $response->get_data()['id'], Meta::SOURCE_URL, true ) );
	}

	/**
	 * Cases for test_rest_empties_non_http_source_url().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function rejected_scheme_cases(): array {
		return array(
			'javascript' => array( 'javascript:alert(1)' ),
			'ftp'        => array( 'ftp://example.com/file.pdf' ),
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
	 * POSTs a new resource with the given meta as the current user.
	 *
	 * @param array<string, string> $meta Meta values to send.
	 */
	private function create_resource( array $meta ): WP_REST_Response {
		$request = new WP_REST_Request( 'POST', '/wp/v2/resources' );
		$request->set_body_params(
			array(
				'title'  => 'A resource',
				'status' => 'publish',
				'meta'   => $meta,
			)
		);

		return rest_get_server()->dispatch( $request );
	}
}
