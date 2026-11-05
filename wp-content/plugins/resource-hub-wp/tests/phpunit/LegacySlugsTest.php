<?php
/**
 * The repair behind `wp resource-hub decode-slugs` (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\LegacySlugs;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Tests\Revalidation\RevalidationTestCase;

/**
 * Tests for {@see LegacySlugs}, with rows planted past every plugin filter as they were stored
 * before the save-time rule.
 */
final class LegacySlugsTest extends RevalidationTestCase {
	use LegacySlugRows;

	/**
	 * The dry run lists each legacy resource and term with its decoded slug, skips clean ones and
	 * escapes the router leaves alone, and changes and queues nothing.
	 */
	public function test_scan_lists_legacy_rows_and_changes_nothing(): void {
		$post_id = $this->legacy_resource( 'publish', 'case%2dstudy' );
		$term_id = $this->legacy_term( Taxonomies::TOPIC, 'ai%2Dtools', 'AI tools' );
		$this->make_resource( 'publish', 'clean-one' );
		$this->make_term( Taxonomies::TOPIC, '%e6%97%a5', 'Day' );

		$rows = ( new LegacySlugs() )->scan();

		$this->assertSame(
			array(
				array(
					'object'    => PostType::NAME,
					'id'        => $post_id,
					'status'    => 'publish',
					'slug'      => 'case%2dstudy',
					'decoded'   => 'case-study',
					'collision' => '',
					'blocked'   => false,
				),
				array(
					'object'    => Taxonomies::TOPIC,
					'id'        => $term_id,
					'status'    => '',
					'slug'      => 'ai%2Dtools',
					'decoded'   => 'ai-tools',
					'collision' => '',
					'blocked'   => false,
				),
			),
			$rows
		);
		$this->assertSame( 'case%2dstudy', $this->stored_post_slug( $post_id ) );
		$this->assertSame( 'ai%2Dtools', $this->stored_term_slug( $term_id ) );
		$this->assertTrue( $this->queue->is_empty() );
	}

	/**
	 * Applying saves each row through core: the slug is decoded, a post keeps the old slug in
	 * `_wp_old_slug`, each save queues its revalidation event, and nothing is left to list.
	 */
	public function test_apply_saves_through_core(): void {
		$post_id = $this->legacy_resource( 'publish', 'case%2dstudy' );
		$draft   = $this->legacy_resource( 'draft', 'draft%2dcase' );
		$term_id = $this->legacy_term( Taxonomies::TYPE, 'how%2dto', 'How-to' );

		$results = ( new LegacySlugs() )->apply();

		$this->assertSame( array( 'decoded', 'decoded', 'decoded' ), array_column( $results, 'result' ) );
		$this->assertSame( array( 'case-study', 'draft-case', 'how-to' ), array_column( $results, 'stored' ) );
		$this->assertSame( 'case-study', $this->stored_post_slug( $post_id ) );
		$this->assertSame( 'draft-case', $this->stored_post_slug( $draft ) );
		$this->assertSame( 'how-to', $this->stored_term_slug( $term_id ) );
		$this->assertContains( 'case%2dstudy', get_post_meta( $post_id, '_wp_old_slug', false ) );

		$events = $this->queue->events();
		$this->assertSame(
			array( 'resource:update:' . $post_id, 'term:update:' . $term_id ),
			array_map( static fn( array $event ): string => $event['type'] . ':' . $event['event'] . ':' . $event['id'], $events )
		);
		$this->assertSame( 'how-to', $events[1]['slug'] );

		$this->assertSame( array(), ( new LegacySlugs() )->scan() );
	}

	/**
	 * A resource whose decoded slug another resource has is listed with the holder, and the save
	 * gives it core's suffix.
	 */
	public function test_post_collision_is_resolved_by_core(): void {
		$holder  = $this->make_resource( 'publish', 'case-study' );
		$post_id = $this->legacy_resource( 'publish', 'case%2dstudy' );

		$rows = ( new LegacySlugs() )->scan();

		$this->assertCount( 1, $rows );
		$this->assertFalse( $rows[0]['blocked'] );
		$this->assertSame( "resource #{$holder} (publish) has it; the save gives this one a suffix", $rows[0]['collision'] );

		$results = ( new LegacySlugs() )->apply();

		$this->assertSame( 'decoded', $results[0]['result'] );
		$this->assertSame( 'case-study-2', $this->stored_post_slug( $post_id ) );
	}

