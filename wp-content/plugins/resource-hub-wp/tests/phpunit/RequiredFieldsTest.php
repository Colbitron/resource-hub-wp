<?php
/**
 * A resource has a title, a topic and a summary once it is public.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\OneType;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\RequiredFields;
use ResourceHub\ContentModel\Taxonomies;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * The required-fields rule on REST saves, the path the block editor uses: each field judged from
 * the request when it carries it and from storage when it does not.
 */
final class RequiredFieldsTest extends WP_UnitTestCase {
	/**
	 * A type term ID, created per test.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * A topic term ID, created per test.
	 *
	 * @var int
	 */
	private int $topic;

	/**
	 * Registers the meta again (the test library unregisters every meta key after each test, and
	 * REST stores only registered meta), logs in an editor and creates a type and a topic.
	 */
	public function set_up(): void {
		parent::set_up();

		( new Meta() )->register();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->type  = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$this->topic = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
	}

	/**
	 * Titles that are blank by the rule: refused when publishing or scheduling, allowed as a draft.
	 *
	 * @dataProvider blank_titles
	 *
	 * @param string $title The title sent.
	 */
	public function test_blank_title_is_refused_only_for_a_public_status( string $title ): void {
		foreach ( OneType::PUBLIC_STATUSES as $status ) {
			$refused = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'title' => $title ), $status ) );

			$this->assertSame( 400, $refused->get_status(), $status );
			$this->assertSame( RequiredFields::TITLE_MISSING, $refused->get_data()['code'], $status );
		}

		$this->assertSame( 0, (int) wp_count_posts( PostType::NAME )->publish );

		$draft = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'title' => $title ), 'draft' ) );
		$this->assertSame( 201, $draft->get_status() );
	}

	/**
	 * Cases for test_blank_title_is_refused_only_for_a_public_status() and test_is_blank().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function blank_titles(): array {
		return array(
			'empty'                => array( '' ),
			'whitespace'           => array( " \t\n " ),
			'no-break space'       => array( '&nbsp;' ),
			'no-break space, raw'  => array( "\u{00A0}" ),
			'zero-width space'     => array( '&#8203;' ),
			'zero-width, raw'      => array( "\u{200B}\u{200C}\u{200D}" ),
			'empty element'        => array( '<em></em>' ),
			'element of spaces'    => array( '<strong> &nbsp; </strong>' ),
			'byte-order mark'      => array( "\u{FEFF}" ),
			'byte-order mark, raw' => array( "\xEF\xBB\xBF" ),
		);
	}

	/**
	 * A title with anything to read passes, however it is dressed.
	 *
	 * @dataProvider good_titles
	 *
	 * @param string $title The title sent.
	 */
	public function test_good_title_is_accepted( string $title ): void {
		$response = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'title' => $title ), 'publish' ) );

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * Cases for test_good_title_is_accepted().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function good_titles(): array {
		return array(
			'plain'                   => array( 'A resource' ),
			'one letter among blanks' => array( "\u{FEFF} &nbsp; a \u{200B}" ),
			'entity with a glyph'     => array( '&amp;' ),
			'inside an element'       => array( '<em>Emphasis</em>' ),
		);
	}

	/**
	 * The blank rule, stated on its own: each blank case is blank and each good case is not.
	 */
	public function test_is_blank(): void {
		foreach ( $this->blank_titles() as $name => $case ) {
			$this->assertTrue( RequiredFields::is_blank( $case[0] ), $name );
		}

		foreach ( $this->good_titles() as $name => $case ) {
			$this->assertFalse( RequiredFields::is_blank( $case[0] ), $name );
		}

		// Not valid UTF-8, so not blank; the database refuses such a title on its own.
		$this->assertFalse( RequiredFields::is_blank( "ab\xC3\x28cd" ) );
	}

	/**
	 * No topic, and topic IDs that name no term, are refused for a public status and fine for a draft.
	 *
	 * @dataProvider no_topics
	 *
	 * @param array<int> $topics The `resource_topic` sent.
	 */
	public function test_no_topic_is_refused_only_for_a_public_status( array $topics ): void {
		$refused = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( Taxonomies::TOPIC => $topics ), 'publish' ) );
		$this->assertSame( 400, $refused->get_status() );
		$this->assertSame( RequiredFields::TOPIC_MISSING, $refused->get_data()['code'] );

		$draft = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( Taxonomies::TOPIC => $topics ), 'draft' ) );
		$this->assertSame( 201, $draft->get_status() );
	}

	/**
	 * Cases for test_no_topic_is_refused_only_for_a_public_status().
	 *
	 * @return array<string, array{0: array<int>}>
	 */
	public function no_topics(): array {
		return array(
			'none'       => array( array() ),
			'unknown ID' => array( array( 999999 ) ),
		);
	}

	/**
	 * A request without the parameter at all, for a new resource, has no topic either.
	 */
	public function test_new_resource_without_the_topic_parameter_is_refused(): void {
		$params = $this->complete( array(), 'publish' );
		unset( $params[ Taxonomies::TOPIC ] );

		$response = $this->send( 'POST', '/wp/v2/resources', $params );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( RequiredFields::TOPIC_MISSING, $response->get_data()['code'] );
	}

	/**
	 * Summaries that are blank by the rule, `null` among them, are refused for a public status and
	 * fine for a draft.
	 *
	 * @dataProvider blank_summaries
	 *
	 * @param mixed $summary The `meta.summary` sent.
	 */
	public function test_blank_summary_is_refused_only_for_a_public_status( $summary ): void {
		$refused = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'meta' => array( Meta::SUMMARY => $summary ) ), 'publish' ) );
		$this->assertSame( 400, $refused->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $refused->get_data()['code'] );

		$draft = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'meta' => array( Meta::SUMMARY => $summary ) ), 'draft' ) );
		$this->assertSame( 201, $draft->get_status() );
	}

	/**
	 * Cases for test_blank_summary_is_refused_only_for_a_public_status().
	 *
	 * @return array<string, array{0: mixed}>
	 */
	public function blank_summaries(): array {
		return array(
			'empty'                       => array( '' ),
			'whitespace'                  => array( "  \n" ),
			'no-break space, raw'         => array( "\u{00A0}" ),
			'zero-width, raw'             => array( "\u{200B}\u{FEFF}" ),
			'empty element'               => array( '<em></em>' ),
			'script only'                 => array( '<script>alert(1)</script>' ),
			'null'                        => array( null ),
			// Stored as '' by the sanitizer, so judging the raw value would let it publish blank.
			'invalid UTF-8'               => array( "ab\xC3\x28cd" ),
			'invalid UTF-8 among letters' => array( "A summary \xFF" ),
		);
	}

	/**
	 * A summary that is stored with something to read passes, entities typed as text among them:
	 * the front end shows the stored text verbatim, so a typed `&nbsp;` is six visible characters.
	 *
	 * @dataProvider good_summaries
	 *
	 * @param string $summary The `meta.summary` sent.
	 * @param string $stored  What the sanitizer stores.
	 */
	public function test_good_summary_is_accepted( string $summary, string $stored ): void {
		$response = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'meta' => array( Meta::SUMMARY => $summary ) ), 'publish' ) );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( $stored, get_post_meta( $response->get_data()['id'], Meta::SUMMARY, true ) );
	}

	/**
	 * Cases for test_good_summary_is_accepted().
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function good_summaries(): array {
		return array(
			'plain'                   => array( 'A summary', 'A summary' ),
			'no-break entity as text' => array( '&nbsp;', '&nbsp;' ),
			'escaped tag as text'     => array( '&lt;b&gt;', '<b>' ),
			'one letter among blanks' => array( "\u{FEFF} \u{00A0} a \u{200B}", "\u{FEFF} \u{00A0} a \u{200B}" ),
		);
	}

	/**
	 * The summary's blank rule, stated on its own: stored text is judged as it is, with nothing
	 * stripped or decoded.
	 */
	public function test_is_blank_summary(): void {
		$this->assertTrue( RequiredFields::is_blank_summary( '' ) );
		$this->assertTrue( RequiredFields::is_blank_summary( " \t\n\u{00A0}\u{200B}\u{200C}\u{200D}\u{FEFF}" ) );
		$this->assertFalse( RequiredFields::is_blank_summary( '&nbsp;' ) );
		$this->assertFalse( RequiredFields::is_blank_summary( '<em></em>' ) );
		$this->assertFalse( RequiredFields::is_blank_summary( '&#8203;' ) );
	}

	/**
	 * A request that sends no `meta` for a new resource has no summary either, and one that sends
	 * other meta but not the summary is judged on the summary's absence.
	 */
	public function test_new_resource_without_the_summary_is_refused(): void {
		$params = $this->complete( array(), 'publish' );
		unset( $params['meta'] );

		$without_meta = $this->send( 'POST', '/wp/v2/resources', $params );
		$this->assertSame( 400, $without_meta->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $without_meta->get_data()['code'] );

		$params['meta'] = array( Meta::SOURCE_URL => 'https://example.com/' );

		$other_meta = $this->send( 'POST', '/wp/v2/resources', $params );
		$this->assertSame( 400, $other_meta->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $other_meta->get_data()['code'] );
	}

	/**
	 * A complete resource is created, published, with all three stored.
	 */
	public function test_complete_resource_is_published(): void {
		$response = $this->send( 'POST', '/wp/v2/resources', $this->complete( array(), 'publish' ) );

		$this->assertSame( 201, $response->get_status() );

		$post_id = $response->get_data()['id'];

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( array( $this->topic ), wp_get_object_terms( $post_id, Taxonomies::TOPIC, array( 'fields' => 'ids' ) ) );
		$this->assertSame( 'A summary', get_post_meta( $post_id, Meta::SUMMARY, true ) );
		$this->assertSame( array(), RequiredFields::missing_stored( $post_id ) );
	}

	/**
	 * With everything missing, the title's error leads and the others ride along, in order; the
	 * type's rule (OneType) comes before all of them.
	 */
	public function test_every_missing_field_is_reported_in_order(): void {
		$response = $this->send(
			'POST',
			'/wp/v2/resources',
			array(
				'status'         => 'publish',
				Taxonomies::TYPE => array( $this->type ),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( RequiredFields::TITLE_MISSING, $response->get_data()['code'] );
		$this->assertSame(
			array( RequiredFields::TOPIC_MISSING, RequiredFields::SUMMARY_MISSING ),
			array_column( $response->get_data()['additional_errors'], 'code' )
		);

		$typeless = $this->send( 'POST', '/wp/v2/resources', array( 'status' => 'publish' ) );
		$this->assertSame( OneType::MISSING, $typeless->get_data()['code'] );
	}

	/**
	 * The messages are what the editor shows after "Publishing failed." or "Updating failed.", so
	 * they are plain, name the panel, and quote no value.
	 */
	public function test_refusal_messages_are_plain(): void {
		$title = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'title' => '' ), 'publish' ) );
		$this->assertSame( 'A resource needs a title to be published or scheduled. Add one at the top of the editor.', $title->get_data()['message'] );

		$topic = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( Taxonomies::TOPIC => array() ), 'publish' ) );
		$this->assertSame( 'A resource needs at least one topic to be published or scheduled. Add one in the Topics panel.', $topic->get_data()['message'] );

		$summary = $this->send( 'POST', '/wp/v2/resources', $this->complete( array( 'meta' => array( Meta::SUMMARY => '' ) ), 'publish' ) );
		$this->assertSame( 'A resource needs a summary to be published or scheduled. Write one in the Resource details panel.', $summary->get_data()['message'] );
	}

	/**
	 * A published resource cannot lose any of the three through REST: each refusal leaves the
	 * stored value as it was, and a save that touches none of them, or restores one, goes through.
	 */
	public function test_published_resource_keeps_its_fields(): void {
		$post_id = $this->published_resource();

		$blanked = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'title' => '<em> </em>' ) );
		$this->assertSame( 400, $blanked->get_status() );
		$this->assertSame( RequiredFields::TITLE_MISSING, $blanked->get_data()['code'] );
		$this->assertSame( 'Published', get_post( $post_id )->post_title );

		$untopiced = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( Taxonomies::TOPIC => array() ) );
		$this->assertSame( 400, $untopiced->get_status() );
		$this->assertSame( RequiredFields::TOPIC_MISSING, $untopiced->get_data()['code'] );
		$this->assertSame( array( $this->topic ), wp_get_object_terms( $post_id, Taxonomies::TOPIC, array( 'fields' => 'ids' ) ) );

		$unsummarised = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'meta' => array( Meta::SUMMARY => '' ) ) );
		$this->assertSame( 400, $unsummarised->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $unsummarised->get_data()['code'] );
		$this->assertSame( 'A summary', get_post_meta( $post_id, Meta::SUMMARY, true ) );

		$reslugged = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'slug' => 'elsewhere' ) );
		$this->assertSame( 200, $reslugged->get_status() );

		$other_topic = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$retopiced   = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( Taxonomies::TOPIC => array( $other_topic ) ) );
		$this->assertSame( 200, $retopiced->get_status() );
		$this->assertSame( array( $other_topic ), wp_get_object_terms( $post_id, Taxonomies::TOPIC, array( 'fields' => 'ids' ) ) );
	}

	/**
	 * A resource the unguarded paths published without a summary (or a topic, or a title) is judged
	 * on what is stored: a REST save that does not supply the missing field is refused, and the
	 * same save that supplies it goes through. `missing_stored()` names the gap for WP-CLI.
	 */
	public function test_published_resource_with_a_stored_gap_is_judged_on_storage(): void {
		$post_id = $this->published_resource();
		delete_post_meta( $post_id, Meta::SUMMARY );

		$this->assertSame( array( 'summary' ), RequiredFields::missing_stored( $post_id ) );

		$reslugged = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'slug' => 'elsewhere' ) );
		$this->assertSame( 400, $reslugged->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $reslugged->get_data()['code'] );
		$this->assertSame( 'published', get_post( $post_id )->post_name );

		$repaired = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id,
			array(
				'slug' => 'elsewhere',
				'meta' => array( Meta::SUMMARY => 'Now with a summary' ),
			)
		);
		$this->assertSame( 200, $repaired->get_status() );
		$this->assertSame( 'elsewhere', get_post( $post_id )->post_name );
		$this->assertSame( array(), RequiredFields::missing_stored( $post_id ) );

		wp_set_object_terms( $post_id, array(), Taxonomies::TOPIC );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => '',
			)
		);
		$this->assertSame( array( 'title', 'topic' ), RequiredFields::missing_stored( $post_id ) );
		$this->assertSame( RequiredFields::FIELDS, RequiredFields::missing_stored( 999999 ) );
	}

	/**
	 * Publishing a draft is judged on the stored fields when the request does not send them, and
	 * on the request's when it does, so a complete draft publishes with a status change alone.
	 */
	public function test_draft_is_published_from_stored_or_sent_fields(): void {
		$bare = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
				'post_title'  => 'A draft',
			)
		);
		wp_set_object_terms( $bare, $this->type, Taxonomies::TYPE );

		$refused = $this->send( 'POST', '/wp/v2/resources/' . $bare, array( 'status' => 'publish' ) );
		$this->assertSame( 400, $refused->get_status() );
		$this->assertSame( RequiredFields::TOPIC_MISSING, $refused->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $bare ) );

		$sent = $this->send(
			'POST',
			'/wp/v2/resources/' . $bare,
			array(
				'status'          => 'publish',
				'meta'            => array( Meta::SUMMARY => 'A summary' ),
				Taxonomies::TOPIC => array( $this->topic ),
			)
		);
		$this->assertSame( 200, $sent->get_status() );
		$this->assertSame( 'publish', get_post_status( $bare ) );

		$complete = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
				'post_title'  => 'A complete draft',
			)
		);
		wp_set_object_terms( $complete, $this->type, Taxonomies::TYPE );
		wp_set_object_terms( $complete, $this->topic, Taxonomies::TOPIC );
		update_post_meta( $complete, Meta::SUMMARY, 'A summary' );

		$stored = $this->send( 'POST', '/wp/v2/resources/' . $complete, array( 'status' => 'publish' ) );
		$this->assertSame( 200, $stored->get_status() );
		$this->assertSame( 'publish', get_post_status( $complete ) );
	}

	/**
	 * Scheduling is judged like publishing.
	 */
	public function test_scheduling_is_judged_like_publishing(): void {
		$params         = $this->complete( array( 'meta' => array( Meta::SUMMARY => '' ) ), 'future' );
		$params['date'] = gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS );

		$response = $this->send( 'POST', '/wp/v2/resources', $params );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $response->get_data()['code'] );
	}

	/**
	 * An autosave of a published resource with a blank title passes: it writes a revision, never
	 * the resource, and the resource keeps its title.
	 */
	public function test_autosave_of_a_published_resource_passes(): void {
		$post_id = $this->published_resource();

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'title'   => '',
				'content' => 'Still typing',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Published', get_post( $post_id )->post_title );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * A crafted autosave that sends `status: publish` for the author's own draft, which core's
	 * autosaves route would write to the resource itself, is refused while the draft lacks a
	 * field, judged on what that write stores: the summary it sends does not count, because the
	 * route does not write meta to the resource. Nothing is written.
	 */
	public function test_autosave_that_would_publish_an_incomplete_draft_is_refused(): void {
		$post_id = $this->draft_resource( false );
		wp_set_object_terms( $post_id, $this->topic, Taxonomies::TOPIC );

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'status' => 'publish',
				'meta'   => array( Meta::SUMMARY => 'Sent, not stored' ),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( RequiredFields::SUMMARY_MISSING, $response->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'A draft', get_post( $post_id )->post_title );

		$blank_title = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'status' => 'future',
				'title'  => array( 'raw' => ' ' ),
			)
		);
		$this->assertSame( 400, $blank_title->get_status() );
		$this->assertSame( RequiredFields::TITLE_MISSING, $blank_title->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * A crafted autosave that would publish a draft with its title, topic and summary but no
	 * stored type is refused with OneType's code and message: the `resource_type` it sends does
	 * not count, because the route does not write terms to the resource. A draft with two stored
	 * types is refused the same way, with OneType's other error. Nothing is written.
	 */
	public function test_autosave_that_would_publish_a_typeless_draft_is_refused(): void {
		$post_id = $this->draft_resource( true );
		wp_set_object_terms( $post_id, array(), Taxonomies::TYPE );

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'status'         => 'publish',
				Taxonomies::TYPE => array( $this->type ),
			)
		);

		$expected = OneType::problem( 'publish', 0 );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( OneType::MISSING, $response->get_data()['code'] );
		$this->assertSame( $expected->get_error_message(), $response->get_data()['message'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( array(), OneType::stored_type_ids( $post_id ) );

		$second = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		wp_set_object_terms( $post_id, array( $this->type, $second ), Taxonomies::TYPE );

		$two_types = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'status'         => 'publish',
				Taxonomies::TYPE => array( $this->type ),
			)
		);
		$this->assertSame( 400, $two_types->get_status() );
		$this->assertSame( OneType::TOO_MANY, $two_types->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * The same autosave of a draft with its title, topic, summary and one stored type passes, and
	 * the route publishes it, as it would without this check.
	 */
	public function test_autosave_that_would_publish_a_draft_with_one_stored_type_passes(): void {
		$post_id = $this->draft_resource( true );

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'status'         => 'publish',
				Taxonomies::TYPE => array( $this->type ),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * A normal autosave of a published resource passes even when the resource has no stored
	 * type, as an unguarded path can leave it: the route writes a revision, never the resource.
	 */
	public function test_autosave_of_a_published_resource_without_a_type_passes(): void {
		$post_id = $this->published_resource();
		wp_set_object_terms( $post_id, array(), Taxonomies::TYPE );

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'title'   => 'Edited',
				'content' => 'Still typing',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'Published', get_post( $post_id )->post_title );
	}

	/**
	 * An autosave of a draft that sends no status, or a status that is not public, passes
	 * whatever the draft lacks: it is a draft save.
	 */
	public function test_autosave_of_an_incomplete_draft_as_a_draft_passes(): void {
		$post_id = $this->draft_resource( false );

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id . '/autosaves',
			array(
				'title'   => '',
				'content' => 'Still typing',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'Still typing', get_post( $post_id )->post_content );
	}

	/**
	 * Unpublishing is never refused: a published resource that lacks a summary, sent to draft or
	 * private with its title blanked and its topics cleared too, saves.
	 *
	 * @dataProvider unpublished_statuses
	 *
	 * @param string $status The status sent.
	 */
	public function test_unpublishing_an_incomplete_resource_is_allowed( string $status ): void {
		$post_id = $this->published_resource();
		delete_post_meta( $post_id, Meta::SUMMARY );

		$response = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id,
			array(
				'status'          => $status,
				'title'           => '',
				'content'         => 'Some content.',
				Taxonomies::TOPIC => array(),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $status, get_post_status( $post_id ) );
		$this->assertSame( RequiredFields::FIELDS, RequiredFields::missing_stored( $post_id ) );
	}

	/**
	 * Cases for test_unpublishing_an_incomplete_resource_is_allowed().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function unpublished_statuses(): array {
		return array(
			'draft'   => array( 'draft' ),
			'private' => array( 'private' ),
		);
	}

	/**
	 * A draft resource by the current user with a type, titled "A draft", with a topic and a
	 * summary when asked.
	 *
	 * @param bool $complete Whether to store a topic and a summary too.
	 */
	private function draft_resource( bool $complete ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
				'post_title'  => 'A draft',
				'post_author' => get_current_user_id(),
			)
		);
		wp_set_object_terms( $post_id, $this->type, Taxonomies::TYPE );

		if ( $complete ) {
			wp_set_object_terms( $post_id, $this->topic, Taxonomies::TOPIC );
			update_post_meta( $post_id, Meta::SUMMARY, 'A summary' );
		}

		return $post_id;
	}

	/**
	 * Parameters for a resource with every required field, with the given ones replacing them.
	 * The content keeps core from refusing a draft whose title, content and excerpt are all empty,
	 * so a blank title reaches this rule.
	 *
	 * @param array<string, mixed> $overrides Parameters that replace the complete ones.
	 * @param string               $status    Status sent.
	 * @return array<string, mixed>
	 */
	private function complete( array $overrides, string $status ): array {
		return $overrides + array(
			'title'           => 'A resource',
			'content'         => 'Some content.',
			'status'          => $status,
			'meta'            => array( Meta::SUMMARY => 'A summary' ),
			Taxonomies::TYPE  => array( $this->type ),
			Taxonomies::TOPIC => array( $this->topic ),
		);
	}

	/**
	 * A published resource with every required field, made outside REST, titled "Published" with
	 * the slug `published` and the summary "A summary".
	 */
	private function published_resource(): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Published',
				'post_name'   => 'published',
				'post_author' => get_current_user_id(),
			)
		);
		wp_set_object_terms( $post_id, $this->type, Taxonomies::TYPE );
		wp_set_object_terms( $post_id, $this->topic, Taxonomies::TOPIC );
		update_post_meta( $post_id, Meta::SUMMARY, 'A summary' );

		return $post_id;
	}

	/**
	 * Dispatches a REST request with body parameters as the current user.
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
