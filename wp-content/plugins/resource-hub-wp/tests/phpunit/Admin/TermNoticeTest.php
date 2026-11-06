<?php
/**
 * The last result as a notice on a topic's or type's edit screen (see `docs/architecture/revalidation.md`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Admin;

use ResourceHub\Admin\TermNotice;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use WP_UnitTestCase;

/**
 * Tests for {@see TermNotice}.
 */
final class TermNoticeTest extends WP_UnitTestCase {
	/**
	 * A term in one taxonomy holding a record.
	 *
	 * @param string                    $taxonomy Taxonomy.
	 * @param array<string, mixed>|null $record   The record, or null for none.
	 */
	private static function term_with( string $taxonomy, ?array $record ): int {
		$term_id = self::factory()->term->create( array( 'taxonomy' => $taxonomy ) );

		if ( null !== $record ) {
			update_term_meta( $term_id, ResultStore::META_KEY, $record );
		}

		return $term_id;
	}

	/**
	 * What the edit-form action's callback prints for a term.
	 *
	 * @param string $taxonomy Taxonomy.
	 * @param int    $term_id  Term.
	 */
	private static function printed( string $taxonomy, int $term_id ): string {
		ob_start();
		( new TermNotice() )->render( get_term( $term_id, $taxonomy ) );

		return (string) ob_get_clean();
	}

	/**
	 * Both taxonomies' edit screens show the notice through the edit-form action, as an inline notice
	 * whose class follows the result, with the sentence and the relative time.
	 *
	 * @dataProvider taxonomies
	 *
	 * @param string $taxonomy Taxonomy.
	 */
	public function test_notice_on_the_edit_screen( string $taxonomy ): void {
		$term_id = self::term_with(
			$taxonomy,
			ResultTextTest::record(
				array(
					'outcome' => Result::UNAUTHORIZED,
					'code'    => 401,
					'event'   => 'update',
				)
			)
		);

		$printed = self::printed( $taxonomy, $term_id );

		$this->assertNotFalse( has_action( $taxonomy . '_term_edit_form_top' ) );
		$this->assertStringContainsString( 'class="notice notice-error inline"', $printed );
		$this->assertStringContainsString( 'Front-end revalidation:', $printed );
		$this->assertStringContainsString( 'Revalidation rejected: the secret does not match (401).', $printed );
		$this->assertMatchesRegularExpression( '/\(.+ ago\)/', $printed );
	}

	/**
	 * Cases for test_notice_on_the_edit_screen().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function taxonomies(): array {
		return array(
			'topic' => array( Taxonomies::TOPIC ),
			'type'  => array( Taxonomies::TYPE ),
		);
	}

	/**
	 * A success is a success notice; a term with no record prints nothing; the flag taxonomy has no notice.
	 */
	public function test_success_and_absence(): void {
		$sent = self::term_with(
			Taxonomies::TOPIC,
			ResultTextTest::record(
				array(
					'status'  => Result::SENT,
					'outcome' => Result::OK,
					'code'    => 200,
				)
			)
		);
		$this->assertStringContainsString( 'notice-success', self::printed( Taxonomies::TOPIC, $sent ) );
		$this->assertStringContainsString( 'The front end accepted the revalidation (200).', self::printed( Taxonomies::TOPIC, $sent ) );

		$none = self::term_with( Taxonomies::TOPIC, null );
		$this->assertSame( '', self::printed( Taxonomies::TOPIC, $none ) );

		$this->assertFalse( has_action( Taxonomies::FLAG . '_term_edit_form_top' ) );
	}

	/**
	 * A fresh `pending` reads as pending with a warning; one older than five minutes reads as no answer recorded.
	 */
	public function test_stale_pending(): void {
		$written = 1_800_000_000;
		$term_id = self::term_with(
			Taxonomies::TYPE,
			ResultTextTest::record(
				array(
					'status'  => ResultStore::PENDING,
					'outcome' => ResultStore::PENDING,
					'code'    => null,
					'time'    => gmdate( 'Y-m-d\TH:i:s\Z', $written ),
				)
			)
		);

		$fresh = TermNotice::notice( $term_id, $written + 30 );
		$this->assertStringContainsString( 'notice-warning', $fresh );
		$this->assertStringContainsString( 'Revalidation is pending', $fresh );

		$stale = TermNotice::notice( $term_id, $written + 600 );
		$this->assertStringContainsString( 'No answer recorded: the send may not have run.', $stale );
	}

	/**
	 * The sentence and the quoted error are escaped, and the body is never printed.
	 */
	public function test_escaping_and_no_body(): void {
		$term_id = self::term_with(
			Taxonomies::TOPIC,
			ResultTextTest::record(
				array(
					'outcome' => Result::TRANSPORT_ERROR,
					'code'    => null,
					'error'   => 'cURL <script>alert(1)</script>',
					'body'    => 'BODY-MUST-NOT-APPEAR',
				)
			)
		);

		$printed = TermNotice::notice( $term_id );

		$this->assertStringNotContainsString( '<script>', $printed );
		$this->assertStringContainsString( 'cURL &lt;script&gt;', $printed );
		$this->assertStringNotContainsString( 'BODY-MUST-NOT-APPEAR', $printed );
	}
}
