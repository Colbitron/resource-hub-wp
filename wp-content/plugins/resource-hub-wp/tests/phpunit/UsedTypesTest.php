<?php
/**
 * A type that resources still have cannot be deleted (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\ContentModel\UsedTypes;
use WP_REST_Request;
use WP_REST_Response;
use WP_Term;
use WP_UnitTestCase;

/**
 * `delete_term` on a used type, through the capability and over REST.
 */
final class UsedTypesTest extends WP_UnitTestCase {
	/**
	 * Logs in an administrator, who could delete any type that is not in use.
	 */
	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	/**
	 * Deleting a type over REST: refused with a plain message while a resource has it in any status
	 * but trash; allowed once nothing does.
	 *
	 * @dataProvider status_cases
	 *
	 * @param string $status  Status of the resource that has the type.
	 * @param bool   $refused Whether the delete is refused.
	 */
	public function test_rest_delete( string $status, bool $refused ): void {
		$type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'trash' === $status ? 'publish' : $status,
			)
		);
		wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );

		if ( 'trash' === $status ) {
			wp_trash_post( $post_id );
		}

		$response = $this->delete( $type_id );

		if ( $refused ) {
			$this->assertSame( 403, $response->get_status() );
			$this->assertSame( UsedTypes::ERROR_CODE, $response->get_data()['code'] );
			$this->assertSame( 'This type cannot be deleted while resources have it. Give those resources another type first.', $response->get_data()['message'] );
			$this->assertInstanceOf( WP_Term::class, get_term( $type_id, Taxonomies::TYPE ) );
			$this->assertFalse( current_user_can( 'delete_term', $type_id ) );
			return;
		}

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_term( $type_id, Taxonomies::TYPE ) );
	}

	/**
	 * Cases for test_rest_delete().
	 *
	 * @return array<string, array{0: string, 1: bool}>
	 */
	public function status_cases(): array {
		return array(
			'published' => array( 'publish', true ),
			'draft'     => array( 'draft', true ),
			'private'   => array( 'private', true ),
			'trashed'   => array( 'trash', false ),
		);
	}

	/**
	 * A type no resource has can be deleted, and the capability allows it.
	 */
	public function test_unused_type_can_be_deleted(): void {
		$type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );

		$this->assertTrue( current_user_can( 'delete_term', $type_id ) );

		$response = $this->delete( $type_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_term( $type_id, Taxonomies::TYPE ) );
	}

	/**
	 * Someone who may not delete types at all keeps core's own answer.
	 */
	public function test_user_without_the_capability_gets_cores_answer(): void {
		$type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$post_id = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		$response = $this->delete( $type_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'rest_cannot_delete', $response->get_data()['code'] );
	}

	/**
	 * Other taxonomies are untouched: a topic resources have can still be deleted.
	 */
	public function test_other_taxonomies_are_untouched(): void {
		$topic_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$post_id  = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		wp_set_object_terms( $post_id, $topic_id, Taxonomies::TOPIC );

		$this->assertTrue( current_user_can( 'delete_term', $topic_id ) );
	}

	/**
	 * Sends a forced REST delete of a type, as the Types API takes it.
	 *
	 * @param int $type_id Type term ID.
	 */
	private function delete( int $type_id ): WP_REST_Response {
		$request = new WP_REST_Request( 'DELETE', '/wp/v2/' . Taxonomies::TYPE . '/' . $type_id );
		$request->set_param( 'force', true );

		return rest_get_server()->dispatch( $request );
	}
}