	/**
	 * A term whose decoded slug another term has is blocked: the dry run says so, and applying
	 * skips it without saving and reports why, while the other rows are still saved.
	 */
	public function test_term_collision_is_reported_and_skipped(): void {
		$holder  = $this->make_term( Taxonomies::TOPIC, 'case-study', 'Case study' );
		$term_id = $this->legacy_term( Taxonomies::TOPIC, 'case%2dstudy', 'Legacy case study' );
		$other   = $this->legacy_term( Taxonomies::TOPIC, 'ai%2dtools', 'AI tools' );

		$rows = ( new LegacySlugs() )->scan();

		$this->assertTrue( $rows[0]['blocked'] );
		$this->assertSame( "term #{$holder} has it; type a new slug for this one", $rows[0]['collision'] );
		$this->assertFalse( $rows[1]['blocked'] );

		$results = ( new LegacySlugs() )->apply();

		$this->assertSame( array( 'skipped', 'decoded' ), array_column( $results, 'result' ) );
		$this->assertSame( "term #{$holder} has it; type a new slug for this one", $results[0]['message'] );
		$this->assertSame( 'case%2dstudy', $this->stored_term_slug( $term_id ) );
		$this->assertSame( 'ai-tools', $this->stored_term_slug( $other ) );
	}

	/**
	 * Two legacy terms that decode to the same slug: the first is saved, the second is blocked,
	 * because core would refuse it once the first holds the slug.
	 */
	public function test_two_legacy_terms_decoding_alike(): void {
		$first  = $this->legacy_term( Taxonomies::TOPIC, 'case%2dstudy', 'First' );
		$second = $this->legacy_term( Taxonomies::TOPIC, 'case%2Dstudy', 'Second' );

		$rows = ( new LegacySlugs() )->scan();

		$this->assertSame( array( false, true ), array_column( $rows, 'blocked' ) );
		$this->assertSame( "term #{$first} decodes to it too; type a new slug for this one", $rows[1]['collision'] );

		( new LegacySlugs() )->apply();

		$this->assertSame( 'case-study', $this->stored_term_slug( $first ) );
		$this->assertSame( 'case%2Dstudy', $this->stored_term_slug( $second ) );
	}

	/**
	 * A cron publish of a scheduled resource writes only the status, so its legacy slug survives the
	 * publish; the command lists it and repairs it.
	 */
	public function test_cron_publish_leaves_the_slug_for_the_command(): void {
		$post_id = $this->legacy_resource( 'future', 'case%2dstudy' );

		wp_publish_post( $post_id );

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'case%2dstudy', $this->stored_post_slug( $post_id ) );
		$this->assertSame( array( $post_id ), array_column( ( new LegacySlugs() )->scan(), 'id' ) );

		( new LegacySlugs() )->apply();

		$this->assertSame( 'case-study', $this->stored_post_slug( $post_id ) );
	}

	/**
	 * A `webinar` resource in a status, whose stored slug is the given legacy slug, with nothing queued.
	 *
	 * @param string $status Post status.
	 * @param string $slug   The legacy slug.
	 */
	private function legacy_resource( string $status, string $slug ): int {
		$args    = 'future' === $status ? array( 'post_date' => gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS ) ) : array();
		$post_id = $this->with_legacy_post_slug(
			$slug,
			fn(): int => self::factory()->post->create(
				array_merge(
					array(
						'post_type'   => PostType::NAME,
						'post_status' => $status,
						'post_name'   => 'placeholder',
						'post_title'  => 'A resource',
					),
					$args
				)
			)
		);
		wp_set_object_terms( $post_id, array( $this->term_id( Taxonomies::TYPE, 'webinar' ) ), Taxonomies::TYPE );
		$this->queue->clear();

		$this->assertSame( $status, get_post_status( $post_id ) );
		$this->assertSame( $slug, $this->stored_post_slug( $post_id ), 'The legacy slug was not stored.' );

		return $post_id;
	}

	/**
	 * A term whose stored slug is the given legacy slug, with nothing queued.
	 *
	 * @param string $taxonomy Taxonomy.
	 * @param string $slug     The legacy slug.
	 * @param string $name     Term name.
	 */
	private function legacy_term( string $taxonomy, string $slug, string $name ): int {
		$term_id = $this->with_legacy_term_slug( $slug, fn(): int => $this->make_term( $taxonomy, sanitize_title( $name ) . '-placeholder', $name ) );

		$this->assertSame( $slug, $this->stored_term_slug( $term_id ), 'The legacy slug was not stored.' );

		return $term_id;
	}
}
