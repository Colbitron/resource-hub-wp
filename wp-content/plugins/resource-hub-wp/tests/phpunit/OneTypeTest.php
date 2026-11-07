<?php
/**
 * A resource has at most one type, and exactly one to be published (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\OneType;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_REST_Request;
use WP_REST_Response;
use WP_UnitTestCase;

/**
 * The type-count rule on REST saves, the path the block editor uses.
 */
final class OneTypeTest extends WP_UnitTestCase {
	/**
	 * Two type term IDs, created per test.
	 *
	 * @var int[]
	 */
	private array $types;

	/**
	 * A topic term ID, created per test: a public resource also needs a topic and a summary
	 * (RequiredFields), so every save here that may publish sends both.
	 *
	 * @var int
	 */
	private int $topic;

	/**
	 * Logs in an editor and creates two types and a topic.
	 */
	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->types = array(
			self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ),
			self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ),
		);
		$this->topic = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
	}

	/**
	 * Creating a resource: no type is fine until it is published or scheduled; two types never are.
	 *
	 * @dataProvider create_cases
	 *
	 * @param string      $status Status sent.
	 * @param int         $count  Number of types sent.
	 * @param int         $http   Expected HTTP status.
	 * @param string|null $code   Expected error code, or null on success.
	 */
	public function test_create( string $status, int $count, int $http, ?string $code ): void {
		$params = array(
			'title'           => 'A resource',
			'status'          => $status,
			'meta'            => array( Meta::SUMMARY => 'A summary' ),
			Taxonomies::TYPE  => array_slice( $this->types, 0, $count ),
			Taxonomies::TOPIC => array( $this->topic ),
		);

		if ( 'future' === $status ) {
			$params['date'] = gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS );
		}

		$response = $this->send( 'POST', '/wp/v2/resources', $params );

		$this->assertSame( $http, $response->get_status() );

		if ( null === $code ) {
			$this->assertCount( $count, wp_get_object_terms( $response->get_data()['id'], Taxonomies::TYPE ) );
			return;
		}

		$this->assertSame( $code, $response->get_data()['code'] );
		$this->assertSame( 0, (int) wp_count_posts( PostType::NAME )->$status );
	}

	/**
	 * Cases for test_create().
	 *
	 * @return array<string, array{0: string, 1: int, 2: int, 3: string|null}>
	 */
	public function create_cases(): array {
		return array(
			'draft, no type'       => array( 'draft', 0, 201, null ),
			'draft, one type'      => array( 'draft', 1, 201, null ),
			'draft, two types'     => array( 'draft', 2, 400, OneType::TOO_MANY ),
			'pending, no type'     => array( 'pending', 0, 201, null ),
			'publish, no type'     => array( 'publish', 0, 400, OneType::MISSING ),
			'publish, one type'    => array( 'publish', 1, 201, null ),
			'publish, two types'   => array( 'publish', 2, 400, OneType::TOO_MANY ),
			'scheduled, no type'   => array( 'future', 0, 400, OneType::MISSING ),
			'scheduled, one type'  => array( 'future', 1, 201, null ),
			'scheduled, two types' => array( 'future', 2, 400, OneType::TOO_MANY ),
		);
	}

	/**
	 * The refusal's message is what the editor shows in its notice, so it is plain and says what to do.
	 */
	public function test_refusal_messages_are_plain(): void {
		$missing = $this->send( 'POST', '/wp/v2/resources', array( 'status' => 'publish' ) );
		$this->assertSame( 'A resource needs a type to be published or scheduled. Choose one in the Types panel.', $missing->get_data()['message'] );

		$too_many = $this->send(
			'POST',
			'/wp/v2/resources',
			array(
				'status'         => 'draft',
				Taxonomies::TYPE => $this->types,
			)
		);
		$this->assertSame( 'A resource can have only one type. Choose one in the Types panel.', $too_many->get_data()['message'] );
	}

	/**
	 * A published resource cannot lose its type, with a message that fits a resource already
	 * published, and a save that sends no terms is checked against the stored ones.
	 */
	public function test_published_resource_keeps_its_type(): void {
		$post_id = $this->published_resource( $this->types[0] );

		$removed = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( Taxonomies::TYPE => array() ) );
		$this->assertSame( 400, $removed->get_status() );
		$this->assertSame( OneType::MISSING, $removed->get_data()['code'] );
		$this->assertSame( 'A resource needs a type to be published or scheduled. Choose one in the Types panel.', $removed->get_data()['message'] );
		$this->assertSame( array( $this->types[0] ), wp_get_object_terms( $post_id, Taxonomies::TYPE, array( 'fields' => 'ids' ) ) );

		$retitled = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'title' => 'Retitled' ) );
		$this->assertSame( 200, $retitled->get_status() );

		$switched = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( Taxonomies::TYPE => array( $this->types[1] ) ) );
		$this->assertSame( 200, $switched->get_status() );
		$this->assertSame( array( $this->types[1] ), wp_get_object_terms( $post_id, Taxonomies::TYPE, array( 'fields' => 'ids' ) ) );
	}

	/**
	 * A published resource cannot gain a second type.
	 */
	public function test_published_resource_cannot_gain_a_second_type(): void {
		$post_id = $this->published_resource( $this->types[0] );

		$response = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( Taxonomies::TYPE => $this->types ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( OneType::TOO_MANY, $response->get_data()['code'] );
		$this->assertCount( 1, wp_get_object_terms( $post_id, Taxonomies::TYPE ) );
	}

	/**
	 * A draft with no type can be saved, but publishing it needs a type, sent with the publish or
	 * stored before it.
	 */
	public function test_draft_is_published_only_with_a_type(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
			)
		);

		$this->assertSame( 200, $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'title' => 'Still a draft' ) )->get_status() );

		$refused = $this->send( 'POST', '/wp/v2/resources/' . $post_id, array( 'status' => 'publish' ) );
		$this->assertSame( 400, $refused->get_status() );
		$this->assertSame( 'draft', get_post_status( $post_id ) );

		$published = $this->send(
			'POST',
			'/wp/v2/resources/' . $post_id,
			array(
				'status'          => 'publish',
				'meta'            => array( Meta::SUMMARY => 'A summary' ),
				Taxonomies::TYPE  => array( $this->types[0] ),
				Taxonomies::TOPIC => array( $this->topic ),
			)
		);
		$this->assertSame( 200, $published->get_status() );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * IDs that name no type do not count, because core skips them when it assigns terms.
	 */
	public function test_unknown_type_ids_do_not_count(): void {
		$response = $this->send(
			'POST',
			'/wp/v2/resources',
			array(
				'status'         => 'publish',
				Taxonomies::TYPE => array( 999999 ),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( OneType::MISSING, $response->get_data()['code'] );
	}

	/**
	 * A published resource with the given type.
	 *
	 * @param int $type_id Type term ID.
	 */
	private function published_resource( int $type_id ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
			)
		);
		wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );
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
