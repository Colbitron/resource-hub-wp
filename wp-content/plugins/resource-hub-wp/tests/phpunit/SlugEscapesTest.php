<?php
/**
 * Resource and term slugs never store an escape the front end's router decodes (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\SlugEscapes;
use ResourceHub\ContentModel\Taxonomies;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * Tests for {@see SlugEscapes} through core's real save paths: `wp_insert_post()`,
 * `wp_update_post()`, `wp_insert_term()`, `wp_update_term()` and the REST controllers.
 *
 * What the front end relies on: after any save through these paths, no stored resource or term
 * slug contains an escape of `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
 */
final class SlugEscapesTest extends WP_UnitTestCase {
	use LegacySlugRows;

	/**
	 * How many slugs the property test generates.
	 */
	private const GENERATED_SLUGS = 20000;

	/**
	 * Logs in an editor, who can write resources and manage terms.
	 */
	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
	}

	/**
	 * Slugs as an editor types them and as they are stored. What core makes of each decoded
	 * character is core's choice, pinned here: it keeps `-` and `_`, turns `.` into `-`, and
	 * strips `~`, `!`, `'`, `(`, `)` and `*`.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function slug_cases(): array {
		return array(
			'%2d is a hyphen'                     => array( 'case%2dstudy', 'case-study' ),
			'%2D, upper-case hex'                 => array( 'case%2Dstudy', 'case-study' ),
			'%41 decoded, then lower-cased'       => array( '%41BC', 'abc' ),
			'%61 lower-case letter'               => array( '%61bc', 'abc' ),
			'%30 digit'                           => array( 'v%30', 'v0' ),
			'%2e becomes a hyphen'                => array( 'x%2ey', 'x-y' ),
			'%5f underscore kept'                 => array( 'x%5fy', 'x_y' ),
			'%7E tilde stripped by core'          => array( 'x%7Ey', 'xy' ),
			'%27 apostrophe stripped by core'     => array( 'case%27study', 'casestudy' ),
			'%21 exclamation stripped by core'    => array( 'wow%21', 'wow' ),
			'%28 and %29 parentheses stripped'    => array( 'a%28b%29c', 'abc' ),
			'%2a asterisk stripped'               => array( 'a%2ab', 'ab' ),
			'%2A asterisk, upper-case hex'        => array( 'a%2Ab', 'ab' ),
			'decoded hyphens collapse'            => array( 'a%2d%2d-b', 'a-b' ),
			'%25 kept, so %252d stays encoded'    => array( 'x%252dy', 'x%252dy' ),
			'CJK kept'                            => array( '%e6%97%a5%e6%9c%ac', '%e6%97%a5%e6%9c%ac' ),
			'CJK kept beside a decoded escape'    => array( '%e6%97%a5%2d1', '%e6%97%a5-1' ),
			'%2f kept, as core keeps it'          => array( 'a%2fb', 'a%2fb' ),
			'%20 kept'                            => array( 'a%20b', 'a%20b' ),
			'%25 kept'                            => array( 'a%25b', 'a%25b' ),
			'%26 kept'                            => array( 'a%26b', 'a%26b' ),
			'%2b kept'                            => array( 'a%2bb', 'a%2bb' ),
			'%2c kept'                            => array( 'a%2cb', 'a%2cb' ),
			'%3a kept'                            => array( 'a%3ab', 'a%3ab' ),
			'%3b kept'                            => array( 'a%3bb', 'a%3bb' ),
			'%3d kept'                            => array( 'a%3db', 'a%3db' ),
			'%40 kept'                            => array( 'a%40b', 'a%40b' ),
			'%e2%80%99 stripped by core, as ever' => array( 'it%e2%80%99s', 'its' ),
			'no escape, unchanged'                => array( 'plain-slug', 'plain-slug' ),
		);
	}

	/**
	 * The rule on its own, given a slug as `sanitize_title()` leaves it, as every hook does.
	 *
	 * @dataProvider slug_cases
	 *
	 * @param string $typed  Slug as typed.
	 * @param string $stored Slug expected to be stored.
	 */
	public function test_decode( string $typed, string $stored ): void {
		$this->assertSame( $stored, SlugEscapes::decode( sanitize_title( $typed ) ) );
	}

	/**
	 * Slugs where core's sanitising after one pass makes a new escape of the set: it turns
	 * `---XX---` back into `%XX`, and decoded dashes, literal hex digits and a kept escape can
	 * supply those. Decoding repeats until none is left.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function rebuilt_escape_cases(): array {
		return array(
			'dashes, hex digits and a kept %20' => array( '%2d%2d%2d41%20', 'a20' ),
			'dashes, hex digits and kept CJK'   => array( '%2d%2d%2d4a%e6%97%a5', 'je6-%97%a5' ),
			'dashes on both sides'              => array( '%2d%2d%2d41%2d%2d%2d', 'a' ),
			'a fuzzed slug'                     => array( '%69%51-%20%57-%2d-%32d%3a', 'iq-%20w-3a' ),
		);
	}

	/**
	 * An escape core's sanitising makes is decoded too, and the result is a fixed point.
	 *
	 * @dataProvider rebuilt_escape_cases
	 *
	 * @param string $typed  Slug as typed.
	 * @param string $stored Slug expected to be stored.
	 */
	public function test_decode_repeats_until_no_escape_is_left( string $typed, string $stored ): void {
		$decoded = SlugEscapes::decode( sanitize_title( $typed ) );

		$this->assertSame( $stored, $decoded );
		$this->assertSame( $stored, SlugEscapes::decode( $decoded ) );
		$this->assertSame( $stored, SlugEscapes::decode_stored( $typed ) );
	}

	/**
	 * A topic saved with a slug whose first pass makes a new escape stores the fully decoded slug.
	 */
	public function test_term_save_with_a_rebuilt_escape(): void {
		$this->assertSame( 'a20', $this->stored_term_slug( $this->term( Taxonomies::TOPIC, 'Rebuilt', '%2d%2d%2d41%20' ) ) );
	}

	/**
	 * Over many generated slugs, built from the pieces that combine into escapes (decoded and kept
	 * escapes, dashes, hex digits, stray `%`), the result never holds an escape of the set and
	 * decoding it again changes nothing, whether given the slug sanitized or as stored. The fixed
	 * sequence holds 22 slugs a single decoding pass left with such an escape.
	 */
	public function test_decode_property_over_generated_slugs(): void {
		$pieces = array( '%2d%2d%2d', '%2d', '%2D', '%41', '%4a', '%61', '%32', '%2e', '%7e', '%5f', '%20', '%3a', '%25', '%e6', '%97', '%a5', '%', '-', '---', '4', '1', 'a', 'd', 'F', '2', 'e', '.', '_' );
		$failed = array();
		$state  = 20261105;
		// A fixed linear congruential sequence, so every run checks the same slugs.
		$next = static function ( int $bound ) use ( &$state ): int {
			$state = ( $state * 1103515245 + 12345 ) % 2147483648;

			return intdiv( $state, 65536 ) % $bound;
		};

		for ( $i = 0; $i < self::GENERATED_SLUGS; $i++ ) {
			$raw = '';

			for ( $n = 1 + $next( 10 ); $n > 0; $n-- ) {
				$raw .= $pieces[ $next( count( $pieces ) ) ];
			}

			foreach ( array( SlugEscapes::decode( sanitize_title( $raw ) ), SlugEscapes::decode_stored( $raw ) ) as $result ) {
				if ( SlugEscapes::has_router_escape( $result ) || SlugEscapes::decode( $result ) !== $result ) {
					$failed[ $raw ] = $result;
				}
			}
		}

		$this->assertSame( array(), $failed );
	}

	/**
	 * A published resource saved with `wp_insert_post()` stores the decoded slug.
	 *
	 * @dataProvider slug_cases
	 *
	 * @param string $typed  Slug as typed.
	 * @param string $stored Slug expected to be stored.
	 */
	public function test_insert_published_resource( string $typed, string $stored ): void {
		$this->assertSame( $stored, get_post( $this->resource( 'publish', $typed ) )->post_name );
	}

	/**
	 * A topic created with `wp_insert_term()` and a given slug stores the decoded slug.
	 *
	 * @dataProvider slug_cases
	 *
	 * @param string $typed  Slug as typed.
	 * @param string $stored Slug expected to be stored.
	 */
	public function test_insert_topic( string $typed, string $stored ): void {
		$this->assertSame( $stored, $this->stored_term_slug( $this->term( Taxonomies::TOPIC, 'Topic ' . $typed, $typed ) ) );
	}

	/**
	 * A draft, for which core checks no uniqueness, and a scheduled or private resource, for which
	 * it does, all store the decoded slug.
	 *
	 * @dataProvider statuses
	 *
	 * @param string $status Post status.
	 */
	public function test_every_status_is_decoded( string $status ): void {
		$args = 'future' === $status ? array( 'post_date' => gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS ) ) : array();

		$this->assertSame( 'case-study', get_post( $this->resource( $status, 'case%2dstudy', $args ) )->post_name );
	}

	/**
	 * Cases for test_every_status_is_decoded().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function statuses(): array {
		return array(
			'draft'   => array( 'draft' ),
			'pending' => array( 'pending' ),
			'future'  => array( 'future' ),
			'private' => array( 'private' ),
		);
	}

	/**
	 * A slug generated from the title is decoded too.
	 */
	public function test_slug_from_title(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Case%2DStudy',
			)
		);

		$this->assertSame( 'case-study', get_post( $post_id )->post_name );
	}

	/**
	 * A slug that decodes to nothing is treated as empty, so core uses the title, as it does for a
	 * typed slug of hyphens.
	 */
	public function test_slug_decoding_to_nothing_falls_back_to_the_title(): void {
		$this->assertSame( 'fallback-title', get_post( $this->resource( 'publish', '%2d%2d', array( 'post_title' => 'Fallback Title' ) ) )->post_name );
	}

	/**
	 * Changing a resource's slug with `wp_update_post()` stores the decoded slug, draft or published.
	 *
	 * @dataProvider update_statuses
	 *
	 * @param string $status Post status.
	 */
	public function test_update_resource( string $status ): void {
		$post_id = $this->resource( $status, 'before' );

		wp_update_post(
			array(
				'ID'        => $post_id,
				'post_name' => 'after%2Dupdate',
			)
		);

		$this->assertSame( 'after-update', get_post( $post_id )->post_name );
	}

	/**
	 * Cases for test_update_resource().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function update_statuses(): array {
		return array(
			'draft'   => array( 'draft' ),
			'publish' => array( 'publish' ),
		);
	}

	/**
	 * A decoded slug another resource already has gets core's `-2` suffix, on insert and on update,
	 * because core's uniqueness check runs on the decoded slug.
	 */
	public function test_decoded_resource_slug_collision_gets_a_suffix(): void {
		$this->resource( 'publish', 'case-study' );

		$this->assertSame( 'case-study-2', get_post( $this->resource( 'publish', 'case%2dstudy' ) )->post_name );

		$post_id = $this->resource( 'publish', 'elsewhere' );
		wp_update_post(
			array(
				'ID'        => $post_id,
				'post_name' => 'case%2Dstudy',
			)
		);

		$this->assertSame( 'case-study-3', get_post( $post_id )->post_name );
	}

	/**
	 * A decoded slug takes the bare slug a trashed resource still holds, as typing it would: the
	 * trashed resource is renamed `…__trashed` first.
	 */
	public function test_decoded_slug_takes_the_slug_a_trashed_resource_holds(): void {
		$trashed = $this->resource( 'publish', 'case-study' );
		wp_trash_post( $trashed );
		$this->assertSame( 'case-study__trashed', get_post( $trashed )->post_name, 'Core did not rename the trashed resource.' );

		wp_update_post(
			array(
				'ID'        => $trashed,
				'post_name' => 'case-study',
			)
		);
		$this->assertSame( 'case-study', get_post( $trashed )->post_name, 'The trashed resource does not hold the slug.' );

		$this->assertSame( 'case-study', get_post( $this->resource( 'publish', 'case%2dstudy' ) )->post_name );
		$this->assertSame( 'case-study__trashed', get_post( $trashed )->post_name );
	}

	/**
	 * Core's `add_trashed_suffix_to_trashed_posts` filter turns that rename off for a decoded slug
	 * as it does for a typed one, and core's uniqueness check then gives a suffix.
	 */
	public function test_trashed_rename_honours_cores_filter(): void {
		$trashed = $this->resource( 'publish', 'case-study' );
		wp_trash_post( $trashed );
		wp_update_post(
			array(
				'ID'        => $trashed,
				'post_name' => 'case-study',
			)
		);

		add_filter( 'add_trashed_suffix_to_trashed_posts', '__return_false' );

		$this->assertSame( 'case-study-2', get_post( $this->resource( 'publish', 'case%2dstudy' ) )->post_name );
		$this->assertSame( 'case-study', get_post( $trashed )->post_name );
	}

	/**
	 * A resource stored with such an escape before this rule existed is decoded the next time it
	 * is saved, even by a save that does not touch the slug.
	 */
	public function test_stored_resource_slug_is_decoded_on_next_save(): void {
		$post_id = $this->with_legacy_post_slug( 'case%2dstudy', fn(): int => $this->resource( 'publish', 'case-study' ) );
		$this->assertSame( 'case%2dstudy', get_post( $post_id )->post_name, 'The legacy slug was not stored.' );

		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Retitled',
			)
		);

		$this->assertSame( 'case-study', get_post( $post_id )->post_name );
	}

	/**
	 * Other post types keep core's behaviour.
	 */
	public function test_other_post_types_are_untouched(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => 'post',
				'post_status' => 'publish',
				'post_name'   => 'case%2dstudy',
			)
		);

		$this->assertSame( 'case%2dstudy', get_post( $post_id )->post_name );
	}

	/**
	 * Creating and editing a resource over REST, the block editor's save path, stores the decoded
	 * slug and returns it.
	 */
	public function test_rest_create_and_update_resource(): void {
		$type = $this->term( Taxonomies::TYPE, 'Webinar', 'webinar' );

		$created = $this->send(
			'POST',
			'/wp/v2/resources',
			array(
				'title'         => 'Case study',
				'slug'          => 'case%2Dstudy',
				'status'        => 'publish',
				'resource_type' => array( $type ),
			)
		);

		$this->assertSame( 201, $created->get_status() );
		$this->assertSame( 'case-study', $created->get_data()['slug'] );

		$post_id = $created->get_data()['id'];
		$updated = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'slug' => '%41BC%27s' ) );

		$this->assertSame( 200, $updated->get_status() );
		$this->assertSame( 'abcs', $updated->get_data()['slug'] );
		$this->assertSame( 'abcs', get_post( $post_id )->post_name );
	}

	/**
	 * Each of the three taxonomies decodes a given slug; other taxonomies keep core's behaviour.
	 *
	 * @dataProvider taxonomies
	 *
	 * @param string $taxonomy Taxonomy.
	 * @param string $stored   Slug expected to be stored for `case%2dstudy`.
	 */
	public function test_taxonomies( string $taxonomy, string $stored ): void {
		$this->assertSame( $stored, $this->stored_term_slug( $this->term( $taxonomy, 'Case study', 'case%2dstudy' ) ) );
	}

	/**
	 * Cases for test_taxonomies().
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function taxonomies(): array {
		return array(
			'topic'    => array( Taxonomies::TOPIC, 'case-study' ),
			'type'     => array( Taxonomies::TYPE, 'case-study' ),
			'flag'     => array( Taxonomies::FLAG, 'case-study' ),
			'category' => array( 'category', 'case%2dstudy' ),
		);
	}

	/**
	 * A term slug generated from the name never has an escape, so it needs no decoding: core strips
	 * every percent escape from a term's name on save (`sanitize_text_field()` on `pre_term_name`),
	 * on create and on an edit that clears the slug. Pinned, because SlugEscapes relies on it.
	 */
	public function test_core_strips_escapes_from_term_names(): void {
		$term_id = $this->term( Taxonomies::TOPIC, 'Case%2DStudy' );

		$this->assertSame( 'CaseStudy', get_term( $term_id )->name );
		$this->assertSame( 'casestudy', $this->stored_term_slug( $term_id ) );

		wp_update_term(
			$term_id,
			Taxonomies::TOPIC,
			array(
				'name' => 'Other%2dName',
				'slug' => '',
			)
		);

		$this->assertSame( 'othername', $this->stored_term_slug( $term_id ) );
	}

	/**
	 * A given term slug that decodes to nothing is treated as having none, so core generates the
	 * slug from the name, as it does for a typed slug of hyphens.
	 */
	public function test_term_slug_decoding_to_nothing_falls_back_to_the_name(): void {
		$this->assertSame( 'fallback', $this->stored_term_slug( $this->term( Taxonomies::TOPIC, 'Fallback', '%2d%2d' ) ) );
	}

	/**
	 * A given term slug whose decoded form another term has gets core's `-2` suffix on create.
	 */
	public function test_decoded_term_slug_collision_on_create_gets_a_suffix(): void {
		$this->term( Taxonomies::TOPIC, 'Case study', 'case-study' );

		$this->assertSame( 'case-study-2', $this->stored_term_slug( $this->term( Taxonomies::TOPIC, 'Another', 'case%2dstudy' ) ) );
	}

	/**
	 * Editing a term's slug with `wp_update_term()` stores the decoded slug; a given slug whose
	 * decoded form another term has is refused, as core refuses any taken slug on an edit.
	 */
	public function test_update_term_slug(): void {
		$term_id = $this->term( Taxonomies::TOPIC, 'Before', 'before' );

		$this->assertIsArray( wp_update_term( $term_id, Taxonomies::TOPIC, array( 'slug' => 'after%2dupdate' ) ) );
		$this->assertSame( 'after-update', $this->stored_term_slug( $term_id ) );

		$this->term( Taxonomies::TOPIC, 'Taken', 'taken' );
		$result = wp_update_term( $term_id, Taxonomies::TOPIC, array( 'slug' => 'tak%65n' ) );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'duplicate_term_slug', $result->get_error_code() );
		$this->assertSame( 'after-update', $this->stored_term_slug( $term_id ) );
	}

	/**
	 * A term stored with such an escape before this rule existed is decoded the next time it is
	 * saved, even by an edit that does not touch the slug.
	 */
	public function test_stored_term_slug_is_decoded_on_next_save(): void {
		$term_id = $this->with_legacy_term_slug( 'case%2dstudy', fn(): int => $this->term( Taxonomies::TOPIC, 'Case study', 'case-study' ) );
		$this->assertSame( 'case%2dstudy', $this->stored_term_slug( $term_id ), 'The legacy slug was not stored.' );

		wp_update_term( $term_id, Taxonomies::TOPIC, array( 'description' => 'Now described.' ) );

		$this->assertSame( 'case-study', $this->stored_term_slug( $term_id ) );
	}

	/**
	 * Creating and editing a topic over REST stores the decoded slug and returns it.
	 */
	public function test_rest_create_and_update_term(): void {
		$created = $this->send(
			'POST',
			'/wp/v2/' . Taxonomies::TOPIC,
			array(
				'name' => 'Case study',
				'slug' => 'case%2dstudy',
			)
		);

		$this->assertSame( 201, $created->get_status() );
		$this->assertSame( 'case-study', $created->get_data()['slug'] );

		$term_id = $created->get_data()['id'];
		$updated = $this->send( 'POST', '/wp/v2/' . Taxonomies::TOPIC . '/' . $term_id, array( 'slug' => 'x%7Ey%2e1' ) );

		$this->assertSame( 200, $updated->get_status() );
		$this->assertSame( 'xy-1', $updated->get_data()['slug'] );
		$this->assertSame( 'xy-1', $this->stored_term_slug( $term_id ) );
	}

	/**
	 * A legacy term whose decoded slug another term has cannot be saved until the editor types a new
	 * slug. Over REST, core's `duplicate_term_slug` error, which has no status and would be a 500, is
	 * a 400; a new slug saves.
	 */
	public function test_rest_edit_of_a_colliding_legacy_term_is_a_400(): void {
		$this->term( Taxonomies::TOPIC, 'Case study', 'case-study' );
		$term_id = $this->with_legacy_term_slug( 'case%2dstudy', fn(): int => $this->term( Taxonomies::TOPIC, 'Legacy', 'legacy' ) );

		$refused = $this->send( 'POST', '/wp/v2/' . Taxonomies::TOPIC . '/' . $term_id, array( 'description' => 'Only this.' ) );

		$this->assertSame( 400, $refused->get_status() );
		$this->assertSame( 'duplicate_term_slug', $refused->get_data()['code'] );
		$this->assertSame( 400, $refused->get_data()['data']['status'] );
		$this->assertSame( 'case%2dstudy', $this->stored_term_slug( $term_id ) );

		$saved = $this->send( 'POST', '/wp/v2/' . Taxonomies::TOPIC . '/' . $term_id, array( 'slug' => 'legacy-case-study' ) );

		$this->assertSame( 200, $saved->get_status() );
		$this->assertSame( 'legacy-case-study', $this->stored_term_slug( $term_id ) );
	}

	/**
	 * The 400 is for the plugin's taxonomies only: a duplicate slug on a category keeps core's answer.
	 */
	public function test_other_taxonomies_keep_cores_duplicate_slug_status(): void {
		$this->term( 'category', 'Taken', 'taken' );
		$term_id = $this->term( 'category', 'Mine', 'mine' );

		$response = $this->send( 'POST', '/wp/v2/categories/' . $term_id, array( 'slug' => 'taken' ) );

		$this->assertSame( 'duplicate_term_slug', $response->get_data()['code'] );
		$this->assertSame( 500, $response->get_status() );
	}

	/**
	 * Creates a resource with a slug.
	 *
	 * @param string               $status Post status.
	 * @param string               $slug   Slug as typed.
	 * @param array<string, mixed> $args   More arguments for `wp_insert_post()`.
	 */
	private function resource( string $status, string $slug, array $args = array() ): int {
		return self::factory()->post->create(
			array_merge(
				array(
					'post_type'   => PostType::NAME,
					'post_status' => $status,
					'post_name'   => $slug,
					'post_title'  => 'A resource',
				),
				$args
			)
		);
	}


	/**
	 * Creates a term with `wp_insert_term()` and returns its ID.
	 *
	 * @param string $taxonomy Taxonomy.
	 * @param string $name     Name.
	 * @param string $slug     Slug as typed, '' for none.
	 */
	private function term( string $taxonomy, string $name, string $slug = '' ): int {
		$result = wp_insert_term( $name, $taxonomy, '' === $slug ? array() : array( 'slug' => $slug ) );

		$this->assertIsArray( $result, $result instanceof WP_Error ? $result->get_error_message() : 'Term not created.' );

		return (int) $result['term_id'];
	}


	/**
	 * Dispatches a REST request with body parameters.
	 *
	 * @param string               $method HTTP method.
	 * @param string               $route  Route.
	 * @param array<string, mixed> $params Body parameters.
	 */
	private function send( string $method, string $route, array $params ): WP_REST_Response {
		$request = new WP_REST_Request( $method, $route );
		$request->set_body_params( $params );

		return rest_get_server()->dispatch( $request );
	}
}
