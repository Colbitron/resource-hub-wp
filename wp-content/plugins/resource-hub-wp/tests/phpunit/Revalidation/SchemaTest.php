<?php
/**
 * The PHP side of the contract: the validator reads the shared schemas and agrees with their fixtures.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\Taxonomies;
use WP_UnitTestCase;

/**
 * Proves the schema check the other revalidation tests rely on is real: every valid request fixture in
 * `packages/ui/fixtures/` passes and every invalid one fails through the same validator (ADR 0010).
 */
final class SchemaTest extends WP_UnitTestCase {
	/**
	 * The schemas directory is mounted and holds the request schema.
	 */
	public function test_schemas_are_mounted(): void {
		$this->assertFileExists( SchemaValidator::schemas_dir() . '/revalidate-request.schema.json' );
		$this->assertFileExists( SchemaValidator::schemas_dir() . '/common.schema.json' );
	}

	/**
	 * Every `revalidate-request.*.json` fixture: valid ones pass, invalid ones fail.
	 */
	public function test_request_fixtures_agree_with_the_validator(): void {
		$valid   = glob( SchemaValidator::fixtures_dir() . '/valid/revalidate-request.*.json' );
		$invalid = glob( SchemaValidator::fixtures_dir() . '/invalid/revalidate-request.*.json' );

		$this->assertNotEmpty( $valid );
		$this->assertNotEmpty( $invalid );

		foreach ( $valid as $file ) {
			$this->assertNull( SchemaValidator::errors( 'revalidate-request', wp_json_file_decode( $file, array( 'associative' => true ) ) ), basename( $file ) . ' should be valid' );
		}

		foreach ( $invalid as $file ) {
			$this->assertNotNull( SchemaValidator::errors( 'revalidate-request', wp_json_file_decode( $file, array( 'associative' => true ) ) ), basename( $file ) . ' should be invalid' );
		}
	}

	/**
	 * The response schemas are registered too, so a test can check what the front end answers.
	 */
	public function test_response_schemas_are_registered(): void {
		$this->assertNull( SchemaValidator::errors( 'revalidate-response-ok', array( 'revalidated' => array( '/resources/' ) ) ) );
		$this->assertNotNull( SchemaValidator::errors( 'revalidate-response-ok', array( 'revalidated' => array( 'resources' ) ) ) );
		$this->assertNull( SchemaValidator::errors( 'revalidate-response-error', array( 'error' => 'unauthorized' ) ) );
		$this->assertNotNull( SchemaValidator::errors( 'revalidate-response-error', array( 'error' => '' ) ) );
	}

	/**
	 * The reserved type slugs are rejected where the plugin would put them.
	 */
	public function test_reserved_type_slugs_fail(): void {
		$event = array(
			'type'     => 'term',
			'taxonomy' => Taxonomies::TYPE,
			'event'    => 'create',
			'id'       => 3,
			'slug'     => 'topic',
			'name'     => 'Topic',
			'previous' => null,
		);

		$this->assertNotNull(
			SchemaValidator::errors(
				'revalidate-request',
				array(
					'version' => 1,
					'events'  => array( $event ),
				)
			)
		);

		$event['slug'] = 'guide';
		$this->assertNull(
			SchemaValidator::errors(
				'revalidate-request',
				array(
					'version' => 1,
					'events'  => array( $event ),
				)
			)
		);
	}
}
